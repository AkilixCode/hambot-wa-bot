/**
 * HTTP Client — the bot's single way out to the network
 *
 * Every command that fetches content (pinterest, meme, weather, wiki, …) goes
 * through get/post/head here. This module decides, per request:
 *
 *   ROUTE     proxy or direct. The proxy (usually the owner's phone over
 *             Tailscale) is used when `.security proxy on`; if it is known to
 *             be down — its circuit breaker is open — requests go direct at
 *             once instead of each waiting out a timeout first.
 *
 *   TRANSPORT Shared keep-alive agents. For HTTP proxies that means a real
 *             CONNECT tunnel (https-proxy-agent): axios's own `proxy` option
 *             sends HTTPS requests to the proxy in a form most proxies, and
 *             EveryProxy in particular, do not handle — and nearly every
 *             target this bot talks to is HTTPS.
 *
 *   RETRIES   GET/HEAD are retried on resets, timeouts, DNS hiccups and
 *             408/429/5xx, with jittered backoff and Retry-After honoured.
 *             POST is never retried unless the caller asks. An overall
 *             deadline keeps retries from running far past the timeout the
 *             caller chose.
 *
 *   FALLBACK  Only a fault of the proxy itself (refused, unreachable, did
 *             not answer the handshake, rejected the CONNECT) switches a
 *             request to direct. A slow or failing *target* does not: going
 *             direct would just repeat the wait from the datacenter IP the
 *             proxy exists to hide.
 *
 *   LOGGING   Each problem — a retry, a final failure, a fallback — is one
 *             compact line via logger.net(), visible in the default log mode
 *             and tagged with the command that caused it.
 *
 * Extra request options understood here (stripped before axios sees them):
 *   retry     number of extra attempts, or false for none
 *   deadline  ms ceiling across all attempts (default: 2 × timeout)
 *   netLog    false to keep an expected failure (a probe) out of the logs
 */

const http = require('http');
const https = require('https');
const axios = require('axios');
const config = require('../config');
const logger = require('./logger');
const providers = require('./providers');
const { classify, isConnectionError } = require('./net-errors');

// Circuit breaker id for the proxy itself, shared with utils/ytdlp so both
// HTTP and yt-dlp learn from each other's proxy failures.
const PROXY_BREAKER_ID = 'egress:proxy';

const DEFAULT_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

// Retry pacing. Backoff doubles per attempt up to the cap, with jitter so a
// burst of failed requests does not retry in lockstep.
const BACKOFF_BASE_MS = 300;
const BACKOFF_CAP_MS = 4000;
// A Retry-After longer than this is not worth waiting for inside a chat
// command; the request fails and the provider cascade moves on.
const MAX_RETRY_AFTER_MS = 5000;
// Don't start an attempt with less time than this left before the deadline.
const MIN_ATTEMPT_MS = 1000;
// How often "proxy is paused, going direct" may be logged.
const SKIP_NOTICE_INTERVAL_MS = 60 * 1000;

// SOCKS5 replies that mean the proxy worked but the *target* could not be
// reached. Anything else from the SOCKS layer is the proxy's fault.
const SOCKS_TARGET_REPLIES = {
    HostUnreachable: 'EHOSTUNREACH',
    NetworkUnreachable: 'ENETUNREACH',
    ConnectionRefused: 'ECONNREFUSED',
    TTLExpired: 'ETIMEDOUT'
};

/** @type {Map<string, {httpAgent: Object, httpsAgent: Object}>} */
const agentCache = new Map();
const missingModuleWarned = new Set();
let lastSkipNotice = 0;

// ─────────────────────────────────────────────────────
//  PROXY HELPERS
// ─────────────────────────────────────────────────────

/**
 * Check if proxy is configured and enabled
 * @returns {boolean}
 */
function isProxyEnabled() {
    return Boolean(config.proxy.enabled && config.proxy.host && config.proxy.port);
}

/**
 * The proxy URL to use. One source for everything — config.getProxyUrl() —
 * so axios and yt-dlp can never leave through different proxies.
 * @param {boolean} [force] - Ignore the on/off toggle (egress probe)
 * @returns {string|null}
 */
function resolveProxyUrl(force = false) {
    if (force) return config.proxy.url || config.media.proxyUrl || null;
    return config.getProxyUrl();
}

