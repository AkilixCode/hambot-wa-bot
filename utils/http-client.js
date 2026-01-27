/**
 * HTTP Client with Proxy Support
 * Centralized axios instance configured with proxy settings
 * Supports HTTP, HTTPS, and SOCKS5 proxies (e.g., Tailscale + Every Proxy)
 */

const axios = require('axios');
const config = require('../config');
const logger = require('./logger');

// Only require socks-proxy-agent if we're using SOCKS5
let SocksProxyAgent = null;

/**
 * Get or create SOCKS proxy agent (lazy loaded)
 */
async function getSocksAgent(proxyUrl) {
    if (!SocksProxyAgent) {
        try {
            const { SocksProxyAgent: Agent } = await import('socks-proxy-agent');
            SocksProxyAgent = Agent;
        } catch {
            logger.warn('socks-proxy-agent not installed. SOCKS5 proxy will not work. Install with: npm install socks-proxy-agent');
            return null;
        }
    }
    return new SocksProxyAgent(proxyUrl);
}

/**
 * Create axios instance with proxy configuration
 * @param {Object} customConfig - Custom axios config to merge
 * @returns {Object} axios instance or config
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
    
    // Handle SOCKS5 proxy
    if (client.defaults._useSocksProxy) {
        const agent = await getSocksAgent(client.defaults._proxyUrl);
        if (agent) {
            options.httpAgent = agent;
            options.httpsAgent = agent;
        }
        delete client.defaults._useSocksProxy;
        delete client.defaults._proxyUrl;
    }

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
    
    // Handle SOCKS5 proxy
    if (client.defaults._useSocksProxy) {
        const agent = await getSocksAgent(client.defaults._proxyUrl);
        if (agent) {
            options.httpAgent = agent;
            options.httpsAgent = agent;
        }
        delete client.defaults._useSocksProxy;
        delete client.defaults._proxyUrl;
    }

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
    
    // Handle SOCKS5 proxy
    if (client.defaults._useSocksProxy) {
        const agent = await getSocksAgent(client.defaults._proxyUrl);
        if (agent) {
            options.httpAgent = agent;
            options.httpsAgent = agent;
        }
        delete client.defaults._useSocksProxy;
        delete client.defaults._proxyUrl;
    }

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
