require('dotenv').config({ quiet: true });
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const config = require('./config');
const logger = require('./utils/logger');
const cache = require('./utils/cache');
const security = require('./utils/security');
const egress = require('./utils/egress');
const tempdir = require('./utils/tempdir');
const socketRef = require('./utils/socket-ref');
const login = require('./utils/login');
const health = require('./utils/health');
const session = require('./utils/session');

// Use the modular handler directly
const handler = require('./handler');

// Baileys is ESM-only since v7 — must use dynamic import()
let makeWASocket, useMultiFileAuthState;

let sock = null;

// Where Baileys keeps the linked session (a Docker volume in production).
// HAMBOT_AUTH_DIR exists for the tests, which must never touch a real session.
const AUTH_DIR = process.env.HAMBOT_AUTH_DIR || 'auth_info_baileys';

// Survive reconnects within this process: backoff state, and how many
// pairing codes were already requested (capped, then QR — see utils/login).
let closeCounters = session.freshCounters();
let pairingCodesIssued = 0;
let reconnectTimer = null;
let startupLogged = false;

// Baileys can sit in "connecting" forever when WhatsApp's servers are
// unreachable (outbound traffic dropped by a firewall, broken IPv6, a blocked
// network): no QR, no error, no close. Give up on the socket after this long
// and retry with backoff, saying why.
const CONNECT_WATCHDOG_MS = Number(process.env.HAMBOT_CONNECT_TIMEOUT_MS) || 45 * 1000;
let connectWatchdog = null;

/**
 * Detach and close the current socket before a new one replaces it.
 */
function retireSocket() {
    if (!sock) return;
    for (const event of ['creds.update', 'connection.update', 'messages.upsert']) {
        try { sock.ev.removeAllListeners(event); } catch { /* already gone */ }
    }
    try { sock.end(undefined); } catch { /* already closed */ }
}

/**
 * Schedule the next startBot(), replacing any pending one.
 * @param {number} delayMs
 */
function scheduleStart(delayMs) {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => startBot(), delayMs);
}

/**
 * React to a closed connection according to why it closed
 * (see utils/session.decideOnClose).
 * @param {Object} [lastDisconnect]
 */
function handleClose(lastDisconnect) {
    const statusCode = lastDisconnect?.error?.output?.statusCode;
    const decision = session.decideOnClose(statusCode, closeCounters);
    closeCounters = decision.next;

    // logger.system, not warn: this is shown in the default "simple" log
    // mode too, so a failing connection is never silent.
    const reason = lastDisconnect?.error?.message;
    logger.system(`Disconnected (${statusCode ?? 'no code'}${reason ? `: ${reason}` : ''}) — ${decision.message}`);

    if (decision.action === 'relink') {
        try {
            const archived = session.archiveSession(AUTH_DIR);
            if (archived) {
                console.log([
                    '',
                    '  The old session was archived, not deleted:',
                    `    ${archived}`,
                    '  If this was a mistake: ./deploy.sh restore-session',
                    '  (or move those files back into auth_info_baileys/).',
                    '  A new pairing code or QR code follows below.',
                    ''
                ].join('\n'));
            }
        } catch (error) {
            logger.error(error, { context: 'session-archive' });
        }
        pairingCodesIssued = 0;
        scheduleStart(decision.delayMs);
    } else if (decision.action === 'stop') {
        // Stay up without reconnecting; the health check turns unhealthy.
        health.report('close');
    } else {
        scheduleStart(decision.delayMs);
    }
}

