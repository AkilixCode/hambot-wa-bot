/**
 * Network Layer Tests
 *
 * Drives utils/http-client against local servers only — a flaky target, an
 * HTTP CONNECT proxy, a proxy that is down, one that never answers — so no
 * internet is needed. Each block pins a bug that was fixed:
 *
 *   - a SOCKS "fallback to local IP" that still went through the dead proxy
 *   - HTTPS through an HTTP proxy without a CONNECT tunnel
 *   - a slow target treated as a dead proxy (double wait, IP leak)
 *   - no retries at all on resets and 5xx
 *   - network problems invisible in the default log mode
 *
 * Run with:
 *   npm run test:network
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Must be set before config.js is first required.
process.env.HAMBOT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hambot-net-'));
process.env.PROXY_CONNECT_TIMEOUT = '400';
process.env.LOG_LEVEL = 'simple';
process.env.NET_LOG = 'problems';
process.env.SECRET_TEST_API_KEY = 'sk_test_supersecretvalue123';
delete process.env.PROXY_ENABLED;
delete process.env.HB_PROXY_URL;

const assert = require('assert');
const http = require('http');
const net = require('net');

const config = require('../config');
const httpClient = require('../utils/http-client');
const providers = require('../utils/providers');
const logger = require('../utils/logger');
const netContext = require('../utils/net-context');
const { classify, isConnectionError } = require('../utils/net-errors');

let passed = 0;
let failed = 0;

async function test(name, fn) {
    // Each test starts from a clean slate: no pooled sockets, closed
    // breakers, proxy off, fallback on.
    httpClient.destroyAgents();
    providers.resetHealth();
    logger.clearNetHistory();
    setProxy(null);
    config.network.fallbackToLocal = true;
    logger.netLevel = 'problems';

    try {
        await fn();
        passed++;
        console.log(`✅ PASS: ${name}`);
    } catch (err) {
        failed++;
        console.log(`❌ FAIL: ${name}\n   ${err.stack || err.message}`);
    }
}

/**
 * Point the bot at a proxy URL (or turn the proxy off with null).
 * @param {string|null} url
 */
function setProxy(url) {
    if (!url) {
        Object.assign(config.proxy, { enabled: false, host: null, port: null, user: null, pass: null, url: null });
        return;
    }
    const u = new URL(url);
    Object.assign(config.proxy, {
        enabled: true,
        type: u.protocol.startsWith('socks') ? 'socks5' : 'http',
        host: u.hostname,
        port: Number(u.port),
        user: u.username || null,
        pass: u.password || null,
        url
    });
}

/** Capture console.log while fn runs. */
async function captureLogs(fn) {
    const lines = [];
    const original = console.log;
    console.log = (...args) => lines.push(args.join(' '));
    try {
        await fn();
    } finally {
        console.log = original;
    }
    return lines;
}

function listen(server) {
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function close(server) {
    if (server.closeAllConnections) server.closeAllConnections();
    return new Promise(resolve => server.close(() => resolve()));
}

/** A port with nothing listening on it. */
async function deadPort() {
    const s = net.createServer();
    const port = await listen(s);
    await close(s);
    return port;
}

/**
 * A minimal HTTP proxy that only speaks CONNECT, like EveryProxy does for
 * HTTPS. `mode` changes how it answers.
 */
async function startConnectProxy(mode = 'ok') {
    const state = { tunnels: 0, connections: 0, plainRequests: 0 };
    const server = http.createServer((req, res) => {
        // axios's native proxy support would land here (absolute-URI request).
        state.plainRequests++;
        res.statusCode = 400;
        res.end('CONNECT only');
    });
    server.on('connection', () => state.connections++);
    server.on('connect', (req, socket, head) => {
        state.tunnels++;
        if (mode === '407') {
            socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n');
            return;
        }
        if (mode === '502') {
            socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
            return;
        }
        const [host, port] = req.url.split(':');
        const upstream = net.connect(Number(port), host, () => {
            socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head && head.length) upstream.write(head);
            upstream.pipe(socket);
            socket.pipe(upstream);
        });
        upstream.on('error', () => socket.destroy());
        socket.on('error', () => upstream.destroy());
    });
    const port = await listen(server);
    return { server, state, url: `http://127.0.0.1:${port}` };
}

