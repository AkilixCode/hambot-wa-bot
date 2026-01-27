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
 * Make HTTP GET request with proxy support
 * @param {string} url - URL to fetch
 * @param {Object} options - Axios request options
 * @returns {Promise} axios response
 */
async function get(url, options = {}) {
    const client = createHttpClient(options);
    applySocksProxy(client, options);
    return client.get(url, options);
}

/**
 * Make HTTP POST request with proxy support
 * @param {string} url - URL to post to
 * @param {Object} data - Request body
 * @param {Object} options - Axios request options
 * @returns {Promise} axios response
 */
async function post(url, data = {}, options = {}) {
    const client = createHttpClient(options);
    applySocksProxy(client, options);
    return client.post(url, data, options);
}

/**
 * Make HTTP HEAD request with proxy support
 * @param {string} url - URL to check
 * @param {Object} options - Axios request options
 * @returns {Promise} axios response
 */
async function head(url, options = {}) {
    const client = createHttpClient(options);
    applySocksProxy(client, options);
    return client.head(url, options);
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
    get,
    post,
    head,
    isProxyEnabled,
    getProxyStatus
};
