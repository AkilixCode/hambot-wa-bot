/**
 * Security Manager
 * Comprehensive security controls and threat protection
 */

const dns = require('dns').promises;
const logger = require('./logger');
const config = require('../config');
const redact = require('./redact');

// How many audit entries are kept in memory (ring buffer).
const AUDIT_LOG_MAX = 200;

// Per-user security event counters are forgotten after this long without a
// new event. They were never pruned before, so the map grew for as long as
// the process ran — one key per event type per user ever seen.
const SECURITY_EVENT_TTL_MS = 24 * 60 * 60 * 1000;

// Unauthorized attempts on owner-only commands: window and escalating penalties.
const UNAUTHORIZED_WINDOW_MS = 10 * 60 * 1000;
const UNAUTHORIZED_PENALTIES = [
    { attempts: 8, blockMs: 12 * 60 * 60 * 1000 },
    { attempts: 5, blockMs: 2 * 60 * 60 * 1000 },
    { attempts: 3, blockMs: 30 * 60 * 1000 }
];

class SecurityManager {
    constructor() {
        // Blacklist for malicious patterns.
        //
        // Shell metacharacters and SQL keywords used to be listed here too.
        // Nothing in the bot runs a shell (every spawn is shell:false) or a
        // database, so they guarded nothing — while rejecting `.calc (2+3)*4`,
        // any URL with `&` in its query string, and plain words like "update"
        // or "union", each hit counting towards an auto-block.
        this.blacklistedPatterns = [
            // Path traversal
            /\.\.[\/\\]/g,
            // Script injection
            /<script[^>]*>.*?<\/script>/gi,
            // Null bytes
            /\0/g
        ];

        // Whitelist patterns are now handled by stripExpressionTags() and stripLanguageTags()
        // methods which remove safe patterns before malicious pattern detection

        // Security event counters: `${event}_${userId}` -> { count, lastSeen }
        this.securityEvents = new Map();
        
        // Blocked users (temporary)
        this.blockedUsers = new Map();
        
        // Suspicious activity tracking
        this.suspiciousActivity = new Map();

        // Runtime security feature toggles (can be changed by owner via .security command)
        this.runtimeSettings = {
            chatFilterEnabled: true,  // Can be toggled at runtime
            rateLimitEnabled: true,   // Can be toggled at runtime
            autoBlockEnabled: true,   // Auto-block on suspicious activity
            lockdownEnabled: false    // Panic mode: only the owner is served
        };

        // Rolling audit trail of security-relevant events and owner actions.
        // In-memory only — never persisted, so it cannot be exfiltrated from disk.
        this.auditLog = [];

        // Failed owner-only command attempts, keyed by user ID.
        this.unauthorizedAttempts = new Map();
    }

    // ─────────────────────────────────────────────────────
    //  AUDIT TRAIL
    // ─────────────────────────────────────────────────────

    /**
     * Append an entry to the in-memory audit trail.
     * All free-text detail is redacted on the way in so a secret can never be
     * stored and later replayed by `.security audit`.
     *
     * @param {string} action - Short action key, e.g. 'owner.restart'
     * @param {Object} details - { actor, target, outcome, detail }
     * @returns {Object} The stored entry
     */
    recordAudit(action, details = {}) {
        const entry = {
            timestamp: Date.now(),
            action: String(action).slice(0, 64),
            actor: details.actor ? redact.maskJid(details.actor) : 'system',
            target: details.target ? redact.maskJid(details.target) : null,
            outcome: details.outcome || 'ok',
            detail: details.detail ? redact.redact(String(details.detail)).slice(0, 200) : null
        };

        this.auditLog.push(entry);
        if (this.auditLog.length > AUDIT_LOG_MAX) {
            this.auditLog.splice(0, this.auditLog.length - AUDIT_LOG_MAX);
        }

        return entry;
    }

