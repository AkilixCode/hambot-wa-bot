/**
 * AI Chat Memory
 *
 * Recent turns per person per chat, so `.chat` can follow a conversation.
 * In memory only — never written to disk — and bounded three ways:
 *
 *   turns      CHAT_MEMORY_TURNS question+answer pairs per conversation
 *   characters CHAT_MEMORY_MAX_CHARS per request, oldest turns dropped first
 *              (keeps every request small and cheap)
 *   chats      CHAT_MEMORY_MAX_CHATS conversations; the least recently used
 *              is dropped first
 *
 * A conversation idle for CHAT_MEMORY_IDLE_MIN is forgotten. One unref()'d
 * timer sweeps; it never keeps the process alive.
 */

const crypto = require('crypto');

const SWEEP_MS = 5 * 60 * 1000;

class ChatMemory {
    /**
     * @param {Object} opts - settings.memory
     */
    constructor(opts) {
        this.opts = opts;
        /** @type {Map<string, {turns: Array<{q: string, a: string}>, at: number, salt: string}>} */
        this.store = new Map();
        this.timer = setInterval(() => this.sweep(), SWEEP_MS);
        if (this.timer.unref) this.timer.unref();
    }

    /**
     * Conversation key: one per person per chat, so in a group everyone has
     * their own thread.
     */
    static key(chat, sender) {
        return `${chat}|${String(sender || '').split(':')[0]}`;
    }

    /** @private */
    entry(key, create) {
        let entry = this.store.get(key);
        if (entry && Date.now() - entry.at > this.opts.idleMs) {
            this.store.delete(key);
            entry = null;
        }
        if (!entry && create) {
            entry = { turns: [], at: Date.now(), salt: crypto.randomBytes(4).toString('hex') };
        }
        if (entry) {
            // Re-insert: Map order is the LRU order.
            this.store.delete(key);
            this.store.set(key, entry);
        }
        return entry;
    }

    /**
     * Previous turns as chat messages, oldest first, within the char budget.
     * @param {string} key
     * @param {number} [reserve] - Characters already used by the new question
     * @returns {Array<{role: string, content: string}>}
     */
    history(key, reserve = 0) {
        if (!this.opts.turns) return [];
        const entry = this.entry(key, false);
        if (!entry) return [];

        const budget = Math.max(0, this.opts.maxChars - reserve);
        const picked = [];
        let used = 0;
        for (let i = entry.turns.length - 1; i >= 0; i--) {
            const turn = entry.turns[i];
            const size = turn.q.length + turn.a.length;
            if (used + size > budget) break;
            used += size;
            picked.unshift(turn);
        }
        const messages = [];
        for (const turn of picked) {
            messages.push({ role: 'user', content: turn.q });
            messages.push({ role: 'assistant', content: turn.a });
        }
        return messages;
    }

    /**
     * Remember a finished exchange.
     * @param {string} key
     * @param {string} question
     * @param {string} answer
     */
    add(key, question, answer) {
        if (!this.opts.turns) return;
        const entry = this.entry(key, true);
        entry.turns.push({ q: question, a: answer });
        while (entry.turns.length > this.opts.turns) entry.turns.shift();
        entry.at = Date.now();
        while (this.store.size > this.opts.maxChats) {
            this.store.delete(this.store.keys().next().value);
        }
    }

    /**
     * Stable id for an agent-side session (Hermes X-Hermes-Session-Id,
     * OpenClaw `user`). Changes on reset, so the agent starts fresh too.
     * @param {string} key
     * @returns {string}
     */
    sessionId(key) {
        const entry = this.entry(key, true);
        if (!this.store.has(key)) this.store.set(key, entry);
        const hash = crypto.createHash('sha256').update(`${key}|${entry.salt}`).digest('hex').slice(0, 16);
        return `hambot-${hash}`;
    }

    /** Start a new agent session without forgetting the bot-side turns. */
    rotateSession(key) {
        const entry = this.entry(key, true);
        entry.salt = crypto.randomBytes(4).toString('hex');
        this.store.set(key, entry);
        return this.sessionId(key);
    }

    /**
     * Forget a conversation.
     * @returns {boolean} whether there was anything to forget
     */
    reset(key) {
        const had = Boolean(this.entry(key, false) && this.store.get(key).turns.length);
        this.store.delete(key);
        return had;
    }

    /** Number of turns held for a conversation. */
    size(key) {
        const entry = this.entry(key, false);
        return entry ? entry.turns.length : 0;
    }

    sweep() {
        const now = Date.now();
        for (const [key, entry] of this.store) {
            if (now - entry.at > this.opts.idleMs) this.store.delete(key);
        }
    }

    get conversations() {
        return this.store.size;
    }

    destroy() {
        clearInterval(this.timer);
        this.store.clear();
    }
}

module.exports = ChatMemory;
