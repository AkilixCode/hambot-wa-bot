/**
 * AI Chat Backend Health
 *
 * Decides, before a request is made, whether a backend is worth trying —
 * so a dead or misconfigured backend costs nothing instead of a timeout on
 * every message.
 *
 *   ready          normal
 *   down:config    settings are wrong (bad key, missing model, unusable URL).
 *                  Set aside until `.chat test` shows it works or the bot
 *                  restarts with new settings: a wrong key never fixes itself.
 *   down:network   CHAT_FAIL_THRESHOLD failures in a row (refused, no
 *                  response, went silent, 5xx, …). Set aside for
 *                  CHAT_RETRY_COOLDOWN_SEC, doubling up to 10 minutes. When the
 *                  pause ends, exactly one real request goes through as a
 *                  probe; success makes it ready again.
 *
 * State changes are reported through `onChange` (log + owner message).
 */

const MAX_COOLDOWN_MS = 10 * 60 * 1000;

class BackendHealth {
    /**
     * @param {Object} opts
     * @param {number} opts.failThreshold
     * @param {number} opts.retryCooldownMs
     * @param {Function} [opts.onChange] - ({ id, state, previous, reason, cooldownMs, failures })
     * @param {Function} [opts.now]
     */
    constructor(opts) {
        this.opts = opts;
        this.now = opts.now || Date.now;
        this.backends = new Map();
    }

    /** @private */
    get(id) {
        if (!this.backends.has(id)) {
            this.backends.set(id, {
                state: 'ready',
                failures: 0,
                cooldownMs: this.opts.retryCooldownMs,
                until: 0,
                probing: false,
                lastError: null,
                lastOkAt: null
            });
        }
        return this.backends.get(id);
    }

    /** @private */
    change(id, entry, state, reason) {
        const previous = entry.state;
        entry.state = state;
        if (previous !== state && this.opts.onChange) {
            try {
                this.opts.onChange({ id, state, previous, reason, cooldownMs: entry.cooldownMs, failures: entry.failures });
            } catch {
                // reporting must never break the request path
            }
        }
    }

    /**
     * Mark a backend unusable because of its settings (checked at startup).
     * @param {string} id
     * @param {Object} error - { kind, summary, fix }
     */
    disable(id, error) {
        const entry = this.get(id);
        entry.lastError = { ...error, at: this.now() };
        this.change(id, entry, 'down:config', error.summary);
    }

    /**
     * May a request go to this backend now?
     * @param {string} id
     * @returns {{ok: boolean, probe?: boolean, state: string, retryInMs?: number}}
     */
    check(id) {
        const entry = this.get(id);
        if (entry.state === 'ready') return { ok: true, state: 'ready' };
        if (entry.state === 'down:config') return { ok: false, state: entry.state };

        const now = this.now();
        if (now < entry.until) return { ok: false, state: entry.state, retryInMs: entry.until - now };
        if (entry.probing) return { ok: false, state: 'probing' };
        entry.probing = true;
        return { ok: true, probe: true, state: 'probing' };
    }

    /**
     * A request finished well.
     * @param {string} id
     */
    success(id) {
        const entry = this.get(id);
        entry.failures = 0;
        entry.probing = false;
        entry.cooldownMs = this.opts.retryCooldownMs;
        entry.until = 0;
        entry.lastOkAt = this.now();
        if (entry.state !== 'ready') this.change(id, entry, 'ready', 'answered again');
    }

    /**
     * A request failed. Only config and network kinds count.
     * @param {string} id
     * @param {Object} error - ChatError
     * @returns {string} the state afterwards
     */
    failure(id, error) {
        const entry = this.get(id);
        const wasProbe = entry.probing;
        entry.probing = false;
        entry.lastError = {
            kind: error.kind,
            summary: error.summary,
            fix: error.fix,
            serverMessage: error.serverMessage,
            at: this.now()
        };

        if (error.isConfig) {
            this.change(id, entry, 'down:config', error.summary);
            return entry.state;
        }
        if (!error.isNetwork) return entry.state;

        entry.failures += 1;
        if (wasProbe && entry.state === 'down:network') {
            // The probe failed: pause longer.
            entry.cooldownMs = Math.min(entry.cooldownMs * 2, MAX_COOLDOWN_MS);
            entry.until = this.now() + entry.cooldownMs;
            return entry.state;
        }
        if (entry.failures >= this.opts.failThreshold) {
            entry.until = this.now() + entry.cooldownMs;
            this.change(id, entry, 'down:network', error.summary);
        }
        return entry.state;
    }

    /**
     * A probe that ended without telling us anything (cancelled, refused by
     * the model): let the next request probe instead.
     */
    release(id) {
        this.get(id).probing = false;
    }

    /** Forget everything about a backend (after `.chat test` succeeds). */
    reset(id) {
        const entry = this.get(id);
        entry.failures = 0;
        entry.probing = false;
        entry.until = 0;
        entry.cooldownMs = this.opts.retryCooldownMs;
        if (entry.state !== 'ready') this.change(id, entry, 'ready', 'check passed');
    }

    /** For `.chat status`. */
    snapshot(id) {
        const entry = this.get(id);
        return {
            state: entry.state,
            failures: entry.failures,
            retryInMs: entry.state === 'down:network' ? Math.max(0, entry.until - this.now()) : null,
            lastError: entry.lastError,
            lastOkAt: entry.lastOkAt
        };
    }
}

module.exports = BackendHealth;
module.exports.MAX_COOLDOWN_MS = MAX_COOLDOWN_MS;