    /**
     * Read the most recent audit entries (newest first).
     * @param {number} limit - Maximum number of entries
     * @returns {Array}
     */
    getAuditLog(limit = 20) {
        const safeLimit = Math.min(Math.max(parseInt(limit) || 20, 1), AUDIT_LOG_MAX);
        return this.auditLog.slice(-safeLimit).reverse();
    }

    /**
     * Clear the audit trail.
     * @returns {number} Number of entries removed
     */
    clearAuditLog() {
        const count = this.auditLog.length;
        this.auditLog = [];
        return count;
    }

    // ─────────────────────────────────────────────────────
    //  LOCKDOWN (PANIC MODE)
    // ─────────────────────────────────────────────────────

    /**
     * Enable or disable lockdown. While locked down the bot silently ignores
     * every message that does not come from an owner ID.
     * @param {boolean} enabled
     * @param {string} [actor] - Who flipped the switch (for the audit trail)
     * @returns {boolean} New state
     */
    setLockdown(enabled, actor = null) {
        this.runtimeSettings.lockdownEnabled = Boolean(enabled);
        this.recordAudit(enabled ? 'lockdown.enabled' : 'lockdown.disabled', { actor });
        logger.warn(`Lockdown mode ${enabled ? 'ENABLED' : 'disabled'}`);
        return this.runtimeSettings.lockdownEnabled;
    }

    /**
     * @returns {boolean} Whether lockdown mode is active
     */
    isLockdownEnabled() {
        return this.runtimeSettings.lockdownEnabled === true;
    }

    // ─────────────────────────────────────────────────────
    //  OWNER-COMMAND BRUTE FORCE PROTECTION
    // ─────────────────────────────────────────────────────

    /**
     * Record a non-owner trying to run an owner-only command and apply an
     * escalating temporary block once the attempts pass a threshold.
     *
     * Without this, an attacker can probe `.security` endlessly for free —
     * every failed attempt is a chance to find a gap in the owner check.
     *
     * @param {string} userId - Sender JID
     * @param {string} attemptedCommand - What they tried to run (redacted before storage)
     * @returns {Object} { attempts: number, blocked: boolean, blockMinutes: number|null }
     */
    registerUnauthorizedAttempt(userId, attemptedCommand = '') {
        // Owners can never lock themselves out via this path.
        if (!userId || config.isOwner(userId)) {
            return { attempts: 0, blocked: false, blockMinutes: null };
        }

        const now = Date.now();
        const previous = (this.unauthorizedAttempts.get(userId) || [])
            .filter(ts => now - ts < UNAUTHORIZED_WINDOW_MS);
        previous.push(now);
        this.unauthorizedAttempts.set(userId, previous);

        this.logSecurityEvent('unauthorized_owner_command', {
            userId,
            attemptedCommand: String(attemptedCommand).slice(0, 100),
            attempts: previous.length
        });

        if (!this.runtimeSettings.autoBlockEnabled) {
            return { attempts: previous.length, blocked: false, blockMinutes: null };
        }

        const penalty = UNAUTHORIZED_PENALTIES.find(p => previous.length >= p.attempts);
        if (!penalty) {
            return { attempts: previous.length, blocked: false, blockMinutes: null };
        }

        const result = this.blockUser(userId, penalty.blockMs, 'Percobaan akses perintah owner berulang');
        return {
            attempts: previous.length,
            blocked: result.success,
            blockMinutes: result.success ? Math.round(penalty.blockMs / 60000) : null
        };
    }

    /**
     * Forget recorded unauthorized attempts for a user (used when unblocking).
     * @param {string} userId
     */
    clearUnauthorizedAttempts(userId) {
        this.unauthorizedAttempts.delete(userId);
    }

    /**
     * Sanitize user input to prevent injection attacks
     */
    sanitizeInput(input, maxLength = 1000) {
        if (!input || typeof input !== 'string') {
            return '';
        }

        // Trim and limit length
        let sanitized = input.trim().slice(0, maxLength);

        // Remove null bytes
        sanitized = sanitized.replace(/\0/g, '');

        // Remove control characters except newline and tab
        sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

        // Encode special characters for specific contexts
        // This is a general sanitization, commands may need specific handling

        return sanitized;
    }

