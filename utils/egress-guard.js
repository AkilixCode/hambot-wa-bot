/**
 * Egress guard: where yt-dlp may connect
 *
 * `.video` and `.music` check a user's URL before handing it to yt-dlp
 * (security.resolvesToPublicHost), but yt-dlp then resolves names itself,
 * follows redirects, and fetches whatever playlists and segments the media
 * names. A redirect, a DNS answer that changes between our check and its
 * fetch, or an HLS/DASH manifest listing internal addresses all reached the
 * bot's own network: localhost, the LAN, Docker services, cloud metadata.
 *
 * So yt-dlp is given this as its proxy, for every run and on every route.
 * For each connection it:
 *   1. accepts only its own per-route token (no open relay for other local
 *      programs, which would also spend the owner's proxy credentials);
 *   2. allows ports 80 and 443 only;
 *   3. resolves the name once and refuses if any answer is not a public
 *      address (security.isPrivateAddress: the IANA special-purpose ranges);
 *   4. dials the address it checked, never the name again, either
 *      directly or through the owner's proxy by IP: `CONNECT <ip>:<port>`
 *      for HTTP(S) proxies, an IP destination for SOCKS.
 *
 * Refusals answer `403 Egress Blocked`; a proxy that cannot be reached or
 * refuses answers `502 Upstream Proxy Failed`, which utils/ytdlp counts as a
 * proxy failure exactly like before (circuit breaker, direct fallback).
 *
 * Exceptions, dialled directly: addresses the owner configured, which are
 * private on purpose. Today that is the PO token provider (POT_PROVIDER_URL),
 * which yt-dlp's plugin calls through this proxy.
 *
 * What it cannot see: beyond an upstream proxy. The provider receives only a
 * public IP the bot approved; it is trusted to route that to the internet.
 */

const crypto = require('crypto');
const dns = require('dns').promises;
const http = require('http');
const net = require('net');
const tls = require('tls');
const security = require('./security');
const logger = require('./logger');

const ALLOWED_PORTS = new Set([80, 443]);
const CONNECT_TIMEOUT_MS = 15 * 1000;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const LOG_WINDOW_MS = 60 * 1000;

/** A refusal, with the status line the client sees. */
class EgressRefused extends Error {
    constructor(status, reason) {
        super(reason);
        this.status = status;
    }
}

const blocked = (reason) => new EgressRefused('403 Egress Blocked', reason);
const upstreamFailed = (reason) => new EgressRefused('502 Upstream Proxy Failed', reason);

/**
 * `host:port` → { host, port } (IPv6 in brackets).
 * @returns {{host: string, port: number}|null}
 */
function splitHostPort(value) {
    const m = /^\[([^\]]+)\]:(\d+)$/.exec(value) || /^([^:]+):(\d+)$/.exec(value);
    if (!m) return null;
    const port = Number(m[2]);
    if (!port || port > 65535) return null;
    return { host: m[1].toLowerCase().replace(/\.$/, ''), port };
}

/** `host:port` key for the allowlist. */
function key(host, port) {
    return `${String(host).toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')}:${port}`;
}

/**
 * The owner's own endpoints yt-dlp reaches through the guard, as allowlist
 * keys. Private on purpose (a Docker service, the LAN), so never checked.
 * @param {Object} [env=process.env]
 * @returns {string[]}
 */
function ownerEndpoints(env = process.env) {
    const out = [];
    const pot = String(env.POT_PROVIDER_URL || '').trim();
    if (pot) {
        try {
            const u = new URL(pot);
            out.push(key(u.hostname, u.port || (u.protocol === 'https:' ? 443 : 80)));
        } catch {
            // not a URL: yt-dlp cannot use it either
        }
    }
    return out;
}

