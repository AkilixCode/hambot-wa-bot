/**
 * AI Chat Settings
 *
 * Every CHAT_* variable from .env, parsed once and checked. Nothing here can
 * throw: a value that cannot be used falls back to its default and becomes a
 * problem line naming the variable, what it held and what is used instead.
 * Those lines are logged at startup, shown to the owner in `.chat status`
 * and listed by `./deploy.sh doctor`.
 *
 * A backend whose own settings are unusable (no URL, no model, a key that
 * would travel over plain http to the internet, …) is marked `unusable`
 * here, before the first message, so no request ever waits on it.
 *
 * Deliberately light: no network, no SDKs. commands/chat.js reads its
 * cooldown from here without loading the rest of utils/chat.
 */

const fs = require('fs');
const path = require('path');
const net = require('net');

const BACKENDS = ['local', 'provider', 'agent'];
const ACCESS = ['owner', 'allowlist', 'public'];

// Official addresses used when CHAT_PROVIDER_URL is empty.
const PROVIDER_DEFAULT_URL = {
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com',
    gemini: 'https://generativelanguage.googleapis.com/v1beta'
};

const AGENT_DEFAULT_MODEL = {
    hermes: 'hermes-agent',
    openclaw: null, // built from CHAT_AGENT_ID
    openai: null
};

// Endpoint paths people paste by accident. Stripped so the base URL is left.
const ENDPOINT_SUFFIXES = [
    /\/chat\/completions\/?$/i,
    /\/completions\/?$/i,
    /\/api\/chat\/?$/i,
    /\/api\/generate\/?$/i,
    /\/api\/tags\/?$/i,
    /\/messages\/?$/i,
    /\/models\/?$/i
];

const DEFAULT_SYSTEM_PROMPT = [
    'Kamu adalah {name}, asisten AI yang menjawab lewat WhatsApp.',
    'Jawab dalam bahasa yang dipakai pengguna (default: Bahasa Indonesia), ringkas dan jelas.',
    'Format untuk WhatsApp: *tebal*, _miring_, daftar dengan "•", blok kode dengan ```.',
    'Jangan memakai tabel atau heading Markdown.'
].join('\n');

/**
 * Small parsing helpers that record what went wrong instead of throwing.
 * @param {Object} env
 * @param {string[]} problems
 */
function reader(env, problems) {
    const raw = name => {
        const value = env[name];
        if (value === undefined || value === null) return '';
        return String(value).replace(/\r/g, '').trim();
    };

    const bool = (name, fallback) => {
        const value = raw(name).toLowerCase();
        if (!value) return fallback;
        if (['true', 'yes', 'on', '1'].includes(value)) return true;
        if (['false', 'no', 'off', '0'].includes(value)) return false;
        problems.push(`${name}=${raw(name)} is not true/false, using ${fallback}`);
        return fallback;
    };

    const num = (name, fallback, min, max, { float = false } = {}) => {
        const value = raw(name);
        if (!value) return fallback;
        const n = float ? Number(value) : Number.parseInt(value, 10);
        if (!Number.isFinite(n) || (!float && !/^-?\d+$/.test(value))) {
            problems.push(`${name}=${value} is not a number, using ${fallback}`);
            return fallback;
        }
        if (n < min) {
            problems.push(`${name}=${value} is below ${min}, using ${min}`);
            return min;
        }
        if (n > max) {
            problems.push(`${name}=${value} is above ${max}, using ${max}`);
            return max;
        }
        return n;
    };

    const optionalNum = (name, min, max) => {
        if (!raw(name)) return null;
        return num(name, null, min, max, { float: true });
    };

    const pick = (name, fallback, allowed) => {
        const value = raw(name).toLowerCase();
        if (!value) return fallback;
        if (allowed.includes(value)) return value;
        problems.push(`${name}=${raw(name)} is not one of ${allowed.join('|')}, using ${fallback}`);
        return fallback;
    };

    return { raw, bool, num, optionalNum, pick };
}

