/**
 * AI Chat Tests
 *
 * Every wire format, timer, limit and failure path of `.chat`, against fake
 * servers on 127.0.0.1 — no AI, no network, no WhatsApp. Run with:
 *   npm run test:chat
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'hambot-chat-test-'));

// Before config.js is loaded anywhere.
process.env.HAMBOT_DATA_DIR = DATA;
process.env.BOT_OWNER_ID = '6281111111111';
process.env.LOG_LEVEL = 'simple';
process.env.CHAT_COOLDOWN_SEC = '0';
process.env.RATE_LIMIT_MAX = '1000';
delete process.env.CHAT_ENABLED;

const settingsLib = require('../utils/chat/settings');
const format = require('../utils/chat/format');
const ChatMemory = require('../utils/chat/memory');
const BackendHealth = require('../utils/chat/health');
const client = require('../utils/chat/client');
const transport = require('../utils/chat/transport');
const { ChatService, ChatUserError, today } = require('../utils/chat');
const { ChatError } = client;

let passed = 0;
let failed = 0;
const only = process.env.ONLY;

async function test(name, fn) {
    if (only && !name.includes(only)) return;
    try {
        await fn();
        passed++;
        console.log(`✅ PASS: ${name}`);
    } catch (error) {
        failed++;
        console.log(`❌ FAIL: ${name}\n   ${error && error.stack ? error.stack.split('\n').slice(0, 4).join('\n   ') : error}`);
    }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ─────────────────────────────────────────────────────
//  FAKE SERVERS
// ─────────────────────────────────────────────────────

/**
 * A local HTTP server whose behaviour each test sets with `on(fn)`.
 * Records every request and counts TCP connections.
 */
function fakeServer() {
    const state = { requests: [], connections: 0, closed: 0, handler: null };
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            const record = { method: req.method, url: req.url, headers: req.headers, body, json: null };
            try { record.json = JSON.parse(body); } catch { /* not JSON */ }
            state.requests.push(record);
            if (state.handler) state.handler(req, res, record);
            else res.end();
        });
    });
    server.on('connection', (socket) => {
        state.connections++;
        socket.on('close', () => { state.closed++; });
    });
    server.keepAliveTimeout = 30000;
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        resolve({
            port,
            url: `http://127.0.0.1:${port}`,
            state,
            get requests() { return state.requests; },
            on(fn) { state.handler = fn; state.requests = []; },
            close() {
                server.closeAllConnections && server.closeAllConnections();
                return new Promise(r => server.close(() => r()));
            }
        });
    }));
}

/** An OpenAI-style SSE answer, one chunk per piece, `gap` ms apart. */
function sseAnswer(res, pieces, { gap = 10, model = 'fake-model', extra = [] } = {}) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const events = [...extra];
    for (const piece of pieces) events.push(`data: ${JSON.stringify({ model, choices: [{ delta: { content: piece } }] })}\n\n`);
    events.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
    events.push('data: [DONE]\n\n');
    let i = 0;
    const next = () => {
        if (res.destroyed) return;
        if (i >= events.length) return res.end();
        res.write(events[i++]);
        setTimeout(next, gap);
    };
    next();
}

function jsonReply(res, status, obj, headers = {}) {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(obj));
}

/** Settings for one backend pointing at a fake server. */
function backendFor(id, srv, env = {}) {
    const base = {
        local: { CHAT_LOCAL_API: 'openai', CHAT_LOCAL_URL: srv.url, CHAT_LOCAL_MODEL: 'fake-model' },
        provider: { CHAT_PROVIDER_API: 'openai', CHAT_PROVIDER_URL: `${srv.url}/v1`, CHAT_PROVIDER_MODEL: 'fake-model', CHAT_PROVIDER_API_KEY: 'sk-test-provider-key-123456' },
        agent: { CHAT_AGENT_PLATFORM: 'hermes', CHAT_AGENT_URL: `${srv.url}/v1`, CHAT_AGENT_TOKEN: 'agent-token-abcdef123456' }
    }[id];
    const s = settingsLib.load({ CHAT_ENABLED: 'true', CHAT_BACKEND: id, ...base, ...env });
    return s.backends[id];
}

const ctxFast = (extra = {}) => ({ responseTimeoutMs: 1500, idleTimeoutMs: 1500, ...extra });
const simpleReq = (extra = {}) => ({ system: 'sys', messages: [{ role: 'user', content: 'hi' }], maxTokens: 64, temperature: null, topP: null, ...extra });

/** Capture console.log output while fn runs. */
async function captureLogs(fn) {
    const lines = [];
    const original = console.log;
    console.log = (...args) => lines.push(args.join(' '));
    try {
        await fn();
    } finally {
        console.log = original;
    }
    return lines.join('\n');
}

const who = (n = 1, extra = {}) => ({ sender: `62812000000${n}@s.whatsapp.net`, chat: `62812000000${n}@s.whatsapp.net`, isGroup: false, isOwner: false, ...extra });

function serviceFor(srv, env = {}, opts = {}) {
    return new ChatService({
        env: {
            CHAT_ENABLED: 'true',
            CHAT_BACKEND: 'local',
            CHAT_ACCESS: 'public',
            CHAT_STARTUP_CHECK: 'false',
            CHAT_LOCAL_API: 'openai',
            CHAT_LOCAL_URL: srv ? srv.url : '',
            CHAT_LOCAL_MODEL: 'fake-model',
            ...env
        },
        sendOwner: opts.sendOwner || (async () => {}),
        now: opts.now
    });
}

// ─────────────────────────────────────────────────────

