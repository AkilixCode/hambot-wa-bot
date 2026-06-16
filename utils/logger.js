/**
 * Enhanced Logging System v2
 * Two modes: 'simple' (clean command blocks) and 'full' (verbose debug)
 * 
 * Simple mode: Shows only command results and critical errors
 * Full mode: Shows everything — debug, info, warn, error with timestamps
 */

const config = require('../config');

// Category emoji mapping for simple mode
const CATEGORY_EMOJI = {
    media: '🎵',
    fun: '🎲',
    utility: '🔧',
    network: '🌐',
    general: '📋',
    security: '🔒',
    owner: '👑'
};

class Logger {
    constructor() {
        this.mode = this._resolveMode(config.logging.level);
        this.silent = config.logging.silent;
    }

    /**
     * Resolve LOG_LEVEL value to internal mode
     * Accepts: 'simple', 'full' (new), or legacy 'error/warn/info/debug'
     */
    _resolveMode(level) {
        if (level === 'simple' || level === 'full') return level;
        // Legacy mapping: treat old values as 'full' mode
        if (['error', 'warn', 'info', 'debug'].includes(level)) return 'full';
        return 'simple'; // default
    }

    // ─────────────────────────────────────────────────────
    //  COMMAND TRACKING (used by handler.js)
    // ─────────────────────────────────────────────────────

    /**
     * Start tracking a command execution.
     * Returns a tracker object to pass to commandEnd().
     * 
     * @param {string} commandName - e.g. 'pinterest'
     * @param {string} sender - Full JID e.g. '6281234567890@s.whatsapp.net'
     * @param {string} from - Chat JID
     * @param {boolean} isGroup - Whether command was sent in a group
     * @param {Object} [command] - The command instance (for category/emoji)
     * @returns {Object} tracker object
     */
    commandStart(commandName, sender, from, isGroup, command = null) {
        return {
            commandName,
            sender,
            senderNumber: sender.split('@')[0],
            from,
            isGroup,
            category: command?.category || 'general',
            startTime: Date.now()
        };
    }

    /**
     * Finish tracking a command execution and print the log.
     * 
     * @param {Object} tracker - From commandStart()
     * @param {'done'|'failed'|'blocked'|'busy'} status
     * @param {string|Error|null} detail - Error object, reason string, or null
     */
    commandEnd(tracker, status, detail = null) {
        if (this.silent) return;
        if (!tracker) return;

        const duration = Date.now() - tracker.startTime;

        if (this.mode === 'simple') {
            this._printSimpleBlock(tracker, status, duration, detail);
        } else {
            this._printFullCommandLog(tracker, status, duration, detail);
        }
    }

    /**
     * Print a clean, indented command block (simple mode)
     */
    _printSimpleBlock(tracker, status, duration, detail) {
        const emoji = CATEGORY_EMOJI[tracker.category] || '📋';
        const chatLabel = tracker.isGroup ? `grup` : 'pribadi';

        const statusMap = {
            done: `✅ Done (${duration}ms)`,
            failed: '❌ Failed',
            blocked: '⚠️ Blocked',
            busy: '⏳ Server Busy'
        };

        const lines = [
            `${emoji} .${tracker.commandName}`,
            `   From    : ${tracker.senderNumber} (${chatLabel})`,
            `   Status  : ${statusMap[status] || status}`
        ];

        // Add error/reason line if present
        if (detail && status !== 'done') {
            const errorMsg = detail instanceof Error ? detail.message : String(detail);
            // Truncate long error messages for readability
            const shortMsg = errorMsg.length > 120 ? errorMsg.substring(0, 120) + '...' : errorMsg;
            lines.push(`   Error   : ${shortMsg}`);
        }

        console.log(lines.join('\n'));
    }

    /**
     * Print verbose command log (full mode)
     */
    _printFullCommandLog(tracker, status, duration, detail) {
        const timestamp = new Date().toISOString();
        const statusEmoji = { done: '✅', failed: '❌', blocked: '⚠️', busy: '⏳' };
        
        const logData = {
            command: tracker.commandName,
            sender: tracker.senderNumber,
            chat: tracker.isGroup ? 'grup' : 'pribadi',
            chatId: tracker.from,
            status,
            duration: `${duration}ms`
        };

        if (detail && status !== 'done') {
            logData.error = detail instanceof Error ? detail.message : String(detail);
            if (detail instanceof Error && detail.stack) {
                logData.stack = detail.stack.split('\n').slice(0, 3).join(' | ');
            }
        }

        console.log(`${statusEmoji[status] || '📋'} [${timestamp}] [COMMAND] ${JSON.stringify(logData)}`);
    }

