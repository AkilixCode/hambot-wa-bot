/**
 * Enhanced Message Handler with Security
 * Main message processing with security controls
 */

require('dotenv').config({ quiet: true });
const config = require('./config');
const cache = require('./utils/cache');
const RateLimiter = require('./utils/rate-limiter');
const logger = require('./utils/logger');
const security = require('./utils/security');
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
 * Main message handler with security
 */
module.exports = async (sock, m) => {
    const startTime = Date.now();
    let isHeavyCommand = false;
    let command = null;
    let tracker = null;

    try {
        const msg = m.messages[0];
        if (!msg.message) return;
        if (msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const sender = msg.key.participant || from;
        const isGroup = from.endsWith('@g.us');

        // Private mode: ignore private messages if ONLY_GROUP_MODE is enabled
        if (config.bot.onlyGroupMode && !isGroup) {
            return; // Silently ignore private messages
        }

        // SECURITY: Check if user is blocked
        if (security.isUserBlocked(sender)) {
            logger.warn('Blocked user attempted command', { userId: sender.split('@')[0] });
            return; // Silently ignore
        }

        const isOwnerSender = config.isOwner(sender);

        // SECURITY: Lockdown (panic mode) — serve nobody but the owner.
        // Silent by design: a reply would confirm the bot is alive and tell an
        // attacker exactly when the owner is present.
        if (security.isLockdownEnabled() && !isOwnerSender) {
            return;
        }

        // Extract text content
        const content = msg.message?.conversation ||
                        msg.message?.extendedTextMessage?.text ||
                        msg.message?.imageMessage?.caption ||
                        "";

        let textBody = content.trim();
        
        // Check for command prefix
        if (!textBody.startsWith(config.bot.prefix)) return;
        
        // SECURITY: Sanitize input
        textBody = security.sanitizeInput(textBody, 2000);
        
        // Clean up prefix
        if (textBody.startsWith(config.bot.prefix + ' ')) {
            textBody = config.bot.prefix + textBody.slice(2).trim();
        }

        const commandName = textBody.split(' ')[0].toLowerCase().slice(config.bot.prefix.length);
        const args = textBody.trim().split(/ +/).slice(1);

        // SECURITY: Detect malicious patterns.
        // Both the .env setting and the runtime toggle (.security disable chatFilter)
        // must be on — previously the runtime toggle was ignored here, so turning
        // the filter off from chat silently did nothing.
        if (config.security.chatFilterEnabled && security.isFeatureEnabled('chatFilter')) {
            const maliciousCheck = security.detectMaliciousPatterns(textBody);
            if (maliciousCheck.isMalicious) {
                security.logSecurityEvent('malicious_pattern_detected', {
                    userId: sender,
                    command: commandName,
                    pattern: maliciousCheck.pattern
                });
                
                security.trackSuspiciousActivity(sender, 'malicious_pattern');
                
                return await sock.sendMessage(from, { 
                    text: '⚠️ Pesanmu mengandung pola mencurigakan dan diblokir karena alasan keamanan.' 
                }, { quoted: msg });
            }
        }

        // Get command from registry
        command = commandRegistry.get(commandName);
        if (!command) return; // Unknown command, ignore

        // SECURITY: always authorise against the canonical command name.
        // `commandName` is raw user input, so an alias (e.g. `.sec` for
        // `security`) would otherwise miss the owner-only allowlist entirely.
        const canonicalName = command.name;

        // Runtime-disabled commands (owner can still use them to test)
        if (commandRegistry.isDisabled(canonicalName) && !isOwnerSender) {
            return await sock.sendMessage(from, {
                text: '🚫 Perintah ini sedang dinonaktifkan sementara oleh owner.'
            }, { quoted: msg });
        }

        // Build context
        const context = {
            from,
            sender,
            isGroup,
            isOwner: isOwnerSender,
            commandName: canonicalName,
            invokedAs: commandName,
            startTime
        };

        // Start tracking this command execution
        tracker = logger.commandStart(canonicalName, sender, from, isGroup, command);

        // SECURITY: Validate command arguments
        const argsValidation = security.validateCommandArgs(canonicalName, args);
        if (!argsValidation.valid) {
            security.logSecurityEvent('invalid_arguments', {
                userId: sender,
                command: canonicalName,
                reason: argsValidation.reason
            });
            
            logger.commandEnd(tracker, 'blocked', argsValidation.reason);
            return await sock.sendMessage(from, { 
                text: `⚠️ Keamanan: ${argsValidation.reason}` 
            }, { quoted: msg });
        }

        // SECURITY: Check permissions (against the canonical name, never the alias)
        const permission = security.checkPermission(sender, canonicalName, isGroup);
        if (!permission.allowed) {
            // Repeated probing of owner-only commands earns an escalating block
            const attempt = config.isOwnerOnlyCommand(canonicalName)
                ? security.registerUnauthorizedAttempt(sender, `${canonicalName} ${args.join(' ')}`)
                : { blocked: false };

            if (!attempt.blocked) {
                security.logSecurityEvent('permission_denied', {
                    userId: sender,
                    command: canonicalName,
                    reason: permission.reason
                });
            }

            logger.commandEnd(tracker, 'blocked', permission.reason);
            return await sock.sendMessage(from, {
                text: attempt.blocked
                    ? `🔒 Akses Ditolak: ${permission.reason}\n\n⛔ Terlalu banyak percobaan. Kamu diblokir selama ${attempt.blockMinutes} menit.`
                    : `🔒 Akses Ditolak: ${permission.reason}`
            }, { quoted: msg });
        }

        // --- Rate Limiting ---
        const rateLimit = rateLimiter.check(sender);
        if (!rateLimit.allowed) {
            security.trackSuspiciousActivity(sender, 'rate_limit_exceeded');
            logger.commandEnd(tracker, 'blocked', `Rate limit exceeded (retry in ${rateLimit.retryAfter}s)`);
            return sock.sendMessage(from, { 
                text: `⏳ Batas request tercapai. Coba lagi dalam ${rateLimit.retryAfter} detik.` 
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
                logger.commandEnd(tracker, 'busy', `Server busy (${activeProcesses}/${config.performance.maxProcesses})`);
                return sock.sendMessage(from, { 
                    text: `⚠️ Server sibuk (${activeProcesses}/${config.performance.maxProcesses}). Mohon tunggu...` 
                }, { quoted: msg });
            }
            activeProcesses++;
        }

        // --- Validate Command ---
        const validation = await command.validate(msg, context);
        if (!validation.valid) {
            logger.commandEnd(tracker, 'failed', validation.error);
            return sock.sendMessage(from, { text: validation.error }, { quoted: msg });
        }

        // --- Execute Command ---
        await command.execute(sock, msg, args, context);

        // Check if command self-reported failure via logError()
        if (context._failed) {
            logger.commandEnd(tracker, 'failed', context._failError);
        } else {
            logger.commandEnd(tracker, 'done');
        }

    } catch (err) {
        // Log the failure with the tracker if available
        if (tracker) {
            logger.commandEnd(tracker, 'failed', err);
        } else {
            logger.error(err, { 
                command: command?.name || 'unknown',
                sender: m.messages[0]?.key?.participant || 'unknown'
            });
        }

        // SECURITY: Track errors as potential security events
        if (err.message && (err.message.includes('injection') || err.message.includes('attack'))) {
            const sender = m.messages[0]?.key?.participant || m.messages[0]?.key?.remoteJid;
            security.trackSuspiciousActivity(sender, 'error_based_attack');
        }

        // Send error message to user
        try {
            const from = m.messages[0]?.key?.remoteJid;
            if (from) {
                await sock.sendMessage(from, { 
                    text: '❌ Terjadi kesalahan saat memproses perintahmu.' 
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
    logger.system(`Command system initialized (${commandsPath})`);
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
