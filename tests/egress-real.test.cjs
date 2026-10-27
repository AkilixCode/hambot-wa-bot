/**
 * Egress guard with the real tools: yt-dlp and ffmpeg, through utils/ytdlp.
 *
 * Unit tests (egress-guard.test.cjs) prove the guard's rules. These prove
 * that real yt-dlp, with the args utils/ytdlp gives it, cannot get around
 * them: every connection it makes, directly or through ffmpeg or an external
 * tool, either goes through the guard or does not happen.
 *
 * Every refused case is paired with a case that succeeds on the same path,
 * so "the canary was never contacted" cannot pass just because the
 * download broke before fetching anything.
 *
 *   origin  127.0.0.1:A  serves real media (ffmpeg-made mp4, HLS, DASH);
 *                        allowed through the guard's injected allowlist
 *   canary  127.0.0.1:B  HTTP, counts every connection; must stay at 0
 *   raw     127.0.0.1:C  TCP, counts every connection; must stay at 0
 *
 * Needs Python with yt-dlp, and ffmpeg. CI runs it in the egress-real job;
 * HAMBOT_EGRESS_REAL=1 makes missing tools a failure instead of a skip.
 * Linux and macOS (it puts a stand-in rtmpdump on PATH).
 */

process.env.LOG_LEVEL = 'simple';
process.env.HAMBOT_ENV_FILE = 'tests/no-such.env';
// Fail fast on refusals; 0 would mean "yt-dlp's default" (10).
process.env.YTDLP_RETRIES = '1';
process.env.YTDLP_FRAGMENT_RETRIES = '1';
process.env.YTDLP_EXTRACTOR_RETRIES = '1';
process.env.YTDLP_SOCKET_TIMEOUT = '5';
// The setting Docker, Kubernetes and corporate machines often carry. yt-dlp
// honours it even with --proxy, so without utils/ytdlp clearing it these
// addresses would go straight past the guard. Set here so every run of this
// test (CI included) covers that.
process.env.NO_PROXY = 'localhost,127.0.0.1,::1,127.0.0.0/8,169.254.0.0/16,10.0.0.0/8';
process.env.no_proxy = process.env.NO_PROXY;

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PUBLIC = '93.184.216.34';
let passed = 0;
let failed = 0;
// Canary counts at the start of the current case: each case is judged on
// what it caused, so one leak does not fail every case after it.
let canaryRef = null;
let baseline = null;

async function test(name, fn) {
    if (canaryRef) baseline = { ...canaryRef };
    try {
        await fn();
        passed++;
        console.log(`✅ PASS: ${name}`);
    } catch (err) {
        failed++;
        console.log(`❌ FAIL: ${name}\n   ${String(err.message).split('\n').slice(0, 6).join('\n   ')}`);
    }
}

function toolsMissing() {
    const python = spawnSync(process.env.YTDLP_PYTHON || 'python3', ['-m', 'yt_dlp', '--version'], { encoding: 'utf8' });
    if (python.status !== 0) return 'yt-dlp (python3 -m yt_dlp)';
    if (spawnSync('ffmpeg', ['-version']).status !== 0) return 'ffmpeg';
    if (process.platform === 'win32') return 'a POSIX system (stand-in rtmpdump)';
    return null;
}

function ffmpeg(args) {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')}: ${r.stderr}`);
}

/** Real media: an mp4, an HLS rendition and a DASH manifest (separate video and audio). */
function makeMedia(dir) {
    fs.mkdirSync(path.join(dir, 'hls'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'dash'), { recursive: true });
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc=duration=2:size=160x120:rate=10', '-f', 'lavfi', '-i', 'sine=duration=2',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(dir, 'video.mp4')]);
    ffmpeg(['-i', path.join(dir, 'video.mp4'), '-c', 'copy', '-f', 'hls', '-hls_time', '1', '-hls_list_size', '0',
        path.join(dir, 'hls', 'index.m3u8')]);
    ffmpeg(['-i', path.join(dir, 'video.mp4'), '-map', '0:v', '-map', '0:a', '-c', 'copy', '-f', 'dash', '-seg_duration', '1',
        path.join(dir, 'dash', 'manifest.mpd')]);
}

