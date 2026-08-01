/**
 * Command Base Class
 * Abstract base for all bot commands with common functionality
 */

const logger = require('../utils/logger');
const ui = require('../utils/ui');

class CommandBase {
    constructor(config = {}) {
        this.name = config.name || 'unknown';
        this.aliases = config.aliases || [];
        this.description = config.description || '';
        this.usage = config.usage || '';
        this.category = config.category || 'general';
        this.cooldown = config.cooldown || 2000;
        this.isHeavy = config.isHeavy || false;
        this.requiresGroup = config.requiresGroup || false;
        this.requiresAdmin = config.requiresAdmin || false;
        this.requiresMedia = config.requiresMedia || false;
    }

    /**
     * Execute command - must be implemented by subclasses
     */
    async execute(sock, msg, args, context) {
        throw new Error(`Command ${this.name} must implement execute() method`);
    }

    /**
     * Validate command execution context
     */
    async validate(msg, context) {
        const { from, isGroup } = context;

        // Check if group required
        if (this.requiresGroup && !isGroup) {
            return {
                valid: false,
                error: ui.error('Perintah ini hanya bisa dipakai di dalam grup.', {
                    title: 'Khusus Grup',
                    hint: [`Tambahkan bot ke grup, lalu jalankan ${this.usage || '.' + this.name}`]
                })
            };
        }

        // Admin gating is NOT handled here — it needs the socket to read group
        // metadata, which validate() does not have. It lives in the permission
        // layer instead, driven by config.adminOnlyCommands (ADMIN_ONLY_COMMANDS).

        // Check if media required
        if (this.requiresMedia) {
            const hasImage = msg.message.imageMessage;
            const hasQuoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            
            if (!hasImage && !hasQuoted) {
                return {
                    valid: false,
                    error: ui.error('Perintah ini butuh gambar.', {
                        title: 'Gambar Diperlukan',
                        hint: [
                            `Kirim gambar dengan caption ${'.' + this.name}`,
                            `Atau reply gambar yang sudah ada dengan ${'.' + this.name}`
                        ]
                    })
                };
            }
        }

        return { valid: true };
    }

    /**
     * Send reply message.
     *
     * Every plain-text reply in the bot funnels through here, which makes it the
     * one place that can guarantee a message is never long enough for WhatsApp
     * to silently drop the tail.
     */
    async reply(sock, from, msg, text) {
        return await sock.sendMessage(from, { text: ui.clamp(text) }, { quoted: msg });
    }

    /**
     * Reply with the standard error card.
     * @param {Object} sock
     * @param {string} from
     * @param {Object} msg
     * @param {string} reason What went wrong, one sentence
     * @param {Object} [opts] Passed through to ui.error ({ title, hint, icon })
     */
    async replyError(sock, from, msg, reason, opts) {
        return await this.reply(sock, from, msg, ui.error(reason, opts));
    }

    /**
     * Reply with the standard usage panel.
     * @param {Object} sock
     * @param {string} from
     * @param {Object} msg
     * @param {Object} opts Passed through to ui.usage
     */
    async replyUsage(sock, from, msg, opts) {
        return await this.reply(sock, from, msg, ui.usage(opts));
    }

    /**
     * Send a media message with a caption.
     *
     * Captions bypass reply() entirely, so they need their own clamp — without
     * it a long caption is truncated by WhatsApp with no warning to the user.
     *
     * @param {Object} sock
     * @param {string} from
     * @param {Object} msg Message to quote
     * @param {Object} payload Baileys media payload, e.g. { image, caption }
     */
    async replyMedia(sock, from, msg, payload) {
        const body = { ...payload };
        if (typeof body.caption === 'string') {
            // WhatsApp caps captions well below the text-message limit.
            body.caption = ui.clamp(body.caption, 1024);
        }
        return await sock.sendMessage(from, body, { quoted: msg });
    }

    /**
     * Send reaction
     */
    async react(sock, msg, emoji) {
        return await sock.sendMessage(msg.key.remoteJid, { 
            react: { text: emoji, key: msg.key } 
        });
    }

    /**
     * Log error (used internally by commands)
     * When called with handler's context (has commandName), marks command as failed
     * so handler.js logs the correct status instead of 'done'
     */
    logError(error, context) {
        // Mark command as failed if this is the handler's context object
        if (context && context.commandName) {
            context._failed = true;
            context._failError = error;
        }
        logger.error(error, { command: this.name });
    }

    /**
     * Gracefully mark a command as failed in the handler logs without throwing an error
     * Useful when a command fails to find data (e.g. proxy timeout) but handles it nicely.
     */
    setFailed(context, reason) {
        if (context && context.commandName) {
            context._failed = true;
            context._failError = reason;
        }
    }
}

module.exports = CommandBase;