/**
 * host:port of the proxy, for log lines. Never includes credentials.
 * @param {string} [url]
 * @returns {string}
 */
function proxyLabel(url = resolveProxyUrl(true)) {
    try {
        const u = new URL(url);
        return u.port ? `${u.hostname}:${u.port}` : u.hostname;
    } catch {
        return config.proxy.host ? `${config.proxy.host}:${config.proxy.port}` : 'proxy';
    }
}

/**
 * Require a proxy agent class, warning once if the package is missing.
 * @param {string} name - npm package
 * @param {string} exportName
 * @returns {Function|null}
 */
function loadAgentClass(name, exportName) {
    try {
        return require(name)[exportName];
    } catch {
        if (!missingModuleWarned.has(name)) {
            missingModuleWarned.add(name);
            logger.system(`${name} is not installed — the proxy cannot be used. Run: npm install`);
        }
        return null;
    }
}

/**
 * Build an error that marks a proxy-stage failure.
 * @param {string} message
 * @param {Object} props - code, proxyFault, proxyStatus
 * @param {Error} [cause]
 * @returns {Error}
 */
function proxyError(message, props, cause) {
    const error = new Error(message, cause ? { cause } : undefined);
    Object.assign(error, props);
    return error;
}

/**
 * Wrap a proxy agent's connect() so that every failure while talking to the
 * proxy is labelled (`proxyFault`), and so a proxy that never answers is cut
 * off after proxyConnectTimeout.
 *
 * The timeout is not optional: axios starts its own timer only once a socket
 * exists, and with a proxy agent the socket exists only after the proxy
 * handshake — so a proxy that accepted the TCP connection and then went
 * silent used to hang a request for minutes.
 *
 * @param {Object} agent - HttpsProxyAgent or SocksProxyAgent
 * @param {'http'|'socks'} kind
 * @returns {Object} the same agent
 */
function guardProxyAgent(agent, kind) {
    const connect = agent.connect.bind(agent);
    // One short-lived 'proxyConnect' listener per in-flight handshake; a
    // burst of parallel downloads must not trip the max-listeners warning.
    agent.setMaxListeners(0);

    agent.connect = async (req, opts) => {
        const timeoutMs = config.network.proxyConnectTimeout;
        let connectStatus = null;
        const onProxyConnect = (response, forReq) => {
            if (forReq === req) connectStatus = response.statusCode;
        };
        if (kind === 'http') agent.on('proxyConnect', onProxyConnect);

        let timer;
        const pending = connect(req, opts);
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => {
                // The handshake may still complete later; don't leak that socket.
                pending.then(socket => socket && socket.destroy && socket.destroy(), () => {});
                reject(proxyError(`Proxy did not answer within ${timeoutMs}ms`, {
                    code: 'ETIMEDOUT',
                    proxyFault: true
                }));
            }, timeoutMs);
        });

        try {
            const socket = await Promise.race([pending, timeout]);

            // https-proxy-agent hands a refused CONNECT back as a fake HTTP
            // response, which would look like the *target* answered 407/502.
            // Turn it into an error that says where it came from.
            if (kind === 'http' && connectStatus !== null && connectStatus !== 200) {
                socket.destroy();
                // 5xx: the proxy is up but could not reach the target.
                // Anything else (407 auth, 403 policy): the proxy refused us.
                throw proxyError(`Proxy refused CONNECT (HTTP ${connectStatus})`, {
                    code: 'EPROXYCONNECT',
                    proxyStatus: connectStatus,
                    proxyFault: connectStatus < 500
                });
            }
            return socket;
        } catch (error) {
            if (error.proxyFault !== undefined) throw error;
            throw labelProxyFailure(error, kind, opts);
        } finally {
            clearTimeout(timer);
            if (kind === 'http') agent.off('proxyConnect', onProxyConnect);
        }
    };

    return agent;
}

/**
 * Decide whether an error from inside a proxy agent is the proxy's fault.
 * @param {Error} error
 * @param {'http'|'socks'} kind
 * @param {Object} opts - Agent connect options (target host/port)
 * @returns {Error} The error, annotated
 */
