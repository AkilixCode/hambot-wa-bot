/**
 * Enhanced Message Handler
 * Main message processing with improved architecture
 */

require('dotenv').config();
const config = require('./config');
const cache = require('./utils/cache');
const RateLimiter = require('./utils/rate-limiter');
const logger = require('./utils/logger');
const commandRegistry = require('./commands/registry');
const path = require('path');

// Initialize rate limiter
const rateLimiter = new RateLimiter(
    config.performance.rateLimitWindow,
    config.performance.rateLimitMax
);

// Queue management
let activeProcesses = 0;
const userCooldowns = new Map();

/**
 * Main message handler
 */
module.exports = async (sock, m) => {
    const startTime = Date.now();
    let isHeavyCommand = false;
    let command = null;

    try {
        const msg = m.messages[0];
        if (!msg.message) return;
        if (msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const sender = msg.key.participant || from;
        const isGroup = from.endsWith('@g.us');

        // Extract text content
        const content = msg.message?.conversation ||
                        msg.message?.extendedTextMessage?.text ||
                        msg.message?.imageMessage?.caption ||
                        "";

        let textBody = content.trim();
        
        // Check for command prefix
        if (!textBody.startsWith(config.bot.prefix)) return;
        
        // Clean up prefix
        if (textBody.startsWith(config.bot.prefix + ' ')) {
            textBody = config.bot.prefix + textBody.slice(2).trim();
        }

        const commandName = textBody.split(' ')[0].toLowerCase().slice(config.bot.prefix.length);
        const args = textBody.trim().split(/ +/).slice(1);

        // Get command from registry
        command = commandRegistry.get(commandName);
        if (!command) return; // Unknown command, ignore

        // Build context
        const context = {
            from,
            sender,
            isGroup,
            commandName,
            startTime
        };

        // Log command
        logger.command(logger.formatCommand(commandName, sender, from, isGroup));

        // --- Rate Limiting ---
        const rateLimit = rateLimiter.check(sender);
        if (!rateLimit.allowed) {
            return sock.sendMessage(from, { 
                text: `⏳ Rate limit exceeded. Try again in ${rateLimit.retryAfter} seconds.` 
            }, { quoted: msg });
        }

        // --- Cooldown (Simple anti-spam) ---
        if (userCooldowns.has(sender)) {
            return;
        }
        userCooldowns.set(sender, true);
        setTimeout(() => userCooldowns.delete(sender), command.cooldown || config.performance.cooldownMs);

        // --- Queue Management for Heavy Commands ---
        isHeavyCommand = command.isHeavy;
        if (isHeavyCommand) {
            if (activeProcesses >= config.performance.maxProcesses) {
                return sock.sendMessage(from, { 
                    text: `⚠️ Server busy (${activeProcesses}/${config.performance.maxProcesses}). Please wait...` 
                }, { quoted: msg });
            }
            activeProcesses++;
        }

        // --- Validate Command ---
        const validation = await command.validate(msg, context);
        if (!validation.valid) {
            return sock.sendMessage(from, { text: validation.error }, { quoted: msg });
        }

        // --- Execute Command ---
        await command.execute(sock, msg, args, context);

        // Log performance
        const duration = Date.now() - startTime;
        command.log(context, duration, true);

    } catch (err) {
        logger.error(err, { 
            command: command?.name || 'unknown',
            sender: m.messages[0]?.key?.participant || 'unknown'
        });

        // Send error message to user
        try {
            const from = m.messages[0]?.key?.remoteJid;
            if (from) {
                await sock.sendMessage(from, { 
                    text: '❌ An error occurred while processing your command.' 
                }, { quoted: m.messages[0] });
            }
        } catch (sendError) {
            logger.error(sendError, { context: 'error-message-send' });
        }

    } finally {
        if (isHeavyCommand && activeProcesses > 0) {
            activeProcesses--;
        }
    }
};

// Load all commands
try {
    const commandsPath = path.join(__dirname, 'commands');
    commandRegistry.loadFromDirectory(commandsPath);
    logger.info('Command system initialized');
} catch (error) {
    logger.error(error, { context: 'command-loading' });
}

// Graceful shutdown
process.on('SIGINT', async () => {
    logger.info('Shutting down handler...');
    cache.destroy();
    rateLimiter.destroy();
    process.exit(0);
});
