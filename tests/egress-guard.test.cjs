/**
 * Egress guard (utils/egress-guard): unit tests, offline, any OS.
 *
 * Fake resolvers stand in for DNS, a fake dialler stands in for the internet,
 * and local servers play the owner's HTTP and SOCKS5 proxies, so every case
 * runs on loopback while the guard believes it is reaching public addresses.
 */

process.env.LOG_LEVEL = 'simple';

const assert = require('assert');
const http = require('http');
const net = require('net');
const egressGuard = require('../utils/egress-guard');

let passed = 0;
let failed = 0;

async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`✅ PASS: ${name}`);
    } catch (err) {
        failed++;
        console.log(`❌ FAIL: ${name}\n   ${err.message}`);
    }
}

const PUBLIC = '93.184.216.34';
const publicLookup = async () => [{ address: PUBLIC, family: 4 }];

/** A TCP server that echoes, counting connections. */
async function echoServer() {
    const srv = { connections: 0 };
    srv.server = net.createServer(sock => {
        srv.connections++;
        sock.on('error', () => {});
        sock.pipe(sock);
    });
    await new Promise(resolve => srv.server.listen(0, '127.0.0.1', resolve));
    srv.port = srv.server.address().port;
    return srv;
}

/** A dialler that records what the guard asked for and reaches `srv` instead. */
function recordingDialler(srv, into) {
    return (o) => {
        into.push(`${o.host}:${o.port}`);
        return net.connect(srv.port, '127.0.0.1');
    };
}

/**
 * CONNECT through the guard. Resolves with the status line and, on 200, the
 * tunnel socket (left open for the caller).
 */
