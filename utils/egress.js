/**
 * Egress Control — runtime proxy toggle
 *
 * The bot runs on a datacenter VPS. YouTube and (historically) Pinterest treat
 * datacenter ASNs as bots and block them, which is why the media commands fail
 * from the server but work fine from a phone. The fix is to route media traffic
 * through a residential connection — typically the owner's phone running an
 * HTTP/SOCKS5 proxy, reachable over Tailscale.
 *
 * That plumbing already existed in config.js but was a boot-time env flag, so
 * flipping it meant editing .env and restarting. This module makes it a live
 * toggle:
 *
 *   - It owns `config.proxy.enabled`, which every existing consumer already
 *     reads (utils/http-client.js, config.getYtDlpProxyArgs). Flipping it here
 *     moves the whole bot at once — no consumer needs to know this module exists.
 *   - The choice is persisted, so a restart does not silently revert it.
 *
 * Seeded from PROXY_ENABLED on first run; the persisted state wins afterwards.
 */

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const config = require('../config');
const logger = require('./logger');
const httpClient = require('./http-client');
const { classify } = require('./net-errors');
const { dataDir } = require('./paths');

// HAMBOT_DATA_DIR (see utils/paths) exists mainly so the test suite can
// point this somewhere disposable — otherwise running the tests on a live
// server overwrote the owner's persisted proxy toggle.
const STATE_DIR = dataDir();
const STATE_FILE = path.join(STATE_DIR, 'egress.json');

// Public endpoints that echo the caller's IP, tried in order. All IPv4-only:
// the direct and proxy answers are compared, and an IPv4 address next to an
// IPv6 one would always look "different".
const IP_ECHO_URLS = [
    'https://api.ipify.org?format=json',
    'https://ipv4.icanhazip.com',
    'https://v4.ident.me'
];
const PROBE_TIMEOUT = 10000;

// Result of the last test(), surfaced by the media doctor.
let lastCheck = null;

/**
 * Whether a proxy is actually usable — enabled AND fully configured.
 * `config.proxy.enabled` alone is not enough: a true flag with no host is a
 * misconfiguration that would otherwise silently produce direct connections.
 * @returns {boolean}
 */
function isEnabled() {
    return Boolean(config.proxy.enabled && config.proxy.host && config.proxy.port);
}

/**
 * Whether proxy credentials are present at all, regardless of the toggle.
 * @returns {boolean}
 */
function isConfigured() {
    return Boolean(config.proxy.host && config.proxy.port);
}

/**
 * Load the persisted toggle and apply it to config. Called once at startup,
 * before any command runs.
 */
function restore() {
    try {
        if (!fs.existsSync(STATE_FILE)) return;
        const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        if (typeof raw.enabled === 'boolean') {
            config.proxy.enabled = raw.enabled;
            logger.system(`Egress: restored proxy toggle -> ${raw.enabled ? 'ON' : 'OFF'}`);
        }
    } catch {
        // A corrupt state file must not stop the bot. Fall back to the env flag.
    }
}

/**
 * Persist the current toggle so it survives a restart.
 */
async function persist() {
    try {
        await fsPromises.mkdir(STATE_DIR, { recursive: true });
        await fsPromises.writeFile(
            STATE_FILE,
            JSON.stringify({ enabled: config.proxy.enabled, updatedAt: Date.now() }, null, 2)
        );
    } catch (error) {
        logger.warn(`Egress: failed to persist proxy state - ${error.message}`);
    }
}

/**
 * Turn the proxy on.
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
async function enable() {
    if (!isConfigured()) {
        return { ok: false, reason: 'PROXY_HOST dan PROXY_PORT belum diisi di .env' };
    }
    config.proxy.enabled = true;
    await persist();
    logger.system(`Egress: proxy ENABLED (${httpClient.proxyLabel()})`);
    return { ok: true };
}

/**
 * Turn the proxy off — all traffic goes out via the server's own IP.
 * @returns {Promise<{ok: boolean}>}
 */
async function disable() {
    config.proxy.enabled = false;
    await persist();
    logger.system('Egress: proxy DISABLED — traffic leaves from the server IP');
    return { ok: true };
}

/**
 * An axios instance forced through the proxy, ignoring the toggle, so the
 * proxy can be probed while it is switched off. It uses the same agents as
 * real traffic (utils/http-client), so a passing probe means real requests
 * will get through too — the old probe used a different code path and could
 * pass while every real HTTPS request through an HTTP proxy failed.
 * @returns {Object|null} axios instance, or null if no proxy is configured
 */
function _forcedProxyClient() {
    return httpClient.createProxyClient({ timeout: PROBE_TIMEOUT });
}

/**
 * Fetch the public IP seen by a given client, timing the round trip.
 * Tries each echo service in turn, so one being down does not read as
 * "the proxy is broken".
 * @param {Object} client - axios instance
 * @param {string} route - 'proxy' or 'direct', for error classification
 * @returns {Promise<{ok: boolean, ip?: string, ms?: number, error?: string}>}
 */
async function _probe(client, route) {
    const started = Date.now();
    let lastError = null;

    for (const url of IP_ECHO_URLS) {
        try {
            const res = await client.get(url);
            const ip = typeof res.data === 'object' && res.data ? res.data.ip : String(res.data).trim();
            if (ip && /^[0-9a-f.:]+$/i.test(ip)) {
                return { ok: true, ip, ms: Date.now() - started };
            }
            lastError = `unexpected answer from ${new URL(url).host}`;
        } catch (error) {
            lastError = classify(error, { route, timeout: PROBE_TIMEOUT }).summary;
            // The proxy itself failing will not get better on the next echo
            // service; stop instead of waiting out the timeout again.
            if (route === 'proxy' && classify(error, { route }).proxyFault) break;
        }
    }
    return { ok: false, error: lastError, ms: Date.now() - started };
}

/**
 * Compare the egress IP seen through the proxy against the direct one.
 *
 * Two identical IPs mean the proxy is not actually changing the exit point —
 * a silent misconfiguration that looks like success until YouTube blocks you
 * anyway. That is the single most useful thing this check can tell the owner.
 *
 * @returns {Promise<Object>} Probe results for both paths
 */
async function test() {
    const direct = await _probe(httpClient.createLocalHttpClient({ timeout: PROBE_TIMEOUT }), 'direct');

    const proxyClient = _forcedProxyClient();
    const viaProxy = proxyClient
        ? await _probe(proxyClient, 'proxy')
        : { ok: false, error: 'Proxy belum dikonfigurasi' };

    const result = {
        direct,
        proxy: viaProxy,
        configured: isConfigured(),
        enabled: isEnabled(),
        // Only meaningful when both probes succeeded.
        distinct: Boolean(direct.ok && viaProxy.ok && direct.ip !== viaProxy.ip),
        checkedAt: Date.now()
    };

    lastCheck = result;
    return result;
}

/**
 * Current egress state, without touching the network.
 * @returns {Object}
 */
function status() {
    return {
        enabled: isEnabled(),
        configured: isConfigured(),
        type: config.proxy.type || 'http',
        host: config.proxy.host,
        port: config.proxy.port,
        authenticated: Boolean(config.proxy.user && config.proxy.pass),
        fallbackToLocal: config.network.fallbackToLocal,
        lastCheck
    };
}

module.exports = {
    STATE_FILE,
    isEnabled,
    isConfigured,
    restore,
    enable,
    disable,
    test,
    status
};
