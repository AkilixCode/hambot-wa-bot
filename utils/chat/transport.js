/**
 * AI Chat Transport
 *
 * One HTTP request to an AI backend, with the two timers that decide whether
 * it is alive:
 *
 *   response timeout  nothing at all (no headers) within N seconds
 *   idle timeout      a stream that went quiet for N seconds mid-answer
 *
 * There is deliberately no total-time limit. Every byte that arrives — answer
 * text, reasoning tokens, an agent's tool-progress event, an SSE keep-alive
 * comment, a ping — restarts the idle timer, so a model that thinks for five
 * minutes or an agent that works for twenty is an *active* session, not a
 * timeout. CHAT_MAX_ACTIVE_MIN adds an optional hard cap.
 *
 * Also enforced here, for every wire format:
 *   - redirects are never followed (a 3xx could carry the key elsewhere)
 *   - responses are size-capped
 *   - one keep-alive agent per backend, so sockets are reused
 *   - an abort (`.chat stop`, shutdown) or a timer closes the socket at once
 *
 * Errors carry a `code` the client maps to a kind:
 *   ENORESPONSE  no response within the response timeout
 *   EIDLE        went silent mid-stream
 *   EMAXACTIVE   CHAT_MAX_ACTIVE_MIN reached
 *   EABORTED     cancelled
 *   ETOOLARGE    response over the size cap
 * plus Node's own (ECONNREFUSED, ENOTFOUND, ECONNRESET, …), and `sent`
 * (whether the request body was fully written) so the caller knows if an
 * agent may already have started working.
 */

const http = require('http');
const https = require('https');
const { Readable, Transform } = require('stream');

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_ERROR_BODY_BYTES = 64 * 1024;

/** @type {Map<string, {httpAgent: Object, httpsAgent: Object}>} */
const agentCache = new Map();

/**
 * An error raised by a timer or an abort.
 * @param {string} code
 * @param {string} message
 * @returns {Error}
 */
function transportError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

/**
 * Keep-alive agents for a backend. Cached per backend and settings, so
 * consecutive questions reuse the open connection instead of a new TCP+TLS
 * handshake each time.
 * @param {Object} backend - From settings
 * @param {Object} opts
 * @param {number} opts.maxSockets
 * @param {boolean} opts.forceIPv4
 * @returns {{httpAgent: Object, httpsAgent: Object}}
 */
function agentsFor(backend, { maxSockets, forceIPv4 }) {
    if (backend.useProxy) {
        // The residential proxy only for a provider that asked for it.
        // Lazily required: http-client pulls in the whole proxy stack.
        try {
            const httpClient = require('../http-client');
            if (httpClient.isProxyEnabled()) {
                const proxied = httpClient.getAgents('proxy');
                if (proxied) return proxied;
            }
        } catch {
            // fall through to direct
        }
    }

    const family = forceIPv4 ? 4 : 0;
    const key = `${backend.id}:${family}:${maxSockets}`;
    if (!agentCache.has(key)) {
        const options = { keepAlive: true, maxSockets: maxSockets + 1, family };
        agentCache.set(key, {
            httpAgent: new http.Agent(options),
            httpsAgent: new https.Agent(options)
        });
    }
    return agentCache.get(key);
}

/** Close every pooled connection (shutdown, tests). */
function destroyAgents() {
    for (const { httpAgent, httpsAgent } of agentCache.values()) {
        httpAgent.destroy();
        httpsAgent.destroy();
    }
    agentCache.clear();
}

/**
 * Open a request and resolve once the response headers arrive.
 *
 * @param {Object} opts
 * @param {string|URL} opts.url
 * @param {string} [opts.method]
 * @param {Object} [opts.headers]
 * @param {string|Buffer} [opts.body]
 * @param {{httpAgent: Object, httpsAgent: Object}} [opts.agents]
 * @param {AbortSignal} [opts.signal]
 * @param {number} opts.responseTimeoutMs
 * @param {number} opts.idleTimeoutMs
 * @param {number|null} [opts.maxActiveMs]
 * @param {Function} [opts.onActivity] - Called with each chunk
 * @param {Function} [opts.onFail] - Called with the error that ended it
 * @param {number} [opts.maxBytes]
 * @returns {Promise<{status: number, headers: Object, body: Readable, sent: boolean, firstByteMs: number}>}
 */