async function main() {
    console.log('\n🧪 AI CHAT TESTS\n' + '='.repeat(60));
    const srv = await fakeServer();
    const srv2 = await fakeServer();

    // ── Settings ─────────────────────────────────────────
    console.log('\n⚙️  Settings...\n');

    await test('defaults: off, owner-only, 2 at once, no daily limit', () => {
        const s = settingsLib.load({});
        assert.strictEqual(s.enabled, false);
        assert.strictEqual(s.access, 'owner');
        assert.strictEqual(s.agentAccess, 'owner');
        assert.strictEqual(s.maxConcurrent, 2);
        assert.strictEqual(s.daily.enabled, false);
        assert.strictEqual(s.temperature, null, 'sampling is left to the server unless set');
        assert.deepStrictEqual(s.problems, []);
    });

    await test('booleans accept every spelling; a bad one is reported and defaulted', () => {
        for (const [value, expected] of [['true', true], ['YES', true], ['on', true], ['1', true], ['false', false], ['No', false], ['off', false], ['0', false]]) {
            assert.strictEqual(settingsLib.load({ CHAT_ENABLED: value }).enabled, expected, value);
        }
        const s = settingsLib.load({ CHAT_DAILY_LIMIT_ENABLED: 'maybe' });
        assert.strictEqual(s.daily.enabled, false);
        assert.ok(s.problems.some(p => p.includes('CHAT_DAILY_LIMIT_ENABLED=maybe')));
    });

    await test('numbers are clamped and reported with the value used', () => {
        const s = settingsLib.load({ CHAT_MAX_CONCURRENT: '50', CHAT_QUEUE_MAX: 'lots', CHAT_DAILY_LIMIT: '0' });
        assert.strictEqual(s.maxConcurrent, 10);
        assert.strictEqual(s.queueMax, 3);
        assert.strictEqual(s.daily.limit, 1);
        assert.ok(s.problems.includes('CHAT_MAX_CONCURRENT=50 is above 10, using 10'));
        assert.ok(s.problems.some(p => p.startsWith('CHAT_QUEUE_MAX=lots is not a number')));
    });

    await test('an unknown choice falls back with a problem line', () => {
        const s = settingsLib.load({ CHAT_BACKEND: 'cloud', CHAT_ACCESS: 'everyone' });
        assert.strictEqual(s.backend, 'local');
        assert.strictEqual(s.access, 'owner');
        assert.strictEqual(s.problems.length, 2);
    });

    await test('URL: no scheme or a user:password makes the backend unusable', () => {
        let s = settingsLib.load({ CHAT_LOCAL_URL: '192.168.1.5:11434', CHAT_LOCAL_MODEL: 'x' });
        assert.strictEqual(s.backends.local.usable, false);
        assert.ok(s.backends.local.unusable[0].includes('no http:// or https://'));
        s = settingsLib.load({ CHAT_AGENT_URL: 'http://me:pw@100.64.0.2:8642/v1' });
        assert.strictEqual(s.backends.agent.usable, false);
    });

    await test('URL: a pasted endpoint path is stripped, with a note', () => {
        const s = settingsLib.load({ CHAT_LOCAL_API: 'openai', CHAT_LOCAL_URL: 'http://10.0.0.5:1234/v1/chat/completions/', CHAT_LOCAL_MODEL: 'x' });
        assert.strictEqual(s.backends.local.url.href, 'http://10.0.0.5:1234/v1');
        assert.ok(s.problems.some(p => p.includes('endpoint path removed')));
    });

    await test('URL: Ollama /v1 is dropped, a bare OpenAI-style host gets /v1, Anthropic loses /v1', () => {
        assert.strictEqual(settingsLib.load({ CHAT_LOCAL_URL: 'http://127.0.0.1:11434/v1', CHAT_LOCAL_MODEL: 'x' }).backends.local.url.href, 'http://127.0.0.1:11434/');
        assert.strictEqual(settingsLib.load({ CHAT_LOCAL_API: 'openai', CHAT_LOCAL_URL: 'http://127.0.0.1:1234', CHAT_LOCAL_MODEL: 'x' }).backends.local.url.href, 'http://127.0.0.1:1234/v1');
        assert.strictEqual(settingsLib.load({ CHAT_PROVIDER_API: 'anthropic', CHAT_PROVIDER_URL: 'https://api.anthropic.com/v1/messages', CHAT_PROVIDER_MODEL: 'm', CHAT_PROVIDER_API_KEY: 'k' }).backends.provider.url.href, 'https://api.anthropic.com/');
    });

    await test('a key over plain http to a public host is refused; private networks are fine', () => {
        const s = settingsLib.load({ CHAT_PROVIDER_URL: 'http://api.example.com/v1', CHAT_PROVIDER_MODEL: 'm', CHAT_PROVIDER_API_KEY: 'secret-key-123' });
        assert.strictEqual(s.backends.provider.usable, false);
        assert.ok(s.backends.provider.unusable.some(r => r.includes('would travel unencrypted')));
        for (const host of ['localhost', '127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.9', '100.101.102.103', 'fd7a:115c:a1e0::1', 'pc.tail1234.ts.net', 'host.docker.internal', 'ollama', '::1']) {
            assert.strictEqual(settingsLib.isPrivateHost(host), true, host);
        }
        for (const host of ['8.8.8.8', 'api.example.com', '100.128.0.1', '172.32.0.1']) {
            assert.strictEqual(settingsLib.isPrivateHost(host), false, host);
        }
    });

    await test('provider: the official URL needs a key; Gemini falls back to GEMINI_API_KEY', () => {
        let s = settingsLib.load({ CHAT_PROVIDER_API: 'openai', CHAT_PROVIDER_MODEL: 'gpt-x' });
        assert.strictEqual(s.backends.provider.usable, false);
        assert.ok(s.backends.provider.unusable.some(r => r.includes('CHAT_PROVIDER_API_KEY is empty')));
        s = settingsLib.load({ CHAT_PROVIDER_API: 'gemini', CHAT_PROVIDER_MODEL: 'gemini-x', GEMINI_API_KEY: 'AIzaTESTKEY' });
        assert.strictEqual(s.backends.provider.usable, true);
        assert.strictEqual(s.backends.provider.keyVar, 'GEMINI_API_KEY');
        assert.strictEqual(s.backends.provider.url.href, 'https://generativelanguage.googleapis.com/v1beta');
    });

    await test('agent defaults: Hermes model, OpenClaw agent target, memory falls back safely', () => {
        let s = settingsLib.load({ CHAT_AGENT_URL: 'http://127.0.0.1:8642/v1' });
        assert.strictEqual(s.backends.agent.model, 'hermes-agent');
        s = settingsLib.load({ CHAT_AGENT_PLATFORM: 'openclaw', CHAT_AGENT_URL: 'http://127.0.0.1:18789/v1', CHAT_AGENT_ID: 'main' });
        assert.strictEqual(s.backends.agent.model, 'openclaw/main');
        s = settingsLib.load({ CHAT_AGENT_URL: 'http://127.0.0.1:8642/v1', CHAT_AGENT_MEMORY: 'agent' });
        assert.strictEqual(s.backends.agent.memory, 'bot', 'Hermes refuses sessions without a key');
        assert.ok(s.problems.some(p => p.includes('CHAT_AGENT_MEMORY=agent needs CHAT_AGENT_TOKEN')));
    });

    await test('system prompt: file wins; a missing file is reported and the default used', () => {
        const file = path.join(DATA, 'prompt.txt');
        fs.writeFileSync(file, 'Kamu bot uji {name}.');
        let s = settingsLib.load({ CHAT_SYSTEM_PROMPT: 'inline', CHAT_SYSTEM_PROMPT_FILE: file }, { botName: 'Ham' });
        assert.strictEqual(s.systemPrompt, 'Kamu bot uji Ham.');
        s = settingsLib.load({ CHAT_SYSTEM_PROMPT_FILE: path.join(DATA, 'nope.txt') });
        assert.ok(s.systemPrompt.includes('asisten AI'));
        assert.ok(s.problems.some(p => p.includes('cannot be read')));
    });

    await test('CHAT_PROVIDER_HEADERS: bad JSON reported, auth headers never overridable', () => {
        let s = settingsLib.load({ CHAT_PROVIDER_URL: 'https://x.example/v1', CHAT_PROVIDER_MODEL: 'm', CHAT_PROVIDER_HEADERS: '{bad' });
        assert.ok(s.problems.some(p => p.includes('CHAT_PROVIDER_HEADERS is not a JSON object')));
        s = settingsLib.load({ CHAT_PROVIDER_URL: 'https://x.example/v1', CHAT_PROVIDER_MODEL: 'm', CHAT_PROVIDER_HEADERS: '{"HTTP-Referer":"https://a.b","Authorization":"x"}' });
        assert.deepStrictEqual(s.backends.provider.headers, { 'HTTP-Referer': 'https://a.b' });
    });

    await test('access: owner / allowlist / public, @lid and device ids, agent never wider', () => {
        const base = { CHAT_ALLOWED_USERS: '6281234567890, 987654321@lid, 0812 bad' };
        const allow = settingsLib.load({ ...base, CHAT_ACCESS: 'allowlist', CHAT_AGENT_ACCESS: 'public' });
        assert.ok(allow.problems.some(p => p.includes('"0812 bad"')));
        const check = (s, sender, backend, extra = {}) => settingsLib.checkAccess(s, { sender, isGroup: false, isOwner: false, ...extra }, backend).ok;
        assert.strictEqual(check(allow, '6281234567890@s.whatsapp.net'), true);
        assert.strictEqual(check(allow, '6281234567890:12@s.whatsapp.net'), true);
        assert.strictEqual(check(allow, '987654321@lid'), true);
        assert.strictEqual(check(allow, '6289999999999@s.whatsapp.net'), false);
        assert.strictEqual(check(allow, '6281234567890@s.whatsapp.net', 'agent'), true, 'public agent access is capped at allowlist');
        assert.strictEqual(check(allow, '6289999999999@s.whatsapp.net', 'agent'), false);
        const pub = settingsLib.load({ CHAT_ACCESS: 'public' });
        assert.strictEqual(check(pub, '6289999999999@s.whatsapp.net'), true);
        assert.strictEqual(check(pub, '6289999999999@s.whatsapp.net', 'agent'), false, 'agent stays owner-only by default');
        assert.strictEqual(check(settingsLib.load({}), 'x@s.whatsapp.net', null, { isOwner: true }), true);
        const noGroups = settingsLib.load({ CHAT_ACCESS: 'public', CHAT_IN_GROUPS: 'false' });
        assert.strictEqual(check(noGroups, 'x@s.whatsapp.net', null, { isGroup: true, isOwner: true }), false);
        assert.strictEqual(check(noGroups, 'x@s.whatsapp.net', null), true);
    });

    // ── Formatting ───────────────────────────────────────
    console.log('\n📝 Formatting...\n');

    await test('reasoning blocks are removed, including an unclosed one', () => {
        assert.strictEqual(format.stripThinking('<think>hmm\nlong</think>\n\nAnswer'), 'Answer');
        assert.strictEqual(format.stripThinking('reasoning text</think>Answer'), 'Answer');
        assert.strictEqual(format.stripThinking('<think>never ends'), '');
        assert.strictEqual(format.stripThinking('Plain answer'), 'Plain answer');
    });

    await test('Markdown becomes WhatsApp formatting; code is left alone', () => {
        const out = format.toWhatsApp('# Title\n**bold** and *italic* and ~~gone~~\n- item\n[site](https://a.b)\n```js\nconst x = **y**;\n```');
        assert.ok(out.includes('*Title*'));
        assert.ok(out.includes('*bold* and _italic_ and ~gone~'));
        assert.ok(out.includes('• item'));
        assert.ok(out.includes('site (https://a.b)'));
        assert.ok(out.includes('```\nconst x = **y**;\n```'), 'language tag dropped, code untouched');
    });

    await test('tables become a monospace block without the separator row', () => {
        const out = format.toWhatsApp('| a | b |\n|---|---|\n| 1 | 2 |');
        assert.strictEqual(out, '```\n| a | b |\n| 1 | 2 |\n```');
    });

    await test('long answers split under the limit, code blocks kept whole, capped parts', () => {
        const para = 'kata '.repeat(300).trim();
        const code = '```\n' + 'line\n'.repeat(100) + '```';
        const { parts } = format.split([para, para, code, para].join('\n\n'), { limit: 2000, maxParts: 10 });
        assert.ok(parts.every(p => p.length <= 2000));
        assert.ok(parts.some(p => p.startsWith('```') && p.endsWith('```') && p.includes('line\nline')));
        const huge = format.split(Array(20).fill(para).join('\n\n'), { limit: 1600, maxParts: 4 });
        assert.strictEqual(huge.parts.length, 4);
        assert.strictEqual(huge.cut, true);
        const giant = format.split('```\n' + 'x'.repeat(9000) + '\n```', { limit: 3000, maxParts: 10 });
        assert.ok(giant.parts.every(p => p.length <= 3000 && p.startsWith('```') && p.endsWith('```')));
    });

    // ── Memory ───────────────────────────────────────────
    console.log('\n🧠 Memory...\n');

    await test('memory: turns capped, char budget drops the oldest, reset forgets', () => {
        const m = new ChatMemory({ turns: 3, idleMs: 60000, maxChars: 100, maxChats: 10 });
        const key = ChatMemory.key('chat', 'u@s.whatsapp.net');
        for (let i = 1; i <= 5; i++) m.add(key, `q${i}`, `a${i}`);
        assert.deepStrictEqual(m.history(key).map(x => x.content), ['q3', 'a3', 'q4', 'a4', 'q5', 'a5']);
        m.add(key, 'Q'.repeat(40), 'A'.repeat(40));
        const h = m.history(key);
        assert.ok(h.reduce((n, x) => n + x.content.length, 0) <= 100);
        assert.strictEqual(h[h.length - 1].content, 'A'.repeat(40), 'newest turn kept');
        assert.strictEqual(m.reset(key), true);
        assert.deepStrictEqual(m.history(key), []);
        m.destroy();
    });

    await test('memory: idle conversations expire; LRU cap; each person separate in a group', () => {
        const m = new ChatMemory({ turns: 5, idleMs: 1000, maxChars: 10000, maxChats: 2 });
        const a = ChatMemory.key('group@g.us', 'a@s.whatsapp.net');
        const b = ChatMemory.key('group@g.us', 'b:3@s.whatsapp.net');
        m.add(a, 'qa', 'aa');
        m.add(b, 'qb', 'ab');
        assert.deepStrictEqual(m.history(a).map(x => x.content), ['qa', 'aa']);
        assert.deepStrictEqual(m.history(b).map(x => x.content), ['qb', 'ab']);
        m.store.get(a).at -= 5000;
        assert.deepStrictEqual(m.history(a), [], 'expired');
        m.add(ChatMemory.key('x', 'c'), 'q', 'a');
        m.add(ChatMemory.key('y', 'd'), 'q', 'a');
        assert.ok(m.conversations <= 2);
        m.destroy();
    });

    await test('memory: agent session id is stable and rotates on reset', () => {
        const m = new ChatMemory({ turns: 5, idleMs: 60000, maxChars: 1000, maxChats: 10 });
        const key = ChatMemory.key('c', 'u');
        const one = m.sessionId(key);
        assert.strictEqual(m.sessionId(key), one);
        assert.notStrictEqual(m.rotateSession(key), one);
        m.destroy();
    });

    // ── Health ───────────────────────────────────────────
    console.log('\n🩺 Health...\n');

    await test('health: N network failures set a backend aside, the probe restores it', () => {
        let now = 0;
        const changes = [];
        const h = new BackendHealth({ failThreshold: 3, retryCooldownMs: 1000, now: () => now, onChange: c => changes.push(c.state) });
        const net = new ChatError('refused', 'refused');
        h.failure('a', net);
        h.failure('a', net);
        assert.strictEqual(h.check('a').ok, true);
        h.failure('a', net);
        assert.strictEqual(h.check('a').ok, false, 'set aside');
        now = 1001;
        const gate = h.check('a');
        assert.strictEqual(gate.ok && gate.probe, true, 'one probe after the pause');
        assert.strictEqual(h.check('a').ok, false, 'only one probe at a time');
        h.failure('a', net);
        assert.strictEqual(h.snapshot('a').retryInMs, 2000, 'failed probe doubles the pause');
        now = 3002;
        assert.strictEqual(h.check('a').probe, true);
        h.success('a');
        assert.strictEqual(h.check('a').state, 'ready');
        assert.deepStrictEqual(changes, ['down:network', 'ready']);
    });

    await test('health: a config failure drops the backend at once; the pause never exceeds 10 min', () => {
        let now = 0;
        const h = new BackendHealth({ failThreshold: 3, retryCooldownMs: 400000, now: () => now });
        h.failure('a', new ChatError('auth', 'HTTP 401 auth'));
        assert.strictEqual(h.check('a').state, 'down:config');
        now = 10 ** 9;
        assert.strictEqual(h.check('a').ok, false, 'config problems do not heal with time');
        const net = new ChatError('silent', 'went silent');
        for (let i = 0; i < 3; i++) h.failure('b', net);
        for (let i = 0; i < 5; i++) {
            now += 10 ** 7;
            h.check('b');
            h.failure('b', net);
        }
        assert.strictEqual(h.snapshot('b').retryInMs, BackendHealth.MAX_COOLDOWN_MS);
        h.failure('c', new ChatError('refusal', 'declined'));
        assert.strictEqual(h.snapshot('c').failures, 0, 'a refusal says nothing about health');
    });

    // ── Wire formats ─────────────────────────────────────
    console.log('\n🔌 Wire formats...\n');

    await test('openai: streams text, sends model/stream/max_tokens/key, no sampling unless set', async () => {
        srv.on((req, res) => sseAnswer(res, ['Hal', 'lo']));
        const b = backendFor('provider', srv);
        const out = await client.ask(b, simpleReq(), ctxFast());
        assert.strictEqual(out.text, 'Hallo');
        const r = srv.requests[0];
        assert.strictEqual(r.url, '/v1/chat/completions');
        assert.strictEqual(r.headers.authorization, 'Bearer sk-test-provider-key-123456');
        assert.strictEqual(r.json.model, 'fake-model');
        assert.strictEqual(r.json.stream, true);
        assert.strictEqual(r.json.max_tokens, 64);
        assert.ok(!('temperature' in r.json));
        assert.deepStrictEqual(r.json.messages[0], { role: 'system', content: 'sys' });
        await client.ask(b, simpleReq({ temperature: 0.3, topP: 0.9 }), ctxFast());
        assert.strictEqual(srv.requests[1].json.temperature, 0.3);
        assert.strictEqual(srv.requests[1].json.top_p, 0.9);
    });

    await test('openai: an unsupported max_tokens/temperature gets exactly one corrected retry', async () => {
        srv.on((req, res, r) => {
            if ('max_tokens' in r.json) return jsonReply(res, 400, { error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." } });
            sseAnswer(res, ['ok']);
        });
        const b = backendFor('provider', srv);
        const out = await client.ask(b, simpleReq({ temperature: 0.5 }), ctxFast());
        assert.strictEqual(out.text, 'ok');
        assert.strictEqual(srv.requests.length, 2);
        assert.strictEqual(srv.requests[1].json.max_completion_tokens, 64);
        assert.ok(!('temperature' in srv.requests[1].json));

        srv.on((req, res) => jsonReply(res, 400, { error: { message: "'temperature' does not support 0.5 with this model. Only the default (1) value is supported." } }));
        await assert.rejects(client.ask(b, simpleReq({ temperature: 0.5 }), ctxFast()), e => e.kind === 'bad_request');
        assert.strictEqual(srv.requests.length, 2, 'never a loop');
    });

    await test('openai: a server that ignores stream:true (plain JSON) still works', async () => {
        srv.on((req, res) => jsonReply(res, 200, { model: 'm2', choices: [{ message: { content: 'plain' }, finish_reason: 'stop' }] }));
        const out = await client.ask(backendFor('local', srv), simpleReq(), ctxFast());
        assert.strictEqual(out.text, 'plain');
        assert.strictEqual(out.model, 'm2');
    });

    await test('ollama: NDJSON with thinking, num_ctx/keep_alive sent; missing model says ollama pull', async () => {
        srv.on((req, res) => {
            res.writeHead(200, { 'content-type': 'application/x-ndjson' });
            res.write(JSON.stringify({ message: { thinking: 'hmm' } }) + '\n');
            res.write(JSON.stringify({ message: { content: 'Halo ' } }) + '\n');
            res.write(JSON.stringify({ message: { content: 'dunia' } }) + '\n');
            res.end(JSON.stringify({ done: true, done_reason: 'stop' }) + '\n');
        });
        const b = backendFor('local', srv, { CHAT_LOCAL_API: 'ollama', CHAT_LOCAL_CONTEXT: '4096', CHAT_LOCAL_KEEP_ALIVE: '10m' });
        const out = await client.ask(b, simpleReq(), ctxFast());
        assert.strictEqual(out.text, 'Halo dunia');
        const r = srv.requests[0];
        assert.strictEqual(r.url, '/api/chat');
        assert.strictEqual(r.json.options.num_ctx, 4096);
        assert.strictEqual(r.json.options.num_predict, 64);
        assert.strictEqual(r.json.keep_alive, '10m');

        srv.on((req, res) => jsonReply(res, 404, { error: "model 'llama9' not found" }));
        await assert.rejects(client.ask(b, simpleReq(), ctxFast()), e => e.kind === 'model' && e.fix.includes('ollama pull fake-model'));
    });

    await test('gemini: key in a header (never the URL), system instruction, thoughts skipped; bad key = auth', async () => {
        srv.on((req, res) => {
            res.writeHead(200, { 'content-type': 'text/event-stream' });
            res.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'thinking', thought: true }] } }] })}\n\n`);
            res.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Jawa' }] } }] })}\n\n`);
            res.end(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ban' }] }, finishReason: 'STOP' }], modelVersion: 'gem-1' })}\n\n`);
        });
        const b = backendFor('provider', srv, { CHAT_PROVIDER_API: 'gemini', CHAT_PROVIDER_URL: `${srv.url}/v1beta`, CHAT_PROVIDER_MODEL: 'gem', CHAT_PROVIDER_API_KEY: 'AIzaSECRETgeminiKEY12345' });
        const out = await client.ask(b, simpleReq({ messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }] }), ctxFast());
        assert.strictEqual(out.text, 'Jawaban');
        const r = srv.requests[0];
        assert.strictEqual(r.url, '/v1beta/models/gem:streamGenerateContent?alt=sse');
        assert.ok(!r.url.includes('AIza'));
        assert.strictEqual(r.headers['x-goog-api-key'], 'AIzaSECRETgeminiKEY12345');
        assert.deepStrictEqual(r.json.systemInstruction, { parts: [{ text: 'sys' }] });
        assert.deepStrictEqual(r.json.contents.map(c => c.role), ['user', 'model', 'user']);

        srv.on((req, res) => jsonReply(res, 400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }));
        await assert.rejects(client.ask(b, simpleReq(), ctxFast()), e => e.kind === 'auth' && e.fix.includes('CHAT_PROVIDER_API_KEY'));
    });

    await test('anthropic (official SDK): /v1/messages, x-api-key, pings keep a long answer alive', async () => {
        srv.on((req, res) => {
            res.writeHead(200, { 'content-type': 'text/event-stream' });
            const events = [
                ['message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
                ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
                ['ping', { type: 'ping' }], ['ping', { type: 'ping' }], ['ping', { type: 'ping' }], ['ping', { type: 'ping' }],
                ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Halo' } }],
                ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' dari Claude' } }],
                ['content_block_stop', { type: 'content_block_stop', index: 0 }],
                ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } }],
                ['message_stop', { type: 'message_stop' }]
            ];
            let i = 0;
            const t = setInterval(() => {
                if (i >= events.length) { clearInterval(t); return res.end(); }
                const [name, data] = events[i++];
                res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
            }, 120);
        });
        const b = backendFor('provider', srv, { CHAT_PROVIDER_API: 'anthropic', CHAT_PROVIDER_URL: srv.url, CHAT_PROVIDER_MODEL: 'claude-opus-5-5', CHAT_PROVIDER_API_KEY: 'sk-ant-test-key-1234567890' });
        // 11 events × 120ms ≈ 1.3s total, idle limit 400ms: only the pings keep it alive.
        const out = await client.ask(b, simpleReq(), ctxFast({ idleTimeoutMs: 400 }));
        assert.strictEqual(out.text, 'Halo dari Claude');
        assert.strictEqual(out.model, 'claude-test');
        const r = srv.requests[0];
        assert.strictEqual(r.url, '/v1/messages');
        assert.strictEqual(r.headers['x-api-key'], 'sk-ant-test-key-1234567890');
        assert.strictEqual(r.json.max_tokens, 64);
        assert.strictEqual(r.json.system, 'sys');
        assert.ok(!('temperature' in r.json), 'not sent unless set');

        srv.on((req, res) => jsonReply(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
        await assert.rejects(client.ask(b, simpleReq(), ctxFast()), e => e.kind === 'auth');
        srv.on((req, res) => jsonReply(res, 404, { type: 'error', error: { type: 'not_found_error', message: 'model: claude-nope' } }));
        await assert.rejects(client.ask(b, simpleReq(), ctxFast()), e => e.kind === 'model');
    });

    await test('hermes: session header + latest message only; tool progress and keep-alives reported', async () => {
        const events = [];
        srv.on((req, res) => sseAnswer(res, ['done'], {
            gap: 150,
            extra: [': keepalive\n\n', `event: hermes.tool.progress\ndata: ${JSON.stringify({ tool: 'terminal', label: 'ls -la', status: 'running' })}\n\n`, ': keepalive\n\n']
        }));
        const b = backendFor('agent', srv, { CHAT_AGENT_MEMORY: 'agent' });
        const out = await client.ask(b, simpleReq({ sessionKey: 'hambot-abc' }), ctxFast({ idleTimeoutMs: 400, onActivity: e => events.push(e.type === 'tool' ? `tool:${e.tool}` : e.type) }));
        assert.strictEqual(out.text, 'done');
        const r = srv.requests[0];
        assert.strictEqual(r.headers['x-hermes-session-id'], 'hambot-abc');
        assert.strictEqual(r.headers.authorization, 'Bearer agent-token-abcdef123456');
        assert.ok(!('max_tokens' in r.json), 'agents manage their own budget');
        assert.strictEqual(r.json.model, 'hermes-agent');
        assert.ok(events.includes('keepalive'));
        assert.ok(events.includes('tool:ls -la'));
    });

    await test('hermes: a pruned session (409) gets one fresh session id, never a loop', async () => {
        srv.on((req, res) => jsonReply(res, 409, { error: { message: 'Session not found: hambot-old', code: 'session_not_found' } }));
        const b = backendFor('agent', srv, { CHAT_AGENT_MEMORY: 'agent' });
        let rotated = 0;
        await assert.rejects(client.ask(b, simpleReq({ sessionKey: 'hambot-old' }), ctxFast({ onSessionReset: () => { rotated++; return 'hambot-new'; } })));
        assert.strictEqual(srv.requests.length, 2);
        assert.strictEqual(srv.requests[1].headers['x-hermes-session-id'], 'hambot-new');
        assert.strictEqual(rotated, 1);
    });

    await test('openclaw: agent target model, `user` session, an error in the stream keeps the partial text', async () => {
        srv.on((req, res) => {
            res.writeHead(200, { 'content-type': 'text/event-stream' });
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Sebagian' } }] })}\n\n`);
            res.write(`data: ${JSON.stringify({ error: { message: 'agent run was cancelled', type: 'api_error' } })}\n\n`);
            res.end('data: [DONE]\n\n');
        });
        const b = backendFor('agent', srv, { CHAT_AGENT_PLATFORM: 'openclaw', CHAT_AGENT_ID: 'main', CHAT_AGENT_MEMORY: 'agent' });
        await assert.rejects(client.ask(b, simpleReq({ sessionKey: 'hambot-x' }), ctxFast()), e => e.kind === 'server' && e.partialText === 'Sebagian' && e.serverMessage.includes('cancelled'));
        assert.strictEqual(srv.requests[0].json.model, 'openclaw/main');
        assert.strictEqual(srv.requests[0].json.user, 'hambot-x');
    });

    await test('model lists for each format', async () => {
        srv.on((req, res) => {
            if (req.url === '/api/tags') return jsonReply(res, 200, { models: [{ name: 'llama3.2:latest' }, { name: 'qwen3:8b' }] });
            if (req.url.startsWith('/v1beta/models')) return jsonReply(res, 200, { models: [{ name: 'models/gem', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embed', supportedGenerationMethods: ['embedContent'] }] });
            return jsonReply(res, 200, { data: [{ id: 'b' }, { id: 'a' }] });
        });
        assert.deepStrictEqual(await client.listModels(backendFor('local', srv, { CHAT_LOCAL_API: 'ollama' }), ctxFast()), ['llama3.2:latest', 'qwen3:8b']);
        assert.deepStrictEqual(await client.listModels(backendFor('local', srv), ctxFast()), ['a', 'b']);
        assert.deepStrictEqual(await client.listModels(backendFor('provider', srv, { CHAT_PROVIDER_API: 'gemini', CHAT_PROVIDER_URL: `${srv.url}/v1beta`, CHAT_PROVIDER_API_KEY: 'k' }), ctxFast()), ['gem']);
    });

    // ── Timeouts: silence, not slowness ──────────────────
    console.log('\n⏱️  Timeouts...\n');

    await test('a slow answer that streams longer than every timeout combined still completes', async () => {
        srv.on((req, res) => sseAnswer(res, Array(16).fill('.'), { gap: 150 }));
        const started = Date.now();
        const out = await client.ask(backendFor('local', srv), simpleReq(), { responseTimeoutMs: 400, idleTimeoutMs: 400 });
        assert.strictEqual(out.text, '.'.repeat(16));
        assert.ok(Date.now() - started > 2000, 'ran for longer than response + idle timeouts');
    });

    await test('reasoning tokens alone keep a session active until the answer arrives', async () => {
        srv.on((req, res) => {
            res.writeHead(200, { 'content-type': 'text/event-stream' });
            let i = 0;
            const t = setInterval(() => {
                if (i++ < 8) return res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'mikir ' } }] })}\n\n`);
                clearInterval(t);
                res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Jawab' } }] })}\n\n`);
                res.end('data: [DONE]\n\n');
            }, 150);
        });
        const out = await client.ask(backendFor('local', srv), simpleReq(), { responseTimeoutMs: 400, idleTimeoutMs: 400 });
        assert.strictEqual(out.text, 'Jawab');
    });

    await test('no response at all → "no response" after the response timeout, with the fix', async () => {
        srv.on(() => { /* never answers */ });
        const started = Date.now();
        await assert.rejects(client.ask(backendFor('local', srv), simpleReq(), { responseTimeoutMs: 300, idleTimeoutMs: 5000 }),
            e => e.kind === 'no_response' && e.fix.includes('CHAT_LOCAL_RESPONSE_TIMEOUT_SEC'));
        assert.ok(Date.now() - started < 1500);
    });

    await test('silence mid-answer → "went silent" with the partial text', async () => {
        srv.on((req, res) => {
            res.writeHead(200, { 'content-type': 'text/event-stream' });
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Separuh jawaban' } }] })}\n\n`);
        });
        await assert.rejects(client.ask(backendFor('local', srv), simpleReq(), { responseTimeoutMs: 1000, idleTimeoutMs: 300 }),
            e => e.kind === 'silent' && e.partialText === 'Separuh jawaban' && e.fix.includes('CHAT_LOCAL_IDLE_TIMEOUT_SEC'));
    });

    await test('CHAT_MAX_ACTIVE_MIN cuts an endless stream (and is off by default)', async () => {
        assert.strictEqual(settingsLib.load({}).maxActiveMs, null);
        srv.on((req, res) => sseAnswer(res, Array(100).fill('x'), { gap: 50 }));
        await assert.rejects(client.ask(backendFor('local', srv), simpleReq(), { responseTimeoutMs: 1000, idleTimeoutMs: 1000, maxActiveMs: 400 }),
            e => e.kind === 'max_active' && e.partialText.length > 0);
    });

    await test('an abort ends the request at once and closes its socket', async () => {
        srv.on((req, res) => sseAnswer(res, Array(100).fill('x'), { gap: 50 }));
        const before = srv.state.closed;
        const controller = new AbortController();
        setTimeout(() => controller.abort('stopped'), 200);
        const started = Date.now();
        await assert.rejects(client.ask(backendFor('local', srv), simpleReq(), { responseTimeoutMs: 1000, idleTimeoutMs: 1000, signal: controller.signal }), e => e.kind === 'aborted');
        assert.ok(Date.now() - started < 1000);
        await sleep(100);
        assert.ok(srv.state.closed > before, 'socket closed');
    });

    // ── Retries and secrets ──────────────────────────────
    console.log('\n🔐 Retries and secrets...\n');

    await test('a refused connection fails fast with the platform hint', async () => {
        const dead = await fakeServer();
        const url = dead.url;
        await dead.close();
        const b = settingsLib.load({ CHAT_LOCAL_API: 'ollama', CHAT_LOCAL_URL: url, CHAT_LOCAL_MODEL: 'm' }).backends.local;
        const started = Date.now();
        await assert.rejects(client.ask(b, simpleReq(), ctxFast()), e => e.kind === 'refused' && e.fix.includes('ollama serve'));
        assert.ok(Date.now() - started < 2000);
    });

    await test('an agent that went silent is never resent', async () => {
        srv.on((req, res) => {
            res.writeHead(200, { 'content-type': 'text/event-stream' });
            res.write(': working\n\n');
        });
        await assert.rejects(client.ask(backendFor('agent', srv), simpleReq(), { responseTimeoutMs: 1000, idleTimeoutMs: 300 }), e => e.kind === 'silent');
        assert.strictEqual(srv.requests.length, 1);
    });

    await test('429 with a short Retry-After: one retry for a provider, none for an agent', async () => {
        srv.on((req, res) => jsonReply(res, 429, { error: { message: 'slow down' } }, { 'retry-after': '0' }));
        await assert.rejects(client.ask(backendFor('provider', srv), simpleReq(), ctxFast()), e => e.kind === 'rate');
        assert.strictEqual(srv.requests.length, 2);
        srv.on((req, res) => jsonReply(res, 429, { error: { message: 'slow down' } }, { 'retry-after': '0' }));
        await assert.rejects(client.ask(backendFor('agent', srv), simpleReq(), ctxFast()), e => e.kind === 'rate');
        assert.strictEqual(srv.requests.length, 1);
    });

    await test('redirects are never followed, so the key cannot reach another host', async () => {
        srv2.on((req, res) => sseAnswer(res, ['stolen']));
        srv.on((req, res) => { res.writeHead(307, { location: `${srv2.url}/v1/chat/completions` }); res.end(); });
        await assert.rejects(client.ask(backendFor('provider', srv), simpleReq(), ctxFast()), e => e.kind === 'redirect' && e.isConfig);
        assert.strictEqual(srv2.requests.length, 0);
    });

    await test('a key echoed in a server error never reaches the error text or the log', async () => {
        process.env.CHAT_PROVIDER_API_KEY = 'sk-test-provider-key-123456';
        srv.on((req, res, r) => jsonReply(res, 401, { error: { message: `Incorrect API key provided: ${r.headers.authorization.slice(7)}` } }));
        const svc = serviceFor(srv, { CHAT_BACKEND: 'provider', CHAT_PROVIDER_API: 'openai', CHAT_PROVIDER_URL: `${srv.url}/v1`, CHAT_PROVIDER_MODEL: 'fake-model', CHAT_PROVIDER_API_KEY: 'sk-test-provider-key-123456' });
        let thrown;
        const logs = await captureLogs(async () => {
            try { await svc.ask(who(1), 'rahasia pertanyaan'); } catch (e) { thrown = e; }
        });
        assert.ok(thrown instanceof ChatUserError && thrown.code === 'offline');
        const err = thrown.tried[0].error;
        assert.strictEqual(err.kind, 'auth');
        assert.ok(!JSON.stringify({ ...err, message: err.message }).includes('sk-test-provider-key-123456'));
        assert.ok(!logs.includes('sk-test-provider-key-123456'), 'not in the log');
        assert.ok(!logs.includes('rahasia pertanyaan'), 'the question is never logged');
        assert.ok(logs.includes('fix: CHAT_PROVIDER_API_KEY is wrong'), 'the log says what to fix');
        assert.ok(logs.includes('fingerprint'), 'and which key was loaded');
        assert.ok(logs.includes('host=127.0.•.•'), 'host masked');
        const status = JSON.stringify(svc.status(who(1, { isOwner: true })));
        assert.ok(!status.includes('sk-test-provider-key-123456'));
        svc.shutdown();
        delete process.env.CHAT_PROVIDER_API_KEY;
    });

    await test('an answer repeating one of the bot\'s own secrets arrives redacted', async () => {
        process.env.OMDB_API_KEY = 'omdb-secret-value-998877';
        srv.on((req, res) => sseAnswer(res, ['Isi .env: OMDB_API_KEY=omdb-secret-value-998877 dan contoh api_key="abc12345"']));
        const svc = serviceFor(srv);
        const out = await svc.ask(who(2), 'baca .env');
        assert.ok(!out.parts.join('').includes('omdb-secret-value-998877'));
        assert.ok(out.parts.join('').includes('[REDACTED]'));
        assert.ok(out.parts.join('').includes('api_key="abc12345"'), 'harmless look-alikes are untouched');
        svc.shutdown();
        delete process.env.OMDB_API_KEY;
    });

    await test('a backend with unusable settings is never called', async () => {
        srv.on((req, res) => sseAnswer(res, ['x']));
        const svc = serviceFor(srv, { CHAT_BACKEND: 'provider', CHAT_PROVIDER_URL: 'http://api.example.com/v1', CHAT_PROVIDER_MODEL: 'm', CHAT_PROVIDER_API_KEY: 'secret-key-1234' });
        await assert.rejects(svc.ask(who(3), 'hi'), e => e.code === 'offline' && e.tried[0].skipped && e.tried[0].state === 'down:config');
        assert.strictEqual(srv.requests.length, 0);
        svc.shutdown();
    });

    // ── Service: limits, routing, health ─────────────────
    console.log('\n🚦 Service...\n');

    await test('2 active at once: the 3rd waits its turn, the 4th is turned away when the line is full', async () => {
        srv.on((req, res) => sseAnswer(res, ['a', 'b', 'c'], { gap: 120 }));
        const svc = serviceFor(srv, { CHAT_QUEUE_MAX: '1' });
        const queued = [];
        const asks = [1, 2, 3].map(n => svc.ask(who(10 + n), 'q', { onQueued: p => queued.push(p) }));
        await sleep(30);
        assert.strictEqual(svc.slots.active, 2);
        await assert.rejects(svc.ask(who(20), 'q'), e => e.code === 'busy');
        const results = await Promise.all(asks);
        assert.strictEqual(results.length, 3);
        assert.deepStrictEqual(queued, [1]);
        assert.strictEqual(svc.slots.active, 0);
        svc.shutdown();
    });

    await test('one request per person; slots come back after an error', async () => {
        srv.on((req, res) => sseAnswer(res, ['a', 'b'], { gap: 100 }));
        const svc = serviceFor(srv);
        const first = svc.ask(who(30), 'q');
        await sleep(20);
        await assert.rejects(svc.ask(who(30), 'again'), e => e.code === 'busy_user');
        await first;
        srv.on((req, res) => jsonReply(res, 500, { error: 'boom' }));
        await assert.rejects(svc.ask(who(30), 'q'), e => e.code === 'offline');
        assert.strictEqual(svc.slots.active, 0);
        assert.strictEqual(svc.sessions.size, 0);
        svc.shutdown();
    });

    await test('.chat stop cancels a running and a queued request, freeing the slot', async () => {
        srv.on((req, res) => sseAnswer(res, Array(100).fill('x'), { gap: 50 }));
        const svc = serviceFor(srv, { CHAT_MAX_CONCURRENT: '1' });
        const running = svc.ask(who(40), 'q');
        await sleep(30);
        const waiting = svc.ask(who(41), 'q', { onQueued: () => {} });
        await sleep(30);
        assert.strictEqual(svc.stop(who(41)), 1);
        await assert.rejects(waiting, e => e.code === 'stopped');
        assert.strictEqual(svc.stop(who(99, { isOwner: true }), true), 1, 'stop all');
        await assert.rejects(running, e => e.code === 'stopped');
        assert.strictEqual(svc.slots.active, 0);
        svc.shutdown();
    });

    await test('daily limit: off by default, counts when on, owner exempt unless counted, survives a restart, resets daily', async () => {
        srv.on((req, res) => sseAnswer(res, ['ok']));
        try { fs.unlinkSync(path.join(DATA, 'chat-usage.json')); } catch { /* none */ }
        let svc = serviceFor(srv);
        assert.strictEqual(svc.remaining(who(50)), null);
        svc.shutdown();

        let now = Date.UTC(2026, 9, 21, 3, 0, 0);
        const env = { CHAT_DAILY_LIMIT_ENABLED: 'true', CHAT_DAILY_LIMIT: '2' };
        svc = serviceFor(srv, env, { now: () => now });
        const r1 = await svc.ask(who(50), 'q');
        assert.strictEqual(r1.remaining, 1);
        await svc.ask(who(50), 'q');
        await assert.rejects(svc.ask(who(50), 'q'), e => e.code === 'daily_limit');
        await svc.ask(who(51, { isOwner: true }), 'q');
        assert.strictEqual(svc.remaining(who(51, { isOwner: true })), null, 'owner exempt');
        svc.shutdown(); // flushes counters

        svc = serviceFor(srv, env, { now: () => now });
        await assert.rejects(svc.ask(who(50), 'q'), e => e.code === 'daily_limit', 'kept across a restart');
        now += 24 * 3600 * 1000;
        assert.strictEqual(svc.remaining(who(50)), 2, 'new day');
        svc.shutdown();

        svc = serviceFor(srv, { ...env, CHAT_DAILY_LIMIT_OWNER: 'true' }, { now: () => now });
        assert.strictEqual(svc.remaining(who(51, { isOwner: true })), 2);
        svc.shutdown();
        assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
    });

    await test('fallback answers when the main one is down; a 401 drops the main one at once', async () => {
        srv.on((req, res) => jsonReply(res, 401, { error: { message: 'bad key' } }));
        srv2.on((req, res) => sseAnswer(res, ['dari cadangan']));
        const notices = [];
        const svc = serviceFor(srv, {
            CHAT_FALLBACK: 'provider',
            CHAT_PROVIDER_API: 'openai', CHAT_PROVIDER_URL: `${srv2.url}/v1`, CHAT_PROVIDER_MODEL: 'p-model'
        }, { sendOwner: async t => notices.push(t) });
        const r = await svc.ask(who(60), 'q');
        assert.strictEqual(r.viaFallback, true);
        assert.ok(r.parts[0].includes('dari cadangan'));
        assert.strictEqual(srv.requests.length, 1);
        await svc.ask(who(60), 'q2');
        assert.strictEqual(srv.requests.length, 1, 'the main backend is not asked again');
        assert.strictEqual(notices.length, 1, 'owner told once');
        assert.ok(notices[0].includes('local(openai)'));
        svc.shutdown();
    });

    await test('after CHAT_FAIL_THRESHOLD failures a backend is skipped with no wait, then probed back', async () => {
        let now = 1000;
        srv.on((req, res) => jsonReply(res, 503, { error: 'overloaded' }));
        const notices = [];
        const svc = serviceFor(srv, { CHAT_FAIL_THRESHOLD: '2', CHAT_RETRY_COOLDOWN_SEC: '30' }, { now: () => now, sendOwner: async t => notices.push(t) });
        for (let i = 0; i < 2; i++) await assert.rejects(svc.ask(who(70), 'q'), e => e.code === 'offline');
        const count = srv.requests.length;
        const started = Date.now();
        await assert.rejects(svc.ask(who(70), 'q'), e => e.code === 'offline' && e.tried[0].skipped);
        assert.ok(Date.now() - started < 100, 'skipped without waiting');
        assert.strictEqual(srv.requests.length, count);
        now += 31000;
        srv.on((req, res) => sseAnswer(res, ['pulih']));
        const r = await svc.ask(who(70), 'q');
        assert.ok(r.parts[0].includes('pulih'));
        assert.strictEqual(svc.health.snapshot('local').state, 'ready');
        await sleep(10);
        assert.strictEqual(notices.length, 2, 'down once, back once');
        assert.ok(notices[1].includes('kembali normal'));
        svc.shutdown();
    });

    await test('half an answer is sent (marked) instead of asking the fallback again', async () => {
        srv.on((req, res) => {
            res.writeHead(200, { 'content-type': 'text/event-stream' });
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Bagian pertama' } }] })}\n\n`);
            setTimeout(() => res.destroy(), 50);
        });
        srv2.on((req, res) => sseAnswer(res, ['cadangan']));
        const svc = serviceFor(srv, { CHAT_FALLBACK: 'provider', CHAT_PROVIDER_URL: `${srv2.url}/v1`, CHAT_PROVIDER_MODEL: 'p' });
        const r = await svc.ask(who(80), 'q');
        assert.ok(r.partial);
        assert.ok(r.parts[0].includes('Bagian pertama'));
        assert.strictEqual(srv2.requests.length, 0);
        svc.shutdown();
    });

    await test('memory flows into the next request; quoted text is included and capped', async () => {
        srv.on((req, res, r) => sseAnswer(res, [`jawaban ${r.json.messages.length}`]));
        const svc = serviceFor(srv, { CHAT_MAX_INPUT: '200' });
        await svc.ask(who(90), 'pertama');
        await svc.ask(who(90), 'kedua', { quoted: 'Q'.repeat(1000) });
        const msgs = srv.requests[1].json.messages;
        assert.deepStrictEqual(msgs.slice(1, 3).map(m => m.content), ['pertama', 'jawaban 2']);
        const last = msgs[msgs.length - 1].content;
        assert.ok(last.startsWith('Pesan yang dibalas:'));
        assert.ok(last.endsWith('kedua'));
        assert.ok(last.length <= 200);
        assert.strictEqual(svc.reset(who(90)), true);
        svc.shutdown();
    });

    await test('connections are reused between questions (keep-alive)', async () => {
        const fresh = await fakeServer();
        fresh.on((req, res) => sseAnswer(res, ['ok']));
        const svc = serviceFor(fresh);
        for (let i = 0; i < 3; i++) {
            await svc.ask(who(95), `q${i}`);
            await sleep(50); // people take longer than this between questions
        }
        assert.strictEqual(fresh.state.connections, 1);
        svc.shutdown();
        await fresh.close();
    });

    await test('.chat use switches only to a configured backend, and the choice survives a restart', async () => {
        try { fs.unlinkSync(path.join(DATA, 'chat.json')); } catch { /* none */ }
        const env = { CHAT_AGENT_URL: `${srv.url}/v1`, CHAT_AGENT_TOKEN: 'tok-123456789' };
        let svc = serviceFor(srv, env);
        assert.deepStrictEqual(svc.use('provider'), { ok: false, reason: 'not_configured' });
        assert.strictEqual(svc.use('agent').ok, true);
        svc.shutdown();
        svc = serviceFor(srv, env);
        assert.strictEqual(svc.settings.backend, 'agent');
        svc.shutdown();
        svc = serviceFor(srv);
        assert.strictEqual(svc.settings.backend, 'local', 'ignored once the agent is no longer configured');
        svc.shutdown();
        fs.unlinkSync(path.join(DATA, 'chat.json'));
    });

    await test('agent access: others never reach the agent by default', async () => {
        const svc = serviceFor(srv, { CHAT_BACKEND: 'agent', CHAT_AGENT_URL: `${srv.url}/v1`, CHAT_AGENT_TOKEN: 'tok-123456789' });
        assert.deepStrictEqual(svc.access(who(96)), { ok: false, reason: 'agent_owner' });
        assert.strictEqual(svc.access(who(96, { isOwner: true })).ok, true);
        svc.shutdown();
    });

    await test('.chat test reports each step; startup logs a summary and never throws', async () => {
        srv.on((req, res) => {
            if (req.url.endsWith('/models')) return jsonReply(res, 200, { data: [{ id: 'other-model' }] });
            sseAnswer(res, ['OK']);
        });
        const svc = serviceFor(srv);
        const [result] = await svc.test();
        assert.strictEqual(result.ok, false);
        assert.ok(result.lines.some(l => l.level === 'FIX' && l.text.includes('other-model')));
        const logs = await captureLogs(() => {
            const bad = serviceFor(null, { CHAT_LOCAL_URL: 'nonsense', CHAT_STARTUP_CHECK: 'true' });
            bad.startup();
            bad.shutdown();
        });
        assert.ok(logs.includes('AI chat: local(openai)'));
        assert.ok(logs.includes('config: local:'));
        svc.shutdown();
    });

    // ── Through the handler ──────────────────────────────
    console.log('\n💬 Through the handler...\n');

    await test('CHAT_ENABLED=false: .chat answers "off" and utils/chat is never loaded', async () => {
        // A separate process, so nothing above has loaded utils/chat yet.
        const { execFileSync } = require('child_process');
        const out = execFileSync(process.execPath, ['-e', `
            process.env.HAMBOT_DATA_DIR = ${JSON.stringify(DATA)};
            process.env.CHAT_ENABLED = 'false';
            process.env.LOG_SILENT = 'true';
            const handler = require('./handler');
            const sent = [];
            const sock = { sendMessage: async (j, c) => { sent.push(c); return {}; }, sendPresenceUpdate: async () => {} };
            handler(sock, { messages: [{ key: { remoteJid: '6281111111111@s.whatsapp.net', id: 'X' }, message: { conversation: '.chat halo' } }] }).then(() => {
                const loaded = Object.keys(require.cache).some(k => k.includes('utils/chat/'));
                console.log(JSON.stringify({ loaded, text: sent.map(s => s.text || '').join('|') }));
            });
        `], { cwd: ROOT, encoding: 'utf8' });
        const result = JSON.parse(out.trim().split('\n').pop());
        assert.strictEqual(result.loaded, false);
        assert.ok(/belum dinyalakan/.test(result.text));
    });

    process.env.CHAT_ENABLED = 'true';
    process.env.CHAT_ACCESS = 'owner';
    process.env.CHAT_BACKEND = 'local';
    process.env.CHAT_LOCAL_API = 'openai';
    process.env.CHAT_LOCAL_URL = srv.url;
    process.env.CHAT_LOCAL_MODEL = 'fake-model';
    process.env.CHAT_STARTUP_CHECK = 'false';
    process.env.CHAT_NOTIFY_OWNER = 'false';
    process.env.LOG_SILENT = 'true';
    require('../utils/chat')._reset();
    const handler = require('../handler');
    const ui = require('../utils/ui');

    const fakeSock = () => {
        const sent = [];
        return { sent, async sendMessage(jid, content) { sent.push(content); return { key: { id: String(sent.length) } }; }, async sendPresenceUpdate() {} };
    };
    const send = async (sock, text, { sender = '6281111111111@s.whatsapp.net', group = false, quoted } = {}) => {
        const message = quoted
            ? { extendedTextMessage: { text, contextInfo: { quotedMessage: { conversation: quoted } } } }
            : { conversation: text };
        const remoteJid = group ? '120363000000000000@g.us' : sender;
        await handler(sock, { messages: [{ key: { remoteJid, participant: group ? sender : undefined, id: `M${Math.random()}` }, message }] });
        await sleep(5);
    };
    const texts = sock => sock.sent.filter(s => s.text).map(s => ui.plain(s.text));

    await test('owner asks: the answer comes back as plain text, newlines and quoted text kept', async () => {
        srv.on((req, res) => sseAnswer(res, ['**Halo** owner']));
        const sock = fakeSock();
        await send(sock, '.chat baris satu\n    baris dua (indentasi)', { quoted: 'pesan lama' });
        const all = texts(sock);
        assert.ok(all.some(t => t.startsWith('*Halo* owner')), all.join('\n---\n'));
        assert.ok(all.some(t => t.includes('fake-model')), 'footer names the model');
        const last = srv.requests[0].json.messages.pop().content;
        assert.ok(last.includes('baris satu\n    baris dua (indentasi)'));
        assert.ok(last.includes('pesan lama'));
    });

    await test('.chat is exempt from the chat filter; other commands still are not', async () => {
        srv.on((req, res) => sseAnswer(res, ['ok']));
        const sock = fakeSock();
        await send(sock, '.ai apa arti ../ di path?');
        assert.strictEqual(srv.requests.length, 1, 'reached the AI');
        const sock2 = fakeSock();
        await send(sock2, '.calc ../etc/passwd', { sender: '6282222222222@s.whatsapp.net' });
        assert.ok(texts(sock2).some(t => /diblokir/i.test(t)));
    });

    await test('non-owner is refused with owner-only access; owner tools are owner-only', async () => {
        const sock = fakeSock();
        await send(sock, '.chat halo', { sender: '6283333333333@s.whatsapp.net' });
        assert.ok(texts(sock).some(t => /khusus owner/i.test(t)));
        const sock2 = fakeSock();
        await send(sock2, '.chat test', { sender: '6283333333334@s.whatsapp.net' });
        assert.ok(texts(sock2).some(t => /khusus owner/i.test(t)));
    });

    await test('.chat status (owner) shows the backend and a key fingerprint, never the key', async () => {
        process.env.CHAT_LOCAL_API_KEY = 'local-key-should-not-show-123';
        require('../utils/chat')._reset();
        const sock = fakeSock();
        await send(sock, '.chat status');
        const out = texts(sock).join('\n');
        assert.ok(out.includes('local(openai)'));
        assert.ok(out.includes('kunci'));
        assert.ok(!out.includes('local-key-should-not-show-123'));
        delete process.env.CHAT_LOCAL_API_KEY;
        require('../utils/chat')._reset();
    });

    await test('an offline backend: the owner gets the fix, others a plain sentence', async () => {
        srv.on((req, res) => jsonReply(res, 404, { error: { message: 'The model `fake-model` does not exist' } }));
        const sock = fakeSock();
        await send(sock, '.chat halo');
        const out = texts(sock).join('\n');
        assert.ok(out.includes('CHAT_LOCAL_MODEL'), out);
        process.env.CHAT_ACCESS = 'public';
        require('../utils/chat')._reset();
        srv.on((req, res) => jsonReply(res, 500, { error: 'boom' }));
        const sock2 = fakeSock();
        await send(sock2, '.chat halo', { sender: '6284444444444@s.whatsapp.net' });
        const out2 = texts(sock2).join('\n');
        assert.ok(/tidak bisa dihubungi/.test(out2));
        assert.ok(!out2.includes('127.0.0.1'));
        process.env.CHAT_ACCESS = 'owner';
    });

    await test('typing indicator while it works; .chat stop and .chat models through the handler', async () => {
        require('../utils/chat')._reset();
        srv.on((req, res) => {
            if (req.url.endsWith('/models')) return jsonReply(res, 200, { data: [{ id: 'fake-model' }, { id: 'other' }] });
            sseAnswer(res, Array(40).fill('x'), { gap: 50 });
        });
        const presence = [];
        const sock = fakeSock();
        sock.sendPresenceUpdate = async (state) => { presence.push(state); };
        const asking = send(sock, '.chat tulis panjang');
        await sleep(200);
        const sock2 = fakeSock();
        await send(sock2, '.chat stop');
        await asking;
        assert.ok(presence.includes('composing') && presence[presence.length - 1] === 'paused');
        assert.ok(texts(sock2).some(t => t.includes('1 permintaan AI dibatalkan')));
        assert.ok(texts(sock).some(t => /dibatalkan/i.test(t)));
        const sock3 = fakeSock();
        await send(sock3, '.chat models');
        const out = texts(sock3).join('\n');
        assert.ok(out.includes('fake-model') && out.includes('other'));
    });

    require('../utils/chat')._reset();
    transport.destroyAgents();
    await srv.close();
    await srv2.close();
    fs.rmSync(DATA, { recursive: true, force: true });

    console.log('\n' + '='.repeat(60));
    console.log(`✅ Tests Passed: ${passed}`);
    console.log(`❌ Tests Failed: ${failed}`);
    console.log('='.repeat(60));
    process.exit(failed ? 1 : 0);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