    /**
     * Check if input contains valid expression tags
     * Expression tags like [screaming], [whispering] are safe for TTS
     * @param {string} input - Input to check
     * @returns {string} - Input with expression tags removed (for further checking)
     */
    stripExpressionTags(input) {
        if (!input) return input;
        // Remove valid expression tags (only word characters and spaces inside brackets)
        // Pattern: [word] or [multiple words]
        return input.replace(/\[[\w\s]+\]/g, '');
    }

    /**
     * Check if input contains valid language tags
     * Language tags like <en>, <id> are safe for TTS
     * @param {string} input - Input to check
     * @returns {string} - Input with language tags removed
     */
    stripLanguageTags(input) {
        if (!input) return input;
        // Remove valid language tags: <xx> where xx is 2 lowercase letters
        return input.replace(/<[a-z]{2}>/gi, '');
    }

    /**
     * Check for malicious patterns in input
     * Respects whitelisted patterns (e.g., TTS expression tags, language tags)
     */
    detectMaliciousPatterns(input) {
        if (!input) return { isMalicious: false };

        // First, strip out safe patterns (expression tags and language tags)
        // These look like injection but are actually safe for TTS commands
        let sanitizedInput = this.stripExpressionTags(input);
        sanitizedInput = this.stripLanguageTags(sanitizedInput);

        for (const pattern of this.blacklistedPatterns) {
            // Reset lastIndex for global patterns before testing
            pattern.lastIndex = 0;
            
            if (pattern.test(sanitizedInput)) {
                const matched = sanitizedInput.match(pattern);
                
                return {
                    isMalicious: true,
                    pattern: pattern.toString(),
                    matched: matched
                };
            }
        }

        return { isMalicious: false };
    }

    /**
     * Validate command arguments
     */
    validateCommandArgs(command, args) {
        // Check for excessively long arguments
        for (const arg of args) {
            if (arg.length > 2000) {
                return {
                    valid: false,
                    reason: 'Argumen terlalu panjang (maksimal 2000 karakter).'
                };
            }
        }

        // Check for suspicious patterns in calc command
        if (command === 'calc') {
            const expression = args.join(' ');
            // Only allow math operations
            if (!/^[0-9+\-*/.() ,MathsqrtSincostanlogabsroundfloorcepiPIE\^×÷]+$/i.test(expression)) {
                return {
                    valid: false,
                    reason: 'Ada karakter yang tidak diizinkan dalam ekspresi matematika.'
                };
            }
        }

        // Check for URL validation in commands that use URLs.
        // `music` belongs here too: it hands the URL straight to yt-dlp, so
        // leaving it out made it the one unguarded path to the internal network.
        if (['video', 'photo', 'music'].includes(command)) {
            const url = args[0];
            // Only validate when the argument actually looks like a URL —
            // `.music <judul lagu>` is a search, not a fetch.
            if (url && /^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !this.isValidURL(url)) {
                return {
                    valid: false,
                    reason: 'URL tidak valid atau mengarah ke jaringan internal.'
                };
            }
        }

        return { valid: true };
    }

    /**
     * Is this IPv4 address outside the public internet?
     *
     * @param {number} a First octet
     * @param {number} b Second octet
     * @returns {boolean}
     * @private
     */
    _isPrivateIPv4(a, b) {
        if (a === 0) return true;                          // 0.0.0.0/8 "this network"
        if (a === 10) return true;                          // 10.0.0.0/8
        if (a === 127) return true;                         // loopback, all of 127/8
        if (a === 169 && b === 254) return true;            // link-local + cloud metadata
        if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16.0.0/12, incl. Docker's bridge
        if (a === 192 && b === 168) return true;            // 192.168.0.0/16
        if (a === 192 && b === 0) return true;              // 192.0.0.0/24 + TEST-NET-1
        if (a === 100 && b >= 64 && b <= 127) return true;  // 100.64.0.0/10 CGNAT / Tailscale
        if (a >= 224) return true;                          // multicast, reserved, broadcast
        return false;
    }