/**
 * Is this host on a network where a key may travel over plain http?
 * Loopback, private ranges, Tailscale (WireGuard-encrypted), Docker's host
 * alias and single-label names (container service names) qualify.
 * @param {string} hostname
 * @returns {boolean}
 */
function isPrivateHost(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!host) return false;
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    if (host === 'host.docker.internal' || host === 'gateway.docker.internal') return true;
    if (host.endsWith('.ts.net') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return true;

    if (net.isIPv4(host)) {
        const [a, b] = host.split('.').map(Number);
        return a === 127 || a === 10 ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            (a === 100 && b >= 64 && b <= 127); // Tailscale CGNAT range
    }
    if (net.isIPv6(host)) {
        return host === '::1' ||
            host.startsWith('fd7a:115c:a1e0') || // Tailscale
            /^f[cd][0-9a-f]{2}:/.test(host);     // unique local
    }
    // A name without a dot only resolves inside a private network
    // (a Docker service such as `ollama`, or a LAN hostname).
    return !host.includes('.');
}

/**
 * Turn what the user typed into a base URL for the given wire format.
 * @param {string} value
 * @param {string} api - openai | ollama | anthropic | gemini
 * @param {string} varName - For problem lines
 * @param {string[]} notes - Gets a line when the URL was changed
 * @returns {{url: URL|null, error: string|null}}
 */