function open(opts) {
    const url = opts.url instanceof URL ? opts.url : new URL(opts.url);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const agents = opts.agents || {};
    const maxBytes = opts.maxBytes || MAX_RESPONSE_BYTES;
    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
        let settled = false;
        let finished = false;
        let response = null;
        let sent = false;
        let bytes = 0;
        let responseTimer = null;
        let idleTimer = null;
        let activeTimer = null;

        const clearTimers = () => {
            clearTimeout(responseTimer);
            clearTimeout(idleTimer);
            clearTimeout(activeTimer);
        };

        const fail = (error) => {
            if (finished) return;
            finished = true;
            clearTimers();
            if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
            error.sent = sent;
            if (opts.onFail) opts.onFail(error);
            if (!settled) {
                settled = true;
                req.destroy();
                reject(error);
            } else {
                if (response) response.destroy(error);
                req.destroy();
            }
        };

        const onAbort = () => {
            const reason = opts.signal.reason;
            const error = transportError('EABORTED', typeof reason === 'string' ? reason : 'cancelled');
            if (reason && typeof reason === 'object' && reason.code) error.code = reason.code;
            fail(error);
        };

        const armIdle = () => {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => fail(transportError(
                'EIDLE', `no data for ${Math.round(opts.idleTimeoutMs / 1000)}s`
            )), opts.idleTimeoutMs);
        };

        const headers = { ...(opts.headers || {}) };
        if (opts.body !== undefined && opts.body !== null && headers['content-length'] === undefined) {
            headers['content-length'] = Buffer.byteLength(opts.body);
        }

        const req = lib.request(url, {
            method: opts.method || 'POST',
            headers,
            agent: isHttps ? agents.httpsAgent : agents.httpAgent
        });

        responseTimer = setTimeout(() => fail(transportError(
            'ENORESPONSE', `no response within ${Math.round(opts.responseTimeoutMs / 1000)}s`
        )), opts.responseTimeoutMs);

        if (opts.maxActiveMs) {
            activeTimer = setTimeout(() => fail(transportError(
                'EMAXACTIVE', `still running after ${Math.round(opts.maxActiveMs / 60000)} min (CHAT_MAX_ACTIVE_MIN)`
            )), opts.maxActiveMs);
        }

        if (opts.signal) {
            if (opts.signal.aborted) {
                // Defer so `req` exists for fail() to destroy.
                setImmediate(onAbort);
            } else {
                opts.signal.addEventListener('abort', onAbort, { once: true });
            }
        }

        req.on('finish', () => { sent = true; });
        req.on('error', (error) => fail(error));

        req.on('response', (res) => {
            clearTimeout(responseTimer);
            armIdle();
            const firstByteMs = Date.now() - startedAt;

            // Every chunk passes through here on its way to the parser, so
            // the idle timer sees exactly what the reader sees. (A 'data'
            // listener on `res` would switch it to flowing mode and drop
            // whatever arrived before the reader attached.)
            const tap = new Transform({
                transform(chunk, encoding, callback) {
                    bytes += chunk.length;
                    if (bytes > maxBytes) {
                        callback();
                        fail(transportError('ETOOLARGE', `response larger than ${Math.round(maxBytes / 1048576)} MB`));
                        return;
                    }
                    armIdle();
                    if (opts.onActivity) {
                        try {
                            opts.onActivity(chunk);
                        } catch {
                            // a progress callback must never break the request
                        }
                    }
                    callback(null, chunk);
                }
            });
            response = tap;

            res.on('end', () => {
                finished = true;
                clearTimers();
                if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
            });
            res.on('error', (error) => {
                if (!finished) fail(error);
            });
            res.on('aborted', () => {
                if (!finished) fail(transportError('ECONNRESET', 'connection closed mid-answer'));
            });
            tap.on('close', () => {
                if (res.complete || finished) return;
                // The reader stopped early ([DONE] seen, or an error). Drain
                // the little that is left so the keep-alive socket can be
                // reused, but never for long.
                finished = true;
                clearTimers();
                if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
                res.unpipe(tap);
                const drain = setTimeout(() => res.destroy(), 2000);
                if (drain.unref) drain.unref();
                res.on('end', () => clearTimeout(drain));
                res.on('close', () => clearTimeout(drain));
                res.resume();
            });
            res.pipe(tap);

            settled = true;
            resolve({
                status: res.statusCode,
                headers: res.headers,
                body: tap,
                sent: true,
                firstByteMs
            });
        });

        if (opts.body !== undefined && opts.body !== null) req.write(opts.body);
        req.end();
    });
}