    /**
     * Is this IPv6 address outside the public internet?
     * @param {string} address Address without the surrounding brackets
     * @returns {boolean}
     * @private
     */
    _isPrivateIPv6(address) {
        const addr = String(address).toLowerCase();

        if (addr === '::1' || addr === '::') return true;

        // IPv4-mapped addresses (::ffff:7f00:1) tunnel an IPv4 target through
        // an IPv6 literal, so unwrap and re-check the embedded address.
        const mapped = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
        if (mapped) {
            const high = parseInt(mapped[1], 16);
            return this._isPrivateIPv4((high >> 8) & 0xff, high & 0xff);
        }

        if (/^f[cd]/.test(addr)) return true;    // fc00::/7 unique local
        if (/^fe[89ab]/.test(addr)) return true; // fe80::/10 link-local
        return false;
    }

    /**
     * Does this hostname point somewhere that is not the public internet?
     *
     * The WHATWG URL parser already normalises the alternate IPv4 encodings
     * (2130706433, 0x7f000001, 127.1, 0177.0.0.1 all become 127.0.0.1), so only
     * the dotted-quad form has to be recognised here.
     *
     * @param {string} hostname url.hostname, IPv6 literals still bracketed
     * @returns {boolean}
     */
    isPrivateHostname(hostname) {
        // A trailing dot makes an FQDN ("localhost.") that resolves identically
        // but slips past a naive equality check.
        const host = String(hostname || '').toLowerCase().replace(/\.+$/, '');
        if (!host) return true;

        if (host.startsWith('[') && host.endsWith(']')) {
            return this._isPrivateIPv6(host.slice(1, -1));
        }

        if (host === 'localhost' || host.endsWith('.localhost') ||
            host.endsWith('.local') || host.endsWith('.internal') ||
            host.endsWith('.home.arpa') || host === 'metadata') {
            return true;
        }

        const quad = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
        if (quad) {
            return this._isPrivateIPv4(Number(quad[1]), Number(quad[2]));
        }

        return false;
    }

    /**
     * Resolve a URL's hostname and confirm every address it maps to is public.
     *
     * isValidURL() only inspects the text of the URL, so a hostname the
     * attacker controls ("evil.example.com" with an A record of 169.254.169.254)
     * sails straight through it. Call this before handing a user-supplied URL to
     * anything that will actually fetch it.
     *
     * A resolver failure is treated as unsafe: if we cannot tell where a name
     * points, we do not fetch it.
     *
     * @param {string} string A URL
     * @returns {Promise<{safe: boolean, reason?: string}>}
     */
    async resolvesToPublicHost(string) {
        let url;
        try {
            url = new URL(string);
        } catch (e) {
            return { safe: false, reason: 'URL tidak valid.' };
        }

        const hostname = url.hostname.replace(/^\[|\]$/g, '');

        // A literal address needs no lookup; isPrivateHostname already ruled on it.
        if (/^[\d.]+$/.test(hostname) || hostname.includes(':')) {
            return this.isPrivateHostname(url.hostname)
                ? { safe: false, reason: 'URL mengarah ke jaringan internal.' }
                : { safe: true };
        }

        try {
            const records = await dns.lookup(hostname, { all: true });
            for (const record of records) {
                const bracketed = record.family === 6 ? `[${record.address}]` : record.address;
                if (this.isPrivateHostname(bracketed)) {
                    return { safe: false, reason: 'URL mengarah ke jaringan internal.' };
                }
            }
            return { safe: true };
        } catch (error) {
            return { safe: false, reason: 'Nama domain tidak bisa diperiksa.' };
        }
    }

