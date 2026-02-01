/**
 * Enhanced Logging System
 * Structured logging with different levels and context
 */

const config = require('../config');

class Logger {
    constructor() {
        this.level = config.logging.level;
        this.silent = config.logging.silent;
        
        this.levels = {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3
        };
    }

    /**
     * Format command info for logging
     * Always displays full sender ID for precise identification
     */
    formatCommand(command, sender, from, isGroup) {
        // Keep full sender ID for precise tracking
        // Format: number@s.whatsapp.net
        return {
            command,
            sender: sender, // Full JID for precise identification
            senderNumber: sender.split('@')[0], // Just the number for readability
            chat: isGroup ? 'grup' : 'pribadi',
            chatId: from
        };
    }

    /**
     * Internal log method
     */
    _log(level, message, context = {}) {
        if (this.silent) return;
        
        const levelNum = this.levels[level] || 999;
        const currentLevelNum = this.levels[this.level] || 999;
        
        if (levelNum > currentLevelNum) return;
        
        const timestamp = new Date().toISOString();
        const emoji = {
            error: '❌',
            warn: '⚠️',
            info: 'ℹ️',
            debug: '🔍'
        }[level] || '📝';
        
        const contextStr = Object.keys(context).length > 0 
            ? ` ${JSON.stringify(context)}` 
            : '';
        
        console.log(`${emoji} [${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`);
    }

    /**
     * Log command execution
     */
    command(info) {
        this._log('info', 'Command executed', info);
    }

    /**
     * Log error with context
     */
    error(error, context = {}) {
        const errorInfo = {
            error: error.message,
            stack: error.stack?.split('\n')[0],
            ...context
        };
        this._log('error', 'Error occurred', errorInfo);
    }

    /**
     * Log warning
     */
    warn(message, context = {}) {
        this._log('warn', message, context);
    }

    /**
     * Log info
     */
    info(message, context = {}) {
        this._log('info', message, context);
    }

    /**
     * Log debug information
     */
    debug(message, context = {}) {
        this._log('debug', message, context);
    }

    /**
     * Log performance metrics
     */
    performance(command, duration, success = true) {
        this._log('info', 'Performance metric', {
            command,
            duration: `${duration}ms`,
            success
        });
    }
}

module.exports = new Logger();
