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
const fs = require('fs');

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

    const providers = require('./utils/providers');

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

    const ytdlp = require('./utils/ytdlp');

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
        for (const f of ['commands/music.js', 'commands/video.js']) {
            const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
            assert.ok(
                !src.includes('player_client=android'),
                `${f} still pins player_client=android`
            );
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
        const { spawnPromise } = require('./utils/helpers');
        const started = Date.now();
        await assert.rejects(
            () => spawnPromise('ping', ['-i', '1', '-c', '30', '127.0.0.1'], { timeout: 1200 }),
            (err) => {
                assert.strictEqual(err.timedOut, true, 'error must be flagged as a timeout');
                return true;
            }
        );
        assert.ok(Date.now() - started < 5000, 'must not wait for the full command');
    });

    await test('spawnPromise still rejects commands off the allowlist', () => {
        const { spawnPromise } = require('./utils/helpers');
        return assert.rejects(
            () => spawnPromise('rm', ['-rf', '/']),
            /Command not allowed/
        );
    });

    // ── Config size parsing ───────────────────────────────────────────
    console.log('\n📦 Size Limits...\n');

    const config = require('./config');

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

    const tempdir = require('./utils/tempdir');

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

    const egress = require('./utils/egress');

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

    const { cachedFetch, invalidate } = require('./utils/cached-fetch');

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

    const media = require('./utils/media');

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

    const PinterestCommand = require('./commands/pinterest');
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
        const httpClient = require('./utils/http-client');
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

    await test('Playwright is no longer a dependency', () => {
        const pkg = require('./package.json');
        assert.ok(!pkg.dependencies.playwright, 'playwright must be removed');
        const src = fs.readFileSync(path.join(__dirname, 'commands/pinterest.js'), 'utf8');
        assert.ok(!src.includes("require('playwright')"), 'pinterest must not load a browser');
    });

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