function labelProxyFailure(error, kind, opts) {
    if (kind === 'socks') {
        // socks5:// resolves the target name locally first; that failing is
        // a DNS problem with the target, not the proxy.
        if (error.hostname && opts && error.hostname === opts.host) {
            error.proxyFault = false;
            return error;
        }
        const reply = /rejected connection - (\w+)/.exec(error.message || '');
        if (reply && SOCKS_TARGET_REPLIES[reply[1]]) {
            error.proxyFault = false;
            if (!error.code) error.code = SOCKS_TARGET_REPLIES[reply[1]];
            return error;
        }
    }
    // Everything else happened before the target was involved: TCP to the
    // proxy, the CONNECT exchange, the SOCKS handshake or its auth.
    error.proxyFault = true;
    // SocksClientError carries the socket error only in its message
    // ("connect ECONNREFUSED 100.64.0.2:1080"); lift the code out for the log.
    if (!error.code) {
        const code = /\b(E[A-Z]{4,})\b/.exec(error.message || '');
        if (code) error.code = code[1];
    }
    return error;
}

/**
 * Shared agents for a route, cached until the proxy URL or IPv4 setting
 * changes — so `.security proxy on/off` takes effect on the next request
 * while connections are still reused between requests.
 *
 * @param {'proxy'|'direct'} route
 * @param {Object} [options]
 * @param {boolean} [options.force] - Proxy agents even if the toggle is off
 * @returns {{httpAgent: Object, httpsAgent: Object}|null} null when the
 *   proxy route is asked for but cannot be built
 */
function getAgents(route, options = {}) {
    const family = config.network.forceIPv4 ? 4 : 0;

    if (route === 'direct') {
        const key = `direct:${family}`;
        if (!agentCache.has(key)) {
            const agentOptions = { keepAlive: true, maxSockets: 32, family };
            agentCache.set(key, {
                httpAgent: new http.Agent(agentOptions),
                httpsAgent: new https.Agent(agentOptions)
            });
        }
        return agentCache.get(key);
    }

    const url = resolveProxyUrl(options.force);
    if (!url) return null;

    const key = `proxy:${url}`;
    if (agentCache.has(key)) return agentCache.get(key);

    let agent = null;
    if (/^socks/i.test(url)) {
        const SocksProxyAgent = loadAgentClass('socks-proxy-agent', 'SocksProxyAgent');
        if (SocksProxyAgent) agent = guardProxyAgent(new SocksProxyAgent(url, { keepAlive: true }), 'socks');
    } else {
        const HttpsProxyAgent = loadAgentClass('https-proxy-agent', 'HttpsProxyAgent');
        // CONNECT tunnels plain-HTTP targets too, so one agent serves both.
        if (HttpsProxyAgent) agent = guardProxyAgent(new HttpsProxyAgent(url, { keepAlive: true }), 'http');
    }
    if (!agent) return null;

    // Drop agents for a previous proxy URL so their sockets close.
    for (const [oldKey, old] of agentCache) {
        if (oldKey.startsWith('proxy:')) {
            old.httpAgent.destroy();
            agentCache.delete(oldKey);
        }
    }

    const agents = { httpAgent: agent, httpsAgent: agent };
    agentCache.set(key, agents);
    return agents;
}

/**
 * Close every pooled connection (shutdown, tests).
 */
function destroyAgents() {
    for (const { httpAgent, httpsAgent } of agentCache.values()) {
        httpAgent.destroy();
        if (httpsAgent !== httpAgent) httpsAgent.destroy();
    }
    agentCache.clear();
}

// ─────────────────────────────────────────────────────
//  CLIENT FACTORIES (kept for existing callers)
// ─────────────────────────────────────────────────────

/**
 * Create an axios instance on the current route (proxy if enabled).
 * Prefer get/post/head, which add retries, fallback and logging.
 * @param {Object} customConfig - Custom axios config to merge
 * @returns {Object} axios instance
 */
function createHttpClient(customConfig = {}) {
    const agents = (isProxyEnabled() && getAgents('proxy')) || getAgents('direct');
    return axios.create({
        timeout: config.network.httpTimeout,
        ...customConfig,
        headers: { 'User-Agent': DEFAULT_USER_AGENT, ...(customConfig.headers || {}) },
        ...agents,
        proxy: false
    });
}

/**
 * Create an axios instance that always connects directly (no proxy).
 * @param {Object} customConfig - Custom axios config to merge
 * @returns {Object} axios instance
 */