function connectThrough(guardUrl, target, { auth = true } = {}) {
    const p = new URL(guardUrl);
    return new Promise((resolve, reject) => {
        const s = net.connect(Number(p.port), p.hostname, () => {
            const lines = [`CONNECT ${target} HTTP/1.1`, `Host: ${target}`];
            if (auth === true) lines.push(`Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(p.username)}:${decodeURIComponent(p.password)}`).toString('base64')}`);
            else if (auth) lines.push(`Proxy-Authorization: Basic ${Buffer.from(auth).toString('base64')}`);
            s.write(`${lines.join('\r\n')}\r\n\r\n`);
        });
        let buf = '';
        const onData = (d) => {
            buf += d;
            const end = buf.indexOf('\r\n\r\n');
            if (end === -1) return;
            s.removeListener('data', onData);
            const status = buf.split('\r\n')[0];
            if (!/ 200 /.test(status)) s.destroy();
            resolve({ status, socket: s });
        };
        s.on('data', onData);
        s.on('error', reject);
    });
}

/** Write through a tunnel and read the echo back. */
function roundTrip(socket, text) {
    return new Promise((resolve) => {
        socket.once('data', d => resolve(d.toString()));
        socket.write(text);
    });
}

/** A fake HTTP proxy: records CONNECT lines and auth, then tunnels to `srv`. */
async function fakeHttpProxy(srv) {
    const proxy = { seen: [] };
    proxy.server = net.createServer(client => {
        client.on('error', () => {});
        let buf = '';
        const onData = (d) => {
            buf += d;
            const end = buf.indexOf('\r\n\r\n');
            if (end === -1) return;
            client.removeListener('data', onData);
            const head = buf.slice(0, end).split('\r\n');
            const auth = head.find(l => /^proxy-authorization:/i.test(l));
            proxy.seen.push({ line: head[0], auth: auth ? Buffer.from(auth.split(' ').pop(), 'base64').toString() : null });
            const dest = net.connect(srv.port, '127.0.0.1', () => {
                client.write('HTTP/1.1 200 Connection established\r\n\r\n');
                client.pipe(dest);
                dest.pipe(client);
            });
            dest.on('error', () => client.destroy());
        };
        client.on('data', onData);
    });
    await new Promise(resolve => proxy.server.listen(0, '127.0.0.1', resolve));
    proxy.port = proxy.server.address().port;
    return proxy;
}

/** A fake SOCKS5 proxy (RFC 1928/1929): records the destination type and address. */
async function fakeSocks5(srv) {
    const proxy = { seen: [] };
    proxy.server = net.createServer(client => {
        client.on('error', () => {});
        let stage = 'greeting';
        client.on('data', function onData(d) {
            if (stage === 'greeting') {
                const methods = [...d.subarray(2, 2 + d[1])];
                const method = methods.includes(2) ? 2 : 0;
                client.write(Buffer.from([5, method]));
                stage = method === 2 ? 'auth' : 'request';
            } else if (stage === 'auth') {
                const ulen = d[1];
                const user = d.subarray(2, 2 + ulen).toString();
                const pass = d.subarray(3 + ulen, 3 + ulen + d[2 + ulen]).toString();
                proxy.auth = `${user}:${pass}`;
                client.write(Buffer.from([1, 0]));
                stage = 'request';
            } else if (stage === 'request') {
                const atyp = d[3];
                let address;
                if (atyp === 1) address = [...d.subarray(4, 8)].join('.');
                else if (atyp === 3) address = d.subarray(5, 5 + d[4]).toString();
                else address = d.subarray(4, 20).toString('hex');
                const port = d.readUInt16BE(d.length - 2);
                proxy.seen.push({ atyp, address, port });
                client.removeListener('data', onData);
                const dest = net.connect(srv.port, '127.0.0.1', () => {
                    client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
                    client.pipe(dest);
                    dest.pipe(client);
                });
                dest.on('error', () => client.destroy());
            }
        });
    });
    await new Promise(resolve => proxy.server.listen(0, '127.0.0.1', resolve));
    proxy.port = proxy.server.address().port;
    return proxy;
}

async function main() {
    console.log('\n🛡️  EGRESS GUARD TESTS\n' + '='.repeat(60));

    const echo = await echoServer();
    const servers = [echo.server];

    await test('no token, or a wrong one: 407, nothing dialled', async () => {
        const dialled = [];
        const guard = egressGuard.create({ lookup: publicLookup, connect: recordingDialler(echo, dialled) });
        const url = await guard.urlFor(null);
        assert.match((await connectThrough(url, 'example.com:443', { auth: false })).status, / 407 /);
        assert.match((await connectThrough(url, 'example.com:443', { auth: 'hambot:not-the-token' })).status, / 407 /);
        assert.deepStrictEqual(dialled, []);
        await guard.close();
    });

    await test('private destinations are refused, however they are written', async () => {
        const dialled = [];
        const guard = egressGuard.create({ lookup: publicLookup, connect: recordingDialler(echo, dialled) });
        const url = await guard.urlFor(null);
        for (const target of ['127.0.0.1:443', '[::ffff:7f00:1]:443', '[::ffff:127.0.0.1]:443', '[64:ff9b::a9fe:a9fe]:443',
            '169.254.169.254:80', '10.0.0.5:443', '[::1]:443', 'localhost:443', 'metadata.google.internal:80']) {
            const { status } = await connectThrough(url, target);
            assert.match(status, / 403 Egress Blocked/, target);
        }
        assert.deepStrictEqual(dialled, []);
        await guard.close();
    });

    await test('a name that resolves privately is refused, even one answer among public ones', async () => {
        for (const answers of [[{ address: '10.1.2.3', family: 4 }], [{ address: PUBLIC, family: 4 }, { address: '::ffff:169.254.169.254', family: 6 }]]) {
            const dialled = [];
            const guard = egressGuard.create({ lookup: async () => answers, connect: recordingDialler(echo, dialled) });
            const { status } = await connectThrough(await guard.urlFor(null), 'rebind.example:443');
            assert.match(status, / 403 Egress Blocked/);
            assert.deepStrictEqual(dialled, []);
            await guard.close();
        }
    });

    await test('only ports 80 and 443', async () => {
        const dialled = [];
        const guard = egressGuard.create({ lookup: publicLookup, connect: recordingDialler(echo, dialled) });
        const url = await guard.urlFor(null);
        for (const target of ['example.com:22', 'example.com:8080', `${PUBLIC}:25`]) {
            assert.match((await connectThrough(url, target)).status, / 403 /, target);
        }
        assert.deepStrictEqual(dialled, []);
        await guard.close();
    });

    await test('a public name is dialled at exactly the address that was checked', async () => {
        const dialled = [];
        let lookups = 0;
        const guard = egressGuard.create({
            lookup: async () => { lookups++; return [{ address: '2606:2800:220:1::1', family: 6 }, { address: PUBLIC, family: 4 }]; },
            connect: recordingDialler(echo, dialled)
        });
        const { status, socket } = await connectThrough(await guard.urlFor(null), 'example.com:443');
        assert.match(status, / 200 /);
        assert.strictEqual(await roundTrip(socket, 'ping'), 'ping', 'the tunnel carries data');
        socket.destroy();
        assert.deepStrictEqual(dialled, [`${PUBLIC}:443`], 'IPv4 first, as FORCE_IPV4 asks');
        assert.strictEqual(lookups, 1, 'resolved once');

        const v6 = [];
        const guard6 = egressGuard.create({
            preferIPv4: false,
            lookup: async () => [{ address: '2606:2800:220:1::1', family: 6 }, { address: PUBLIC, family: 4 }],
            connect: recordingDialler(echo, v6)
        });
        const r6 = await connectThrough(await guard6.urlFor(null), 'example.com:443');
        r6.socket.destroy();
        assert.deepStrictEqual(v6, ['2606:2800:220:1::1:443'], 'without FORCE_IPV4, the first answer');
        await guard.close();
        await guard6.close();
    });

    await test('HTTP proxy upstream: it is only ever asked for the checked IP, with the owner\'s credentials', async () => {
        const proxy = await fakeHttpProxy(echo);
        servers.push(proxy.server);
        const guard = egressGuard.create({ lookup: publicLookup });
        const url = await guard.urlFor(`http://ham%40user:p%3Ass@127.0.0.1:${proxy.port}`);
        const { status, socket } = await connectThrough(url, 'media.example.com:443');
        assert.match(status, / 200 /);
        assert.strictEqual(await roundTrip(socket, 'via-proxy'), 'via-proxy');
        socket.destroy();
        assert.deepStrictEqual(proxy.seen, [{ line: `CONNECT ${PUBLIC}:443 HTTP/1.1`, auth: 'ham@user:p:ss' }]);
        await guard.close();
    });

    await test('SOCKS5 upstream: the destination is an IPv4 address (ATYP 1), never a name', async () => {
        const proxy = await fakeSocks5(echo);
        servers.push(proxy.server);
        const guard = egressGuard.create({ lookup: publicLookup });
        const url = await guard.urlFor(`socks5://u:pw@127.0.0.1:${proxy.port}`);
        const { status, socket } = await connectThrough(url, 'media.example.com:443');
        assert.match(status, / 200 /);
        assert.strictEqual(await roundTrip(socket, 'via-socks'), 'via-socks');
        socket.destroy();
        assert.deepStrictEqual(proxy.seen, [{ atyp: 1, address: PUBLIC, port: 443 }]);
        assert.strictEqual(proxy.auth, 'u:pw');
        await guard.close();
    });

    await test('a dead or refusing upstream answers 502 Upstream Proxy Failed', async () => {
        const guard = egressGuard.create({ lookup: publicLookup });
        const dead = await connectThrough(await guard.urlFor('http://127.0.0.1:9'), 'example.com:443');
        assert.match(dead.status, / 502 Upstream Proxy Failed/);
        const deadSocks = await connectThrough(await guard.urlFor('socks5://127.0.0.1:9'), 'example.com:443');
        assert.match(deadSocks.status, / 502 Upstream Proxy Failed/);

        const refusing = net.createServer(c => c.end('HTTP/1.1 403 Forbidden\r\n\r\n'));
        servers.push(refusing);
        await new Promise(resolve => refusing.listen(0, '127.0.0.1', resolve));
        const refused = await connectThrough(await guard.urlFor(`http://127.0.0.1:${refusing.address().port}`), 'example.com:443');
        assert.match(refused.status, / 502 Upstream Proxy Failed/);
        await guard.close();
    });

    await test('the owner\'s own endpoints (POT provider) are dialled directly, private or not', async () => {
        const saved = process.env.POT_PROVIDER_URL;
        process.env.POT_PROVIDER_URL = 'http://pot-provider:4416';
        try {
            assert.deepStrictEqual(egressGuard.ownerEndpoints(), ['pot-provider:4416']);
            const guard = egressGuard.create({ lookup: async () => { throw new Error('the owner\'s endpoint is not looked up'); } });
            const target = await guard.decide('pot-provider', 4416);
            assert.deepStrictEqual(target, { address: 'pot-provider', port: 4416, direct: true, family: 0 });
            await assert.rejects(guard.decide('pot-provider', 4417), /port/);
            await guard.close();
        } finally {
            if (saved === undefined) delete process.env.POT_PROVIDER_URL; else process.env.POT_PROVIDER_URL = saved;
        }

        // An allowlisted entry also bypasses the owner's proxy: it is local.
        const proxy = await fakeHttpProxy(echo);
        servers.push(proxy.server);
        const guard = egressGuard.create({ allow: [`127.0.0.1:${echo.port}`] });
        const { status, socket } = await connectThrough(await guard.urlFor(`http://127.0.0.1:${proxy.port}`), `127.0.0.1:${echo.port}`);
        assert.match(status, / 200 /);
        assert.strictEqual(await roundTrip(socket, 'local'), 'local');
        socket.destroy();
        assert.deepStrictEqual(proxy.seen, [], 'not sent through the upstream');
        await guard.close();
    });

    await test('plain http:// requests are checked the same way, and proxy credentials are not passed on', async () => {
        const origin = { headers: null };
        const web = http.createServer((req, res) => {
            origin.headers = req.headers;
            origin.url = req.url;
            res.setHeader('X-From', 'origin');
            res.end('hello');
        });
        servers.push(web);
        await new Promise(resolve => web.listen(0, '127.0.0.1', resolve));
        const dialled = [];
        const guard = egressGuard.create({
            lookup: publicLookup,
            connect: (o) => { dialled.push(`${o.host}:${o.port}`); return net.connect(web.address().port, '127.0.0.1'); }
        });
        const p = new URL(await guard.urlFor(null));
        const get = (target) => new Promise((resolve, reject) => {
            const req = http.request({
                host: '127.0.0.1', port: Number(p.port), method: 'GET', path: target,
                headers: { Host: new URL(target).host, 'Proxy-Authorization': `Basic ${Buffer.from(`${p.username}:${p.password}`).toString('base64')}` }
            }, res => {
                let body = '';
                res.on('data', d => { body += d; });
                res.on('end', () => resolve({ status: res.statusCode, message: res.statusMessage, headers: res.headers, body }));
            });
            req.on('error', reject);
            req.end();
        });

        const ok = await get('http://media.example.com/v.mp4?x=1');
        assert.strictEqual(ok.status, 200);
        assert.strictEqual(ok.body, 'hello');
        assert.strictEqual(ok.headers['x-from'], 'origin');
        assert.strictEqual(origin.url, '/v.mp4?x=1', 'origin-form request line');
        assert.strictEqual(origin.headers.host, 'media.example.com');
        assert.strictEqual(origin.headers['proxy-authorization'], undefined, 'the guard token stays with the guard');
        assert.deepStrictEqual(dialled, [`${PUBLIC}:80`]);

        const refused = await get('http://127.0.0.1/admin');
        assert.strictEqual(refused.status, 403);
        assert.strictEqual(refused.message, 'Egress Blocked');
        assert.strictEqual(dialled.length, 1);
        await guard.close();
    });

    await test('yt-dlp behind the guard gets no proxy settings from the environment (NO_PROXY would bypass it)', () => {
        const ytdlp = require('../utils/ytdlp');
        const env = ytdlp.withoutProxyEnv({
            PATH: '/bin', HOME: '/home/x', PYTHONPATH: '/p',
            NO_PROXY: '127.0.0.1', no_proxy: 'localhost', HTTP_PROXY: 'http://a', https_proxy: 'http://b',
            ALL_PROXY: 'socks5://c', Ftp_Proxy: 'http://d'
        });
        assert.deepStrictEqual(env, { PATH: '/bin', HOME: '/home/x', PYTHONPATH: '/p' });
        // Every format selector gets the protocol filter, merges included.
        assert.strictEqual(ytdlp.restrictProtocols('best[ext=mp4]/bestvideo+bestaudio'),
            "best[ext=mp4][protocol~='^(https?|m3u8(_native)?|http_dash_segments(_generator)?)$']/" +
            "bestvideo[protocol~='^(https?|m3u8(_native)?|http_dash_segments(_generator)?)$']+" +
            "bestaudio[protocol~='^(https?|m3u8(_native)?|http_dash_segments(_generator)?)$']");
        const audio = ytdlp.withProtocolFilter(['-x', '--audio-format', 'mp3']);
        assert.strictEqual(audio[0], '-f');
        assert.match(audio[1], /^bestaudio\[protocol~=.+\]\/best\[protocol~=.+\]$/, 'audio extraction gets an explicit, filtered format');
        assert.deepStrictEqual(audio.slice(2), ['-x', '--audio-format', 'mp3']);
        const video = ytdlp.withProtocolFilter(['-f', 'best', '--merge-output-format', 'mp4']);
        assert.match(video[1], /^best\[protocol~=/);
    });

    await test('a client that leaves while the guard is still dialling leaves no connection open', async () => {
        const target = { open: 0 };
        const slowServer = net.createServer(s => {
            target.open++;
            s.on('close', () => { target.open--; });
            s.on('error', () => {});
        });
        servers.push(slowServer);
        const port = await new Promise(resolve => slowServer.listen(0, '127.0.0.1', () => resolve(slowServer.address().port)));
        const guard = egressGuard.create({
            lookup: publicLookup,
            // Dials, but only after the client has already gone.
            connect: () => {
                const s = new net.Socket();
                setTimeout(() => s.connect(port, '127.0.0.1'), 300);
                return s;
            }
        });
        const p = new URL(await guard.urlFor(null));
        const auth = Buffer.from(`${p.username}:${p.password}`).toString('base64');
        const client = net.connect(Number(p.port), '127.0.0.1', () => {
            client.write(`CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\nProxy-Authorization: Basic ${auth}\r\n\r\n`);
            setTimeout(() => client.destroy(), 50);
        });
        client.on('error', () => {});
        await new Promise(resolve => setTimeout(resolve, 900));
        assert.strictEqual(target.open, 0, 'the dialled socket must be closed once nobody is on the other end');
        await guard.close();
    });

    await test('a plain-HTTP download the client abandons stops at the origin too', async () => {
        const origin = { closedAt: null };
        const endless = http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'video/mp4' });
            const chunk = Buffer.alloc(64 * 1024);
            const push = () => { while (!res.destroyed && res.write(chunk)); if (!res.destroyed) res.once('drain', push); };
            res.socket.on('close', () => { origin.closedAt = Date.now(); });
            push();
        });
        servers.push(endless);
        const port = await new Promise(resolve => endless.listen(0, '127.0.0.1', () => resolve(endless.address().port)));
        const guard = egressGuard.create({ lookup: publicLookup, connect: () => net.connect(port, '127.0.0.1') });
        const p = new URL(await guard.urlFor(null));
        let abortedAt = null;
        await new Promise((resolve) => {
            const req = http.request({
                host: '127.0.0.1', port: Number(p.port), path: 'http://media.example.com/big.mp4',
                headers: { Host: 'media.example.com', 'Proxy-Authorization': `Basic ${Buffer.from(`${p.username}:${p.password}`).toString('base64')}` }
            }, res => {
                res.once('data', () => { abortedAt = Date.now(); req.destroy(); resolve(); });
            });
            req.on('error', () => {});
            req.end();
        });
        await new Promise(resolve => setTimeout(resolve, 1000));
        assert.ok(origin.closedAt && origin.closedAt - abortedAt < 1000, 'the guard must stop reading from the origin');
        await guard.close();
    });

    await test('refusals are logged once per destination per minute, then with a count', async () => {
        const lines = [];
        let now = 1_000_000;
        const guard = egressGuard.create({ log: (e) => lines.push(e), now: () => now });
        const url = await guard.urlFor(null);
        for (let i = 0; i < 50; i++) {
            assert.match((await connectThrough(url, '127.0.0.1:443')).status, / 403 /);
        }
        assert.strictEqual(lines.length, 1, `one line for 50 refusals, got ${lines.length}`);
        now += 61 * 1000;
        await connectThrough(url, '127.0.0.1:443');
        assert.strictEqual(lines.length, 2);
        assert.strictEqual(lines[1].suppressed, 49, 'the next line says how many were not logged');
        await connectThrough(url, '10.0.0.1:443');
        assert.strictEqual(lines.length, 3, 'another destination is logged at once');
        await guard.close();
    });

    await test('one token per route, reused; a closed guard frees its port', async () => {
        const guard = egressGuard.create({ lookup: publicLookup });
        const direct = await guard.urlFor(null);
        assert.strictEqual(await guard.urlFor(null), direct);
        assert.notStrictEqual(await guard.urlFor('http://127.0.0.1:9'), direct);
        const port = Number(new URL(direct).port);
        await guard.close();
        await assert.rejects(new Promise((resolve, reject) => {
            const s = net.connect(port, '127.0.0.1', () => { s.destroy(); resolve(); });
            s.on('error', reject);
        }));
    });

    for (const s of servers) s.close();

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