    // ─────────────────────────────────────────────────────
    //  STANDARD LOG METHODS (used everywhere)
    // ─────────────────────────────────────────────────────

    /**
     * Log error — always shown in both modes
     */
    error(error, context = {}) {
        if (this.silent) return;

        const timestamp = new Date().toISOString();

        if (this.mode === 'simple') {
            // In simple mode, only show errors that have useful context
            // Skip empty context errors (they're usually duplicates)
            if (Object.keys(context).length === 0 && (!error || !error.message)) return;
            
            const source = context.context || context.command || 'system';
            const msg = error?.message || String(error);
            const shortMsg = msg.length > 150 ? msg.substring(0, 150) + '...' : msg;
            console.log(`❌ [${source}] ${shortMsg}`);
        } else {
            const errorInfo = {
                error: error?.message || String(error),
                stack: error?.stack?.split('\n')[0],
                ...context
            };
            console.log(`❌ [${timestamp}] [ERROR] ${JSON.stringify(errorInfo)}`);
        }
    }

    /**
     * Log warning — shown in full mode only
     */
    warn(message, context = {}) {
        if (this.silent || this.mode === 'simple') return;

        const timestamp = new Date().toISOString();
        const contextStr = Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : '';
        console.log(`⚠️ [${timestamp}] [WARN] ${message}${contextStr}`);
    }

    /**
     * Log info — shown in full mode only
     */
    info(message, context = {}) {
        if (this.silent || this.mode === 'simple') return;

        const timestamp = new Date().toISOString();
        const contextStr = Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : '';
        console.log(`ℹ️ [${timestamp}] [INFO] ${message}${contextStr}`);
    }

    /**
     * Log debug — shown in full mode only
     */
    debug(message, context = {}) {
        if (this.silent || this.mode === 'simple') return;

        const timestamp = new Date().toISOString();
        const contextStr = Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : '';
        console.log(`🔍 [${timestamp}] [DEBUG] ${message}${contextStr}`);
    }

    // ─────────────────────────────────────────────────────
    //  SYSTEM EVENTS (startup, shutdown — always shown)
    // ─────────────────────────────────────────────────────

    /**
     * Log a system event — always shown in both modes
     * Used for startup, shutdown, connection status
     */
    system(message) {
        if (this.silent) return;

        if (this.mode === 'simple') {
            console.log(`⚙️ ${message}`);
        } else {
            const timestamp = new Date().toISOString();
            console.log(`⚙️ [${timestamp}] [SYSTEM] ${message}`);
        }
    }

    // ─────────────────────────────────────────────────────
    //  BACKWARD COMPATIBILITY
    // ─────────────────────────────────────────────────────

    /**
     * Format command info (kept for backward compat with tests)
     * @deprecated Use commandStart/commandEnd instead
     */
    formatCommand(command, sender, from, isGroup) {
        return {
            command,
            sender: sender,
            senderNumber: sender.split('@')[0],
            chat: isGroup ? 'grup' : 'pribadi',
            chatId: from
        };
    }

    /**
     * Legacy command log method (kept for backward compat)
     * @deprecated Use commandStart/commandEnd instead
     */
    command(info) {
        // In the new system, this is a no-op — handler.js uses commandStart/commandEnd
        // But keep it callable so nothing crashes
        if (this.mode === 'full') {
            const timestamp = new Date().toISOString();
            console.log(`ℹ️ [${timestamp}] [COMMAND] ${JSON.stringify(info)}`);
        }
    }

    /**
     * Legacy performance method (kept for backward compat)
     * @deprecated Integrated into commandEnd
     */
    performance(command, duration, success = true) {
        if (this.mode === 'full') {
            const timestamp = new Date().toISOString();
            console.log(`📊 [${timestamp}] [PERF] ${JSON.stringify({ command, duration: `${duration}ms`, success })}`);
        }
    }
}

module.exports = new Logger();