function createLocalHttpClient(customConfig = {}) {
    return axios.create({
        timeout: config.network.httpTimeout,
        ...customConfig,
        headers: { 'User-Agent': DEFAULT_USER_AGENT, ...(customConfig.headers || {}) },
        ...getAgents('direct'),
        proxy: false
    });
}

/**
 * Create an axios instance forced through the configured proxy, ignoring the
 * on/off toggle. Used by the egress probe, so `.security proxy test` checks
 * the exact path real traffic would take.
 * @param {Object} [customConfig]
 * @returns {Object|null} axios instance, or null if no proxy is configured
 */
function createProxyClient(customConfig = {}) {
    if (!config.proxy.host || !config.proxy.port) return null;
    const agents = getAgents('proxy', { force: true });
    if (!agents) return null;
    return axios.create({
        timeout: config.network.httpTimeout,
        ...customConfig,
        headers: { 'User-Agent': DEFAULT_USER_AGENT, ...(customConfig.headers || {}) },
        ...agents,
        proxy: false
    });
}

// ─────────────────────────────────────────────────────
//  REQUEST PIPELINE
// ─────────────────────────────────────────────────────

/**
 * Check if an error is a connection-level error (not an HTTP status error).
 * Kept for compatibility; fallback decisions use net-errors.classify().
 * @param {Error} error
 * @returns {boolean}
 */
function isProxyConnectionError(error) {
    return isConnectionError(error);
}

/**
 * Extra attempts allowed for this request.
 * @param {string} method
 * @param {number|boolean|undefined} retry
 * @returns {number}
 */
function resolveRetries(method, retry) {
    if (retry === false) return 0;
    if (Number.isInteger(retry) && retry >= 0) return Math.min(retry, 5);
    if (retry && Number.isInteger(retry.retries)) return Math.min(Math.max(retry.retries, 0), 5);
    // Only idempotent requests retry by default.
    return ['GET', 'HEAD', 'OPTIONS'].includes(method) ? config.network.httpRetries : 0;
}

/**
 * Wait before the next attempt: exponential, with jitter.
 * @param {number} attempt - The attempt that just failed (1-based)
 * @returns {number} ms
 */
function backoffMs(attempt) {
    const exp = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * (2 ** (attempt - 1)));
    return Math.round(exp / 2 + Math.random() * (exp / 2));
}

/**
 * Parse a Retry-After header into ms, or null if absent/unparseable.
 * @param {Object} [response]
 * @returns {number|null}
 */
function retryAfterMs(response) {
    const raw = response && response.headers && response.headers['retry-after'];
    if (!raw) return null;
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(raw);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

/**
 * Best-effort size of a response body.
 * @param {Object} response
 * @returns {number}
 */
function responseBytes(response) {
    const header = Number(response.headers && response.headers['content-length']);
    if (Number.isFinite(header) && header > 0) return header;
    const { data } = response;
    if (!data) return 0;
    if (typeof data === 'string') return Buffer.byteLength(data);
    if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) return data.byteLength;
    return 0;
}

