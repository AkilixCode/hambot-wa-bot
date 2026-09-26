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

// Use the modular handler directly
const handler = require('./handler');

// Baileys is ESM-only since v7 — must use dynamic import()
let makeWASocket, useMultiFileAuthState, DisconnectReason;

let sock = null;

async function startBot() {
    try {
        // Dynamically import ESM-only Baileys module (cached after first call)
        if (!makeWASocket) {
            const baileys = await import('@whiskeysockets/baileys');
            makeWASocket = baileys.default;
            useMultiFileAuthState = baileys.useMultiFileAuthState;
            DisconnectReason = baileys.DisconnectReason;
        }

        // Validate configuration
        config.validate();

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
        
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: config.logging.silent ? 'silent' : 'fatal' }),
            browser: config.bot.browser
        });
        socketRef.set(sock);
        health.report('connecting');

        sock.ev.on('creds.update', saveCreds);

        // How to link this device if there are no saved credentials yet.
        // An invalid PAIRING_NUMBER is reported and falls back to the QR code
        // rather than stopping the bot.
        const pairing = login.parsePairingNumber(process.env.PAIRING_NUMBER);
        if (pairing.error) logger.warn(`${pairing.error} — falling back to the QR code`);
        const method = login.loginMethod({
            registered: Boolean(state.creds?.registered),
            pairingNumber: pairing.number
        });
        // Baileys re-emits `qr` every ~20s until linked; a pairing code is
        // requested once per socket, and a failed request falls back to QR.
        let pairingRequested = false;
        let pairingFailed = false;

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            // Feeds the Docker HEALTHCHECK (scripts/healthcheck.js).
            if (qr) health.report('linking');
            if (connection) health.report(connection);

            if (qr && method === 'pairing' && !pairingRequested) {
                pairingRequested = true;
                try {
                    const code = await sock.requestPairingCode(pairing.number);
                    console.log(login.pairingInstructions(code, pairing.number));
                } catch (error) {
                    pairingFailed = true;
                    logger.warn(`Pairing code request failed (${error.message}) — use the QR code instead`);
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
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                logger.warn(`Connection closed`, { 
                    statusCode, 
                    shouldReconnect,
                    reason: lastDisconnect?.error?.message 
                });

                if (shouldReconnect) {
                    setTimeout(() => startBot(), 3000);
                } else {
                    logger.info('Logged out, please restart and link the number again');
                    process.exit(0);
                }
            } else if (connection === 'open') {
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
        if (sock) {
            await sock.end();
        }

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

// Start the bot
startBot();