/**
 * Read a whole (small) body, e.g. an error response or a model list.
 * @param {Readable} body
 * @param {number} [limit]
 * @returns {Promise<string>}
 */
async function readText(body, limit = MAX_ERROR_BODY_BYTES) {
    const chunks = [];
    let size = 0;
    for await (const chunk of body) {
        if (size < limit) {
            chunks.push(chunk);
            size += chunk.length;
        }
    }
    return Buffer.concat(chunks).toString('utf8').slice(0, limit);
}

/**
 * Split a byte stream into lines.
 * @param {Readable} body
 */
async function* lines(body) {
    let buffer = '';
    for await (const chunk of body) {
        buffer += chunk.toString('utf8');
        let index;
        while ((index = buffer.indexOf('\n')) !== -1) {
            yield buffer.slice(0, index).replace(/\r$/, '');
            buffer = buffer.slice(index + 1);
        }
    }
    if (buffer) yield buffer.replace(/\r$/, '');
}

/**
 * Server-sent events: yields { event, data } per event and { comment } for
 * keep-alive comments.
 * @param {Readable} body
 */
async function* sse(body) {
    let event = '';
    let data = [];
    for await (const line of lines(body)) {
        if (line === '') {
            if (data.length) yield { event: event || 'message', data: data.join('\n') };
            event = '';
            data = [];
            continue;
        }
        if (line.startsWith(':')) {
            yield { comment: line.slice(1).trim() };
            continue;
        }
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
    }
    if (data.length) yield { event: event || 'message', data: data.join('\n') };
}

/**
 * A fetch() for SDKs (the Anthropic SDK takes one), built on open() so the
 * SDK's requests get the same timers, redirect refusal, agents and abort
 * handling as everything else.
 * @param {Object} defaults - open() options minus url/method/headers/body
 * @returns {Function}
 */
function makeFetch(defaults) {
    return async (input, init = {}) => {
        const url = typeof input === 'string' ? input : (input.url || String(input));
        const headers = {};
        const rawHeaders = init.headers || {};
        if (typeof rawHeaders.forEach === 'function' && !Array.isArray(rawHeaders)) {
            rawHeaders.forEach((value, name) => { headers[name.toLowerCase()] = value; });
        } else if (Array.isArray(rawHeaders)) {
            for (const [name, value] of rawHeaders) headers[name.toLowerCase()] = value;
        } else {
            for (const [name, value] of Object.entries(rawHeaders)) {
                if (value !== undefined && value !== null) headers[name.toLowerCase()] = String(value);
            }
        }

        let body = init.body;
        if (body instanceof Uint8Array) body = Buffer.from(body);
        else if (body !== undefined && body !== null && typeof body !== 'string' && !Buffer.isBuffer(body)) {
            body = String(body);
        }

        // Both the SDK's own signal and ours may cancel the request.
        const signals = [init.signal, defaults.signal].filter(Boolean);
        const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];

        const res = await open({ ...defaults, url, method: init.method || 'GET', headers, body, signal });

        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
            if (Array.isArray(value)) value.forEach(v => responseHeaders.append(name, v));
            else if (value !== undefined) responseHeaders.set(name, String(value));
        }
        const empty = res.status === 204 || res.status === 304 || (init.method || 'GET') === 'HEAD';
        if (empty) res.body.resume();
        return new Response(empty ? null : Readable.toWeb(res.body), {
            status: res.status,
            headers: responseHeaders
        });
    };
}

module.exports = {
    open,
    readText,
    lines,
    sse,
    makeFetch,
    agentsFor,
    destroyAgents,
    transportError,
    MAX_RESPONSE_BYTES
};