function hostOf(url) {
    try { return new URL(url).host; } catch { return null; }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Pick the route for a new request.
 * @returns {'proxy'|'direct'}
 */
function chooseRoute() {
    if (!isProxyEnabled()) return 'direct';

    if (providers.isOpen(PROXY_BREAKER_ID)) {
        // Without fallback the proxy is the only way out, so try it anyway.
        if (!config.network.fallbackToLocal) return 'proxy';

        if (Date.now() - lastSkipNotice > SKIP_NOTICE_INTERVAL_MS) {
            lastSkipNotice = Date.now();
            logger.net({ type: 'fallback', skipped: true, proxy: proxyLabel(), problem: true });
        }
        return 'direct';
    }
    return 'proxy';
}

/**
 * Run one HTTP request through the pipeline described at the top of the file.
 *
 * @param {string} method
 * @param {string} url
 * @param {*} data - Request body (POST)
 * @param {Object} options - axios options plus retry/deadline/netLog
 * @returns {Promise<Object>} axios response
 * @throws The original axios error, annotated with `.net`
 */
async function request(method, url, data, options = {}) {
    const { retry, deadline, netLog, ...axiosOptions } = options;
    method = method.toUpperCase();

    const timeout = axiosOptions.timeout || config.network.httpTimeout;
    const maxAttempts = resolveRetries(method, retry) + 1;
    const deadlineAt = Date.now() + (deadline || timeout * 2);
    const signal = axiosOptions.signal;
    const problem = netLog !== false;
    const host = hostOf(url);

    let route = chooseRoute();
    let attempt = 0;

    for (;;) {
        attempt++;
        const started = Date.now();
        const attemptTimeout = Math.max(MIN_ATTEMPT_MS, Math.min(timeout, deadlineAt - started));

        // The proxy agents can fail to build (package missing); go direct.
        let agents = route === 'proxy' ? getAgents('proxy') : null;
        if (!agents) {
            route = 'direct';
            agents = getAgents('direct');
        }

        try {
            const response = await axios.request({
                ...axiosOptions,
                method,
                url,
                data,
                timeout: attemptTimeout,
                headers: { 'User-Agent': DEFAULT_USER_AGENT, ...(axiosOptions.headers || {}) },
                httpAgent: agents.httpAgent,
                httpsAgent: agents.httpsAgent,
                proxy: false
            });

            if (route === 'proxy') providers.recordSuccess(PROXY_BREAKER_ID);

            logger.net({
                type: 'request', ok: true, final: true, method, url, route, attempt, maxAttempts,
                status: response.status, ms: Date.now() - started, bytes: responseBytes(response),
                problem: false
            });
            return response;
        } catch (error) {
            const ms = Date.now() - started;
            const c = classify(error, { route, timeout: attemptTimeout });
            error.net = { summary: c.summary, kind: c.kind, host, route, attempts: attempt };

            // The proxy itself failed: count it, and if allowed, re-run this
            // same attempt direct. That switch is not a retry — the request
            // never reached the target.
            if (route === 'proxy' && c.proxyFault) {
                providers.recordFailure(PROXY_BREAKER_ID, error);

                if (config.network.fallbackToLocal && deadlineAt - Date.now() > MIN_ATTEMPT_MS) {
                    logger.net({ type: 'fallback', proxy: proxyLabel(), summary: c.summary, url, problem: true });
                    route = 'direct';
                    attempt--;
                    continue;
                }
            }

            let willRetry = c.retryable && attempt < maxAttempts && !(signal && signal.aborted);
            let wait = willRetry ? backoffMs(attempt) : 0;

            if (willRetry) {
                const after = retryAfterMs(error.response);
                if (after !== null) {
                    if (after > MAX_RETRY_AFTER_MS) willRetry = false;
                    else wait = Math.max(wait, after);
                }
            }
            if (willRetry && Date.now() + wait + MIN_ATTEMPT_MS > deadlineAt) willRetry = false;

            logger.net({
                type: 'request', ok: false, final: !willRetry, willRetry, method, url, route,
                attempt, maxAttempts, status: c.status, summary: c.summary, ms,
                retryInMs: willRetry ? wait : 0, problem
            });

            if (!willRetry) throw error;
            await sleep(wait);
        }
    }
}

/**
 * HTTP GET with retries, proxy support and direct fallback.
 * @param {string} url - URL to fetch
 * @param {Object} options - Axios request options (+ retry/deadline/netLog)
 * @returns {Promise} axios response
 */
async function get(url, options = {}) {
    return request('GET', url, undefined, options);
}

/**
 * HTTP POST with proxy support and direct fallback. Not retried by default.
 * @param {string} url - URL to post to
 * @param {Object} data - Request body
 * @param {Object} options - Axios request options (+ retry/deadline/netLog)
 * @returns {Promise} axios response
 */
async function post(url, data = {}, options = {}) {
    return request('POST', url, data, options);
}

/**
 * HTTP HEAD with retries, proxy support and direct fallback.
 * @param {string} url - URL to check
 * @param {Object} options - Axios request options (+ retry/deadline/netLog)
 * @returns {Promise} axios response
 */
async function head(url, options = {}) {
    return request('HEAD', url, undefined, options);
}

module.exports = {
    createHttpClient,
    createLocalHttpClient,
    createProxyClient,
    get,
    post,
    head,
    request,
    isProxyEnabled,
    isProxyConnectionError,
    proxyLabel,
    destroyAgents,
    PROXY_BREAKER_ID,
    DEFAULT_USER_AGENT
};