function normaliseUrl(value, api, varName, notes) {
    let text = String(value || '').trim().replace(/^['"]|['"]$/g, '');
    if (!text) return { url: null, error: `${varName} is empty` };

    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
        return { url: null, error: `${varName}=${text} has no http:// or https:// in front` };
    }

    let url;
    try {
        url = new URL(text);
    } catch {
        return { url: null, error: `${varName}=${text} is not a valid URL` };
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
        return { url: null, error: `${varName} must start with http:// or https://` };
    }
    if (url.username || url.password) {
        return { url: null, error: `${varName} must not contain a user:password — put the key in its own variable` };
    }
    url.search = '';
    url.hash = '';

    let pathname = url.pathname.replace(/\/+$/, '');
    let stripped = false;
    for (const suffix of ENDPOINT_SUFFIXES) {
        const next = pathname.replace(suffix, '');
        if (next !== pathname) stripped = true;
        pathname = next;
    }
    pathname = pathname.replace(/\/+$/, '');

    if (api === 'ollama' && /\/v1$/i.test(pathname)) {
        // http://host:11434/v1 is Ollama's OpenAI-style address; the native
        // API lives at the root.
        pathname = pathname.replace(/\/v1$/i, '');
        notes.push(`${varName}: dropped /v1 (that is Ollama's OpenAI-style address; CHAT_LOCAL_API=ollama uses the root)`);
    } else if (api === 'openai' && pathname === '') {
        pathname = '/v1';
    } else if (api === 'anthropic') {
        pathname = pathname.replace(/\/v1$/i, '');
    } else if (api === 'gemini' && pathname === '') {
        pathname = '/v1beta';
    }

    if (stripped) notes.push(`${varName}: using ${url.origin}${pathname} (endpoint path removed)`);
    url.pathname = pathname || '/';
    return { url, error: null };
}

/**
 * Parse the allowlist into matchable entries.
 * @param {string} value
 * @param {string[]} problems
 * @returns {Array<{type: 'phone'|'lid', id: string}>}
 */
function parseAllowlist(value, problems) {
    const entries = [];
    for (const item of String(value || '').split(',').map(s => s.trim()).filter(Boolean)) {
        if (item.endsWith('@lid')) {
            entries.push({ type: 'lid', id: item.slice(0, -4) });
            continue;
        }
        const digits = item.replace(/@s\.whatsapp\.net$/, '').replace(/\D/g, '');
        if (!/^[1-9]\d{7,14}$/.test(digits)) {
            problems.push(`CHAT_ALLOWED_USERS: "${item}" is not a number with country code (e.g. 6281234567890), ignored`);
            continue;
        }
        entries.push({ type: 'phone', id: digits });
    }
    return entries;
}

/**
 * Does a sender JID match an allowlist?
 * @param {string} sender - e.g. 6281…@s.whatsapp.net, 6281…:12@s.whatsapp.net, 1234…@lid
 * @param {Array} entries
 * @returns {boolean}
 */
function matchesAllowlist(sender, entries) {
    if (!sender) return false;
    const [localWithDevice, domain = ''] = String(sender).split('@');
    const local = localWithDevice.split(':')[0];
    for (const entry of entries) {
        if (entry.type === 'lid' && domain === 'lid' && local === entry.id) return true;
        if (entry.type === 'phone' && domain !== 'lid' && local.replace(/\D/g, '') === entry.id) return true;
    }
    return false;
}

/**
 * Build one backend's settings.
 * @returns {Object|null} null when the backend is not configured at all
 */
function buildBackend(id, r, env, common, problems) {
    const notes = [];
    const unusable = [];
    const b = {
        id,
        isAgent: id === 'agent',
        notes,
        unusable,
        stream: true,
        responseTimeoutMs: 60000,
        idleTimeoutMs: 60000,
        useProxy: false,
        headers: {}
    };

    if (id === 'local') {
        const urlRaw = r.raw('CHAT_LOCAL_URL');
        const model = r.raw('CHAT_LOCAL_MODEL');
        // The URL has a default in .env.example; the model is what says
        // "this backend is set up".
        if (!model) return null;
        b.api = r.pick('CHAT_LOCAL_API', 'ollama', ['ollama', 'openai']);
        b.platform = b.api;
        b.urlVar = 'CHAT_LOCAL_URL';
        b.keyVar = 'CHAT_LOCAL_API_KEY';
        b.modelVar = 'CHAT_LOCAL_MODEL';
        b.key = r.raw('CHAT_LOCAL_API_KEY');
        b.model = model;
        b.ollama = {
            numCtx: r.num('CHAT_LOCAL_CONTEXT', 8192, 256, 1048576),
            keepAlive: r.raw('CHAT_LOCAL_KEEP_ALIVE') || '5m'
        };
        b.stream = r.bool('CHAT_LOCAL_STREAM', true);
        b.responseTimeoutMs = r.num('CHAT_LOCAL_RESPONSE_TIMEOUT_SEC', 120, 5, 3600) * 1000;
        b.idleTimeoutMs = r.num('CHAT_LOCAL_IDLE_TIMEOUT_SEC', 60, 5, 3600) * 1000;
        const parsed = normaliseUrl(urlRaw || 'http://127.0.0.1:11434', b.api, 'CHAT_LOCAL_URL', notes);
        b.url = parsed.url;
        if (parsed.error) unusable.push(parsed.error);
    }

    if (id === 'provider') {
        const api = r.pick('CHAT_PROVIDER_API', 'openai', ['openai', 'anthropic', 'gemini']);
        const urlRaw = r.raw('CHAT_PROVIDER_URL');
        let key = r.raw('CHAT_PROVIDER_API_KEY');
        b.keyVar = 'CHAT_PROVIDER_API_KEY';
        if (!key && api === 'gemini' && r.raw('GEMINI_API_KEY')) {
            key = r.raw('GEMINI_API_KEY');
            b.keyVar = 'GEMINI_API_KEY';
        }
        const model = r.raw('CHAT_PROVIDER_MODEL');
        if (!urlRaw && !model && !r.raw('CHAT_PROVIDER_API_KEY')) return null;

        b.api = api;
        b.platform = api;
        b.urlVar = 'CHAT_PROVIDER_URL';
        b.modelVar = 'CHAT_PROVIDER_MODEL';
        b.key = key;
        b.model = model;
        b.stream = r.bool('CHAT_PROVIDER_STREAM', true);
        b.responseTimeoutMs = r.num('CHAT_PROVIDER_RESPONSE_TIMEOUT_SEC', 60, 5, 3600) * 1000;
        b.idleTimeoutMs = r.num('CHAT_PROVIDER_IDLE_TIMEOUT_SEC', 60, 5, 3600) * 1000;
        b.useProxy = r.bool('CHAT_PROVIDER_USE_PROXY', false);

        const headersRaw = r.raw('CHAT_PROVIDER_HEADERS');
        if (headersRaw) {
            try {
                const parsed = JSON.parse(headersRaw);
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
                for (const [name, value] of Object.entries(parsed)) {
                    if (!/^[A-Za-z0-9-]{1,64}$/.test(name) || /[\r\n]/.test(String(value))) {
                        problems.push(`CHAT_PROVIDER_HEADERS: header "${name}" is not valid, ignored`);
                        continue;
                    }
                    if (/^(authorization|x-api-key|x-goog-api-key|host|content-length)$/i.test(name)) {
                        problems.push(`CHAT_PROVIDER_HEADERS: "${name}" is set by the bot itself, ignored`);
                        continue;
                    }
                    b.headers[name] = String(value);
                }
            } catch {
                problems.push('CHAT_PROVIDER_HEADERS is not a JSON object like {"HTTP-Referer":"https://example.com"}, ignored');
            }
        }

        const official = !urlRaw;
        const parsed = normaliseUrl(urlRaw || PROVIDER_DEFAULT_URL[api], api, 'CHAT_PROVIDER_URL', notes);
        b.url = parsed.url;
        if (parsed.error) unusable.push(parsed.error);
        if (!model) unusable.push('CHAT_PROVIDER_MODEL is empty — set the model name your provider uses');
        if (!key && official) unusable.push(`${b.keyVar} is empty — ${api} needs an API key`);
    }

    if (id === 'agent') {
        const urlRaw = r.raw('CHAT_AGENT_URL');
        if (!urlRaw) return null;
        b.platform = r.pick('CHAT_AGENT_PLATFORM', 'hermes', ['hermes', 'openclaw', 'openai']);
        b.api = 'openai';
        b.urlVar = 'CHAT_AGENT_URL';
        b.keyVar = 'CHAT_AGENT_TOKEN';
        b.modelVar = 'CHAT_AGENT_MODEL';
        b.key = r.raw('CHAT_AGENT_TOKEN');
        b.agentId = r.raw('CHAT_AGENT_ID') || 'default';
        if (!/^[A-Za-z0-9._-]{1,64}$/.test(b.agentId)) {
            problems.push(`CHAT_AGENT_ID=${b.agentId} has characters an agent id cannot have, using default`);
            b.agentId = 'default';
        }
        b.model = r.raw('CHAT_AGENT_MODEL') ||
            AGENT_DEFAULT_MODEL[b.platform] ||
            (b.platform === 'openclaw' ? `openclaw/${b.agentId}` : '');
        b.memory = r.pick('CHAT_AGENT_MEMORY', 'bot', ['bot', 'agent']);
        b.stream = r.bool('CHAT_AGENT_STREAM', true);
        b.responseTimeoutMs = r.num('CHAT_AGENT_RESPONSE_TIMEOUT_SEC', 90, 5, 3600) * 1000;
        b.idleTimeoutMs = r.num('CHAT_AGENT_IDLE_TIMEOUT_SEC', 180, 5, 3600) * 1000;
        const parsed = normaliseUrl(urlRaw, 'openai', 'CHAT_AGENT_URL', notes);
        b.url = parsed.url;
        if (parsed.error) unusable.push(parsed.error);
        if (!b.model) unusable.push('CHAT_AGENT_MODEL is empty — set the model name your agent expects');
        if (b.memory === 'agent' && b.platform === 'hermes' && !b.key) {
            problems.push('CHAT_AGENT_MEMORY=agent needs CHAT_AGENT_TOKEN with Hermes (it refuses sessions without a key), using bot');
            b.memory = 'bot';
        }
        if (b.memory === 'agent' && b.platform === 'openai') {
            problems.push('CHAT_AGENT_MEMORY=agent only works with hermes or openclaw, using bot');
            b.memory = 'bot';
        }
        if (!b.key && b.url && !['localhost', '127.0.0.1', '::1'].includes(b.url.hostname)) {
            notes.push('CHAT_AGENT_TOKEN is empty — Hermes and OpenClaw require one for anything but localhost');
        }
    }

    // A key must never cross the internet in clear text.
    if (b.url && b.key && b.url.protocol === 'http:' && !isPrivateHost(b.url.hostname)) {
        unusable.push(`${b.urlVar} uses http:// to a public host, so ${b.keyVar} would travel unencrypted — use https://`);
    }

    b.label = `${id}(${b.platform})`;
    b.usable = unusable.length === 0;
    for (const reason of unusable) problems.push(`${id}: ${reason} — this backend is off until fixed`);
    for (const note of notes) problems.push(`${id}: ${note}`);
    return b;
}

/**
 * Parse every CHAT_* setting.
 * @param {Object} [env] - Defaults to process.env
 * @param {Object} [opts]
 * @param {string} [opts.botName]
 * @returns {Object}
 */
function load(env = process.env, opts = {}) {
    const problems = [];
    const r = reader(env, problems);

    const s = {
        enabled: r.bool('CHAT_ENABLED', false),
        backend: r.pick('CHAT_BACKEND', 'local', BACKENDS),
        fallback: r.pick('CHAT_FALLBACK', 'none', ['none', ...BACKENDS]),
        access: r.pick('CHAT_ACCESS', 'owner', ACCESS),
        agentAccess: r.pick('CHAT_AGENT_ACCESS', 'owner', ACCESS),
        inGroups: r.bool('CHAT_IN_GROUPS', true),
        inPrivate: r.bool('CHAT_IN_PRIVATE', true),

        maxConcurrent: r.num('CHAT_MAX_CONCURRENT', 2, 1, 10),
        queueMax: r.num('CHAT_QUEUE_MAX', 3, 0, 50),
        queueWaitMs: r.num('CHAT_QUEUE_WAIT_SEC', 120, 5, 3600) * 1000,
        cooldownMs: r.num('CHAT_COOLDOWN_SEC', 5, 0, 3600) * 1000,
        daily: {
            enabled: r.bool('CHAT_DAILY_LIMIT_ENABLED', false),
            limit: r.num('CHAT_DAILY_LIMIT', 20, 1, 100000),
            owner: r.bool('CHAT_DAILY_LIMIT_OWNER', false)
        },
        maxInput: r.num('CHAT_MAX_INPUT', 6000, 100, 100000),
        maxTokens: r.num('CHAT_MAX_TOKENS', 2048, 16, 128000),
        maxParts: r.num('CHAT_MAX_PARTS', 4, 1, 10),
        maxActiveMs: r.num('CHAT_MAX_ACTIVE_MIN', 0, 0, 1440) * 60000,

        temperature: r.optionalNum('CHAT_TEMPERATURE', 0, 2),
        topP: r.optionalNum('CHAT_TOP_P', 0, 1),

        memory: {
            enabled: r.bool('CHAT_MEMORY_ENABLED', true),
            turns: r.num('CHAT_MEMORY_TURNS', 10, 0, 100),
            idleMs: r.num('CHAT_MEMORY_IDLE_MIN', 30, 1, 10080) * 60000,
            maxChars: r.num('CHAT_MEMORY_MAX_CHARS', 12000, 500, 1000000),
            maxChats: r.num('CHAT_MEMORY_MAX_CHATS', 500, 10, 100000)
        },

        quotedContext: r.bool('CHAT_QUOTED_CONTEXT', true),
        showModel: r.bool('CHAT_SHOW_MODEL', true),
        typing: r.bool('CHAT_TYPING_INDICATOR', true),
        stripThinking: r.bool('CHAT_STRIP_THINKING', true),

        failThreshold: r.num('CHAT_FAIL_THRESHOLD', 3, 1, 50),
        retryCooldownMs: r.num('CHAT_RETRY_COOLDOWN_SEC', 30, 5, 600) * 1000,
        notifyOwner: r.bool('CHAT_NOTIFY_OWNER', true),
        startupCheck: r.bool('CHAT_STARTUP_CHECK', true),

        allowed: parseAllowlist(r.raw('CHAT_ALLOWED_USERS'), problems),
        problems,
        backends: {}
    };

    if (!s.memory.enabled) s.memory.turns = 0;
    if (s.maxActiveMs === 0) s.maxActiveMs = null;

    // System prompt: a file wins over the inline value, which wins over the default.
    const name = opts.botName || r.raw('BOT_NAME') || 'HamBot';
    let prompt = r.raw('CHAT_SYSTEM_PROMPT').replace(/\\n/g, '\n');
    const promptFile = r.raw('CHAT_SYSTEM_PROMPT_FILE');
    if (promptFile) {
        try {
            const file = path.resolve(path.join(__dirname, '..', '..'), promptFile);
            const text = fs.readFileSync(file, 'utf8').trim();
            if (text) prompt = text.slice(0, 20000);
            else problems.push(`CHAT_SYSTEM_PROMPT_FILE=${promptFile} is empty, using ${prompt ? 'CHAT_SYSTEM_PROMPT' : 'the built-in prompt'}`);
        } catch (error) {
            problems.push(`CHAT_SYSTEM_PROMPT_FILE=${promptFile} cannot be read (${error.code || error.message}), using ${prompt ? 'CHAT_SYSTEM_PROMPT' : 'the built-in prompt'}`);
        }
    }
    s.systemPrompt = (prompt || DEFAULT_SYSTEM_PROMPT).replace(/\{name\}/g, name);

    for (const id of BACKENDS) {
        const backend = buildBackend(id, r, env, s, problems);
        if (backend) s.backends[id] = backend;
    }

    if (s.enabled) {
        if (!s.backends[s.backend]) {
            const needs = { local: 'CHAT_LOCAL_MODEL', provider: 'CHAT_PROVIDER_MODEL and CHAT_PROVIDER_API_KEY', agent: 'CHAT_AGENT_URL' }[s.backend];
            problems.push(`CHAT_BACKEND=${s.backend} but that backend has no settings — set ${needs} (or run ./deploy.sh chat)`);
        }
        if (s.fallback !== 'none' && !s.backends[s.fallback]) {
            problems.push(`CHAT_FALLBACK=${s.fallback} but that backend has no settings, no fallback is used`);
            s.fallback = 'none';
        }
        if (s.fallback === s.backend) s.fallback = 'none';
        if (s.access === 'allowlist' && s.allowed.length === 0) {
            problems.push('CHAT_ACCESS=allowlist but CHAT_ALLOWED_USERS is empty, so only the owner can chat');
        }
    }

    return s;
}

/**
 * May this person use this backend here?
 * @param {Object} s - From load()
 * @param {Object} who - { sender, isGroup, isOwner }
 * @param {string} [backendId]
 * @returns {{ok: boolean, reason?: string}}
 */
function checkAccess(s, who, backendId) {
    if (who.isGroup && !s.inGroups) return { ok: false, reason: 'groups' };
    if (!who.isGroup && !s.inPrivate) return { ok: false, reason: 'private' };
    if (who.isOwner) return { ok: true };

    // For the agent, the stricter of the two settings applies: agent access
    // can never be wider than general access.
    const effective = backendId === 'agent' && ACCESS.indexOf(s.agentAccess) < ACCESS.indexOf(s.access)
        ? s.agentAccess
        : s.access;
    if (effective === 'public') return { ok: true };
    if (effective === 'allowlist' && matchesAllowlist(who.sender, s.allowed)) return { ok: true };
    return { ok: false, reason: effective === 'owner' ? 'owner' : 'allowlist' };
}

module.exports = {
    load,
    checkAccess,
    isPrivateHost,
    normaliseUrl,
    matchesAllowlist,
    parseAllowlist,
    BACKENDS,
    PROVIDER_DEFAULT_URL,
    DEFAULT_SYSTEM_PROMPT
};