/**
 * @param {Object} [opts]
 * @param {string[]} [opts.allow] - Extra `host:port` entries dialled directly (tests)
 * @param {Function} [opts.lookup] - dns.promises.lookup stand-in (tests)
 * @param {Function} [opts.connect] - net.connect stand-in for direct dials (tests)
 * @param {boolean|Function} [opts.preferIPv4=true]
 * @param {Function} [opts.log=logger.net] - Where refusals are reported (tests)
 * @param {Function} [opts.now=Date.now] - Clock for the log rate limit (tests)
 */
function create(opts = {}) {
    const lookup = opts.lookup || ((host) => dns.lookup(host, { all: true, verbatim: true }));
    const dialDirect = opts.connect || ((o) => net.connect(o));
    const log = opts.log || ((event) => logger.net(event));
    const now = opts.now || Date.now;
    // destination + reason → { at, suppressed }, for report()
    const logged = new Map();
    const preferIPv4 = typeof opts.preferIPv4 === 'function' ? opts.preferIPv4 : () => opts.preferIPv4 !== false;
    const extraAllow = new Set((opts.allow || []).map(entry => {
        const hp = splitHostPort(entry);
        return hp ? key(hp.host, hp.port) : null;
    }).filter(Boolean));

    // token → upstream proxy URL (or null for direct). One server, any route.
    const routes = new Map();
    let server = null;
    let listening = null;

    function allowed() {
        return new Set([...extraAllow, ...ownerEndpoints()]);
    }

    function routeFor(req) {
        const header = req.headers['proxy-authorization'] || '';
        const m = /^Basic\s+(.+)$/i.exec(header);
        if (!m) return undefined;
        const [, token] = Buffer.from(m[1], 'base64').toString('utf8').split(':');
        return routes.has(token) ? routes.get(token) : undefined;
    }

    /**
     * Decide where a connection may go.
     * @returns {Promise<{address: string, port: number, direct: boolean, family: number}>}
     */
    async function decide(host, port) {
        if (allowed().has(key(host, port))) return { address: host, port, direct: true, family: net.isIP(host) };
        if (!ALLOWED_PORTS.has(port)) throw blocked(`port ${port}`);
        if (security.isPrivateHostname(net.isIP(host) === 6 ? `[${host}]` : host)) throw blocked('private address');

        let answers;
        if (net.isIP(host)) {
            answers = [{ address: host, family: net.isIP(host) }];
        } else {
            try {
                answers = await lookup(host);
            } catch (error) {
                throw new EgressRefused('502 Name Not Resolved', `dns ${error.code || error.message}`);
            }
        }
        if (!answers.length || answers.some(a => security.isPrivateAddress(a.address))) throw blocked('private address');
        const pick = (preferIPv4() && answers.find(a => a.family === 4)) || answers[0];
        return { address: pick.address, port, direct: false, family: pick.family };
    }

    /** Open a socket to the checked address, directly or through the upstream. */
    async function dial(target, upstream) {
        if (target.direct || !upstream) return connectDirect(target.address, target.port);
        return /^socks/i.test(upstream) ? connectSocks(upstream, target) : connectHttpProxy(upstream, target);
    }

    function connectDirect(host, port) {
        return new Promise((resolve, reject) => {
            const socket = dialDirect({ host, port });
            const timer = setTimeout(() => socket.destroy(new Error('connect timeout')), CONNECT_TIMEOUT_MS);
            socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
            socket.once('error', (error) => { clearTimeout(timer); reject(new EgressRefused('504 Destination Unreachable', error.code || error.message)); });
        });
    }

    function connectHttpProxy(upstream, target) {
        return new Promise((resolve, reject) => {
            let u;
            try {
                u = new URL(upstream);
            } catch {
                return reject(upstreamFailed('bad proxy URL'));
            }
            const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
            const socket = u.protocol === 'https:'
                ? tls.connect({ host: u.hostname, port, servername: net.isIP(u.hostname) ? undefined : u.hostname })
                : net.connect({ host: u.hostname, port });
            const fail = (why) => { socket.destroy(); reject(upstreamFailed(why)); };
            const timer = setTimeout(() => fail('timeout'), CONNECT_TIMEOUT_MS);
            socket.once('error', (error) => { clearTimeout(timer); reject(upstreamFailed(error.code || error.message)); });
            socket.once(u.protocol === 'https:' ? 'secureConnect' : 'connect', () => {
                // The IP we checked, never the name: the proxy cannot resolve
                // it differently.
                const dest = target.family === 6 ? `[${target.address}]:${target.port}` : `${target.address}:${target.port}`;
                const lines = [`CONNECT ${dest} HTTP/1.1`, `Host: ${dest}`];
                if (u.username) {
                    const creds = `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`;
                    lines.push(`Proxy-Authorization: Basic ${Buffer.from(creds).toString('base64')}`);
                }
                socket.write(`${lines.join('\r\n')}\r\n\r\n`);
                let buf = Buffer.alloc(0);
                const onData = (chunk) => {
                    buf = Buffer.concat([buf, chunk]);
                    const end = buf.indexOf('\r\n\r\n');
                    if (end === -1) {
                        if (buf.length > 16 * 1024) { clearTimeout(timer); fail('oversized reply'); }
                        return;
                    }
                    socket.removeListener('data', onData);
                    clearTimeout(timer);
                    const status = /^HTTP\/1\.[01] (\d{3})/.exec(buf.toString('latin1', 0, end));
                    if (!status || status[1] !== '200') return fail(`proxy answered ${status ? status[1] : '?'}`);
                    const rest = buf.subarray(end + 4);
                    if (rest.length) socket.unshift(rest);
                    resolve(socket);
                };
                socket.on('data', onData);
            });
        });
    }

    async function connectSocks(upstream, target) {
        let u;
        try {
            u = new URL(upstream);
        } catch {
            throw upstreamFailed('bad proxy URL');
        }
        const { SocksClient } = require('socks');
        try {
            const { socket } = await SocksClient.createConnection({
                proxy: {
                    host: u.hostname,
                    port: Number(u.port) || 1080,
                    type: /^socks4/i.test(u.protocol) ? 4 : 5,
                    userId: u.username ? decodeURIComponent(u.username) : undefined,
                    password: u.password ? decodeURIComponent(u.password) : undefined
                },
                command: 'connect',
                // An IP destination, never a name.
                destination: { host: target.address, port: target.port },
                timeout: CONNECT_TIMEOUT_MS
            });
            return socket;
        } catch (error) {
            throw upstreamFailed(error.message);
        }
    }

    /**
     * Log a refusal: once per destination per minute. A hostile playlist can
     * list thousands of internal segments, and yt-dlp tries each one; the
     * next line after a quiet minute says how many were not logged.
     */
    function report(host, port, error) {
        const id = `${key(host, port)} ${error.message}`;
        const seen = logged.get(id);
        const at = now();
        if (seen && at - seen.at < LOG_WINDOW_MS) {
            seen.suppressed++;
            return;
        }
        logged.set(id, { at, suppressed: 0 });
        if (logged.size > 500) logged.delete(logged.keys().next().value);
        log({ type: 'egress', host, port, reason: error.message, status: error.status, suppressed: seen ? seen.suppressed : 0, problem: true });
    }

    function pipeBoth(a, b) {
        for (const s of [a, b]) {
            s.setTimeout(IDLE_TIMEOUT_MS, () => s.destroy());
            s.on('error', () => { a.destroy(); b.destroy(); });
            s.on('close', () => { a.destroy(); b.destroy(); });
        }
        a.pipe(b);
        b.pipe(a);
    }

    async function onConnect(req, clientSocket, head) {
        clientSocket.on('error', () => {});
        const upstream = routeFor(req);
        if (upstream === undefined) {
            clientSocket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="hambot"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
            return;
        }
        const hp = splitHostPort(req.url);
        if (!hp) {
            clientSocket.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
            return;
        }
        try {
            const target = await decide(hp.host, hp.port);
            const socket = await dial(target, upstream);
            // yt-dlp left while we resolved and dialled: nobody to tunnel for.
            if (clientSocket.destroyed) {
                socket.destroy();
                return;
            }
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head && head.length) socket.write(head);
            pipeBoth(clientSocket, socket);
        } catch (error) {
            const status = error instanceof EgressRefused ? error.status : '502 Upstream Proxy Failed';
            report(hp.host, hp.port, error instanceof EgressRefused ? error : upstreamFailed(error.message));
            clientSocket.end(`HTTP/1.1 ${status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
        }
    }

    async function onRequest(req, res) {
        const upstream = routeFor(req);
        if (upstream === undefined) {
            res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="hambot"', Connection: 'close' });
            return res.end();
        }
        let url;
        try {
            url = new URL(req.url);
        } catch {
            url = null;
        }
        if (!url || url.protocol !== 'http:') {
            res.writeHead(400, { Connection: 'close' });
            return res.end();
        }
        const port = Number(url.port) || 80;
        const host = url.hostname.replace(/^\[|\]$/g, '');
        try {
            const target = await decide(host, port);
            const socket = await dial(target, upstream);
            const headers = [];
            for (let i = 0; i < req.rawHeaders.length; i += 2) {
                const name = req.rawHeaders[i];
                if (/^(proxy-authorization|proxy-connection|connection|keep-alive)$/i.test(name)) continue;
                headers.push(name, req.rawHeaders[i + 1]);
            }
            headers.push('Connection', 'close');
            const out = http.request({
                method: req.method,
                path: `${url.pathname}${url.search}`,
                headers,
                setHost: false,
                createConnection: () => socket
            });
            out.on('response', (r) => {
                const raw = [];
                for (let i = 0; i < r.rawHeaders.length; i += 2) {
                    if (/^(connection|keep-alive|transfer-encoding)$/i.test(r.rawHeaders[i])) continue;
                    raw.push(r.rawHeaders[i], r.rawHeaders[i + 1]);
                }
                res.writeHead(r.statusCode, r.statusMessage, raw);
                r.pipe(res);
            });
            out.on('error', () => res.destroy());
            // yt-dlp gave up (--max-filesize, its timeout, a cancel): stop
            // reading from the origin too, instead of draining the rest of
            // the file into nowhere.
            res.on('close', () => {
                if (!res.writableFinished) {
                    out.destroy();
                    socket.destroy();
                }
            });
            req.pipe(out);
        } catch (error) {
            const refused = error instanceof EgressRefused ? error : upstreamFailed(error.message);
            report(host, port, refused);
            const [code, ...text] = refused.status.split(' ');
            res.writeHead(Number(code), text.join(' '), { Connection: 'close', 'Content-Length': 0 });
            res.end();
        }
    }

    function start() {
        if (listening) return listening;
        server = http.createServer(onRequest);
        server.on('connect', onConnect);
        server.on('clientError', (error, socket) => socket.destroy());
        listening = new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => {
                server.unref();
                resolve(server.address().port);
            });
        }).catch((error) => {
            listening = null;
            throw error;
        });
        return listening;
    }

    /**
     * The proxy URL to give yt-dlp for this route.
     * @param {string|null} upstream - The owner's proxy URL, or null for direct
     * @returns {Promise<string>}
     */
    async function urlFor(upstream = null) {
        const port = await start();
        let token = null;
        for (const [t, u] of routes) if (u === upstream) token = t;
        if (!token) {
            token = crypto.randomBytes(18).toString('base64url');
            routes.set(token, upstream);
        }
        return `http://hambot:${token}@127.0.0.1:${port}`;
    }

    function close() {
        routes.clear();
        if (!server) return Promise.resolve();
        const s = server;
        server = null;
        listening = null;
        return new Promise(resolve => {
            if (typeof s.closeAllConnections === 'function') s.closeAllConnections();
            s.close(() => resolve());
        });
    }

    return { urlFor, close, decide };
}

module.exports = { create, ownerEndpoints, ALLOWED_PORTS };
