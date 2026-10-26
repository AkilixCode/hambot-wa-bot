/**
 * AI Chat Service
 *
 * Everything behind `.chat` that is not WhatsApp formatting:
 *
 *   access     who may chat, where, and with which backend (settings.js)
 *   limits     CHAT_MAX_CONCURRENT active sessions, a short queue, one
 *              request per person, the optional daily limit
 *   memory     recent turns per person per chat (memory.js)
 *   routing    main backend, then the fallback — skipping any backend that
 *              health.js has set aside, without waiting on it
 *   answers    client.js, then: reasoning stripped, the bot's own secrets
 *              scrubbed, Markdown → WhatsApp, split into parts (format.js)
 *   logs       one line per failure with the fix (logger.chat), owner
 *              messages when a backend goes down or comes back
 *
 * Loaded on the first `.chat` only (commands/chat.js requires it lazily).
 */

const fs = require('fs');
const path = require('path');
const config = require('../../config');
const logger = require('../logger');
const { redactKnown, maskHost, fingerprint } = require('../redact');
const { dataDir } = require('../paths');
const socketRef = require('../socket-ref');
const WorkSlots = require('../work-slots');
const settingsLib = require('./settings');
const ChatMemory = require('./memory');
const BackendHealth = require('./health');
const format = require('./format');
const agentMedia = require('./media');
const transport = require('./transport');

const STATE_FILE = 'chat.json';
const USAGE_FILE = 'chat-usage.json';
const USAGE_FLUSH_MS = 30 * 1000;
const OWNER_NOTICE_GAP_MS = 10 * 60 * 1000;

/**
 * A reason to answer the user without an AI reply. `code` picks the message
 * in commands/chat.js.
 */
class ChatUserError extends Error {
    constructor(code, data = {}) {
        super(code);
        this.name = 'ChatUserError';
        this.code = code;
        Object.assign(this, data);
    }
}

/** YYYY-MM-DD in the bot's timezone, for the daily limit. */
function today(now = Date.now()) {
    try {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: process.env.BOT_TIMEZONE || 'Asia/Jakarta',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(new Date(now));
    } catch {
        return new Date(now).toISOString().slice(0, 10);
    }
}

/** A sender without its device suffix, so one person is one key. */
function personKey(sender) {
    const [local, domain = ''] = String(sender || '').split('@');
    return `${local.split(':')[0]}@${domain}`;
}

class ChatService {
    /**
     * @param {Object} [opts]
     * @param {Object} [opts.env] - Defaults to process.env
     * @param {Function} [opts.sendOwner] - (text) => Promise, for backend notices
     * @param {Function} [opts.now]
     */
    constructor(opts = {}) {
        this.env = opts.env || process.env;
        this.now = opts.now || Date.now;
        this.settings = settingsLib.load(this.env, { botName: config.bot.name });
        this.sendOwner = opts.sendOwner || defaultSendOwner;
        this.memory = new ChatMemory(this.settings.memory);
        this.health = new BackendHealth({
            failThreshold: this.settings.failThreshold,
            retryCooldownMs: this.settings.retryCooldownMs,
            now: this.now,
            onChange: change => this.onHealthChange(change)
        });
        this.slots = new WorkSlots(this.settings.maxConcurrent, this.settings.queueMax);
        /** @type {Map<string, Object>} person+chat → session */
        this.sessions = new Map();
        // People with a request running or queued, in any chat: one each.
        this.busyPeople = new Set();
        // Daily-limit uses reserved by requests still in flight.
        this.reserved = new Map();
        this.ownerNotices = new Map();
        this.usage = { day: today(this.now()), counts: {} };
        this.usageDirty = false;
        this.usageTimer = null;

        this.restoreState();
        this.restoreUsage();

        // Backends with unusable settings are off before the first message.
        // Quietly: startup() reports them, and the owner needs no message.
        this.quiet = true;
        for (const [id, backend] of Object.entries(this.settings.backends)) {
            if (!backend.usable) {
                this.health.disable(id, { kind: 'bad_config', summary: backend.unusable[0], fix: backend.unusable.join('; ') });
            }
        }
        this.quiet = false;
    }

