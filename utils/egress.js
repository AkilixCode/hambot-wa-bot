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
const axios = require('axios');
const config = require('../config');
const logger = require('./logger');

// HAMBOT_DATA_DIR exists mainly so the test suite can point this somewhere
// disposable — otherwise running the tests on a live server overwrote the
// owner's persisted proxy toggle.
const STATE_DIR = process.env.HAMBOT_DATA_DIR
    ? path.resolve(process.env.HAMBOT_DATA_DIR)
    : path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(STATE_DIR, 'egress.json');

// Public endpoint that echoes the caller's IP. Plain text, tiny response.
const IP_ECHO_URL = 'https://api.ipify.org?format=json';
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
            logger.info(`Egress: restored proxy toggle -> ${raw.enabled ? 'ON' : 'OFF'}`);
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
    logger.info('Egress: proxy ENABLED');
    return { ok: true };
}

/**
 * Turn the proxy off — all traffic goes out via the server's own IP.
 * @returns {Promise<{ok: boolean}>}
 */
async function disable() {
    config.proxy.enabled = false;
    await persist();
    logger.info('Egress: proxy DISABLED');
    return { ok: true };
}

/**
 * Build an axios instance that is forced through the proxy, ignoring the
 * toggle. Used by test() so the proxy can be probed while it is switched off.
 * @returns {Object|null} axios instance, or null if no proxy is configured
 */
function _forcedProxyClient() {
    if (!isConfigured()) return null;

    const proxyUrl = config.proxy.url || config.media.proxyUrl;
    const type = (config.proxy.type || 'http').toLowerCase();

    if (type === 'socks5' || type === 'socks') {
        try {
            const { SocksProxyAgent } = require('socks-proxy-agent');
            const agent = new SocksProxyAgent(proxyUrl);
            return axios.create({
                timeout: PROBE_TIMEOUT,
                httpAgent: agent,
                httpsAgent: agent,
                proxy: false
            });
        } catch {
            return null;
        }
    }

    // Build the axios proxy object directly rather than calling
    // config.getAxiosProxyConfig(), which short-circuits when the toggle is off.
    const proxy = {
        host: config.proxy.host,
        port: config.proxy.port,
        protocol: type === 'https' ? 'https' : 'http'
    };
    if (config.proxy.user && config.proxy.pass) {
        proxy.auth = { username: config.proxy.user, password: config.proxy.pass };
    }

    return axios.create({ timeout: PROBE_TIMEOUT, proxy });
}

/**
 * Fetch the public IP seen by a given client, timing the round trip.
 * @param {Object} client - axios instance
 * @returns {Promise<{ok: boolean, ip?: string, ms?: number, error?: string}>}
 */
async function _probe(client) {
    const started = Date.now();
    try {
        const res = await client.get(IP_ECHO_URL);
        const ip = typeof res.data === 'object' ? res.data.ip : String(res.data).trim();
        return { ok: true, ip, ms: Date.now() - started };
    } catch (error) {
        return { ok: false, error: error.message, ms: Date.now() - started };
    }
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
    const direct = await _probe(axios.create({ timeout: PROBE_TIMEOUT, proxy: false }));

    const proxyClient = _forcedProxyClient();
    const viaProxy = proxyClient
        ? await _probe(proxyClient)
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
