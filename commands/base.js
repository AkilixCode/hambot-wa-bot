/**
 * Command Base Class
 * Abstract base for all bot commands with common functionality
 */

const logger = require('../utils/logger');

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
            return { valid: false, error: '❌ Perintah ini hanya untuk grup!' };
        }

        // Check if admin required (implement your admin check logic)
        if (this.requiresAdmin) {
            // Add your admin validation here
        }

        // Check if media required
        if (this.requiresMedia) {
            const hasImage = msg.message.imageMessage;
            const hasQuoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            
            if (!hasImage && !hasQuoted) {
                return { valid: false, error: '❌ Perintah ini membutuhkan gambar!' };
            }
        }

        return { valid: true };
    }

    /**
     * Send reply message
     */
    async reply(sock, from, msg, text) {
        return await sock.sendMessage(from, { text }, { quoted: msg });
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
     * Log command execution
     */
    log(context, duration, success = true) {
        logger.command({
            command: this.name,
            ...context,
            duration: `${duration}ms`,
            success
        });
    }

    /**
     * Log error
     */
    logError(error, context) {
        logger.error(error, { command: this.name, ...context });
    }
}

module.exports = CommandBase;
