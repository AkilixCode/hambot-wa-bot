/**
 * Enhanced Message Handler with Security
 * Main message processing with security controls
 */

require('dotenv').config({ quiet: true });
const config = require('./config');
const RateLimiter = require('./utils/rate-limiter');
const logger = require('./utils/logger');
const security = require('./utils/security');
const ui = require('./utils/ui');
const commandRegistry = require('./commands/registry');
const { withCorrectionNote, correctionNote } = require('./utils/correction');
const path = require('path');

// Initialize rate limiter
const rateLimiter = new RateLimiter(
    config.performance.rateLimitWindow,
    config.performance.rateLimitMax
);

// Queue management
let activeProcesses = 0;
// sender JID -> { warned: boolean, expiresAt: number }
const userCooldowns = new Map();

/**
 * Is this sender an admin of this group?
 *
 * Reading group metadata costs an API round trip, so callers should only ask
 * when a command actually gates on it — not on every incoming message.
 *
 * @param {Object} sock
 * @param {string} groupJid
 * @param {string} senderJid
 * @returns {Promise<boolean>} False when membership cannot be established
 */
async function isGroupAdmin(sock, groupJid, senderJid) {
    try {
        const metadata = await sock.groupMetadata(groupJid);
        // Participant IDs may be reported as @lid or @s.whatsapp.net depending
        // on the group, so fall back to comparing the bare number.
        const senderNumber = senderJid.split('@')[0].split(':')[0];
        const participant = metadata.participants.find(p =>
            p.id === senderJid || p.id.split('@')[0].split(':')[0] === senderNumber
        );

        return participant ? ['admin', 'superadmin'].includes(participant.admin) : false;
    } catch (error) {
        // If the roster cannot be read we cannot prove the sender is an admin,
        // so deny rather than assume.
        logger.warn('Group metadata unavailable for admin check', { context: 'admin-check' });
        return false;
    }
}

/**
 * Point a user at the right command when they mistype one.
 *
 * Unknown commands used to be dropped in total silence, which made a typo
 * indistinguishable from the bot being offline.
 *
 * @param {Object} sock
 * @param {Object} msg
 * @param {string} from Chat JID
 * @param {string} sender Sender JID
 * @param {string} commandName The unrecognised name the user typed
 * @param {boolean} isOwnerSender
 */
async function sendUnknownCommandHint(sock, msg, from, sender, commandName, isOwnerSender, match = null) {
    if (!commandName || commandName.length > 32) return;

    // Never suggest owner-only commands to anyone else — the menu hides
    // them on purpose, and a typo must not become a way to enumerate them.
    const visible = name => isOwnerSender || !config.isOwnerOnlyCommand(name);

    // Edit-distance candidates first (ties the matcher could not break),
    // then prefix completions such as `.transl` for `.translate`.
    const suggestions = [...new Set([
        ...(match?.candidates || []).filter(visible),
        ...commandRegistry.suggest(commandName, { filter: visible })
    ])].slice(0, 3);

    // Stay quiet unless there is something useful to say. Replying to every
    // stray message that merely starts with the prefix would make the bot noisy
    // in groups.
    if (suggestions.length === 0) return;

    // This runs before the normal rate-limit check further down, so it has to
    // spend a token itself. Otherwise unknown commands would be an unmetered
    // way to make the bot send messages.
    if (!rateLimiter.check(sender).allowed) return;

    const prefix = config.bot.prefix;
    await sock.sendMessage(from, {
        text: ui.error(`Perintah ${ui.mono(prefix + ui.safe(commandName, 32))} tidak dikenal.`, {
            title: 'Tidak Dikenal',
            hint: [
                ...suggestions.map(name => `${prefix}${name}`),
                `${prefix}menu ${ui.SYM.dot} daftar semua perintah`
            ]
        })
    }, { quoted: msg });
}