    /**
     * Validate URL for safety.
     *
     * This is a syntactic check: it stops a user from naming an internal
     * address directly. It cannot stop a public hostname whose DNS record
     * points inward — use resolvesToPublicHost() before actually fetching.
     *
     * @param {string} string
     * @returns {boolean}
     */
    isValidURL(string) {
        try {
            const url = new URL(string);

            // Only allow http and https
            if (!['http:', 'https:'].includes(url.protocol)) {
                return false;
            }

            // Credentials in a URL are a redirect/confusion trick far more often
            // than a legitimate need for a download link.
            if (url.username || url.password) {
                return false;
            }

            if (this.isPrivateHostname(url.hostname)) {
                return false;
            }

            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Check if user is blocked
     * Checks all possible ID formats for the user
     */
    isUserBlocked(userId) {
        // Never block owner
        if (config.isOwner(userId)) {
            return false;
        }
        
        // Check direct ID
        if (this._isIdBlocked(userId)) {
            return true;
        }
        
        // Check normalized versions of the ID
        const normalizedIds = this._normalizeUserIdForBlocking(userId);
        for (const normalizedId of normalizedIds) {
            if (this._isIdBlocked(normalizedId)) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * Internal check if a specific ID is blocked
     */
    _isIdBlocked(userId) {
        if (!this.blockedUsers.has(userId)) {
            return false;
        }

        const blockInfo = this.blockedUsers.get(userId);
        
        // Check if block has expired
        if (Date.now() > blockInfo.until) {
            this.blockedUsers.delete(userId);
            return false;
        }

        return true;
    }

    /**
     * Normalize user ID to all possible formats for blocking/lookup
     * Returns array of possible ID formats
     * @param {string} input - User ID or phone number
     * @returns {string[]} Array of possible JID formats
     */
    _normalizeUserIdForBlocking(input) {
        if (!input) return [];
        
        const results = [];
        let cleanInput = input.trim();
        
        // If already has suffix, extract number part
        let numberPart = cleanInput;
        if (cleanInput.includes('@')) {
            numberPart = cleanInput.split('@')[0];
            // Also add the original format
            results.push(cleanInput);
        }
        
        // Clean the number part (remove non-digits)
        const cleanNumber = numberPart.replace(/\D/g, '');
        
        if (cleanNumber) {
            // Handle Indonesian format (0xxx -> 62xxx)
            let normalizedNumber = cleanNumber;
            if (cleanNumber.startsWith('0')) {
                normalizedNumber = '62' + cleanNumber.substring(1);
            }
            
            // Add @s.whatsapp.net format
            results.push(`${normalizedNumber}@s.whatsapp.net`);
            
            // Also add with original number if different
            if (cleanNumber !== normalizedNumber) {
                results.push(`${cleanNumber}@s.whatsapp.net`);
            }
        }
        
        return [...new Set(results)]; // Remove duplicates
    }

    /**
     * Block user temporarily
     * Protects owner from being blocked
     * @param {string} userId - User ID to block
     * @param {number} durationMs - Block duration in milliseconds
     * @param {string} reason - Reason for blocking
     * @returns {Object} Result of block attempt
     */
    blockUser(userId, durationMs = 3600000, reason = 'Security violation') {
        // Normalize the user ID to get all possible formats
        const normalizedIds = this._normalizeUserIdForBlocking(userId);
        const primaryId = normalizedIds[0] || userId;
        
        // CRITICAL: Never allow blocking the owner
        // Check original userId first
        const isOriginalOwner = config.isOwner(userId);
        if (isOriginalOwner) {
            logger.warn(`Attempted to block owner - rejected`, { userId });
            return { success: false, reason: 'Tidak dapat memblokir owner bot' };
        }
        
        // Also check all normalized IDs against owner
        for (const normalizedId of normalizedIds) {
            if (config.isOwner(normalizedId)) {
                logger.warn(`Attempted to block owner (normalized) - rejected`, { userId, normalizedId });
                return { success: false, reason: 'Tidak dapat memblokir owner bot' };
            }
        }
        
        const until = Date.now() + durationMs;
        
        // Block all normalized versions of the ID
        for (const normalizedId of normalizedIds) {
            this.blockedUsers.set(normalizedId, { until, reason, originalId: userId });
        }
        
        // If no normalized IDs, block the original
        if (normalizedIds.length === 0) {
            this.blockedUsers.set(userId, { until, reason });
        }
        
        logger.warn(`User blocked`, {
            userId: primaryId.split('@')[0],
            duration: `${durationMs / 1000}s`,
            reason,
            allBlockedIds: normalizedIds
        });
        
        return { success: true, blockedId: primaryId, allBlockedIds: normalizedIds };
    }

    /**
     * Clear blocks for owner IDs on startup
     * Safety fallback in case owner accidentally gets blocked
     */
    clearOwnerBlocks() {
        const ownerIds = config.getOwnerIds();
        let clearedCount = 0;
        
        for (const ownerId of ownerIds) {
            if (this.blockedUsers.has(ownerId)) {
                this.blockedUsers.delete(ownerId);
                clearedCount++;
                logger.info(`Cleared block for owner ID on startup`, { ownerId });
            }
            
            // Also check normalized versions
            const normalizedIds = this._normalizeUserIdForBlocking(ownerId);
            for (const normalizedId of normalizedIds) {
                if (this.blockedUsers.has(normalizedId)) {
                    this.blockedUsers.delete(normalizedId);
                    clearedCount++;
                    logger.info(`Cleared block for normalized owner ID on startup`, { normalizedId });
                }
            }
        }
        
        return clearedCount;
    }

    /**
     * Track suspicious activity
     * Protected: Owner cannot be auto-blocked from suspicious activity
     */
    trackSuspiciousActivity(userId, activityType) {
        // Don't track or auto-block owner
        if (config.isOwner(userId)) {
            return false;
        }
        
        if (!this.suspiciousActivity.has(userId)) {
            this.suspiciousActivity.set(userId, []);
        }

        const activities = this.suspiciousActivity.get(userId);
        activities.push({
            type: activityType,
            timestamp: Date.now()
        });

        // Keep only last 100 activities
        if (activities.length > 100) {
            activities.shift();
        }

        // Check for abuse patterns
        const recentActivities = activities.filter(a => Date.now() - a.timestamp < 60000);
        
        // Respect the owner's `.security disable autoBlock` toggle — previously
        // only the owner-command path honoured it.
        if (recentActivities.length > 20 && this.runtimeSettings.autoBlockEnabled) {
            const result = this.blockUser(userId, 1800000, 'Excessive suspicious activity');
            return result.success;
        }

        return false;
    }

    /**
     * Log security event
     */
    logSecurityEvent(event, context = {}) {
        logger.warn('Security event', {
            event,
            ...context,
            timestamp: new Date().toISOString()
        });

        // Track security events
        const key = `${event}_${context.userId || 'unknown'}`;
        const counter = this.securityEvents.get(key) || { count: 0, lastSeen: 0 };
        counter.count++;
        counter.lastSeen = Date.now();
        this.securityEvents.set(key, counter);

        // Mirror into the audit trail so `.security audit` shows threats too
        const { userId, ...rest } = context;
        this.recordAudit(`event.${event}`, {
            actor: userId,
            outcome: 'blocked',
            detail: Object.keys(rest).length > 0 ? JSON.stringify(rest) : null
        });
    }

    /**
     * Validate file uploads (for future use)
     */
    validateFile(filename, maxSize = 10485760) { // 10MB default
        // Check file extension
        const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp3', '.mp4'];
        const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
        
        if (!allowedExtensions.includes(ext)) {
            return {
                valid: false,
                reason: 'File type not allowed'
            };
        }

        // Check for double extensions (e.g., file.jpg.exe)
        const parts = filename.split('.');
        if (parts.length > 2) {
            return {
                valid: false,
                reason: 'Suspicious filename (multiple extensions)'
            };
        }

        return { valid: true };
    }

    /**
     * Check command permissions
     * Uses centralized config for owner ID validation
     */
    checkPermission(userId, command, isGroup, isAdmin = false) {
        // Owner-only commands (from centralized config)
        if (config.isOwnerOnlyCommand(command)) {
            // Use centralized owner check from config
            if (!config.isOwner(userId)) {
                return {
                    allowed: false,
                    reason: 'Perintah khusus owner'
                };
            }
        }

        // Admin-only commands for groups. The list lives in config so it can be
        // tuned per deployment via ADMIN_ONLY_COMMANDS.
        if (isGroup && config.isAdminOnlyCommand(command) && !isAdmin) {
            return {
                allowed: false,
                reason: 'Perintah khusus admin di grup'
            };
        }

        return { allowed: true };
    }

    /**
     * Get security statistics
     */
    getStats() {
        return {
            blockedUsers: this.blockedUsers.size,
            suspiciousActivityTracked: this.suspiciousActivity.size,
            securityEvents: this.securityEvents.size,
            auditEntries: this.auditLog.length,
            unauthorizedTracked: this.unauthorizedAttempts.size,
            lockdownEnabled: this.isLockdownEnabled(),
            runtimeSettings: { ...this.runtimeSettings },
            recentBlocks: Array.from(this.blockedUsers.entries()).map(([id, info]) => ({
                userId: id.split('@')[0],
                reason: info.reason,
                expiresIn: Math.max(0, info.until - Date.now())
            }))
        };
    }

    /**
     * Summarise current threat activity for the owner panel.
     * IDs are returned masked — the panel never needs full numbers to be useful.
     * @param {number} limit - Max entries per list
     * @returns {Object}
     */
    getThreatSummary(limit = 10) {
        const now = Date.now();

        const suspicious = Array.from(this.suspiciousActivity.entries())
            .map(([userId, activities]) => {
                const recent = activities.filter(a => now - a.timestamp < 3600000);
                const types = {};
                for (const activity of recent) {
                    types[activity.type] = (types[activity.type] || 0) + 1;
                }
                return {
                    userId: redact.maskJid(userId),
                    total: activities.length,
                    lastHour: recent.length,
                    types,
                    lastSeen: activities.length ? activities[activities.length - 1].timestamp : null
                };
            })
            .filter(entry => entry.total > 0)
            .sort((a, b) => b.lastHour - a.lastHour || b.total - a.total)
            .slice(0, limit);

        const probes = Array.from(this.unauthorizedAttempts.entries())
            .map(([userId, timestamps]) => ({
                userId: redact.maskJid(userId),
                attempts: timestamps.length,
                lastSeen: timestamps[timestamps.length - 1] || null
            }))
            .sort((a, b) => b.attempts - a.attempts)
            .slice(0, limit);

        const events = Array.from(this.securityEvents.entries())
            .map(([key, { count }]) => ({ event: key.split('_').slice(0, -1).join('_') || key, count }))
            .reduce((acc, item) => {
                acc[item.event] = (acc[item.event] || 0) + item.count;
                return acc;
            }, {});

        return { suspicious, probes, events };
    }

    /**
     * Toggle a runtime security feature
     * @param {string} feature - Feature name: chatFilter, rateLimit, autoBlock
     * @param {boolean} enabled - Enable or disable
     * @returns {boolean} - New state
     */
    toggleFeature(feature, enabled) {
        const featureMap = {
            'chatFilter': 'chatFilterEnabled',
            'rateLimit': 'rateLimitEnabled',
            'autoBlock': 'autoBlockEnabled'
        };

        const settingKey = featureMap[feature];
        if (!settingKey) {
            return null;
        }

        this.runtimeSettings[settingKey] = enabled;
        logger.info(`Security feature toggled`, { feature, enabled });
        return this.runtimeSettings[settingKey];
    }

    /**
     * Check if a runtime feature is enabled
     * @param {string} feature - Feature name
     * @returns {boolean}
     */
    isFeatureEnabled(feature) {
        const featureMap = {
            'chatFilter': 'chatFilterEnabled',
            'rateLimit': 'rateLimitEnabled',
            'autoBlock': 'autoBlockEnabled'
        };

        const settingKey = featureMap[feature];
        if (!settingKey) {
            return true; // Default to enabled for unknown features
        }

        return this.runtimeSettings[settingKey];
    }

    /**
     * Unblock a specific user
     * Handles multiple ID formats
     * @param {string} userId - User ID to unblock
     * @returns {boolean} - True if user was unblocked
     */
    unblockUser(userId) {
        let unblocked = false;
        
        // Try to unblock direct ID
        if (this.blockedUsers.has(userId)) {
            this.blockedUsers.delete(userId);
            unblocked = true;
        }
        
        // Also unblock all normalized versions
        const normalizedIds = this._normalizeUserIdForBlocking(userId);
        for (const normalizedId of normalizedIds) {
            if (this.blockedUsers.has(normalizedId)) {
                this.blockedUsers.delete(normalizedId);
                unblocked = true;
            }
        }
        
        // Reset the unauthorized-attempt counter too, otherwise the next probe
        // immediately re-triggers the escalating block the owner just lifted.
        this.clearUnauthorizedAttempts(userId);
        for (const normalizedId of normalizedIds) {
            this.clearUnauthorizedAttempts(normalizedId);
        }

        if (unblocked) {
            logger.info(`User manually unblocked`, {
                userId: userId.split('@')[0],
                allUnblockedIds: [userId, ...normalizedIds]
            });
        }

        return unblocked;
    }

    /**
     * Clear all blocked users
     * @returns {number} - Number of users unblocked
     */
    clearAllBlocks() {
        const count = this.blockedUsers.size;
        this.blockedUsers.clear();
        this.unauthorizedAttempts.clear();
        logger.info(`All user blocks cleared`, { count });
        return count;
    }

    /**
     * Get list of all blocked users
     * @returns {Array}
     */
    getBlockedUsers() {
        return Array.from(this.blockedUsers.entries()).map(([id, info]) => ({
            userId: id,
            userIdShort: id.split('@')[0],
            reason: info.reason,
            until: info.until,
            expiresIn: Math.max(0, info.until - Date.now())
        }));
    }

    /**
     * Clean up expired data
     */
    cleanup() {
        // Remove expired blocks
        const now = Date.now();
        for (const [userId, info] of this.blockedUsers.entries()) {
            if (now > info.until) {
                this.blockedUsers.delete(userId);
            }
        }

        // Remove old suspicious activity (older than 1 hour)
        for (const [userId, activities] of this.suspiciousActivity.entries()) {
            const recent = activities.filter(a => now - a.timestamp < 3600000);
            if (recent.length === 0) {
                this.suspiciousActivity.delete(userId);
            } else {
                this.suspiciousActivity.set(userId, recent);
            }
        }

        // Forget event counters nobody has triggered for a day
        for (const [key, counter] of this.securityEvents.entries()) {
            if (now - counter.lastSeen > SECURITY_EVENT_TTL_MS) {
                this.securityEvents.delete(key);
            }
        }

        // Drop unauthorized-attempt counters that fell out of the window
        for (const [userId, timestamps] of this.unauthorizedAttempts.entries()) {
            const recent = timestamps.filter(ts => now - ts < UNAUTHORIZED_WINDOW_MS);
            if (recent.length === 0) {
                this.unauthorizedAttempts.delete(userId);
            } else {
                this.unauthorizedAttempts.set(userId, recent);
            }
        }
    }
}

// Singleton instance
const securityManager = new SecurityManager();

// Auto cleanup every 5 minutes
const cleanupTimer = setInterval(() => securityManager.cleanup(), 300000);
// Housekeeping only: must not keep the event loop alive on its own.
cleanupTimer.unref();

module.exports = securityManager;
