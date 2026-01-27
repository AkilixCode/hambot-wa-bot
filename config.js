/**
 * Configuration Management System
 * Centralized configuration with validation and defaults
 */

require('dotenv').config();

class Config {
    constructor() {
        this.bot = {
            name: process.env.BOT_NAME || 'HamBot',
            owner: process.env.BOT_OWNER || 'Ilham',
            prefix: process.env.BOT_PREFIX || '.',
            browser: ['HamBot', 'Chrome', '1.0.0'],
            // Private mode: ignore private messages when true
            onlyGroupMode: process.env.ONLY_GROUP_MODE === 'true'
        };

        this.performance = {
            maxProcesses: parseInt(process.env.MAX_PROCESSES) || 3,
            cooldownMs: parseInt(process.env.COOLDOWN_MS) || 3000, // Friendlier 3 second cooldown
            rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW) || 60000, // 1 minute
            rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX) || 15, // Allow more for friends
            cacheExpiration: parseInt(process.env.CACHE_EXPIRATION) || 300000 // 5 minutes
        };

        this.media = {
            maxDuration: parseInt(process.env.MAX_MUSIC_DURATION) || 600, // 10 minutes
            maxFileSize: process.env.MAX_FILE_SIZE || '200M', // 200MB limit for data saving
            proxyUrl: this._buildProxyUrl()
        };

        this.apis = {
            elevenlabs: {
                key: process.env.ELEVENLABS_API_KEY,
                voiceId: process.env.ELEVENLABS_VOICE_ID || 'plgKUYgnlZ1DCNh54DwJ'
            },
            omdb: {
                key: process.env.OMDB_API_KEY
            },
            gemini: {
                key: process.env.GEMINI_API_KEY
            }
        };

        this.logging = {
            level: process.env.LOG_LEVEL || 'info',
            silent: process.env.LOG_SILENT === 'true'
        };

        // Proxy configuration for yt-dlp, axios, puppeteer and other services
        // Supports HTTP, HTTPS, and SOCKS5 proxies (e.g., Tailscale + Every Proxy)
        this.proxy = {
            // Enable/disable proxy globally
            enabled: process.env.PROXY_ENABLED === 'true',
            // Proxy type: http, https, socks5
            type: process.env.PROXY_TYPE || 'http',
            // Proxy credentials
            user: process.env.PROXY_USER || null,
            pass: process.env.PROXY_PASS || null,
            host: process.env.PROXY_HOST || null,
            port: process.env.PROXY_PORT ? parseInt(process.env.PROXY_PORT) : null,
            // Full proxy URL (takes priority if set)
            url: this._buildProxyUrl()
        };
    }

    /**
     * Build proxy URL from credentials
     * Supports HTTP, HTTPS, and SOCKS5 protocols
     */
    _buildProxyUrl() {
        // First check legacy HB_PROXY_URL
        if (process.env.HB_PROXY_URL) {
            return process.env.HB_PROXY_URL;
        }

        // Build from individual components
        const type = process.env.PROXY_TYPE || 'http';
        const user = process.env.PROXY_USER;
        const pass = process.env.PROXY_PASS;
        const host = process.env.PROXY_HOST;
        const port = process.env.PROXY_PORT;

        if (host && port) {
            // Determine protocol
            let protocol = 'http';
            if (type === 'socks5' || type === 'socks') {
                protocol = 'socks5';
            } else if (type === 'https') {
                protocol = 'https';
            }

            if (user && pass) {
                return `${protocol}://${user}:${pass}@${host}:${port}`;
            }
            return `${protocol}://${host}:${port}`;
        }

        return null;
    }

    /**
     * Get proxy configuration for axios
     * Returns null if proxy is not enabled or not configured
     */
    getAxiosProxyConfig() {
        if (!this.proxy.enabled || !this.proxy.host || !this.proxy.port) {
            return null;
        }

        const config = {
            host: this.proxy.host,
            port: this.proxy.port,
            protocol: this.proxy.type === 'socks5' ? 'socks5' : (this.proxy.type || 'http')
        };

        if (this.proxy.user && this.proxy.pass) {
            config.auth = {
                username: this.proxy.user,
                password: this.proxy.pass
            };
        }

        return config;
    }

    /**
     * Get proxy URL for yt-dlp and other CLI tools
     */
    getProxyUrl() {
        if (!this.proxy.enabled) {
            return null;
        }
        return this.proxy.url || this.media.proxyUrl;
    }

    /**
     * Get proxy arguments for yt-dlp
     */
    getYtDlpProxyArgs() {
        const proxyUrl = this.getProxyUrl();
        return proxyUrl ? ['--proxy', proxyUrl] : [];
    }

    /**
     * Get proxy configuration for Puppeteer
     */
    getPuppeteerProxyArgs() {
        if (!this.proxy.enabled || !this.proxy.host || !this.proxy.port) {
            return [];
        }

        const proxyUrl = this.proxy.url || `${this.proxy.type || 'http'}://${this.proxy.host}:${this.proxy.port}`;
        return [`--proxy-server=${proxyUrl}`];
    }

    validate() {
        const errors = [];

        if (this.performance.maxProcesses < 1) {
            errors.push('MAX_PROCESSES must be at least 1');
        }

        if (this.performance.cooldownMs < 0) {
            errors.push('COOLDOWN_MS must be non-negative');
        }

        if (errors.length > 0) {
            throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
        }

        return true;
    }
}

module.exports = new Config();