const TYPES = { '.mp4': 'video/mp4', '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.mpd': 'application/dash+xml', '.m4s': 'video/iso.segment', '.html': 'text/html' };

async function listen(server) {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return server.address().port;
}

async function main() {
    console.log('\n🛡️  EGRESS GUARD WITH REAL yt-dlp + ffmpeg\n' + '='.repeat(60));

    const missing = toolsMissing();
    if (missing) {
        console.log(`SKIP: needs ${missing}`);
        process.exit(process.env.HAMBOT_EGRESS_REAL === '1' ? 1 : 0);
    }

    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hambot-egress-real-'));
    const media = path.join(work, 'media');
    makeMedia(media);
    const out = path.join(work, 'out');
    fs.mkdirSync(out);

    // ── Canaries ──
    const canary = { http: 0, raw: 0 };
    canaryRef = canary;
    const canaryHttp = http.createServer((req, res) => { res.end('stolen'); });
    canaryHttp.on('connection', () => { canary.http++; });
    const B = await listen(canaryHttp);
    const canaryRaw = net.createServer(s => { canary.raw++; s.destroy(); });
    const C = await listen(canaryRaw);

    // ── Origin ──
    let A;
    const origin = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://x');
        if (url.pathname === '/redirect.mp4') {
            res.writeHead(302, { Location: `http://127.0.0.1:${B}/video.mp4` });
            return res.end();
        }
        if (url.pathname === '/to-localhost.mp4') {
            res.writeHead(302, { Location: `http://localhost:${B}/video.mp4` });
            return res.end();
        }
        if (url.pathname === '/hls-evil/index.m3u8') {
            const list = fs.readFileSync(path.join(media, 'hls', 'index.m3u8'), 'utf8')
                .replace(/^(index\d+\.ts)$/gm, `http://127.0.0.1:${B}/$1`);
            res.setHeader('Content-Type', TYPES['.m3u8']);
            return res.end(list);
        }
        if (url.pathname === '/dash-evil/manifest.mpd') {
            const mpd = fs.readFileSync(path.join(media, 'dash', 'manifest.mpd'), 'utf8')
                .replace(/(<Period[^>]*>)/, `$1<BaseURL>http://127.0.0.1:${B}/dash/</BaseURL>`);
            res.setHeader('Content-Type', TYPES['.mpd']);
            return res.end(mpd);
        }
        if (url.pathname === '/rtmp.html') {
            res.setHeader('Content-Type', 'text/html');
            return res.end(`<html><head><title>live</title></head><body><video controls><source src="rtmp://127.0.0.1:${C}/live/stream" type="video/mp4"></video></body></html>`);
        }
        const file = path.join(media, path.normalize(url.pathname).replace(/^([/\\])+/, ''));
        if (!file.startsWith(media) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            res.statusCode = 404;
            return res.end();
        }
        res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
    });
    A = await listen(origin);

    // ── A stand-in rtmpdump: like the real one, it ignores proxies ──
    const bin = path.join(work, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'rtmpdump'), [
        `#!${process.execPath}`,
        "const net = require('net');",
        "const at = process.argv.indexOf('-r');",
        "const u = new URL(at === -1 ? 'rtmp://127.0.0.1:1/' : process.argv[at + 1]);",
        "const s = net.connect(Number(u.port) || 1935, u.hostname, () => { s.destroy(); process.exit(1); });",
        "s.on('error', () => process.exit(1));"
    ].join('\n'), { mode: 0o755 });
    process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;

    // ── The bot's own modules, with a guard that knows the test network ──
    const config = require('../config');
    const ytdlp = require('../utils/ytdlp');
    const egressGuard = require('../utils/egress-guard');
    const dns = require('dns').promises;
    await ytdlp.useGuard(egressGuard.create({
        allow: [`127.0.0.1:${A}`],
        // media.example.com is "public" and lands on the origin; evil.example.com
        // is a rebinding name that points at the machine itself.
        lookup: async (host) => {
            if (host === 'media.example.com') return [{ address: PUBLIC, family: 4 }];
            if (host === 'evil.example.com') return [{ address: '127.0.0.1', family: 4 }];
            return dns.lookup(host, { all: true });
        },
        connect: (o) => (o.host === PUBLIC ? net.connect(A, '127.0.0.1') : net.connect(o))
    }));

    const setProxy = (url) => {
        Object.assign(config.proxy, url ? { enabled: true, url } : { enabled: false, url: null });
    };
    const VIDEO = ['-f', 'best[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best', '--merge-output-format', 'mp4'];
    let n = 0;
    const download = (url, formatArgs = VIDEO) => {
        const prefix = path.join(out, `t${++n}`);
        return ytdlp.download(url, `${prefix}.%(ext)s`, formatArgs).then(
            () => {
                const file = fs.readdirSync(out).find(f => f.startsWith(`t${n}.`) && !f.endsWith('.part'));
                return { file: file ? path.join(out, file) : null };
            },
            (error) => ({ error })
        );
    };
    const probe = (file) => {
        const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file], { encoding: 'utf8' });
        return r.stderr;
    };
    const assertCanaryUntouched = (what) => {
        const during = { http: canary.http - baseline.http, raw: canary.raw - baseline.raw };
        assert.deepStrictEqual(during, { http: 0, raw: 0 }, `${what}: a canary was contacted`);
    };

    try {
        // ── Succeeds: proves each path really fetched ──
        await test('direct mp4 downloads through the guard', async () => {
            const r = await download(`http://127.0.0.1:${A}/video.mp4`);
            assert.ok(r.file, r.error && r.error.message);
            assert.match(probe(r.file), /Video: h264/);
        });

        await test('HLS downloads natively, segment by segment, through the guard', async () => {
            const r = await download(`http://127.0.0.1:${A}/hls/index.m3u8`);
            assert.ok(r.file, r.error && r.error.message);
            assert.match(probe(r.file), /Video: h264/);
        });

        await test('DASH with separate video and audio downloads, and ffmpeg merges it locally', async () => {
            const r = await download(`http://127.0.0.1:${A}/dash/manifest.mpd`);
            assert.ok(r.file, r.error && r.error.message);
            const info = probe(r.file);
            assert.match(info, /Video: h264/);
            assert.match(info, /Audio: aac/, 'both streams, merged');
        });

        // ── Refused: same paths, aimed at the canary ──
        await test('a redirect to a private address is refused, the canary untouched', async () => {
            const r = await download(`http://127.0.0.1:${A}/redirect.mp4`);
            assert.ok(r.error, 'must fail');
            assert.match(r.error.message, /Egress Blocked/);
            assert.strictEqual(ytdlp.failureReason(r.error), 'blocked');
            assertCanaryUntouched('redirect');
            const viaName = await download(`http://127.0.0.1:${A}/to-localhost.mp4`);
            assert.ok(viaName.error, 'localhost redirect must fail');
            assertCanaryUntouched('localhost redirect');
        });

        await test('HLS segments on a private address are refused', async () => {
            const r = await download(`http://127.0.0.1:${A}/hls-evil/index.m3u8`);
            assert.ok(r.error, 'must fail');
            assertCanaryUntouched('HLS segments');
        });

        await test('DASH segments on a private address are refused', async () => {
            const r = await download(`http://127.0.0.1:${A}/dash-evil/manifest.mpd`);
            assert.ok(r.error, 'must fail');
            assertCanaryUntouched('DASH segments');
        });

        await test('a name that resolves to the machine itself (rebinding) is refused', async () => {
            const r = await download('http://evil.example.com/video.mp4');
            assert.ok(r.error, 'must fail');
            assert.match(r.error.message, /Egress Blocked/);
            assertCanaryUntouched('rebinding');
        });

        await test('a format only an external tool can fetch (rtmp → rtmpdump) is never chosen', async () => {
            const r = await download(`http://127.0.0.1:${A}/rtmp.html`);
            assert.ok(r.error, 'must fail');
            assert.match(r.error.message, /Requested format is not available/);
            assertCanaryUntouched('rtmp');
        });

        // ── The owner's proxy behind the guard ──
        await test('through an HTTP proxy: it is asked for the checked IP only, and the download works', async () => {
            const seen = [];
            const proxy = net.createServer(client => {
                client.on('error', () => {});
                client.once('data', d => {
                    seen.push(d.toString().split('\r\n')[0]);
                    const dest = net.connect(A, '127.0.0.1', () => {
                        client.write('HTTP/1.1 200 Connection established\r\n\r\n');
                        client.pipe(dest);
                        dest.pipe(client);
                    });
                });
            });
            const P = await listen(proxy);
            setProxy(`http://u:p@127.0.0.1:${P}`);
            try {
                const r = await download('http://media.example.com/video.mp4');
                assert.ok(r.file, r.error && r.error.message);
                assert.ok(seen.length > 0 && seen.every(l => l === `CONNECT ${PUBLIC}:80 HTTP/1.1`), JSON.stringify(seen));
            } finally {
                setProxy(null);
                proxy.close();
            }
            assertCanaryUntouched('http proxy');
        });

        await test('through a SOCKS5 proxy: the destination is the checked IP, and the download works', async () => {
            const seen = [];
            const proxy = net.createServer(client => {
                client.on('error', () => {});
                let stage = 0;
                client.on('data', function onData(d) {
                    if (stage === 0) { client.write(Buffer.from([5, 0])); stage = 1; return; }
                    seen.push({ atyp: d[3], address: d[3] === 1 ? [...d.subarray(4, 8)].join('.') : d.toString('latin1', 5, 5 + d[4]) });
                    client.removeListener('data', onData);
                    const dest = net.connect(A, '127.0.0.1', () => {
                        client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
                        client.pipe(dest);
                        dest.pipe(client);
                    });
                });
            });
            const P = await listen(proxy);
            setProxy(`socks5://127.0.0.1:${P}`);
            try {
                const r = await download('http://media.example.com/video.mp4');
                assert.ok(r.file, r.error && r.error.message);
                assert.ok(seen.length > 0 && seen.every(s => s.atyp === 1 && s.address === PUBLIC), JSON.stringify(seen));
            } finally {
                setProxy(null);
                proxy.close();
            }
            assertCanaryUntouched('socks proxy');
        });

        await test('a dead proxy: counted as a proxy failure, retried direct through the guard (or not, if fallback is off)', async () => {
            const providers = require('../utils/providers');
            const { PROXY_BREAKER_ID } = require('../utils/http-client');
            const failures = () => (providers.getHealth().find(h => h.id === PROXY_BREAKER_ID) || {}).totalFailures || 0;
            providers.resetHealth();
            setProxy('http://127.0.0.1:9'); // nothing listens there
            const savedFallback = config.network.fallbackToLocal;
            try {
                config.network.fallbackToLocal = true;
                const ok = await download('http://media.example.com/video.mp4');
                assert.ok(ok.file, ok.error && ok.error.message);
                assert.strictEqual(failures(), 1, 'the proxy breaker counted it');

                config.network.fallbackToLocal = false;
                const r = await download('http://media.example.com/video.mp4');
                assert.ok(r.error, 'no fallback: must fail');
                assert.strictEqual(ytdlp.isProxyFailure(r.error), true, r.error.message);
                assert.strictEqual(ytdlp.failureReason(r.error), 'proxy');
                assert.strictEqual(failures(), 2);
            } finally {
                config.network.fallbackToLocal = savedFallback;
                setProxy(null);
                providers.resetHealth();
            }
            assertCanaryUntouched('dead proxy');
        });
    } finally {
        await ytdlp.useGuard(null);
        origin.close();
        canaryHttp.close();
        canaryRaw.close();
        fs.rmSync(work, { recursive: true, force: true });
    }

    console.log('\n' + '='.repeat(60));
    console.log(`✅ Tests Passed: ${passed}`);
    console.log(`❌ Tests Failed: ${failed}`);
    console.log('='.repeat(60) + '\n');
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('Test runner crashed:', err);
    process.exit(1);
});
