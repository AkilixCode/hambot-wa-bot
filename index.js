require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const config = require('./config');
const logger = require('./utils/logger');
const browserManager = require('./utils/browser-manager');
const cache = require('./utils/cache');
const security = require('./utils/security');

// Use the modular handler directly
const handler = require('./handler');

let sock = null;

async function startBot() {
    try {
        // Validate configuration
        config.validate();
        
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

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log('\n📱 Scan QR Code below:\n');
                qrcode.generate(qr, { small: true });
                console.log('\n');
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
                    logger.info('Logged out, please restart and scan QR again');
                    process.exit(0);
                }
            } else if (connection === 'open') {
                logger.info(`✅ ${config.bot.name} connected to WhatsApp!`);
            }
        });

        sock.ev.on('messages.upsert', async m => {
            if (m.type === 'notify') {
                await handler(sock, m).catch(error => {
                    logger.error(error, { context: 'message-handler' });
                });
            }
        });

    } catch (error) {
        logger.error(error, { context: 'bot-startup' });
        process.exit(1);
    }
}

// Graceful shutdown
async function shutdown() {
    logger.info('Shutting down gracefully...');

    try {
        // Close WhatsApp connection
        if (sock) {
            await sock.end();
        }

        // Cleanup browser
        await browserManager.destroy();

        // Cleanup cache
        cache.destroy();

        logger.info('Shutdown complete');
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
