/**
 * Media Infrastructure Tests
 *
 * Covers the modules added in v3.2.0 that the media commands depend on:
 * the provider cascade and its circuit breaker, the yt-dlp runner's argument
 * construction and error classification, the egress toggle, temp-file scoping,
 * and cached-fetch provenance.
 *
 * Offline by default — no test here requires network access or yt-dlp to be
 * installed, so it runs in CI and on a bare checkout. Run with:
 *   npm run test:media
 */

const assert = require('assert');
const path = require('path');
// Tests live in tests/; paths are resolved from the repository root.
const ROOT = path.join(__dirname, '..');
const fs = require('fs');
const os = require('os');

// Keep the egress tests away from the real data/egress.json. Must be set
// before utils/egress is required.
process.env.HAMBOT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hambot-test-'));

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        const result = fn();
        if (result && typeof result.then === 'function') {
            return result.then(
                () => { passed++; console.log(`✅ PASS: ${name}`); },
                (err) => { failed++; console.log(`❌ FAIL: ${name}\n   ${err.message}`); }
            );
        }
        passed++;
        console.log(`✅ PASS: ${name}`);
    } catch (err) {
        failed++;
        console.log(`❌ FAIL: ${name}\n   ${err.message}`);
    }
    return Promise.resolve();
}