    // ─────────────────────────────────────────────────────
    //  STATE (data/chat.json, data/chat-usage.json)
    // ─────────────────────────────────────────────────────

    statePath(name) {
        return path.join(dataDir(), name);
    }

    /** `.chat use` survives a restart, as long as that backend is still configured. */
    restoreState() {
        try {
            const raw = JSON.parse(fs.readFileSync(this.statePath(STATE_FILE), 'utf8'));
            if (raw && raw.backend && this.settings.backends[raw.backend]) {
                this.settings.backend = raw.backend;
                if (this.settings.fallback === raw.backend) this.settings.fallback = 'none';
            }
        } catch {
            // no saved choice, or unreadable: the .env value stands
        }
    }

    restoreUsage() {
        try {
            const raw = JSON.parse(fs.readFileSync(this.statePath(USAGE_FILE), 'utf8'));
            if (raw && raw.day === today(this.now()) && raw.counts && typeof raw.counts === 'object') {
                this.usage = { day: raw.day, counts: { ...raw.counts } };
            }
        } catch {
            // start counting from zero
        }
    }

    /** Write the daily counters at most every 30s, never per message. */
    scheduleUsageFlush() {
        this.usageDirty = true;
        if (this.usageTimer) return;
        this.usageTimer = setTimeout(() => {
            this.usageTimer = null;
            this.flushUsage();
        }, USAGE_FLUSH_MS);
        if (this.usageTimer.unref) this.usageTimer.unref();
    }