/**
 * Resolve a command the user mistyped, if the guess is safe to act on.
 *
 * Owner-only commands are never guessed, not even for the owner: a typo in
 * `.security` must not quietly run a different panel action, and a guess
 * must not reveal the hidden commands to anyone else.
 *
 * @param {string} commandName What the user typed after the prefix
 * @returns {{command: Object|null, match: Object}} command set only when the
 *   match is unambiguous
 */
function resolveTypo(commandName) {
    const match = commandRegistry.match(commandName, {
        filter: name => !config.isOwnerOnlyCommand(name)
    });
    const command = match.confident ? commandRegistry.get(match.name) : null;
    return { command, match };
}

/**
 * Split a prefixed message into a command name and its arguments.
 *
 * Tolerates a space after the prefix (`. menu`) for any prefix length — this
 * used to be `slice(2)`, which only worked for single-character prefixes —
 * and ends the command name at any whitespace, so `.menu` followed by a
 * newline is still `menu`. Arguments keep splitting on spaces only, so a
 * multi-line argument (e.g. for `.say`) keeps its line breaks.
 *
 * @param {string} text Message text, already known to start with the prefix
 * @param {string} prefix
 * @returns {{commandName: string, args: string[]}}
 */
function parseCommand(text, prefix) {
    const body = text.slice(prefix.length).replace(/^\s+/, '');
    const commandToken = body.match(/^\S*/)[0];
    const args = body.slice(commandToken.length).trim().split(/ +/).filter(Boolean);
    return { commandName: commandToken.toLowerCase(), args };
}

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
        
        const { commandName, args } = parseCommand(textBody, config.bot.prefix);

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
                    text: ui.warn('Pesanmu mengandung pola yang mencurigakan, jadi diblokir demi keamanan.', {
                        title: 'Diblokir',
                        hint: ['Kirim ulang tanpa karakter atau perintah aneh']
                    })
                }, { quoted: msg });
            }
        }

        // Get command from registry, forgiving an unambiguous typo.
        // Everything after this point (permissions, rate limit, cooldown)
        // applies to the corrected command exactly as if it had been typed.
        command = commandRegistry.get(commandName);
        let correctedFrom = null;
        if (!command) {
            const { command: guessed, match } = resolveTypo(commandName);
            if (!guessed) {
                await sendUnknownCommandHint(sock, msg, from, sender, commandName, isOwnerSender, match);
                return;
            }
            command = guessed;
            correctedFrom = commandName;
            sock = withCorrectionNote(sock, correctionNote(
                config.bot.prefix + commandName,
                config.bot.prefix + command.name
            ));
            logger.info(`Typo corrected: "${commandName}" -> "${command.name}"`);
        }

        // SECURITY: always authorise against the canonical command name.
        // `commandName` is raw user input, so an alias (e.g. `.sec` for
        // `security`) would otherwise miss the owner-only allowlist entirely.
        const canonicalName = command.name;

        // Runtime-disabled commands (owner can still use them to test)
        if (commandRegistry.isDisabled(canonicalName) && !isOwnerSender) {
            return await sock.sendMessage(from, {
                text: ui.warn('Perintah ini sedang dimatikan sementara oleh owner.', {
                    title: 'Nonaktif',
                    icon: ui.EMOJI.blocked,
                    hint: [`${config.bot.prefix}menu ${ui.SYM.dot} lihat perintah lain yang aktif`]
                })
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
            correctedFrom,
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
                text: ui.warn(argsValidation.reason, {
                    title: 'Argumen Ditolak',
                    hint: [`${config.bot.prefix}menu ${canonicalName} ${ui.SYM.dot} lihat cara pakai yang benar`]
                })
            }, { quoted: msg });
        }

        // SECURITY: Check permissions (against the canonical name, never the alias).
        // Group-admin status is resolved lazily — only commands that actually
        // gate on it are worth an extra metadata round trip. The owner always
        // counts as an admin of their own bot.
        const needsAdmin = isGroup && config.isAdminOnlyCommand(canonicalName);
        const isAdmin = needsAdmin
            ? (isOwnerSender || await isGroupAdmin(sock, from, sender))
            : false;

        const permission = security.checkPermission(sender, canonicalName, isGroup, isAdmin);
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
                text: ui.error(permission.reason, {
                    title: 'Akses Ditolak',
                    icon: ui.EMOJI.locked,
                    hint: attempt.blocked
                        ? [`Terlalu banyak percobaan — kamu diblokir ${attempt.blockMinutes} menit`]
                        : [`${config.bot.prefix}menu ${ui.SYM.dot} perintah yang bisa kamu pakai`]
                })
            }, { quoted: msg });
        }

        // --- Rate Limiting ---
        // `.security disable rateLimit` flips this toggle; it used to be
        // displayed in the panel but never consulted.
        const rateLimit = security.isFeatureEnabled('rateLimit')
            ? rateLimiter.check(sender)
            : { allowed: true };
        if (!rateLimit.allowed) {
            security.trackSuspiciousActivity(sender, 'rate_limit_exceeded');
            logger.commandEnd(tracker, 'blocked', `Rate limit exceeded (retry in ${rateLimit.retryAfter}s)`);
            return sock.sendMessage(from, {
                text: ui.warn(`Kamu sudah mencapai batas permintaan. Coba lagi dalam ${rateLimit.retryAfter} detik.`, {
                    title: 'Terlalu Banyak Permintaan',
                    icon: ui.EMOJI.wait
                })
            }, { quoted: msg });
        }

        // --- Cooldown (Simple anti-spam) ---
        const cooldown = userCooldowns.get(sender);
        if (cooldown) {
            // Say something the first time only. Repeating the notice for every
            // dropped message would turn one impatient user into a flood, but
            // dropping all of them in silence (the previous behaviour) left the
            // user thinking the bot was dead.
            if (!cooldown.warned) {
                cooldown.warned = true;
                const wait = Math.max(1, Math.ceil((cooldown.expiresAt - Date.now()) / 1000));
                logger.commandEnd(tracker, 'blocked', 'Cooldown active');
                return sock.sendMessage(from, {
                    text: ui.warn(`Sabar sedikit — tunggu ${wait} detik sebelum perintah berikutnya.`, {
                        title: 'Terlalu Cepat',
                        icon: ui.EMOJI.clock
                    })
                }, { quoted: msg });
            }
            logger.commandEnd(tracker, 'blocked', 'Cooldown active');
            return;
        }

        // --- Queue Management for Heavy Commands ---
        isHeavyCommand = command.isHeavy;
        if (isHeavyCommand) {
            if (activeProcesses >= config.performance.maxProcesses) {
                logger.commandEnd(tracker, 'busy', `Server busy (${activeProcesses}/${config.performance.maxProcesses})`);
                return sock.sendMessage(from, {
                    text: ui.warn(
                        `Bot sedang memproses ${activeProcesses} dari ${config.performance.maxProcesses} tugas berat.`,
                        {
                            title: 'Sedang Sibuk',
                            icon: ui.EMOJI.wait,
                            hint: ['Coba lagi sebentar lagi']
                        }
                    )
                }, { quoted: msg });
            }
            activeProcesses++;
        }

        // Start the cooldown only once the command is actually going to run.
        // It used to be set before the busy check above, so a user told
        // "server busy" was also locked out for the cooldown.
        const cooldownMs = command.cooldown || config.performance.cooldownMs;
        userCooldowns.set(sender, { warned: false, expiresAt: Date.now() + cooldownMs });
        setTimeout(() => userCooldowns.delete(sender), cooldownMs);

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
                    text: ui.error('Terjadi kesalahan saat memproses perintahmu.', {
                        title: 'Gagal',
                        hint: ['Coba lagi sebentar lagi', `${config.bot.prefix}menu ${ui.SYM.dot} lihat daftar perintah`]
                    })
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

// No signal handlers here. This module is required before index.js registers
// its own, so a SIGINT listener here ran first and called process.exit()
// before index.js could close the WhatsApp socket gracefully.

module.exports.parseCommand = parseCommand;