async function main() {
    console.log('🌐 Network layer tests\n');

    // A target with a few behaviours, chosen by path.
    const counters = {};
    const target = http.createServer((req, res) => {
        const key = req.url.split('?')[0];
        counters[key] = (counters[key] || 0) + 1;
        const n = counters[key];

        if (key === '/flaky' && n <= 2) { res.statusCode = 503; return res.end('busy'); }
        if (key === '/reset' && n === 1) { req.socket.destroy(); return; }
        if (key === '/429' && n === 1) { res.statusCode = 429; res.setHeader('Retry-After', '1'); return res.end(); }
        if (key === '/429-long') { res.statusCode = 429; res.setHeader('Retry-After', '60'); return res.end(); }
        if (key === '/404') { res.statusCode = 404; return res.end('nope'); }
        if (key === '/503') { res.statusCode = 503; return res.end('busy'); }
        if (key === '/hang') return; // never answers
        res.end(`ok:${key}`);
    });
    const targetPort = await listen(target);
    const T = `http://127.0.0.1:${targetPort}`;
    const hits = key => counters[key] || 0;

    // ── Classifier ───────────────────────────────────────────────────
    console.log('🔎 Classification...\n');

    await test('classify: HTTP statuses, timeouts, DNS, resets, refusals', () => {
        assert.deepStrictEqual(
            [503, 429, 404, 403].map(status => classify({ message: 'x', response: { status } }).retryable),
            [true, true, false, false]
        );
        const timeout = classify({ code: 'ECONNABORTED', message: 'timeout of 5000ms exceeded' }, { timeout: 5000 });
        assert.strictEqual(timeout.kind, 'timeout');
        assert.strictEqual(timeout.summary, 'timeout after 5.0s');
        assert.strictEqual(classify({ code: 'EAI_AGAIN' }).retryable, true);
        assert.strictEqual(classify({ code: 'ENOTFOUND' }).retryable, false);
        assert.strictEqual(classify({ code: 'ECONNRESET' }).kind, 'reset');
        assert.strictEqual(classify({ message: 'socket hang up' }).kind, 'reset');
        assert.strictEqual(classify({ code: 'ECONNREFUSED' }).kind, 'refused');
        assert.strictEqual(classify({ code: 'ERR_CANCELED', message: 'canceled' }).retryable, false);
        assert.strictEqual(classify({ message: 'maxContentLength size of 10 exceeded' }).kind, 'too-large');
    });

    await test('classify: proxyFault only from the flag, only on the proxy route', () => {
        const wrapped = { message: 'connect ECONNREFUSED', code: 'ECONNREFUSED', cause: { proxyFault: true } };
        assert.strictEqual(classify(wrapped, { route: 'proxy' }).proxyFault, true);
        assert.strictEqual(classify(wrapped, { route: 'proxy' }).kind, 'proxy');
        assert.strictEqual(classify(wrapped, { route: 'direct' }).proxyFault, false);
        // A bare timeout through the proxy is the target's, not the proxy's.
        assert.strictEqual(classify({ code: 'ECONNABORTED', message: 'timeout' }, { route: 'proxy' }).proxyFault, false);
        // Happy Eyeballs AggregateError: the code is inside errors[].
        assert.strictEqual(classify({ message: '', errors: [{ code: 'ETIMEDOUT' }] }).kind, 'timeout');
    });

    await test('isProxyConnectionError keeps its old contract', () => {
        assert.strictEqual(httpClient.isProxyConnectionError({ code: 'ECONNREFUSED' }), true);
        assert.strictEqual(httpClient.isProxyConnectionError({ message: 'SOCKS connection failed' }), true);
        assert.strictEqual(httpClient.isProxyConnectionError({ response: { status: 404 } }), false);
        assert.strictEqual(isConnectionError({}), false);
    });

    // ── Retries ──────────────────────────────────────────────────────
    console.log('\n🔁 Retries...\n');

    await test('GET retries 503 and succeeds on the third attempt', async () => {
        const res = await httpClient.get(`${T}/flaky`);
        assert.strictEqual(res.data, 'ok:/flaky');
        assert.strictEqual(hits('/flaky'), 3);
    });

    await test('A reset connection is retried', async () => {
        const res = await httpClient.get(`${T}/reset`);
        assert.strictEqual(res.data, 'ok:/reset');
        assert.strictEqual(hits('/reset'), 2);
    });

    await test('404 is not retried; the error is annotated', async () => {
        const before = hits('/404');
        const err = await httpClient.get(`${T}/404`).catch(e => e);
        assert.strictEqual(err.response.status, 404);
        assert.strictEqual(hits('/404') - before, 1);
        assert.strictEqual(err.net.summary, 'HTTP 404');
        assert.strictEqual(err.net.host, `127.0.0.1:${targetPort}`);
    });

    await test('POST is not retried by default, but can opt in', async () => {
        const before = hits('/503');
        await assert.rejects(() => httpClient.post(`${T}/503`, { a: 1 }));
        assert.strictEqual(hits('/503') - before, 1);
        await assert.rejects(() => httpClient.post(`${T}/503`, { a: 1 }, { retry: 1 }));
        assert.strictEqual(hits('/503') - before, 3);
    });

    await test('retry:false makes exactly one attempt', async () => {
        const before = hits('/503');
        await assert.rejects(() => httpClient.get(`${T}/503`, { retry: false }));
        assert.strictEqual(hits('/503') - before, 1);
    });

    await test('Retry-After is honoured, and a long one is not waited for', async () => {
        const started = Date.now();
        const res = await httpClient.get(`${T}/429`);
        assert.strictEqual(res.status, 200);
        assert.ok(Date.now() - started >= 950, `waited only ${Date.now() - started}ms`);

        const before = hits('/429-long');
        await assert.rejects(() => httpClient.get(`${T}/429-long`));
        assert.strictEqual(hits('/429-long') - before, 1, 'a 60s Retry-After must not be waited out');
    });

    await test('The overall deadline caps time spent across retries', async () => {
        const started = Date.now();
        const err = await httpClient.get(`${T}/hang`, { timeout: 1000, deadline: 1500 }).catch(e => e);
        const elapsed = Date.now() - started;
        assert.strictEqual(err.net.kind, 'timeout');
        assert.ok(elapsed < 2500, `took ${elapsed}ms`);
    });

    await test('JSON, arraybuffer and maxContentLength still behave', async () => {
        const json = http.createServer((req, res) => {
            if (req.url === '/json') return res.end(JSON.stringify({ ok: true }));
            res.end(Buffer.alloc(2 * 1024 * 1024));
        });
        const port = await listen(json);
        try {
            assert.deepStrictEqual((await httpClient.get(`http://127.0.0.1:${port}/json`)).data, { ok: true });
            await assert.rejects(
                () => httpClient.get(`http://127.0.0.1:${port}/big`, { responseType: 'arraybuffer', maxContentLength: 1024 }),
                /maxContentLength/i
            );
        } finally {
            await close(json);
        }
    });

    // ── Proxy route ──────────────────────────────────────────────────
    console.log('\n🛰️ Proxy...\n');

    await test('An HTTP proxy is used through a CONNECT tunnel, not axios\'s native proxy', async () => {
        const proxy = await startConnectProxy();
        try {
            setProxy(proxy.url);
            const res = await httpClient.get(`${T}/via-proxy`);
            assert.strictEqual(res.data, 'ok:/via-proxy');
            assert.strictEqual(proxy.state.tunnels, 1);
            assert.strictEqual(proxy.state.plainRequests, 0);
        } finally {
            await close(proxy.server);
        }
    });

    await test('Keep-alive: back-to-back requests reuse one tunnel', async () => {
        const proxy = await startConnectProxy();
        try {
            setProxy(proxy.url);
            await httpClient.get(`${T}/ka`);
            await httpClient.get(`${T}/ka`);
            await httpClient.get(`${T}/ka`);
            assert.strictEqual(proxy.state.connections, 1, `opened ${proxy.state.connections} connections`);
        } finally {
            await close(proxy.server);
        }
    });

    await test('Dead HTTP proxy: falls back direct at once', async () => {
        setProxy(`http://127.0.0.1:${await deadPort()}`);
        const before = hits('/fb-http');
        const started = Date.now();
        const res = await httpClient.get(`${T}/fb-http`);
        assert.strictEqual(res.data, 'ok:/fb-http');
        assert.strictEqual(hits('/fb-http') - before, 1);
        assert.ok(Date.now() - started < 1000);
    });

    await test('Dead SOCKS proxy: the fallback really goes direct (B1)', async () => {
        setProxy(`socks5://127.0.0.1:${await deadPort()}`);
        const res = await httpClient.get(`${T}/fb-socks`);
        assert.strictEqual(res.data, 'ok:/fb-socks');
        const health = providers.getHealth().find(p => p.id === httpClient.PROXY_BREAKER_ID);
        assert.ok(health && health.totalFailures === 1, 'the proxy failure is recorded');
    });

    await test('A proxy that never answers is cut off after PROXY_CONNECT_TIMEOUT', async () => {
        const sockets = [];
        const silent = net.createServer(s => sockets.push(s)); // accepts, says nothing
        const port = await listen(silent);
        try {
            setProxy(`http://127.0.0.1:${port}`);
            const started = Date.now();
            const res = await httpClient.get(`${T}/silent`, { timeout: 10000 });
            const elapsed = Date.now() - started;
            assert.strictEqual(res.data, 'ok:/silent');
            assert.ok(elapsed >= 350 && elapsed < 3000, `took ${elapsed}ms`);
        } finally {
            sockets.forEach(s => s.destroy());
            await close(silent);
        }
    });

    await test('CONNECT refused with 407: a proxy fault, never shown as the target\'s 407', async () => {
        const proxy = await startConnectProxy('407');
        try {
            setProxy(proxy.url);
            const res = await httpClient.get(`${T}/auth`);
            assert.strictEqual(res.status, 200, 'fell back direct');
            assert.strictEqual(res.data, 'ok:/auth');
        } finally {
            await close(proxy.server);
        }
    });

    await test('CONNECT 502 (proxy up, target unreachable): no direct fallback', async () => {
        const proxy = await startConnectProxy('502');
        try {
            setProxy(proxy.url);
            const before = hits('/gw');
            const err = await httpClient.get(`${T}/gw`, { retry: false }).catch(e => e);
            assert.ok(err instanceof Error);
            assert.strictEqual(err.net.kind, 'proxy');
            assert.strictEqual(hits('/gw') - before, 0, 'must not leak to the direct route');
        } finally {
            await close(proxy.server);
        }
    });

    await test('A slow target behind a working proxy is NOT retried direct (B5)', async () => {
        const proxy = await startConnectProxy();
        try {
            setProxy(proxy.url);
            const before = hits('/hang');
            const err = await httpClient.get(`${T}/hang`, { timeout: 600, retry: false }).catch(e => e);
            assert.strictEqual(err.net.kind, 'timeout');
            assert.strictEqual(err.net.route, 'proxy');
            assert.strictEqual(hits('/hang') - before, 1, 'one hit, through the tunnel only');
            assert.strictEqual(proxy.state.tunnels, 1);
            const health = providers.getHealth().find(p => p.id === httpClient.PROXY_BREAKER_ID);
            assert.ok(!health || health.totalFailures === 0, 'a target timeout is not a proxy failure');
        } finally {
            await close(proxy.server);
        }
    });

    await test('After 3 proxy failures the breaker opens and requests skip the proxy', async () => {
        const sockets = [];
        let connections = 0;
        const silent = net.createServer(s => { connections++; sockets.push(s); });
        const port = await listen(silent);
        try {
            setProxy(`http://127.0.0.1:${port}`);
            for (let i = 0; i < 3; i++) await httpClient.get(`${T}/trip`);
            assert.strictEqual(connections, 3);
            assert.ok(providers.isOpen(httpClient.PROXY_BREAKER_ID), 'breaker open');

            const started = Date.now();
            await httpClient.get(`${T}/trip`);
            assert.ok(Date.now() - started < 300, 'went direct without waiting on the proxy');
            assert.strictEqual(connections, 3, 'the dead proxy was not contacted again');
        } finally {
            sockets.forEach(s => s.destroy());
            await close(silent);
        }
    });

    await test('With NETWORK_FALLBACK_TO_LOCAL=false a dead proxy is reported, never bypassed', async () => {
        config.network.fallbackToLocal = false;
        setProxy(`http://127.0.0.1:${await deadPort()}`);
        const before = hits('/nofb');
        const err = await httpClient.get(`${T}/nofb`).catch(e => e);
        assert.ok(err instanceof Error);
        assert.strictEqual(err.net.kind, 'proxy');
        assert.strictEqual(hits('/nofb') - before, 0);
    });

    await test('Turning the proxy off takes effect on the next request', async () => {
        const proxy = await startConnectProxy();
        try {
            setProxy(proxy.url);
            await httpClient.get(`${T}/toggle`);
            setProxy(null);
            await httpClient.get(`${T}/toggle`);
            assert.strictEqual(proxy.state.tunnels, 1);
        } finally {
            await close(proxy.server);
        }
    });

    // ── Logging ──────────────────────────────────────────────────────
    console.log('\n📝 Logging...\n');

    await test('Simple mode shows retries and failures, tagged with the command', async () => {
        const ctx = netContext.create('pinterest');
        const lines = await captureLogs(() =>
            netContext.run(ctx, async () => {
                await httpClient.get(`${T}/503`).catch(() => {});
            })
        );
        const net = lines.filter(l => l.startsWith('🌐'));
        assert.strictEqual(net.length, 3, net.join('\n'));
        assert.ok(net[0].includes(`[.pinterest #${ctx.id}]`), net[0]);
        assert.ok(net[0].includes('HTTP 503') && net[0].includes('retry 1/2'), net[0]);
        assert.ok(net[2].includes('✗ HTTP 503') && net[2].includes('after 3 attempts'), net[2]);
        assert.strictEqual(ctx.stats.requests, 1);
        assert.strictEqual(ctx.stats.failed, 1);
        assert.strictEqual(ctx.stats.retries, 2);
    });

    await test('Successful requests are quiet unless NET_LOG=all', async () => {
        let lines = await captureLogs(() => httpClient.get(`${T}/quiet`));
        assert.strictEqual(lines.filter(l => l.startsWith('🌐')).length, 0);
        logger.netLevel = 'all';
        lines = await captureLogs(() => httpClient.get(`${T}/quiet`));
        assert.ok(lines.some(l => l.includes('✓ 200')), lines.join('\n'));
    });

    await test('NET_LOG=off prints nothing, but the doctor history still records', async () => {
        logger.netLevel = 'off';
        const lines = await captureLogs(() => httpClient.get(`${T}/404`).catch(() => {}));
        assert.strictEqual(lines.length, 0, lines.join('\n'));
        assert.strictEqual(logger.recentNetProblems().length, 1);
    });

    await test('netLog:false keeps an expected probe failure out of the log', async () => {
        const lines = await captureLogs(() => httpClient.head(`${T}/404`, { retry: false, netLog: false }).catch(() => {}));
        assert.strictEqual(lines.length, 0, lines.join('\n'));
    });

    await test('Secrets never reach the log: query strings, proxy credentials, env values', async () => {
        const secret = process.env.SECRET_TEST_API_KEY;
        const port = await deadPort();
        setProxy(`http://hamuser:hunter2pass@127.0.0.1:${port}`);
        const lines = await captureLogs(async () => {
            await httpClient.get(`${T}/404?api_key=${secret}&q=private+search`).catch(() => {});
        });
        const all = lines.join('\n') + logger.recentNetProblems().map(p => p.line).join('\n');
        assert.ok(lines.some(l => l.includes('→ retrying direct')), all);
        assert.ok(!all.includes(secret), 'API key leaked');
        assert.ok(!all.includes('hunter2pass') && !all.includes('hamuser'), 'proxy credentials leaked');
        assert.ok(!all.includes('private+search'), 'query string leaked');
        assert.ok(all.includes(`127.0.0.1:${port}`), 'the proxy host:port is still named');
    });

    await test('The command block gets a Network line and a readable Error line', async () => {
        const tracker = logger.commandStart('pinterest', '628123@s.whatsapp.net', '628123@s.whatsapp.net', false);
        const ctx = netContext.create('pinterest');
        tracker.net = ctx.stats;
        let error;
        await captureLogs(() => netContext.run(ctx, async () => {
            await httpClient.get(`${T}/flaky-2`).catch(() => {});
            error = await httpClient.get(`${T}/404`).catch(e => e);
        }));
        const lines = await captureLogs(() => logger.commandEnd(tracker, 'failed', error));
        const block = lines.join('\n');
        assert.ok(/Network : 2 req · 1 ok · 1 failed/.test(block), block);
        assert.ok(block.includes(`Error   : HTTP 404 from 127.0.0.1:${targetPort}`), block);
    });

    // ── Provider cascade ─────────────────────────────────────────────
    console.log('\n🔀 Providers...\n');

    await test('A failed cascade names every provider\'s reason', async () => {
        const lines = [];
        const err = await captureLogs(async () => {
            await providers.runProviders('music-search', [
                { id: 'youtube', run: async () => { const e = new Error('ERROR: Sign in'); e.net = { summary: 'bot-check' }; throw e; } },
                { id: 'soundcloud', run: () => httpClient.get(`${T}/404`) }
            ]).catch(e => lines.push(e));
        }).then(out => ({ out, error: lines[0] }));
        assert.ok(err.error.message.includes('youtube=bot-check'), err.error.message);
        assert.ok(err.error.message.includes('soundcloud=HTTP 404'), err.error.message);
        assert.ok(err.out.some(l => l.startsWith('🔁') && l.includes('all failed')), err.out.join('\n'));
    });

    await test('A circuit trip and its recovery are both visible in simple mode', async () => {
        const lines = await captureLogs(async () => {
            for (let i = 0; i < providers.FAILURE_THRESHOLD; i++) providers.recordFailure('wallhaven', new Error('x'));
            providers.recordSuccess('wallhaven');
        });
        assert.ok(lines.some(l => l.includes('circuit: wallhaven paused')), lines.join('\n'));
        assert.ok(lines.some(l => l.includes('circuit: wallhaven recovered')), lines.join('\n'));
    });

    // ── yt-dlp ───────────────────────────────────────────────────────
    console.log('\n🎬 yt-dlp...\n');

    const ytdlp = require('../utils/ytdlp');

    await test('yt-dlp failures get a one-word reason; targets never include search terms', () => {
        assert.strictEqual(ytdlp.describeTarget('ytsearch5:my secret song'), 'ytsearch');
        assert.strictEqual(ytdlp.describeTarget('https://www.youtube.com/watch?v=x'), 'www.youtube.com');
        assert.strictEqual(ytdlp.failureReason(new Error("ERROR: Sign in to confirm you're not a bot")), 'bot-check');
        assert.strictEqual(ytdlp.failureReason(new Error('ERROR: Unable to connect to proxy')), 'proxy');
        const timedOut = new Error('yt-dlp timeout after 60s');
        timedOut.timedOut = true;
        assert.strictEqual(ytdlp.failureReason(timedOut), 'timeout');
    });

    await test('yt-dlp args carry transport retries', () => {
        const args = config.getYtDlpNetworkArgs();
        for (const flag of ['--socket-timeout', '--retries', '--fragment-retries', '--extractor-retries', '--retry-sleep']) {
            assert.ok(args.includes(flag), `missing ${flag}`);
        }
        process.env.YTDLP_RETRIES = '0';
        assert.ok(!config.getYtDlpNetworkArgs().includes('--retries'), '0 drops the flag');
        delete process.env.YTDLP_RETRIES;
    });

    await test('yt-dlp skips a proxy the HTTP layer already found dead, and never logs its args', async () => {
        const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'hambot-fake-ytdlp-'));
        const runLog = path.join(fakeBin, 'runs.log');
        fs.writeFileSync(path.join(fakeBin, 'python3'), `#!/usr/bin/env node
require('fs').appendFileSync(${JSON.stringify(runLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.argv.includes('--proxy')) { console.error('ERROR: Unable to connect to proxy'); process.exit(1); }
console.log(JSON.stringify({ title: 'ok' }));
`, { mode: 0o755 });
        const savedPath = process.env.PATH;
        const savedPython = process.env.YTDLP_PYTHON;
        process.env.PATH = `${fakeBin}${path.delimiter}${savedPath}`;
        delete process.env.YTDLP_PYTHON;
        const runs = () => fs.readFileSync(runLog, 'utf8').trim().split('\n').map(l => JSON.parse(l));

        try {
            setProxy('http://hamuser:hunter2pass@127.0.0.1:9');

            // Proxy healthy as far as anyone knows: proxied first, then direct.
            const lines = await captureLogs(() => ytdlp.getInfo('https://example.com/v'));
            assert.strictEqual(runs().length, 2);
            assert.ok(runs()[0].includes('--proxy') && !runs()[1].includes('--proxy'));
            assert.ok(lines.some(l => l.startsWith('🎬') && l.includes('✗ proxy (retrying direct)')), lines.join('\n'));
            assert.ok(!lines.join('\n').includes('hunter2pass'), 'proxy password leaked');

            // Breaker open: straight to direct, one run.
            for (let i = 0; i < providers.FAILURE_THRESHOLD; i++) {
                providers.recordFailure(httpClient.PROXY_BREAKER_ID, new Error('down'));
            }
            await captureLogs(() => ytdlp.getInfo('https://example.com/v'));
            assert.strictEqual(runs().length, 3);
            assert.ok(!runs()[2].includes('--proxy'));
        } finally {
            process.env.PATH = savedPath;
            if (savedPython !== undefined) process.env.YTDLP_PYTHON = savedPython;
            fs.rmSync(fakeBin, { recursive: true, force: true });
        }
    });

    // ── Summary ───────────────────────────────────────────────────────
    httpClient.destroyAgents();
    await close(target);
    fs.rmSync(process.env.HAMBOT_DATA_DIR, { recursive: true, force: true });

    console.log('\n' + '='.repeat(60));
    console.log('📊 NETWORK TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Tests Passed: ${passed}`);
    console.log(`❌ Tests Failed: ${failed}`);
    console.log('='.repeat(60) + '\n');

    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('Test runner crashed:', err);
    process.exit(1);
});