    flushUsage() {
        if (!this.usageDirty) return;
        this.usageDirty = false;
        try {
            fs.mkdirSync(dataDir(), { recursive: true });
            const file = this.statePath(USAGE_FILE);
            const tmp = `${file}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify(this.usage));
            fs.renameSync(tmp, file);
        } catch (error) {
            logger.chat(`could not save daily counters (${error.code || error.message}) — they reset on restart`);
        }
    }

    // ─────────────────────────────────────────────────────
    //  ACCESS AND LIMITS
    // ─────────────────────────────────────────────────────

    /**
     * Backends this person may use, in the order to try them.
     * @param {Object} who - { sender, isGroup, isOwner }
     * @returns {string[]}
     */
    candidates(who) {
        const s = this.settings;
        return [s.backend, s.fallback]
            .filter((id, i, all) => id && id !== 'none' && all.indexOf(id) === i)
            .filter(id => s.backends[id])
            .filter(id => settingsLib.checkAccess(s, who, id).ok);
    }

    /**
     * Can this person chat here at all?
     * @returns {{ok: boolean, reason?: string}}
     */
    access(who) {
        const s = this.settings;
        const base = settingsLib.checkAccess(s, who, null);
        if (!base.ok) return base;
        if (!s.backends[s.backend] && !(s.fallback !== 'none' && s.backends[s.fallback])) {
            return { ok: false, reason: 'not_configured' };
        }
        if (!this.candidates(who).length) return { ok: false, reason: 'agent_owner' };
        return { ok: true };
    }

    rollDay() {
        const day = today(this.now());
        if (this.usage.day !== day) {
            this.usage = { day, counts: {} };
            this.usageDirty = true;
        }
    }

    /**
     * Questions left today, or null when there is no limit for this person.
     */
    remaining(who) {
        const daily = this.settings.daily;
        if (!daily.enabled || (who.isOwner && !daily.owner)) return null;
        this.rollDay();
        const key = personKey(who.sender);
        return Math.max(0, daily.limit - (this.usage.counts[key] || 0) - (this.reserved.get(key) || 0));
    }

    /**
     * Take one of today's questions for a request that is starting. Called in
     * the same synchronous step as the remaining() check, so two requests
     * arriving together (in two chats) cannot both take the last one.
     * @returns {boolean} whether a use was reserved (false: no limit applies)
     */
    reserveUse(who) {
        const daily = this.settings.daily;
        if (!daily.enabled || (who.isOwner && !daily.owner)) return false;
        const key = personKey(who.sender);
        this.reserved.set(key, (this.reserved.get(key) || 0) + 1);
        return true;
    }

    /** Give a reserved use back: the request ended without an answer. */
    releaseUse(who) {
        const key = personKey(who.sender);
        const left = (this.reserved.get(key) || 0) - 1;
        if (left > 0) this.reserved.set(key, left);
        else this.reserved.delete(key);
    }

    /** The request was answered: its reserved use becomes a counted one. */
    countUse(who) {
        this.releaseUse(who);
        this.rollDay();
        const key = personKey(who.sender);
        this.usage.counts[key] = (this.usage.counts[key] || 0) + 1;
        this.scheduleUsageFlush();
    }

    // ─────────────────────────────────────────────────────
    //  ASKING
    // ─────────────────────────────────────────────────────

    /**
     * Answer one question.
     *
     * @param {Object} who - { sender, chat, isGroup, isOwner }
     * @param {string} question
     * @param {Object} [hooks]
     * @param {string} [hooks.quoted] - Text of the replied-to message
     * @param {Function} [hooks.onQueued] - (position) when it has to wait
     * @param {Function} [hooks.onStart] - (session) once it runs
     * @param {Function} [hooks.onActivity] - (event, session) for each sign of life
     * @returns {Promise<Object>} { parts, files, filesDropped, model, backend, viaFallback, partial, cut, truncated, ms, remaining }
     * @throws {ChatUserError}
     */
    async ask(who, question, hooks = {}) {
        const s = this.settings;
        const key = ChatMemory.key(who.chat, who.sender);
        const person = personKey(who.sender);

        // Everything from here to the reservation is synchronous: two requests
        // from one person (say in two chats) cannot both pass these checks.
        // One request per person at a time, whichever chat it is in; each
        // chat keeps its own history.
        if (this.busyPeople.has(person)) throw new ChatUserError('busy_user');
        const left = this.remaining(who);
        if (left !== null && left <= 0) throw new ChatUserError('daily_limit', { limit: s.daily.limit });

        const order = this.candidates(who);
        if (!order.length) throw new ChatUserError('agent_owner');

        const controller = new AbortController();
        const session = {
            key,
            sender: who.sender,
            chat: who.chat,
            controller,
            queued: true,
            startedAt: this.now(),
            lastActivityAt: this.now(),
            backend: null,
            tool: null,
            chars: 0
        };
        this.sessions.set(key, session);
        this.busyPeople.add(person);
        // Held until the request ends: counted if answered, released if not
        // (error, empty answer, queue timeout, .chat stop).
        let reserved = this.reserveUse(who);

        let holding = false;
        try {
            holding = this.slots.tryAcquire();
            if (!holding) {
                if (s.queueMax === 0 || this.slots.queueFull) throw new ChatUserError('busy', { active: this.slots.active });
                if (hooks.onQueued) await hooks.onQueued(this.slots.waiting + 1);
                holding = await this.slots.wait(s.queueWaitMs, controller.signal);
                if (!holding) {
                    throw new ChatUserError(controller.signal.aborted ? 'stopped' : 'queue_timeout');
                }
            }
            session.queued = false;
            session.startedAt = this.now();
            session.lastActivityAt = this.now();
            if (hooks.onStart) hooks.onStart(session);

            const userContent = this.buildUserContent(question, s.quotedContext ? hooks.quoted : null);
            const result = await this.route(order, who, key, userContent, session, hooks);

            let text = s.stripThinking ? format.stripThinking(result.text) : result.text.trim();
            text = redactKnown(text);
            const remembered = text;

            // Files the agent made (MEDIA:<path> lines). Only the agent's
            // answers, and only with an outbox folder configured.
            let files = [];
            let filesDropped = 0;
            if (s.agentMedia.dir && result.backend === 'agent') {
                ({ text, refs: files, dropped: filesDropped } = agentMedia.extract(text, s.agentMedia.maxFiles));
            }
            if (!text && files.length === 0) throw new ChatUserError('empty');

            const { parts, cut } = text
                ? format.split(format.toWhatsApp(text), { maxParts: s.maxParts })
                : { parts: [], cut: false };

            if (!result.partial) {
                // The full text, MEDIA lines included: the agent sees what it sent.
                this.memory.add(key, userContent, remembered);
            }
            if (reserved) {
                this.countUse(who);
                reserved = false;
            }

            return {
                parts,
                cut,
                files,
                filesDropped,
                model: result.model,
                backend: result.backend,
                viaFallback: result.viaFallback,
                partial: result.partial,
                truncated: result.truncated,
                ms: this.now() - session.startedAt,
                remaining: this.remaining(who)
            };
        } finally {
            if (reserved) this.releaseUse(who);
            if (holding) this.slots.release();
            this.sessions.delete(key);
            this.busyPeople.delete(person);
        }
    }

    /**
     * The text sent as the user's turn: the replied-to message (if any) and
     * the question, within CHAT_MAX_INPUT.
     */
    buildUserContent(question, quoted) {
        const max = this.settings.maxInput;
        const q = String(question || '').trim().slice(0, max);
        if (!quoted || !String(quoted).trim()) return q;
        const room = Math.max(0, max - q.length - 40);
        const context = String(quoted).trim().slice(0, room);
        if (!context) return q;
        return `Pesan yang dibalas:\n"""\n${context}\n"""\n\n${q}`;
    }

    /**
     * Try the backends in order. Returns the first answer; throws a
     * ChatUserError when none could answer.
     */
    async route(order, who, key, userContent, session, hooks) {
        const client = require('./client');
        const s = this.settings;
        const tried = [];

        for (let i = 0; i < order.length; i++) {
            const id = order[i];
            const backend = s.backends[id];
            const gate = this.health.check(id);
            if (!gate.ok) {
                tried.push({ id, skipped: true, state: gate.state, retryInMs: gate.retryInMs });
                continue;
            }

            session.backend = id;
            const useAgentMemory = backend.isAgent && backend.memory === 'agent';
            const history = useAgentMemory ? [] : this.memory.history(key, userContent.length + s.systemPrompt.length);
            const req = {
                system: s.systemPrompt,
                messages: [...history, { role: 'user', content: userContent }],
                maxTokens: s.maxTokens,
                temperature: s.temperature,
                topP: s.topP,
                sessionKey: useAgentMemory ? this.memory.sessionId(key) : null
            };

            const ctx = {
                signal: session.controller.signal,
                maxActiveMs: s.maxActiveMs,
                agents: transport.agentsFor(backend, {
                    maxSockets: s.maxConcurrent,
                    forceIPv4: config.network ? config.network.forceIPv4 : false
                }),
                onSessionReset: () => this.memory.rotateSession(key),
                onActivity: (event) => {
                    session.lastActivityAt = this.now();
                    if (event.type === 'tool' && event.tool) session.tool = event.tool;
                    if (event.type === 'text') session.tool = null;
                    if (hooks.onActivity) hooks.onActivity(event, session);
                }
            };

            try {
                const answer = await client.ask(backend, req, ctx);
                this.health.success(id);
                if (gate.probe) logger.chat(`${backend.label} answered again — back in use`);
                logger.chat(this.describeSuccess(backend, answer, i > 0));
                return { ...answer, backend: id, viaFallback: i > 0, partial: false };
            } catch (error) {
                if (error.kind === 'aborted') {
                    this.health.release(id);
                    throw new ChatUserError('stopped');
                }

                const state = this.health.failure(id, error);
                if (gate.probe && !error.isConfig && !error.isNetwork) this.health.release(id);
                tried.push({ id, error, state });
                this.logFailure(backend, error, state, order[i + 1]);

                // Not the backend's fault: no point asking another one.
                if (error.kind === 'refusal') throw new ChatUserError('refusal');
                if (error.kind === 'context') throw new ChatUserError('context', { error });
                if (error.kind === 'max_active') {
                    if (error.partialText && error.partialText.trim()) {
                        return { text: error.partialText, model: backend.model, backend: id, viaFallback: i > 0, partial: 'max_active' };
                    }
                    throw new ChatUserError('max_active', { error });
                }

                // Half an answer is worth sending; asking another backend
                // would repeat the work (and an agent's side effects).
                if (error.partialText && error.partialText.trim()) {
                    return { text: error.partialText, model: backend.model, backend: id, viaFallback: i > 0, partial: error.kind };
                }
            }
        }

        throw new ChatUserError('offline', { tried });
    }

    describeSuccess(backend, answer, viaFallback) {
        const host = backend.url ? maskHost(backend.url.hostname) : '?';
        return `${backend.label} host=${host} model=${answer.model} → ✓ ${(answer.ms / 1000).toFixed(1)}s` +
            `${answer.truncated ? ' · cut at CHAT_MAX_TOKENS' : ''}${viaFallback ? ' · fallback' : ''}`;
    }

    logFailure(backend, error, state, nextId) {
        const host = backend.url ? maskHost(backend.url.hostname) : '?';
        const status = error.status ? `${error.status} ` : '';
        const after = error.ms !== undefined ? ` after ${(error.ms / 1000).toFixed(1)}s` : '';
        const health = this.health.snapshot(backend.id);
        let tail = '';
        if (state === 'down:config') tail = ' · set aside until fixed';
        else if (state === 'down:network') tail = ` · set aside, next try in ${Math.ceil((health.retryInMs || 0) / 1000)}s`;
        else if (error.isNetwork) tail = ` · ${health.failures}/${this.settings.failThreshold}`;
        if (error.partialText && error.partialText.trim()) tail += ' · partial answer sent';
        else if (nextId && error.kind !== 'refusal' && error.kind !== 'context') tail += ` · trying ${nextId}`;

        const lines = [`${backend.label} host=${host} model=${backend.model} → ${status}${error.kind}: ${error.summary}${after}${tail}`];
        if (error.serverMessage) lines.push(`server: ${error.serverMessage}`);
        if (error.fix) lines.push(`fix: ${error.fix}`);
        logger.chat(lines, { problem: true });
    }

    // ─────────────────────────────────────────────────────
    //  HEALTH NOTICES
    // ─────────────────────────────────────────────────────

    onHealthChange({ id, state, previous, reason, cooldownMs, failures }) {
        if (this.quiet) return;
        const backend = this.settings.backends[id];
        const label = backend ? backend.label : id;
        if (state === 'down:network') {
            logger.chat(`${label} set aside for ${Math.round(cooldownMs / 1000)}s after ${failures} failures in a row (${reason}) — requests skip it until then`, { problem: true });
        } else if (state === 'down:config' && previous !== 'down:config') {
            logger.chat(`${label} set aside until its settings are fixed (${reason})`, { problem: true });
        } else if (state === 'ready') {
            logger.chat(`${label} is back in use (${reason})`);
        }
        this.noticeOwner(id, label, state, reason, previous);
    }

    noticeOwner(id, label, state, reason, previous) {
        if (!this.settings.notifyOwner) return;
        const last = this.ownerNotices.get(id);
        const now = this.now();
        let text = null;

        if (state.startsWith('down')) {
            if (last && last.down && now - last.at < OWNER_NOTICE_GAP_MS) return;
            const fallback = this.settings.fallback !== 'none' && this.settings.fallback !== id ? ` — cadangan (${this.settings.fallback}) dipakai` : '';
            text = `⚠️ *AI ${label} offline*\n${reason}${fallback}\n\n_Detail: .chat status_`;
            this.ownerNotices.set(id, { at: now, down: true });
        } else if (state === 'ready' && last && last.down) {
            text = `✅ *AI ${label} kembali normal*`;
            this.ownerNotices.set(id, { at: now, down: false });
        }

        if (text) {
            Promise.resolve()
                .then(() => this.sendOwner(text))
                .catch(() => { /* a failed notice must never surface */ });
        }
    }

    // ─────────────────────────────────────────────────────
    //  OWNER TOOLS
    // ─────────────────────────────────────────────────────

    /**
     * Cancel running or queued requests.
     *
     * A person's own request, from whichever chat it was asked in: there is
     * at most one, and "masih diproses" in one chat must be stoppable there.
     *
     * @param {Object} who
     * @param {boolean} all - Every session (owner)
     * @returns {number} how many were cancelled
     */
    stop(who, all = false) {
        let count = 0;
        for (const session of this.sessions.values()) {
            const mine = personKey(session.sender) === personKey(who.sender);
            if (all || mine) {
                session.controller.abort('stopped');
                count++;
            }
        }
        return count;
    }

    /**
     * Switch the main backend live (`.chat use`).
     * @returns {{ok: boolean, reason?: string}}
     */
    use(id) {
        const backend = this.settings.backends[id];
        if (!backend) return { ok: false, reason: 'not_configured' };
        if (!backend.usable) return { ok: false, reason: 'unusable', detail: backend.unusable.join('; ') };
        this.settings.backend = id;
        if (this.settings.fallback === id) this.settings.fallback = 'none';
        try {
            fs.mkdirSync(dataDir(), { recursive: true });
            fs.writeFileSync(this.statePath(STATE_FILE), JSON.stringify({ backend: id, updatedAt: this.now() }, null, 2));
        } catch (error) {
            logger.chat(`could not save the backend choice (${error.code || error.message}) — it resets on restart`);
        }
        logger.chat(`main backend switched to ${backend.label}`);
        return { ok: true };
    }

    /** Forget my conversation here. */
    reset(who) {
        return this.memory.reset(ChatMemory.key(who.chat, who.sender));
    }

    /**
     * Run the checks for the main and fallback backends. A backend that
     * passes is put back in use.
     * @returns {Promise<Array<{id: string, ok: boolean, lines: Array}>>}
     */
    async test() {
        const { probe } = require('./check');
        const results = [];
        const ids = [this.settings.backend, this.settings.fallback]
            .filter((id, i, all) => id && id !== 'none' && all.indexOf(id) === i && this.settings.backends[id]);
        for (const id of ids) {
            const backend = this.settings.backends[id];
            const result = await probe(backend, {
                agents: transport.agentsFor(backend, { maxSockets: this.settings.maxConcurrent, forceIPv4: config.network ? config.network.forceIPv4 : false })
            });
            if (result.ok) this.health.reset(id);
            else if (result.error && result.error.kind !== 'bad_config') {
                const { ChatError } = require('./client');
                const err = result.error instanceof ChatError ? result.error : new ChatError(result.error.kind, result.error.summary, result.error);
                if (err.isConfig) this.health.failure(id, err);
            }
            results.push({ id, ok: result.ok, lines: result.lines });
        }
        return results;
    }

    /** Model list of the main backend. */
    async models(id = this.settings.backend) {
        const backend = this.settings.backends[id];
        if (!backend) throw new ChatUserError('not_configured');
        if (!backend.usable) throw new ChatUserError('unusable', { detail: backend.unusable.join('; ') });
        const client = require('./client');
        return client.listModels(backend, {
            agents: transport.agentsFor(backend, { maxSockets: this.settings.maxConcurrent, forceIPv4: config.network ? config.network.forceIPv4 : false }),
            responseTimeoutMs: Math.min(backend.responseTimeoutMs, 30000),
            idleTimeoutMs: Math.min(backend.idleTimeoutMs, 30000)
        });
    }

    /**
     * Open a file the agent named in a MEDIA: line, if it is inside the
     * outbox folder (utils/chat/media.js holds the checks).
     * @param {string} ref
     * @returns {Promise<Object>} An opened file, or { error }
     */
    openFile(ref) {
        const dir = this.settings.agentMedia.dir;
        if (!dir) return Promise.resolve({ error: 'outside' });
        return agentMedia.open(ref, dir, config.media.maxFileBytes);
    }

    /**
     * Everything `.chat status` shows.
     * @param {Object} who
     */
    status(who) {
        const s = this.settings;
        const backends = {};
        for (const [id, b] of Object.entries(s.backends)) {
            backends[id] = {
                label: b.label,
                model: b.model,
                host: b.url ? maskHost(b.url.hostname) : '?',
                key: b.key ? `${b.key.length} karakter · ${fingerprint(b.key)}` : null,
                usable: b.usable,
                memory: b.memory,
                health: this.health.snapshot(id)
            };
        }
        const now = this.now();
        const sessions = [...this.sessions.values()].map(x => ({
            sender: x.sender,
            mine: personKey(x.sender) === personKey(who.sender),
            backend: x.backend,
            queued: x.queued,
            runningMs: now - x.startedAt,
            idleMs: now - x.lastActivityAt,
            tool: x.tool
        }));
        return {
            enabled: s.enabled,
            backend: s.backend,
            fallback: s.fallback,
            access: s.access,
            agentAccess: s.agentAccess,
            backends,
            sessions,
            slots: { active: this.slots.active, waiting: this.slots.waiting, max: s.maxConcurrent, queueMax: s.queueMax },
            memory: { enabled: s.memory.turns > 0, turns: s.memory.turns, idleMin: Math.round(s.memory.idleMs / 60000), mine: this.memory.size(ChatMemory.key(who.chat, who.sender)) },
            daily: { enabled: s.daily.enabled, limit: s.daily.limit, remaining: this.remaining(who) },
            agentMedia: { dir: s.agentMedia.dir, maxFiles: s.agentMedia.maxFiles, maxBytes: config.media.maxFileBytes },
            problems: s.problems,
            recent: logger.recentChatProblems(5)
        };
    }

    // ─────────────────────────────────────────────────────
    //  LIFECYCLE
    // ─────────────────────────────────────────────────────

    /**
     * Log the configuration once, and (CHAT_STARTUP_CHECK) probe the
     * backends in the background. Never blocks or fails the bot's start.
     */
    startup() {
        const s = this.settings;
        const describe = id => {
            const b = s.backends[id];
            if (!b) return `${id} (not configured)`;
            const state = b.usable ? 'ready' : 'OFF — settings incomplete';
            return `${b.label}, ${b.model || '?'} @ ${b.url ? maskHost(b.url.hostname) : '?'} ${state}`;
        };
        const parts = [`AI chat: ${describe(s.backend)}`];
        if (s.fallback !== 'none') parts.push(`fallback ${describe(s.fallback)}`);
        parts.push(`access ${s.access}${s.backend === 'agent' || s.fallback === 'agent' ? ` (agent: ${s.agentAccess})` : ''}`);
        parts.push(`${s.maxConcurrent} at once`);
        parts.push(`${s.problems.length} config problem${s.problems.length === 1 ? '' : 's'}`);
        logger.chat(parts.join(' · '));
        for (const problem of s.problems) logger.chat(`config: ${problem}`, { problem: true });

        if (!s.startupCheck) return;
        const ids = [s.backend, s.fallback].filter((id, i, all) => id && id !== 'none' && all.indexOf(id) === i && s.backends[id] && s.backends[id].usable);
        for (const id of ids) {
            const backend = s.backends[id];
            const client = require('./client');
            client.listModels(backend, {
                agents: transport.agentsFor(backend, { maxSockets: s.maxConcurrent, forceIPv4: config.network ? config.network.forceIPv4 : false }),
                responseTimeoutMs: 15000,
                idleTimeoutMs: 15000
            }).then((models) => {
                logger.chat(`startup check: ${backend.label} reachable${models.length ? `, ${models.length} models` : ''}`);
            }).catch((error) => {
                if (error.kind === 'endpoint') return; // some servers have no model list
                if (error.isConfig) this.health.failure(id, error);
                this.logFailure(backend, error, this.health.snapshot(id).state, null);
            });
        }
    }

    /** Cancel everything and save the counters (bot shutdown). */
    shutdown() {
        for (const session of this.sessions.values()) session.controller.abort('shutdown');
        clearTimeout(this.usageTimer);
        this.usageTimer = null;
        this.flushUsage();
        this.memory.destroy();
        transport.destroyAgents();
    }
}

/** Private message to the bot owner through the live socket. */
async function defaultSendOwner(text) {
    const sock = socketRef.get();
    const ids = config.bot.ownerIds || [];
    const jid = ids.find(id => id.endsWith('@s.whatsapp.net')) || ids[0];
    if (!sock || !jid) return;
    await sock.sendMessage(jid, { text });
}

let instance = null;

/** The one service, created on first use. */
function service() {
    if (!instance) instance = new ChatService();
    return instance;
}

/** Shut down the service if it was ever started. */
function shutdown() {
    if (instance) instance.shutdown();
}

/** Tests: drop the instance so the next call reads settings afresh. */
function _reset() {
    if (instance) instance.shutdown();
    instance = null;
}

module.exports = { service, shutdown, ChatService, ChatUserError, today, _reset };