async function main() {
    console.log('\n🧪 MEDIA INFRASTRUCTURE TESTS\n' + '='.repeat(60));

    // ── Provider cascade ──────────────────────────────────────────────
    console.log('\n📡 Provider Cascade...\n');

    const providers = require('../utils/providers');

    await test('Cascade returns the first successful provider', async () => {
        providers.resetHealth();
        const out = await providers.runProviders('t', [
            { id: 'a', run: async () => 'A' },
            { id: 'b', run: async () => 'B' }
        ]);
        assert.strictEqual(out.result, 'A');
        assert.strictEqual(out.degraded, false, 'tier 1 must not be flagged degraded');
    });

    await test('Cascade falls through to tier 2 and flags degraded', async () => {
        providers.resetHealth();
        const out = await providers.runProviders('t', [
            { id: 'a', label: 'Alpha', run: async () => { throw new Error('down'); } },
            { id: 'b', label: 'Beta', run: async () => 'B' }
        ]);
        assert.strictEqual(out.result, 'B');
        assert.strictEqual(out.degraded, true);
        assert.strictEqual(out.providerLabel, 'Beta');
    });

    await test('Empty array counts as failure, not success', async () => {
        providers.resetHealth();
        const out = await providers.runProviders('t', [
            { id: 'empty', run: async () => [] },
            { id: 'full', run: async () => [1, 2, 3] }
        ]);
        assert.deepStrictEqual(out.result, [1, 2, 3]);
        assert.strictEqual(out.providerId, 'full');
    });

    await test('Breaker opens after the failure threshold', async () => {
        providers.resetHealth();
        for (let i = 0; i < providers.FAILURE_THRESHOLD; i++) {
            providers.recordFailure('flaky', new Error('x'));
        }
        assert.strictEqual(providers.isOpen('flaky'), true);
    });

    await test('A success closes the breaker', async () => {
        providers.resetHealth();
        for (let i = 0; i < providers.FAILURE_THRESHOLD; i++) {
            providers.recordFailure('flaky', new Error('x'));
        }
        providers.recordSuccess('flaky');
        assert.strictEqual(providers.isOpen('flaky'), false);
    });

    await test('An open provider is skipped when another can serve', async () => {
        providers.resetHealth();
        for (let i = 0; i < providers.FAILURE_THRESHOLD; i++) {
            providers.recordFailure('dead', new Error('x'));
        }
        let called = false;
        const out = await providers.runProviders('t', [
            { id: 'dead', run: async () => { called = true; return 'nope'; } },
            { id: 'alive', run: async () => 'ok' }
        ]);
        assert.strictEqual(called, false, 'open provider must not be invoked');
        assert.strictEqual(out.result, 'ok');
    });

    await test('The last provider runs even with its breaker open', async () => {
        // A stale breaker must never be why the user gets nothing at all.
        providers.resetHealth();
        for (let i = 0; i < providers.FAILURE_THRESHOLD; i++) {
            providers.recordFailure('only', new Error('x'));
        }
        let called = false;
        const out = await providers.runProviders('t', [
            { id: 'only', run: async () => { called = true; return 'served'; } }
        ]);
        assert.strictEqual(called, true);
        assert.strictEqual(out.result, 'served');
    });

    await test('Total failure throws with per-provider attempts attached', async () => {
        providers.resetHealth();
        await assert.rejects(
            () => providers.runProviders('t', [
                { id: 'a', run: async () => { throw new Error('one'); } },
                { id: 'b', run: async () => { throw new Error('two'); } }
            ]),
            (err) => {
                assert.ok(Array.isArray(err.attempts), 'attempts must be attached');
                assert.strictEqual(err.attempts.length, 2);
                return true;
            }
        );
    });

    await test('getHealth reports observed providers', () => {
        providers.resetHealth();
        providers.recordSuccess('p1');
        const health = providers.getHealth();
        assert.strictEqual(health.length, 1);
        assert.strictEqual(health[0].id, 'p1');
        assert.strictEqual(health[0].successes, 1);
    });

    // ── yt-dlp runner ─────────────────────────────────────────────────
    console.log('\n🎬 yt-dlp Runner...\n');

    const ytdlp = require('../utils/ytdlp');

    await test('YTDLP_PYTHON picks the venv, falls back to python3 when it is gone', () => {
        const prev = process.env.YTDLP_PYTHON;
        try {
            delete process.env.YTDLP_PYTHON;
            assert.strictEqual(ytdlp.pythonBin('linux'), 'python3', 'Docker: unset');
            process.env.YTDLP_PYTHON = '.venv/does-not-exist/python';
            assert.strictEqual(ytdlp.pythonBin('linux'), 'python3', 'a local .env read inside Docker must not break media');
            process.env.YTDLP_PYTHON = 'package.json'; // any file that exists, relative to the repo root
            assert.strictEqual(ytdlp.pythonBin(), 'package.json');
            process.env.YTDLP_PYTHON = './package.json';
            assert.strictEqual(ytdlp.pythonBin(), path.join(ROOT, 'package.json'));
        } finally {
            if (prev === undefined) delete process.env.YTDLP_PYTHON;
            else process.env.YTDLP_PYTHON = prev;
        }
    });

    await test('Player clients come from YTDLP_PLAYER_CLIENTS', () => {
        const prev = process.env.YTDLP_PLAYER_CLIENTS;
        process.env.YTDLP_PLAYER_CLIENTS = 'tv,mweb';
        const args = ytdlp.getPlayerClientArgs();
        assert.deepStrictEqual(args, ['--extractor-args', 'youtube:player_client=tv,mweb']);
        if (prev === undefined) delete process.env.YTDLP_PLAYER_CLIENTS;
        else process.env.YTDLP_PLAYER_CLIENTS = prev;
    });

    await test('An empty client list defers to yt-dlp defaults', () => {
        const prev = process.env.YTDLP_PLAYER_CLIENTS;
        process.env.YTDLP_PLAYER_CLIENTS = '';
        assert.deepStrictEqual(ytdlp.getPlayerClientArgs(), []);
        if (prev === undefined) delete process.env.YTDLP_PLAYER_CLIENTS;
        else process.env.YTDLP_PLAYER_CLIENTS = prev;
    });

    await test('The deprecated hardcoded android client is gone', () => {
        // player_client=android was pinned in music.js and video.js and is now
        // deprecated upstream; regressing to it would silently break YouTube.
        for (const f of ['commands/music.js', 'commands/video.js', 'utils/url-parser.js']) {
            const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
            assert.ok(
                !src.includes('player_client=android'),
                `${f} still pins player_client=android`
            );
        }
    });

    await test('url-parser adds no YouTube player client of its own', () => {
        // yt-dlp keeps the last youtube: args. With YTDLP_PLAYER_CLIENTS empty
        // ("let yt-dlp choose") a pin here was the one that ran.
        const { getPlatformArgs } = require('../utils/url-parser');
        for (const url of ['https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ']) {
            assert.ok(!getPlatformArgs(url).join(' ').includes('player_client'), url);
        }
    });

    await test('PO token args are emitted only when configured', () => {
        const prev = process.env.POT_PROVIDER_URL;
        delete process.env.POT_PROVIDER_URL;
        assert.deepStrictEqual(ytdlp.getPotArgs(), []);
        process.env.POT_PROVIDER_URL = 'http://localhost:4416';
        assert.deepStrictEqual(
            ytdlp.getPotArgs(),
            ['--extractor-args', 'youtubepot-bgutilhttp:base_url=http://localhost:4416']
        );
        if (prev === undefined) delete process.env.POT_PROVIDER_URL;
        else process.env.POT_PROVIDER_URL = prev;
    });

    await test('Bot-check errors are recognised', () => {
        assert.ok(ytdlp.isBotCheck(new Error("Sign in to confirm you're not a bot")));
        assert.ok(ytdlp.isBotCheck(new Error('The page needs to be reloaded')));
        assert.ok(ytdlp.isBotCheck(new Error('HTTP Error 403: Forbidden')));
        assert.ok(!ytdlp.isBotCheck(new Error('Video unavailable')));
    });

    await test('Proxy failures are distinguished from remote rejections', () => {
        // Falling back to the local IP on a bot check would hand YouTube the
        // datacenter address we were trying to avoid — strictly worse.
        assert.ok(ytdlp.isProxyFailure(new Error('Unable to connect to proxy')));
        assert.ok(ytdlp.isProxyFailure(new Error('ECONNREFUSED')));
        assert.ok(!ytdlp.isProxyFailure(new Error("Sign in to confirm you're not a bot")));
    });

    await test('A hung process is killed at the timeout', async () => {
        const { spawnPromise } = require('../utils/helpers');
        const started = Date.now();
        await assert.rejects(
            // node rather than ping: it is on the allowlist and is always
            // installed wherever the tests run, while slim images lack ping.
            () => spawnPromise('node', ['-e', 'setTimeout(() => {}, 30000)'], { timeout: 1200 }),
            (err) => {
                assert.strictEqual(err.timedOut, true, 'error must be flagged as a timeout');
                return true;
            }
        );
        assert.ok(Date.now() - started < 5000, 'must not wait for the full command');
    });

    await test('spawnPromise still rejects commands off the allowlist', () => {
        const { spawnPromise } = require('../utils/helpers');
        return assert.rejects(
            () => spawnPromise('rm', ['-rf', '/']),
            /Command not allowed/
        );
    });

    // ── Config size parsing ───────────────────────────────────────────
    console.log('\n📦 Size Limits...\n');

    const config = require('../config');

    await test('Size suffixes parse to bytes', () => {
        assert.strictEqual(config._parseSize('64M'), 64 * 1024 * 1024);
        assert.strictEqual(config._parseSize('1G'), 1024 ** 3);
        assert.strictEqual(config._parseSize('500K'), 500 * 1024);
    });

    await test('An unparseable size degrades to a safe default', () => {
        // A typo in .env must not become NaN and disable the guard entirely.
        assert.strictEqual(config._parseSize('banana'), 64 * 1024 * 1024);
    });

    await test('maxFileBytes is populated and used', () => {
        assert.ok(config.media.maxFileBytes > 0);
        assert.strictEqual(typeof config.media.maxFileSize, 'string');
    });

    // ── Temp directory ────────────────────────────────────────────────
    console.log('\n🗂️  Temp Directory...\n');

    const tempdir = require('../utils/tempdir');

    await test('Temp files resolve inside tmp/, not the repo root', () => {
        const p = tempdir.tempPath('test_file.mp3');
        assert.ok(p.startsWith(tempdir.TEMP_DIR + path.sep));
        assert.ok(!p.includes('commands'));
    });

    await test('Path traversal out of tmp/ is rejected', () => {
        assert.throws(() => tempdir.tempPath('../../etc/passwd'), /Invalid temp filename/);
        assert.throws(() => tempdir.tempPath('/etc/passwd'), /Invalid temp filename/);
    });

    await test('Cleanup removes only the matching prefix', async () => {
        const keep = tempdir.tempPath('keepme_test.txt');
        const drop = tempdir.tempPath('dropme_test.txt');
        fs.writeFileSync(keep, 'x');
        fs.writeFileSync(drop, 'y');

        const removed = await tempdir.cleanupTemp('dropme_test');
        assert.strictEqual(removed, 1);
        assert.ok(fs.existsSync(keep), 'non-matching file must survive');
        assert.ok(!fs.existsSync(drop));

        fs.unlinkSync(keep);
    });

    await test('Cleanup with an empty prefix is a no-op', async () => {
        // An empty prefix previously would have matched every file in the
        // process working directory.
        const canary = tempdir.tempPath('canary_test.txt');
        fs.writeFileSync(canary, 'x');
        const removed = await tempdir.cleanupTemp('');
        assert.strictEqual(removed, 0);
        assert.ok(fs.existsSync(canary));
        fs.unlinkSync(canary);
    });

    // ── Egress toggle ─────────────────────────────────────────────────
    console.log('\n🛰️  Egress Toggle...\n');

    const egress = require('../utils/egress');

    await test('Egress state is written to HAMBOT_DATA_DIR, not the repo', () => {
        assert.strictEqual(
            path.dirname(egress.STATE_FILE),
            path.resolve(process.env.HAMBOT_DATA_DIR)
        );
    });

    await test('Enabling without a configured host is refused', async () => {
        const savedHost = config.proxy.host;
        const savedPort = config.proxy.port;
        config.proxy.host = null;
        config.proxy.port = null;

        const result = await egress.enable();
        assert.strictEqual(result.ok, false);
        assert.ok(result.reason);

        config.proxy.host = savedHost;
        config.proxy.port = savedPort;
    });

    await test('The toggle drives config.proxy.enabled for every consumer', async () => {
        const savedHost = config.proxy.host;
        const savedPort = config.proxy.port;
        const savedEnabled = config.proxy.enabled;

        config.proxy.host = '127.0.0.1';
        config.proxy.port = 8080;
        config.proxy.url = 'http://127.0.0.1:8080';

        await egress.enable();
        assert.strictEqual(config.proxy.enabled, true);
        assert.strictEqual(egress.isEnabled(), true);
        // yt-dlp reads the same flag, so one toggle moves the whole bot.
        assert.deepStrictEqual(config.getYtDlpProxyArgs(), ['--proxy', 'http://127.0.0.1:8080']);

        await egress.disable();
        assert.strictEqual(config.proxy.enabled, false);
        assert.deepStrictEqual(config.getYtDlpProxyArgs(), []);

        config.proxy.host = savedHost;
        config.proxy.port = savedPort;
        config.proxy.enabled = savedEnabled;
    });

    await test('status() reports without touching the network', () => {
        const s = egress.status();
        assert.strictEqual(typeof s.enabled, 'boolean');
        assert.strictEqual(typeof s.configured, 'boolean');
    });

    // ── Cached fetch ──────────────────────────────────────────────────
    console.log('\n💾 Cached Fetch...\n');

    const { cachedFetch, invalidate } = require('../utils/cached-fetch');

    await test('A miss then a hit reports provenance correctly', async () => {
        invalidate('t:prov');
        let calls = 0;
        const producer = async () => { calls++; return 'value'; };

        const a = await cachedFetch('t:prov', 5000, producer);
        const b = await cachedFetch('t:prov', 5000, producer);

        assert.strictEqual(a.fromCache, false);
        assert.strictEqual(b.fromCache, true);
        assert.strictEqual(calls, 1, 'producer must run once');
    });

    await test('Failures are not cached', async () => {
        invalidate('t:fail');
        let calls = 0;
        const failing = async () => { calls++; throw new Error('upstream down'); };

        await assert.rejects(() => cachedFetch('t:fail', 5000, failing));
        await assert.rejects(() => cachedFetch('t:fail', 5000, failing));
        assert.strictEqual(calls, 2, 'a transient failure must be retried, not pinned');
    });

    await test('isCacheable can veto caching a bad payload', async () => {
        invalidate('t:veto');
        let calls = 0;
        const producer = async () => { calls++; return { status: 'fail' }; };
        const opts = { isCacheable: (v) => v.status !== 'fail' };

        await cachedFetch('t:veto', 5000, producer, opts);
        await cachedFetch('t:veto', 5000, producer, opts);
        assert.strictEqual(calls, 2);
    });

    await test('Concurrent misses are coalesced into one call', async () => {
        invalidate('t:flight');
        let calls = 0;
        const slow = async () => {
            calls++;
            await new Promise(r => setTimeout(r, 40));
            return 'v';
        };
        await Promise.all([
            cachedFetch('t:flight', 5000, slow),
            cachedFetch('t:flight', 5000, slow),
            cachedFetch('t:flight', 5000, slow)
        ]);
        assert.strictEqual(calls, 1, 'a burst must produce one upstream request');
    });

    // ── Media helpers ─────────────────────────────────────────────────
    console.log('\n🎵 Media Helpers...\n');

    const media = require('../utils/media');

    await test('yt-dlp errors map to distinct user-facing messages', () => {
        const bot = media.describeError(new Error("Sign in to confirm you're not a bot"), 'musik');
        assert.strictEqual(bot.title, 'Diblokir Sumber');

        const big = media.describeError(new Error('File is larger than max-filesize'), 'video');
        assert.strictEqual(big.title, 'File Kegedean');

        const priv = media.describeError(new Error('Private video'), 'video');
        assert.strictEqual(priv.title, 'Tidak Bisa Diakses');

        const timeout = Object.assign(new Error('x'), { timedOut: true });
        assert.strictEqual(media.describeError(timeout, 'musik').title, 'Waktu Habis');
    });

    await test('Every mapped error carries a title, reason and hints', () => {
        const d = media.describeError(new Error('something odd'), 'musik');
        assert.ok(d.title && d.reason && Array.isArray(d.hint));
    });

    await test('Size limit check follows config', () => {
        assert.strictEqual(media.isWithinSizeLimit(1024), true);
        assert.strictEqual(media.isWithinSizeLimit(config.media.maxFileBytes + 1), false);
    });

    // ── Pinterest parsing (offline) ───────────────────────────────────
    console.log('\n📌 Pinterest Parsing...\n');

    const PinterestCommand = require('../commands/pinterest');
    const pin = new PinterestCommand();

    await test('Avatars and UI sprites are rejected', () => {
        assert.ok(!pin.isUsableImageUrl('https://i.pinimg.com/30x30_RS/ab/cd/ef/x.jpg'));
        assert.ok(!pin.isUsableImageUrl('https://i.pinimg.com/75x75_RS/ab/cd/ef/x.jpg'));
        assert.ok(!pin.isUsableImageUrl('https://i.pinimg.com/140x140_RS/ab/cd/ef/x.jpg'));
        assert.ok(!pin.isUsableImageUrl('https://evil.example.com/x.jpg'));
    });

    await test('Real content URLs are accepted', () => {
        assert.ok(pin.isUsableImageUrl('https://i.pinimg.com/736x/ab/cd/ef/x.jpg'));
        assert.ok(pin.isUsableImageUrl('https://i.pinimg.com/originals/ab/cd/ef/x.png'));
    });

    await test('The largest usable size bucket is preferred', () => {
        const chosen = pin.pickBestImage({
            images: {
                '236x': { url: 'https://i.pinimg.com/236x/a/b/c/x.jpg' },
                '736x': { url: 'https://i.pinimg.com/736x/a/b/c/x.jpg' }
            }
        });
        assert.ok(chosen.includes('/736x/'));
    });

    await test('A pin with no usable image yields null', () => {
        assert.strictEqual(pin.pickBestImage({}), null);
        assert.strictEqual(pin.pickBestImage({ images: {} }), null);
    });

    await test('Magic-byte validation rejects an HTML error page', () => {
        // Pinterest answers some failures with HTML and a 200 status.
        const html = Buffer.from('<!DOCTYPE html><html><body>error</body></html>');
        assert.strictEqual(pin.isValidImageBuffer(html), false);

        const jpeg = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF]), Buffer.alloc(20)]);
        assert.strictEqual(pin.isValidImageBuffer(jpeg), true);
    });

    await test('The image Referer matches the host being fetched', async () => {
        // Both CDNs run hotlink protection. Sending Pinterest's referer to
        // Wallhaven returns a hard 403 — this silently cost 3 of every 5
        // fallback images until it was caught.
        const httpClient = require('../utils/http-client');
        const original = httpClient.get;
        const seen = [];

        httpClient.get = async (url, opts) => {
            seen.push({ url, referer: opts.headers && opts.headers.Referer });
            // Minimal valid JPEG so the magic-byte check passes.
            return { data: Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF]), Buffer.alloc(20)]) };
        };

        try {
            await pin.downloadImage('https://i.pinimg.com/736x/a/b/c/x.jpg');
            await pin.downloadImage('https://w.wallhaven.cc/full/ab/wallhaven-abc.jpg');

            assert.strictEqual(seen[0].referer, 'https://www.pinterest.com/');
            assert.strictEqual(seen[1].referer, 'https://wallhaven.cc/');
        } finally {
            httpClient.get = original;
        }
    });

    await test('A failed original steps down to a smaller size', async () => {
        // Pinterest's full-size path is /originals/, which the ladder missed.
        const seen = [];
        const original = pin.downloadImage;
        pin.downloadImage = async (url) => { seen.push(url); return url.includes('/564x/') ? Buffer.from('img') : null; };
        const sent = [];
        const sock = { sendMessage: async (to, body) => { sent.push(body); return {}; } };
        try {
            await pin.sendResults(sock, 'x@s.whatsapp.net', { key: { remoteJid: 'x@s.whatsapp.net' } },
                ['https://i.pinimg.com/originals/a/b/c/x.jpg'], 'kucing', null);
            assert.deepStrictEqual(seen, ['https://i.pinimg.com/originals/a/b/c/x.jpg', 'https://i.pinimg.com/564x/a/b/c/x.jpg']);
            assert.ok(sent.some(b => b.image), 'the smaller image was sent');
        } finally {
            pin.downloadImage = original;
        }
    });

    // ── Other media commands (offline) ────────────────────────────────
    console.log('\n🎞️  Media Commands...\n');

    await test('.video sends MP4 as a video, WebM/MKV as a file', () => {
        const Video = require('../commands/video');
        const v = new Video();
        const mp4 = v.buildPayload({ path: '/t/a.mp4', name: 'a.mp4' }, { title: 'Clip' }, null);
        assert.ok(mp4.video && mp4.mimetype === 'video/mp4');
        const webm = v.buildPayload({ path: '/t/a.webm', name: 'a.webm' }, { title: 'A/B: clip?' }, null);
        assert.ok(!webm.video && webm.document, 'webm is a document');
        assert.strictEqual(webm.mimetype, 'video/webm');
        assert.strictEqual(webm.fileName, 'AB clip.webm');
        assert.match(webm.caption, /\.webm/);
        const mkv = v.buildPayload({ path: '/t/a.mkv', name: 'a.mkv' }, {}, null);
        assert.strictEqual(mkv.mimetype, 'video/x-matroska');
    });

    await test('.say tells a used-up quota and a blocked account from a bad key', () => {
        const Say = require('../commands/say');
        const say = new Say();
        const axiosError = (status, body) => ({
            message: `Request failed with status code ${status}`,
            response: { status, data: Buffer.from(JSON.stringify(body)) }
        });
        assert.strictEqual(say.describeTtsError(axiosError(401, { detail: { status: 'quota_exceeded' } })).title, 'Kuota Habis');
        assert.strictEqual(say.describeTtsError(axiosError(401, { detail: { status: 'detected_unusual_activity' } })).title, 'Akun Diblokir ElevenLabs');
        assert.strictEqual(say.describeTtsError(axiosError(401, { detail: { status: 'invalid_api_key' } })).title, 'API Key Bermasalah');
        assert.strictEqual(say.describeTtsError({ message: 'x', response: { status: 401, data: Buffer.from('<html>') } }).title, 'API Key Bermasalah');
        assert.strictEqual(say.describeTtsError(axiosError(429, { detail: { status: 'too_many_concurrent_requests' } })).title, 'Sedang Sibuk');
        assert.strictEqual(say.describeTtsError(Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' })).title, 'Tidak Tersedia');
        assert.strictEqual(say.describeTtsError(Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' })).title, 'Waktu Habis');
        assert.strictEqual(say.describeTtsError(new Error('weird')).title, 'Gagal');
    });

    await test('.toimg converts static and animated stickers', async () => {
        const sharp = require('sharp');
        const ToImg = require('../commands/toimg');
        const frame = c => sharp({ create: { width: 8, height: 8, channels: 4, background: c } }).png().toBuffer();
        const still = await sharp(await frame('#ff0000')).webp().toBuffer();
        const animated = await sharp([await frame('#ff0000'), await frame('#00ff00')], { join: { animated: true } })
            .webp({ loop: 0, delay: [100, 100] }).toBuffer();
        assert.strictEqual((await sharp(animated, { animated: true }).metadata()).pages, 2, 'fixture is animated');

        for (const input of [still, animated]) {
            const png = await new ToImg().convert(input);
            const meta = await sharp(png).metadata();
            assert.strictEqual(meta.format, 'png');
            assert.strictEqual(meta.width, 8);
            assert.strictEqual(meta.height, 8, 'first frame only');
        }
    });

    await test('Playwright is no longer a dependency', () => {
        const pkg = require('../package.json');
        assert.ok(!pkg.dependencies.playwright, 'playwright must be removed');
        const src = fs.readFileSync(path.join(ROOT, 'commands/pinterest.js'), 'utf8');
        assert.ok(!src.includes("require('playwright')"), 'pinterest must not load a browser');
    });

    // ── One yt-dlp run per download ──────────────────────────────────
    // A fake yt-dlp (tests/fixtures/fake-ytdlp, any OS) logs each run and
    // either "downloads" (prints JSON, writes the -o file) or, like yt-dlp's
    // --match-filter, prints nothing and writes nothing.
    console.log('\n🎬 Single-pass downloads...\n');

    const runLog = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hambot-ytdlp-runs-')), 'runs.log');
    const fakeYtdlp = require('./fixtures/fake-ytdlp.cjs').install(`
const fs = require('fs');
fs.appendFileSync(${JSON.stringify(runLog)}, JSON.stringify(args) + '\\n');
// 'botcheck': YouTube refuses every download, as from a datacenter IP.
if (process.env.FAKE_YTDLP === 'botcheck' && /youtu/.test(args[0]) && args.includes('-o')) {
    console.error("ERROR: [youtube] abc: Sign in to confirm you're not a bot");
    process.exit(1);
}
// No -o: a metadata or search run (getInfo).
if (!args.includes('-o')) {
    const sc = args[0].startsWith('scsearch');
    console.log(JSON.stringify(sc
        ? { id: 'sc1', title: 'SC Song', uploader: 'SC Artist', duration: 100, url: 'https://soundcloud.com/a/sc-song' }
        : { id: 'abc', title: 'YT Song', uploader: 'YT Artist', duration: 100 }));
    process.exit(0);
}
if (process.env.FAKE_YTDLP === 'filtered') process.exit(0);
const template = args[args.indexOf('-o') + 1];
const ext = args.includes('-x') ? 'mp3' : 'mp4';
// 'nofile': yt-dlp printed the metadata, then skipped the file (max-filesize).
if (process.env.FAKE_YTDLP !== 'nofile') fs.writeFileSync(template.replace('%(ext)s', ext), 'media');
// 'nojson': a file but no metadata, as some odd extractors might.
if (process.env.FAKE_YTDLP === 'nojson') process.exit(0);
console.log(JSON.stringify({ title: 'Fake Title', uploader: 'Fake Channel', duration: 42 }));
`);
    const runs = () => fs.existsSync(runLog)
        ? fs.readFileSync(runLog, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
        : [];
    const tempdirMod = require('../utils/tempdir');

    try {
        await test('.video downloads and reads metadata in one yt-dlp run', async () => {
            fs.rmSync(runLog, { force: true });
            const Video = require('../commands/video');
            const prefix = `video_fake_${process.pid}`;
            try {
                const { file, info, tooLong } = await new Video().downloadVideo('https://example.com/v', prefix, []);
                assert.strictEqual(tooLong, false);
                assert.ok(file && file.path.endsWith('.mp4'), JSON.stringify(file));
                assert.strictEqual(info.title, 'Fake Title');
                const all = runs();
                assert.strictEqual(all.length, 1, `yt-dlp ran ${all.length}x`);
                assert.ok(all[0].includes('--no-simulate') && all[0].includes('--dump-json'));
                const filter = all[0][all[0].indexOf('--match-filter') + 1];
                assert.match(filter, /^duration <=\? \d+$/, 'unknown durations still pass');
            } finally {
                await tempdirMod.cleanupTemp(prefix);
            }
        });

        await test('.video reports over-long media from the filter, without a download', async () => {
            fs.rmSync(runLog, { force: true });
            process.env.FAKE_YTDLP = 'filtered';
            try {
                const Video = require('../commands/video');
                const result = await new Video().downloadVideo('https://example.com/v', `video_long_${process.pid}`, []);
                assert.strictEqual(result.tooLong, true);
                assert.strictEqual(runs().length, 1);
            } finally {
                delete process.env.FAKE_YTDLP;
            }
        });

        await test('.music with a URL: one run, and the info card gets the real title', async () => {
            fs.rmSync(runLog, { force: true });
            const Music = require('../commands/music');
            const music = new Music();
            const prefix = `music_fake_${process.pid}`;
            try {
                const track = music.resolveUrl('https://soundcloud.com/a/b');
                assert.strictEqual(runs().length, 0, 'no metadata lookup before the download');
                const { file, tooLong } = await music.downloadAudio(track, prefix);
                assert.strictEqual(tooLong, false);
                assert.ok(file.path.endsWith('.mp3'));
                assert.strictEqual(track.title, 'Fake Title');
                assert.strictEqual(track.duration, 42);
                assert.strictEqual(runs().length, 1);
            } finally {
                await tempdirMod.cleanupTemp(prefix);
            }
        });

        await test('.music: YouTube refusing the download falls back to SoundCloud once', async () => {
            fs.rmSync(runLog, { force: true });
            providers.resetHealth();
            process.env.FAKE_YTDLP = 'botcheck';
            const Music = require('../commands/music');
            const music = new Music();
            const prefix = `music_fb_${process.pid}`;
            try {
                const track = await music.resolveSearch('lagu enak');
                assert.strictEqual(track.source, 'YouTube');
                const out = await music.downloadWithFallback(track, 'lagu enak', false, prefix);
                assert.ok(out.file && out.file.path.endsWith('.mp3'));
                assert.strictEqual(out.track.source, 'SoundCloud');
                assert.strictEqual(out.track.degraded, true);
                assert.strictEqual(out.track.title, 'SC Song');
                assert.match(music.buildInfoCard(out.track), /SoundCloud/);
                const targets = runs().map(r => r[0]);
                assert.deepStrictEqual(targets, ['ytsearch5:lagu enak', 'https://youtu.be/abc', 'scsearch5:lagu enak', 'https://soundcloud.com/a/sc-song']);
            } finally {
                delete process.env.FAKE_YTDLP;
                providers.resetHealth();
                await tempdirMod.cleanupTemp(prefix);
            }
        });

        await test('.music: a pasted YouTube URL is never swapped for another song', async () => {
            fs.rmSync(runLog, { force: true });
            process.env.FAKE_YTDLP = 'botcheck';
            const Music = require('../commands/music');
            const music = new Music();
            try {
                const url = 'https://youtu.be/abc';
                await assert.rejects(music.downloadWithFallback(music.resolveUrl(url), url, true, `music_url_${process.pid}`), /Sign in/);
                assert.strictEqual(runs().length, 1, 'no SoundCloud search');
            } finally {
                delete process.env.FAKE_YTDLP;
                providers.resetHealth();
            }
        });

        await test('.music: after repeated refusals, searches skip YouTube', async () => {
            fs.rmSync(runLog, { force: true });
            providers.resetHealth();
            const Music = require('../commands/music');
            try {
                for (let i = 0; i < providers.FAILURE_THRESHOLD; i++) {
                    providers.recordFailure('youtube-download', new Error("Sign in to confirm you're not a bot"));
                }
                const track = await new Music().resolveSearch('lagu enak');
                assert.strictEqual(track.source, 'SoundCloud');
                assert.strictEqual(track.degraded, true);
                assert.deepStrictEqual(runs().map(r => r[0]), ['scsearch5:lagu enak']);
            } finally {
                providers.resetHealth();
            }
        });

        await test('.music <url> with words after it fetches only the URL', async () => {
            fs.rmSync(runLog, { force: true });
            const Music = require('../commands/music');
            const sent = [];
            const sock = { sendMessage: async (to, body) => { sent.push(body); return {}; } };
            const msg = { key: { remoteJid: 'x@s.whatsapp.net' }, message: {} };
            // An IP literal: the SSRF guard needs no DNS lookup for it.
            await new Music().execute(sock, msg, ['https://93.184.216.34/track', 'tolong', 'dong'], { from: 'x@s.whatsapp.net' });
            assert.strictEqual(runs()[0][0], 'https://93.184.216.34/track');
            assert.ok(sent.some(b => b.audio), 'audio sent');
        });

        await test('A downloaded file is sent even when yt-dlp printed no metadata', async () => {
            process.env.FAKE_YTDLP = 'nojson';
            const prefix = `video_nojson_${process.pid}`;
            try {
                const Video = require('../commands/video');
                const result = await new Video().downloadVideo('https://example.com/v', prefix, []);
                assert.strictEqual(result.tooLong, false);
                assert.ok(result.file, 'the file on disk wins');
                assert.deepStrictEqual(result.info, {});
            } finally {
                delete process.env.FAKE_YTDLP;
                await tempdirMod.cleanupTemp(prefix);
            }
        });

        await test('Metadata but no file means max-filesize, not "too long"', async () => {
            process.env.FAKE_YTDLP = 'nofile';
            try {
                const Video = require('../commands/video');
                await assert.rejects(
                    new Video().downloadVideo('https://example.com/v', `video_big_${process.pid}`, []),
                    /max-filesize/
                );
            } finally {
                delete process.env.FAKE_YTDLP;
            }
        });
    } finally {
        fakeYtdlp.restore();
        fs.rmSync(path.dirname(runLog), { recursive: true, force: true });
    }

    // ── Summary ───────────────────────────────────────────────────────
    console.log('\n' + '='.repeat(60));
    console.log('📊 MEDIA TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Tests Passed: ${passed}`);
    console.log(`❌ Tests Failed: ${failed}`);
    console.log(`🎯 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
    console.log('='.repeat(60) + '\n');

    if (failed > 0) {
        console.log('❌ Media infrastructure tests failed.\n');
        process.exit(1);
    }
    console.log('✅ All media infrastructure tests passed.\n');
    process.exit(0);
}

main().catch((err) => {
    console.error('Test runner crashed:', err);
    process.exit(1);
});