async function startBot() {
    try {
        // Dynamically import ESM-only Baileys module (cached after first call)
        if (!makeWASocket) {
            const baileys = await import('@whiskeysockets/baileys');
            makeWASocket = baileys.default;
            useMultiFileAuthState = baileys.useMultiFileAuthState;
        }

        // Validate configuration
        config.validate();

        // Show how the owner number was understood, once, so a typo in
        // BOT_OWNER_ID is visible in the first lines of the log.
        if (!startupLogged) {
            startupLogged = true;
            const owners = config.getOwnerIds();
            logger.info(owners.length
                ? `Owner: ${owners.join(', ')} (wrong? ./deploy.sh config)`
                : 'Owner: NOT SET — owner-only commands are disabled (set it with ./deploy.sh config)');
        }

        // Reapply the persisted proxy toggle before any command can run, so
        // `.security proxy on` survives a restart instead of silently reverting
        // to whatever PROXY_ENABLED happens to say.
        egress.restore();

        // Remove scratch files an earlier crash left behind. Non-blocking:
        // a failed sweep must never prevent the bot from starting.
        tempdir.sweepStale().catch(() => {});

        // Safety fallback: Clear any blocks on owner IDs on startup
        // This prevents owner from being locked out if accidentally blocked
        const clearedBlocks = security.clearOwnerBlocks();
        if (clearedBlocks > 0) {
            logger.info(`Safety fallback: Cleared ${clearedBlocks} block(s) on owner IDs`);
        }
        
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

        // Detach the previous socket first: startBot() runs again on every
        // reconnect, and without this each dead socket kept its listeners.
        retireSocket();

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: config.logging.silent ? 'silent' : 'fatal' }),
            browser: config.bot.browser,
            // Test hook: point the socket at a local stub instead of WhatsApp.
            ...(process.env.HAMBOT_WA_URL ? { waWebSocketUrl: process.env.HAMBOT_WA_URL } : {})
        });
        socketRef.set(sock);
        health.report('connecting');

        sock.ev.on('creds.update', saveCreds);

        // How to link this device if there are no saved credentials yet.
        // An invalid PAIRING_NUMBER is reported and falls back to the QR code
        // rather than stopping the bot.
        const pairing = login.parsePairingNumber(process.env.PAIRING_NUMBER);
        if (pairing.error) logger.system(`${pairing.error} — falling back to the QR code`);
        const { method, notice } = login.chooseLoginMethod({
            registered: Boolean(state.creds?.registered),
            pairingNumber: pairing.number,
            preference: process.env.LOGIN_METHOD,
            codesIssued: pairingCodesIssued
        });
        if (notice) logger.system(notice);

        // Baileys re-emits `qr` every ~20s until linked. A pairing code is
        // requested at most once per socket and a limited number of times per
        // process (see chooseLoginMethod); a failed request falls back to QR.
        let pairingRequested = false;
        let pairingFailed = false;
        const thisSock = sock;

        clearTimeout(connectWatchdog);
        connectWatchdog = setTimeout(() => {
            if (sock !== thisSock) return;
            logger.system(`No answer from WhatsApp after ${Math.round(CONNECT_WATCHDOG_MS / 1000)}s. ` +
                'Check that this server can reach the internet (outbound HTTPS/443 to web.whatsapp.com; DNS; firewall).');
            handleClose({ error: { message: 'no answer from WhatsApp', output: { statusCode: session.REASON.timedOut } } });
        }, CONNECT_WATCHDOG_MS);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr || connection === 'open' || connection === 'close') clearTimeout(connectWatchdog);

            // Feeds the Docker HEALTHCHECK (scripts/healthcheck.js).
            if (qr) health.report('linking');
            if (connection) health.report(connection);

            if (qr && method === 'pairing' && !pairingRequested) {
                pairingRequested = true;
                pairingCodesIssued++;
                try {
                    const code = await thisSock.requestPairingCode(pairing.number);
                    console.log(login.pairingInstructions(code, pairing.number));
                } catch (error) {
                    pairingFailed = true;
                    logger.system(`Pairing code request failed (${error.message}) — use the QR code instead`);
                }
            }

            if (qr && (method !== 'pairing' || pairingFailed)) {
                console.log('\n📱 Scan QR Code below:\n');
                qrcode.generate(qr, { small: true });
                console.log('\n');
                login.writeQrPng(qr)
                    .then(file => console.log(`   (also saved as ${file})\n`))
                    .catch(error => logger.warn(`Could not save QR image: ${error.message}`));
            }

            if (connection === 'close') {
                handleClose(lastDisconnect);
            } else if (connection === 'open') {
                closeCounters = session.freshCounters();
                pairingCodesIssued = 0;
                logger.system(`✅ ${config.bot.name} connected to WhatsApp!`);
                login.removeQrPng();
            }
        });

        sock.ev.on('messages.upsert', async ({ type, messages }) => {
            if (type === 'notify') {
                // Process ALL messages in the batch, not just the first
                for (const msg of messages) {
                    await handler(sock, { messages: [msg], type }).catch(error => {
                        logger.error(error, { context: 'message-handler' });
                    });
                }
            }
        });

    } catch (error) {
        logger.error(error, { context: 'bot-startup' });
        process.exit(1);
    }
}

// Graceful shutdown
async function shutdown() {
    logger.system('Shutting down gracefully...');

    try {
        // Close WhatsApp connection
        // Detach first, so closing the socket doesn't schedule a reconnect.
        clearTimeout(reconnectTimer);
        clearTimeout(connectWatchdog);
        retireSocket();

        // Cleanup cache
        cache.destroy();

        logger.system('Shutdown complete');
        process.exit(0);
    } catch (error) {
        logger.error(error, { context: 'shutdown' });
        process.exit(1);
    }
}

// Handle shutdown signals
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    logger.error(error, { context: 'uncaught-exception' });
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error(new Error(String(reason)), { context: 'unhandled-rejection' });
});

// Start the bot when run directly (`node index.js`). Tests require this file
// to exercise handleClose() without connecting to WhatsApp.
if (require.main === module) {
    startBot();
}

module.exports = {
    handleClose,
    cancelScheduledStart: () => { clearTimeout(reconnectTimer); clearTimeout(connectWatchdog); }
};
