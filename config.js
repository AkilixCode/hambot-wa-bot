/**
 * Configuration Management System
 * Centralized configuration with validation and defaults
 */

require('dotenv').config({ quiet: true });

// package.json is the single source of truth for the version. Previously the
// number was duplicated across the changelog, SECURITY.md and the Baileys
// browser identifier, and all three had drifted apart.
const { version: VERSION } = require('./package.json');

class Config {
    constructor() {
        this.bot = {
            name: process.env.BOT_NAME || 'HamBot',
            owner: process.env.BOT_OWNER || 'Name',
            prefix: process.env.BOT_PREFIX || '.',
            // One line under the name on the menu image and caption
            tagline: process.env.BOT_TAGLINE || 'Asisten WhatsApp serba bisa',
            version: VERSION,
            browser: ['HamBot', 'Chrome', VERSION],
            // Private mode: ignore private messages when true
            onlyGroupMode: process.env.ONLY_GROUP_MODE === 'true',
            // Owner IDs - supports both private (@s.whatsapp.net) and group (@lid) formats
            // Can be comma-separated for dual ID support: "id1@s.whatsapp.net,id2@lid"
            ownerIds: this._normalizeOwnerIds(process.env.BOT_OWNER_ID),
            // Legacy single ID for backward compatibility
            ownerId: this._normalizeOwnerId(process.env.BOT_OWNER_ID),
            // Owner-only commands list from env
            ownerOnlyCommands: (process.env.OWNER_ONLY_COMMANDS || 'security,spam').split(',').map(c => c.trim().toLowerCase()).filter(c => c),
            // Commands restricted to group admins. `tagall` pings every member,
            // so leaving it open to everyone makes the bot a spam tool in any
            // group it joins.
            adminOnlyCommands: (process.env.ADMIN_ONLY_COMMANDS || 'tagall').split(',').map(c => c.trim().toLowerCase()).filter(c => c)
        };

        this.performance = {
            maxProcesses: parseInt(process.env.MAX_PROCESSES) || 3,
            cooldownMs: parseInt(process.env.COOLDOWN_MS) || 3000, // Friendlier 3 second cooldown
            rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW) || 60000, // 1 minute
            rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX) || 15, // Allow more for friends
            cacheExpiration: parseInt(process.env.CACHE_EXPIRATION) || 300000 // 5 minutes
        };

        // MAX_FILE_SIZE was previously parsed here and then never read — both
        // media commands hardcoded '200M'. Two problems with that number:
        // WhatsApp will not accept inline media anywhere near it, and a file
        // that size was being read into a Buffer whole, against a 2GB heap cap.
        // MAX_MEDIA_SIZE is the current knob; MAX_FILE_SIZE is still honoured
        // so existing .env files keep working.
        const rawMaxSize = process.env.MAX_MEDIA_SIZE || process.env.MAX_FILE_SIZE || '64M';
        this.media = {
            maxDuration: parseInt(process.env.MAX_MUSIC_DURATION) || 600, // 10 minutes
            // yt-dlp form, e.g. '64M' — passed straight to --max-filesize
            maxFileSize: rawMaxSize,
            // Byte form, for the post-download check
            maxFileBytes: this._parseSize(rawMaxSize),
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
            // 'simple' = clean command blocks, 'full' = verbose debug logs
            level: process.env.LOG_LEVEL || 'simple',
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

        // Proxy configuration for yt-dlp, axios and other services
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

        // Network configuration for yt-dlp and other CLI tools
        // Controls how commands connect to the internet
        this.network = {
            // Force IPv4 for yt-dlp connections (default: true for compatibility)
            // Set to false if your network supports IPv6 or if IPv4 causes issues
            forceIPv4: process.env.FORCE_IPV4 !== 'false',
            // When proxy is enabled, fall back to local IP if proxy fails (default: true)
            // This ensures commands still work even if the proxy is temporarily unavailable
            fallbackToLocal: process.env.NETWORK_FALLBACK_TO_LOCAL !== 'false'
        };
    }

    /**
     * Parse a yt-dlp style size string ('64M', '1.5G', '500K') into bytes.
     * Falls back to 64MB when the value is unparseable, so a typo in .env
     * degrades to a sane default instead of NaN or an unbounded download.
     * @param {string} value - Size with an optional K/M/G suffix
     * @returns {number} Bytes
     */
    _parseSize(value) {
        const match = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*([KMG])?B?$/i);
        if (!match) return 64 * 1024 * 1024;

        const amount = parseFloat(match[1]);
        const unit = (match[2] || '').toUpperCase();
        const multiplier = { K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[unit] || 1;
        return Math.floor(amount * multiplier);
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
                // Encoded so a password containing @, : or / does not break
                // the URL (and with it every proxied request).
                return `${protocol}://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
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
     * Get network arguments for yt-dlp (e.g., --force-ipv4)
     * Configurable via FORCE_IPV4 env var
     */
    getYtDlpNetworkArgs() {
        return this.network.forceIPv4 ? ['--force-ipv4'] : [];
    }

    /**
     * Normalize single owner ID to accept both @s.whatsapp.net and @lid formats
     * @param {string} ownerId - Raw owner ID from env
     * @returns {string|null} Normalized owner ID (first ID if comma-separated)
     */
    _normalizeOwnerId(ownerId) {
        if (!ownerId) return null;
        
        // If comma-separated, return the first one
        const firstId = ownerId.split(',')[0];
        return this._normalizeSingleOwnerId(firstId);
    }

    /**
     * Normalize multiple owner IDs (comma-separated)
     * Supports both @s.whatsapp.net (private chat) and @lid (group chat) formats
     * @param {string} ownerIdStr - Comma-separated owner IDs from env
     * @returns {string[]} Array of normalized owner IDs
     */
    _normalizeOwnerIds(ownerIdStr) {
        if (!ownerIdStr) return [];
        
        return ownerIdStr
            .split(',')
            .map(id => this._normalizeSingleOwnerId(id.trim()))
            .filter(id => id !== null);
    }

    /**
     * Normalize a single owner ID
     * @param {string} ownerId - Single owner ID
     * @returns {string|null} Normalized owner ID
     */
    _normalizeSingleOwnerId(ownerId) {
        if (!ownerId) return null;
        
        // Remove any whitespace
        let normalized = ownerId.trim();
        
        // Accept both @s.whatsapp.net and @lid formats directly
        if (normalized.endsWith('@lid')) {
            return normalized;
        }
        if (normalized.endsWith('@s.whatsapp.net')) {
            const local = normalized.slice(0, -'@s.whatsapp.net'.length);
            return this._isPlausibleNumber(local) ? normalized : null;
        }
        
        // Otherwise, assume it's a phone number - normalize and add @s.whatsapp.net suffix.
        // A number that can never be a WhatsApp ID (local 0-prefixed form, or
        // the wrong length) is dropped here and reported by ownerIdProblems(),
        // instead of silently becoming an owner ID nobody can ever match.
        const number = normalized.replace(/\D/g, '');
        if (!this._isPlausibleNumber(number)) return null;
        
        return `${number}@s.whatsapp.net`;
    }

    /**
     * Could this be a phone number in international form, as WhatsApp uses?
     * No country code starts with 0, and E.164 numbers have at most 15 digits.
     * @param {string} digits
     * @returns {boolean}
     * @private
     */
    _isPlausibleNumber(digits) {
        return /^[1-9]\d{7,14}$/.test(digits);
    }

    /**
     * Human-readable problems with BOT_OWNER_ID, one per unusable entry.
     * A typo here silently locks the owner out of every owner-only command,
     * so it is worth saying loudly at startup.
     * @param {string} [raw] Defaults to the BOT_OWNER_ID environment variable
     * @returns {string[]}
     */
    ownerIdProblems(raw = process.env.BOT_OWNER_ID) {
        if (!raw) return [];
        const problems = [];
        for (const entry of String(raw).split(',').map(e => e.trim()).filter(Boolean)) {
            if (entry.endsWith('@lid')) continue;
            const digits = entry.replace(/@s\.whatsapp\.net$/, '').replace(/\D/g, '');
            if (!digits) {
                problems.push(`"${entry}" contains no phone number`);
            } else if (digits.startsWith('0')) {
                problems.push(`"${entry}" starts with 0 — use the country code instead (e.g. 62812… not 0812…)`);
            } else if (!this._isPlausibleNumber(digits)) {
                problems.push(`"${entry}" is ${digits.length} digits — a number with country code has 8-15`);
            } else if (entry.endsWith('@s.whatsapp.net') && entry !== `${digits}@s.whatsapp.net`) {
                problems.push(`"${entry}" has extra characters before @s.whatsapp.net`);
            }
        }
        return problems;
    }

    /**
     * Check if a sender is the bot owner
     * Supports multiple owner IDs (for private and group chat formats)
     * @param {string} senderId - Sender JID
     * @returns {boolean}
     */
    isOwner(senderId) {
        if (!senderId) return false;
        
        // Check against all owner IDs
        const ownerIds = this.bot.ownerIds;
        if (!ownerIds || ownerIds.length === 0) return false;
        
        for (const ownerId of ownerIds) {
            if (this._matchesOwnerId(senderId, ownerId)) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * Check if sender matches a specific owner ID
     * @param {string} senderId - Sender JID
     * @param {string} ownerId - Owner ID to check against
     * @returns {boolean}
     */
    _matchesOwnerId(senderId, ownerId) {
        if (!ownerId || !senderId) return false;
        
        // Direct match (works for both @lid and @s.whatsapp.net)
        if (senderId === ownerId) {
            return true;
        }
        
        // If owner uses @s.whatsapp.net format, try to normalize sender
        if (ownerId.endsWith('@s.whatsapp.net')) {
            let normalizedSender = senderId;
            
            // If sender uses @lid format, cannot match with @s.whatsapp.net
            if (senderId.endsWith('@lid')) {
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
            
            return normalizedSender === ownerId;
        }
        
        return false;
    }

    /**
     * Get all owner IDs (for protection checks)
     * @returns {string[]}
     */
    getOwnerIds() {
        return this.bot.ownerIds || [];
    }

    /**
     * Check if a command is owner-only
     * @param {string} commandName - Command name
     * @returns {boolean}
     */
    isOwnerOnlyCommand(commandName) {
        return this.bot.ownerOnlyCommands.includes(commandName.toLowerCase());
    }

    /**
     * Check if a command may only be run by a group admin
     * @param {string} commandName - Command name
     * @returns {boolean}
     */
    isAdminOnlyCommand(commandName) {
        return this.bot.adminOnlyCommands.includes(String(commandName).toLowerCase());
    }

    validate() {
        const errors = [];

        if (this.performance.maxProcesses < 1) {
            errors.push('MAX_PROCESSES harus minimal 1');
        }

        if (this.performance.cooldownMs < 0) {
            errors.push('COOLDOWN_MS harus non-negatif');
        }

        // Note: console.warn here instead of logger to avoid a circular dependency
        for (const problem of this.ownerIdProblems()) {
            console.warn(`⚠️ BOT_OWNER_ID: ${problem}. That entry is ignored — fix it with ./deploy.sh config or in .env.`);
        }
        if (!this.bot.ownerIds || this.bot.ownerIds.length === 0) {
            console.warn('⚠️ PERINGATAN: BOT_OWNER_ID tidak dikonfigurasi. Perintah owner-only tidak akan berfungsi.');
        }

        if (errors.length > 0) {
            throw new Error(`Validasi konfigurasi gagal:\n${errors.join('\n')}`);
        }

        return true;
    }
}

module.exports = new Config();
