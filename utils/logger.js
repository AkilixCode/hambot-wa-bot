/**
 * Enhanced Logging System v2
 * Two modes: 'simple' (clean command blocks) and 'full' (verbose debug)
 * 
 * Simple mode: Shows only command results and critical errors
 * Full mode: Shows everything — debug, info, warn, error with timestamps
 */

const config = require('../config');
const redact = require('./redact');
const netContext = require('./net-context');

// How many recent network problems are kept for `.security media`.
const NET_HISTORY_SIZE = 20;

/**
 * Compact byte count for log lines (no helpers.js import: helpers requires
 * http-client, which requires this file).
 * @param {number} bytes
 * @returns {string}
 */
function shortBytes(bytes) {
    if (!bytes) return '0B';
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/**
 * Compact duration for log lines.
 * @param {number} ms
 * @returns {string}
 */
function shortMs(ms) {
    if (!Number.isFinite(ms)) return '?';
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

/**
 * host + path, no query string, middle-truncated. The query is dropped on
 * purpose: it is where API keys and user search terms live.
 * @param {string} url
 * @returns {string}
 */
function shortUrl(url) {
    try {
        const u = new URL(url);
        let path = u.pathname === '/' ? '' : u.pathname;
        if (path.length > 60) path = `${path.slice(0, 28)}…${path.slice(-28)}`;
        return `${u.host}${path}`;
    } catch {
        const s = String(url || '');
        return s.length > 60 ? `${s.slice(0, 57)}...` : s;
    }
}

// Category emoji mapping for simple mode
const CATEGORY_EMOJI = {
    media: '🎵',
    fun: '🎲',
    utility: '🔧',
    network: '🌐',
    general: '📋',
    security: '🔒',
    owner: '👑',
    ai: '🤖'
};

class Logger {
    constructor() {
        this.mode = this._resolveMode(config.logging.level);
        this.silent = config.logging.silent;
        this.netLevel = config.logging.net || 'problems';
        this._netHistory = [];
        this._chatHistory = [];
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
            startTime: Date.now(),
            // Filled by handler.js with the command's network counters
            // (utils/net-context), for the "Network" line.
            net: null
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

        const netLine = this._netSummary(tracker.net);
        if (netLine) lines.push(`   Network : ${netLine}`);

        // Add error/reason line if present
        if (detail && status !== 'done') {
            // Scrub before printing: a failed HTTP call carries the request URL,
            // and some upstream APIs take their key as a query parameter.
            const errorMsg = redact.redact(this._describeDetail(detail));
            // Truncate long error messages for readability
            const shortMsg = errorMsg.length > 160 ? errorMsg.substring(0, 160) + '...' : errorMsg;
            lines.push(`   Error   : ${shortMsg}`);
        }

        console.log(lines.join('\n'));
    }

    /**
     * Text for the Error line. A network failure annotated by http-client
     * reads "HTTP 403 from www.pinterest.com" instead of axios's generic
     * "Request failed with status code 403".
     * @param {Error|string} detail
     * @returns {string}
     */
    _describeDetail(detail) {
        if (!(detail instanceof Error)) return String(detail);
        if (detail.net && detail.net.summary) {
            return `${detail.net.summary}${detail.net.host ? ` from ${detail.net.host}` : ''}`;
        }
        return detail.message;
    }

    /**
     * One-line network totals for a command, or null if it made no calls.
     * @param {Object|null} stats - From utils/net-context
     * @returns {string|null}
     */
    _netSummary(stats) {
        if (!stats || (stats.requests === 0 && stats.ytdlp === 0)) return null;

        const parts = [];
        if (stats.requests > 0) {
            parts.push(`${stats.requests} req`);
            parts.push(`${stats.ok} ok`);
            if (stats.failed) parts.push(`${stats.failed} failed`);
            if (stats.retries) parts.push(`${stats.retries} ${stats.retries === 1 ? 'retry' : 'retries'}`);
        }
        if (stats.ytdlp) parts.push(`${stats.ytdlp} yt-dlp`);
        if (stats.fallbacks) parts.push(`proxy→direct ×${stats.fallbacks}`);
        if (stats.bytes) parts.push(shortBytes(stats.bytes));
        if (stats.routes && stats.routes.size) parts.push(`via ${[...stats.routes].join('+')}`);
        return parts.join(' · ');
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

        const netLine = this._netSummary(tracker.net);
        if (netLine) logData.network = netLine;

        if (detail && status !== 'done') {
            logData.error = redact.redact(this._describeDetail(detail));
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
            const msg = redact.redact(error?.message || String(error));
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
    //  NETWORK EVENTS (shown in both modes, see NET_LOG)
    // ─────────────────────────────────────────────────────

    /**
     * Log a network event.
     *
     * Unlike warn/info/debug, network problems print in the default "simple"
     * mode too: they are the first thing anyone needs when a media command
     * stops working, and hiding them is how "it just fails" went undiagnosed.
     *
     * Every event also feeds the active command's counters (utils/net-context)
     * and, if it is a problem, the recent-problems list the media doctor shows.
     *
     * @param {Object} event
     * @param {'request'|'fallback'|'circuit'|'cascade'|'ytdlp'|'egress'} event.type
     * @param {boolean} [event.problem] - true for anything worth seeing by default
     */
    net(event) {
        if (!event || !event.type) return;

        this._countNet(event);

        const tag = event.tag !== undefined ? event.tag : netContext.tag();
        const body = redact.redact(this._formatNet(event));
        const line = tag ? `[${tag}] ${body}` : body;

        if (event.problem) {
            this._netHistory.push({ at: Date.now(), line });
            if (this._netHistory.length > NET_HISTORY_SIZE) this._netHistory.shift();
        }

        if (this.silent || this.netLevel === 'off') return;
        if (!event.problem && this.netLevel !== 'all') return;

        const icon = { request: '🌐', fallback: '🌐', circuit: '⚡', cascade: '🔁', ytdlp: '🎬', egress: '🛡️' }[event.type] || '🌐';
        if (this.mode === 'simple') {
            console.log(`${icon} ${line}`);
        } else {
            console.log(`${icon} [${new Date().toISOString()}] [NET] ${line}`);
        }
    }

    /**
     * Recent network problems, newest last, already redacted.
     * @param {number} [limit]
     * @returns {Array<{at: number, line: string}>}
     */
    recentNetProblems(limit = NET_HISTORY_SIZE) {
        return this._netHistory.slice(-limit);
    }

    /** Forget recorded network problems (tests, `.security clearcache`). */
    clearNetHistory() {
        this._netHistory = [];
    }

    /**
     * Update the active command's network counters.
     * @param {Object} event
     */
    _countNet(event) {
        const ctx = netContext.current();
        if (!ctx) return;
        const s = ctx.stats;

        if (event.type === 'request') {
            if (event.route) s.routes.add(event.route);
            if (event.willRetry) s.retries++;
            if (event.final) {
                s.requests++;
                if (event.ok) s.ok++;
                else s.failed++;
                if (event.bytes) s.bytes += event.bytes;
            }
        } else if (event.type === 'fallback') {
            s.fallbacks++;
        } else if (event.type === 'ytdlp') {
            s.ytdlp++;
            if (event.route) s.routes.add(event.route);
            if (event.fallback) s.fallbacks++;
        }
    }

    /**
     * Render a network event as one human line (untagged, unredacted).
     * @param {Object} e
     * @returns {string}
     */
    _formatNet(e) {
        switch (e.type) {
            case 'request': {
                const target = `${e.method || 'GET'} ${shortUrl(e.url)}`;
                const tail = [shortMs(e.ms)];
                if (e.ok && e.bytes) tail.push(shortBytes(e.bytes));
                if (e.route) tail.push(e.route);

                if (e.ok) return `${target} → ✓ ${e.status || 'ok'} · ${tail.join(' · ')}`;

                if (e.willRetry) {
                    const wait = e.retryInMs ? ` in ${shortMs(e.retryInMs)}` : '';
                    return `${target} → ${e.summary} · ${tail.join(' · ')} · retry ${e.attempt}/${e.maxAttempts - 1}${wait}`;
                }
                const tries = e.attempt > 1 ? ` (after ${e.attempt} attempts)` : '';
                return `${target} → ✗ ${e.summary}${tries} · ${tail.join(' · ')}`;
            }

            case 'fallback': {
                const proxy = e.proxy ? `proxy ${e.proxy}` : 'proxy';
                return e.skipped
                    ? `${proxy} is paused (circuit open) → going direct`
                    : `${proxy} failed (${e.summary}) → retrying direct${e.url ? ` for ${shortUrl(e.url)}` : ''}`;
            }

            case 'circuit':
                return e.state === 'open'
                    ? `circuit: ${e.id} paused ${Math.round((e.cooldownMs || 0) / 1000)}s after ${e.failures} failures (last: ${e.lastError || '?'})`
                    : `circuit: ${e.id} recovered`;

            case 'cascade': {
                const parts = (e.attempts || []).map(a => {
                    if (a.status === 'ok') return `${a.id} ✓ (${shortMs(a.ms)})`;
                    if (a.status === 'skipped') return `${a.id} ⏭ paused`;
                    if (a.status === 'empty') return `${a.id} ✗ empty (${shortMs(a.ms)})`;
                    return `${a.id} ✗ ${a.summary || a.error || 'error'} (${shortMs(a.ms)})`;
                });
                return e.ok
                    ? `${e.group}: ${parts.join(' → ')}`
                    : `${e.group}: all failed — ${parts.join(', ')}`;
            }

            case 'ytdlp': {
                const where = [e.target, e.route].filter(Boolean).join(' · ');
                if (e.ok) return `yt-dlp ${where} → ✓ ${shortMs(e.ms)}`;
                const detail = e.detail ? ` · ${e.detail}` : '';
                return `yt-dlp ${where} → ✗ ${e.reason}${e.fallback ? ' (retrying direct)' : ''} · ${shortMs(e.ms)}${detail}`;
            }

            case 'egress':
                // Host and port only: never the path or query of what was asked.
                return `egress guard: ${e.host}:${e.port} refused (${e.reason})` +
                    (e.suppressed ? ` ×${e.suppressed} more since the last line` : '');

            default:
                return JSON.stringify(e);
        }
    }

    // ─────────────────────────────────────────────────────
    //  AI CHAT EVENTS (always shown, see utils/chat)
    // ─────────────────────────────────────────────────────

    /**
     * Log an AI chat event: a failure with its fix, a backend set aside or
     * back, the startup summary.
     *
     * Shown in both log modes and not gated by NET_LOG: when `.chat` stops
     * working, these lines are the diagnosis. Redacted, and tagged with the
     * command run like network lines. Never given prompt or answer text.
     *
     * @param {string|string[]} lines - First line, then indented detail lines
     * @param {Object} [opts]
     * @param {boolean} [opts.problem] - Keep in the history `.chat status` shows
     */
    chat(lines, opts = {}) {
        const list = (Array.isArray(lines) ? lines : [lines]).filter(Boolean).map(l => redact.redact(String(l)));
        if (!list.length) return;
        const tag = netContext.tag();
        const head = tag ? `[${tag}] ${list[0]}` : list[0];

        if (opts.problem) {
            this._chatHistory.push({ at: Date.now(), line: [head, ...list.slice(1)].join(' · ') });
            if (this._chatHistory.length > NET_HISTORY_SIZE) this._chatHistory.shift();
        }
        if (this.silent) return;

        const rest = list.slice(1).map(l => `       ${l}`);
        if (this.mode === 'simple') {
            console.log([`🤖 ${head}`, ...rest].join('\n'));
        } else {
            console.log([`🤖 [${new Date().toISOString()}] [CHAT] ${head}`, ...rest].join('\n'));
        }
    }

    /**
     * Recent AI chat problems, newest last, already redacted.
     * @param {number} [limit]
     * @returns {Array<{at: number, line: string}>}
     */
    recentChatProblems(limit = NET_HISTORY_SIZE) {
        return this._chatHistory.slice(-limit);
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
