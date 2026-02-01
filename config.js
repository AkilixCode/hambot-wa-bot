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
            onlyGroupMode: process.env.ONLY_GROUP_MODE === 'true',
            // Owner ID in format: number@s.whatsapp.net
            ownerId: this._normalizeOwnerId(process.env.BOT_OWNER_ID),
            // Owner-only commands list from env
            ownerOnlyCommands: (process.env.OWNER_ONLY_COMMANDS || 'security,spam').split(',').map(c => c.trim().toLowerCase()).filter(c => c)
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

        // Security settings
        // Chat security: filters user input for malicious patterns
        // Server security (rate limiting, blocking) is always active
        this.security = {
            // Enable/disable chat content filtering (malicious pattern detection)
            // When false, users can type anything without being flagged
            // Server-side protections (rate limiting, user blocking) remain active
            chatFilterEnabled: process.env.SECURITY_CHAT_FILTER !== 'false'
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
     * Priority: proxy.url (from PROXY_* env vars) > media.proxyUrl (from HB_PROXY_URL legacy)
     */
    getProxyUrl() {
        if (!this.proxy.enabled) {
            return null;
        }
        // Primary: Use proxy.url built from PROXY_* env vars
        // Fallback: Use media.proxyUrl from legacy HB_PROXY_URL for backward compatibility
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

    /**
     * Normalize owner ID to number@s.whatsapp.net format
     * Ensures consistent format across the application
     * @param {string} ownerId - Raw owner ID from env
     * @returns {string|null} Normalized owner ID
     */
    _normalizeOwnerId(ownerId) {
        if (!ownerId) return null;
        
        // Remove any whitespace
        let normalized = ownerId.trim();
        
        // If already in correct format, return as-is
        if (normalized.endsWith('@s.whatsapp.net')) {
            // Extract number and re-normalize
            const number = normalized.replace('@s.whatsapp.net', '').replace(/\D/g, '');
            return number ? `${number}@s.whatsapp.net` : null;
        }
        
        // If it's @lid format, we need to convert - but we can't 
        // since @lid is a different identifier system
        // Log warning if @lid format detected
        if (normalized.endsWith('@lid')) {
            console.warn('⚠️ WARNING: BOT_OWNER_ID uses @lid format which is not supported.');
            console.warn('⚠️ Please use number@s.whatsapp.net format (e.g., 6281234567890@s.whatsapp.net)');
            return null;
        }
        
        // Otherwise, assume it's a phone number - normalize and add suffix
        const number = normalized.replace(/\D/g, '');
        if (!number) return null;
        
        return `${number}@s.whatsapp.net`;
    }

    /**
     * Check if a sender is the bot owner
     * @param {string} senderId - Sender JID
     * @returns {boolean}
     */
    isOwner(senderId) {
        if (!this.bot.ownerId || !senderId) return false;
        
        // Normalize sender to @s.whatsapp.net format for comparison
        let normalizedSender = senderId;
        
        // If sender uses @lid format, extract and try to match number
        if (senderId.endsWith('@lid')) {
            // Cannot reliably match @lid to @s.whatsapp.net
            // This is a WhatsApp limitation - @lid is an internal ID
            return false;
        }
        
        // If sender is in participant format (group), extract JID
        if (senderId.includes(':')) {
            normalizedSender = senderId.split(':')[0] + '@s.whatsapp.net';
        }
        
        // Ensure @s.whatsapp.net suffix
        if (!normalizedSender.endsWith('@s.whatsapp.net')) {
            const number = normalizedSender.replace(/\D/g, '');
            normalizedSender = `${number}@s.whatsapp.net`;
        }
        
        return normalizedSender === this.bot.ownerId;
    }

    /**
     * Check if a command is owner-only
     * @param {string} commandName - Command name
     * @returns {boolean}
     */
    isOwnerOnlyCommand(commandName) {
        return this.bot.ownerOnlyCommands.includes(commandName.toLowerCase());
    }

    validate() {
        const errors = [];

        if (this.performance.maxProcesses < 1) {
            errors.push('MAX_PROCESSES harus minimal 1');
        }

        if (this.performance.cooldownMs < 0) {
            errors.push('COOLDOWN_MS harus non-negatif');
        }

        if (!this.bot.ownerId) {
            console.warn('⚠️ PERINGATAN: BOT_OWNER_ID tidak dikonfigurasi. Perintah owner-only tidak akan berfungsi.');
        }

        if (errors.length > 0) {
            throw new Error(`Validasi konfigurasi gagal:\n${errors.join('\n')}`);
        }

        return true;
    }
}

module.exports = new Config();
