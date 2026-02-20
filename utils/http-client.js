/**
 * HTTP Client with Proxy Support
 * Centralized axios instance configured with proxy settings
 * Supports HTTP, HTTPS, and SOCKS5 proxies (e.g., Tailscale + Every Proxy)
 */

const axios = require('axios');
const config = require('../config');
const logger = require('./logger');

// Cache for SOCKS proxy agent class
let SocksProxyAgent = null;
let socksLoadAttempted = false;

/**
 * Try to load socks-proxy-agent module (lazy loaded)
 * Uses require with try-catch for compatibility
 */
function loadSocksProxyAgent() {
    if (socksLoadAttempted) {
        return SocksProxyAgent;
    }
    
    socksLoadAttempted = true;
    
    try {
        // Use require for better compatibility with CommonJS modules
        SocksProxyAgent = require('socks-proxy-agent').SocksProxyAgent;
    } catch {
        logger.warn('socks-proxy-agent not installed. SOCKS5 proxy will not work. Install with: npm install socks-proxy-agent');
        SocksProxyAgent = null;
    }
    
    return SocksProxyAgent;
}

/**
 * Create SOCKS proxy agent instance
 * @param {string} proxyUrl - Proxy URL
 * @returns {Object|null} SocksProxyAgent instance or null
 */
function createSocksAgent(proxyUrl) {
    const Agent = loadSocksProxyAgent();
    if (!Agent) {
        return null;
    }
    return new Agent(proxyUrl);
}

/**
 * Apply SOCKS5 proxy agent to options if needed
 * @param {Object} client - Axios client instance
 * @param {Object} options - Request options to modify
 */
function applySocksProxy(client, options) {
    if (client.defaults._useSocksProxy) {
        const agent = createSocksAgent(client.defaults._proxyUrl);
        if (agent) {
            options.httpAgent = agent;
            options.httpsAgent = agent;
        }
        // Clean up internal flags
        delete client.defaults._useSocksProxy;
        delete client.defaults._proxyUrl;
    }
}

/**
 * Create axios instance with proxy configuration
 * @param {Object} customConfig - Custom axios config to merge
 * @returns {Object} axios instance
 */
function createHttpClient(customConfig = {}) {
    const baseConfig = {
        timeout: 30000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        ...customConfig
    };

    // Add proxy configuration if enabled
    if (config.proxy.enabled && config.proxy.host && config.proxy.port) {
        const proxyType = config.proxy.type || 'http';
        
        if (proxyType === 'socks5' || proxyType === 'socks') {
            // For SOCKS5, we need to use httpAgent/httpsAgent
            // This will be handled in the request function
            baseConfig._useSocksProxy = true;
            baseConfig._proxyUrl = config.getProxyUrl();
        } else {
            // For HTTP/HTTPS proxy, use axios native proxy config
            baseConfig.proxy = config.getAxiosProxyConfig();
        }
    }

    return axios.create(baseConfig);
}

/**
 * Create axios instance WITHOUT proxy (for local/direct connection)
 * Used as fallback when proxy is unavailable
 * @param {Object} customConfig - Custom axios config to merge
 * @returns {Object} axios instance
 */
function createLocalHttpClient(customConfig = {}) {
    const baseConfig = {
        timeout: 30000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        ...customConfig
    };

    // Explicitly disable proxy
    baseConfig.proxy = false;

    return axios.create(baseConfig);
}

/**
 * Check if an error is a proxy/connection-level error (not an HTTP status error)
 * Used to determine if a fallback to local IP should be attempted
 * @param {Error} error - The error to check
 * @returns {boolean} true if the error suggests a proxy/connection failure
 */
function isProxyConnectionError(error) {
    // Connection-level errors that suggest the proxy is unavailable
    const connectionErrorCodes = [
        'ECONNREFUSED', 'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND',
        'ENETUNREACH', 'EHOSTUNREACH', 'ECONNRESET', 'EPIPE', 'EAI_AGAIN'
    ];

    if (error.code && connectionErrorCodes.includes(error.code)) return true;

    // Axios timeout or SOCKS proxy errors
    if (error.message && (
        error.message.includes('timeout') ||
        error.message.includes('SOCKS') ||
        error.message.includes('socket disconnected') ||
        error.message.includes('Proxy connection')
    )) return true;

    return false;
}

/**
 * Make HTTP GET request with proxy support and local IP fallback
 * @param {string} url - URL to fetch
 * @param {Object} options - Axios request options
 * @returns {Promise} axios response
 */
async function get(url, options = {}) {
    const client = createHttpClient(options);
    applySocksProxy(client, options);
    try {
        return await client.get(url, options);
    } catch (error) {
        if (isProxyEnabled() && config.network.fallbackToLocal && isProxyConnectionError(error)) {
            logger.warn('Proxy failed for HTTP GET, falling back to local IP');
            const localClient = createLocalHttpClient(options);
            return localClient.get(url, options);
        }
        throw error;
    }
}

/**
 * Make HTTP POST request with proxy support and local IP fallback
 * @param {string} url - URL to post to
 * @param {Object} data - Request body
 * @param {Object} options - Axios request options
 * @returns {Promise} axios response
 */
async function post(url, data = {}, options = {}) {
    const client = createHttpClient(options);
    applySocksProxy(client, options);
    try {
        return await client.post(url, data, options);
    } catch (error) {
        if (isProxyEnabled() && config.network.fallbackToLocal && isProxyConnectionError(error)) {
            logger.warn('Proxy failed for HTTP POST, falling back to local IP');
            const localClient = createLocalHttpClient(options);
            return localClient.post(url, data, options);
        }
        throw error;
    }
}

/**
 * Make HTTP HEAD request with proxy support and local IP fallback
 * @param {string} url - URL to check
 * @param {Object} options - Axios request options
 * @returns {Promise} axios response
 */
async function head(url, options = {}) {
    const client = createHttpClient(options);
    applySocksProxy(client, options);
    try {
        return await client.head(url, options);
    } catch (error) {
        if (isProxyEnabled() && config.network.fallbackToLocal && isProxyConnectionError(error)) {
            logger.warn('Proxy failed for HTTP HEAD, falling back to local IP');
            const localClient = createLocalHttpClient(options);
            return localClient.head(url, options);
        }
        throw error;
    }
}

/**
 * Check if proxy is configured and enabled
 * @returns {boolean}
 */
function isProxyEnabled() {
    return config.proxy.enabled && config.proxy.host && config.proxy.port;
}

/**
 * Get proxy status for debugging
 * @returns {Object}
 */
function getProxyStatus() {
    return {
        enabled: config.proxy.enabled,
        type: config.proxy.type,
        host: config.proxy.host,
        port: config.proxy.port,
        url: config.proxy.enabled ? config.getProxyUrl() : null
    };
}

module.exports = {
    createHttpClient,
    createLocalHttpClient,
    get,
    post,
    head,
    isProxyEnabled,
    isProxyConnectionError,
    getProxyStatus
};
