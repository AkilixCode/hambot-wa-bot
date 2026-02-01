/**
 * Security Manager
 * Comprehensive security controls and threat protection
 */

const logger = require('./logger');
const config = require('../config');

class SecurityManager {
    constructor() {
        // Blacklist for malicious patterns
        this.blacklistedPatterns = [
            // Command injection
            /[;&|`$(){}[\]<>]/g,
            // Path traversal
            /\.\.[\/\\]/g,
            // SQL injection patterns
            /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION)\b)/gi,
            // Script injection
            /<script[^>]*>.*?<\/script>/gi,
            // Null bytes
            /\0/g
        ];

        // Whitelist patterns are now handled by stripExpressionTags() and stripLanguageTags()
        // methods which remove safe patterns before malicious pattern detection

        // Rate limit tracking for security events
        this.securityEvents = new Map();
        
        // Blocked users (temporary)
        this.blockedUsers = new Map();
        
        // Command execution limits per user
        this.commandLimits = new Map();
        
        // Suspicious activity tracking
        this.suspiciousActivity = new Map();

        // Runtime security feature toggles (can be changed by owner via .security command)
        this.runtimeSettings = {
            chatFilterEnabled: true,  // Can be toggled at runtime
            rateLimitEnabled: true,   // Can be toggled at runtime
            autoBlockEnabled: true    // Auto-block on suspicious activity
        };
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
                    reason: 'Argument too long (max 2000 characters)'
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
                    reason: 'Invalid characters in mathematical expression'
                };
            }
        }

        // Check for URL validation in commands that use URLs
        if (['video', 'photo'].includes(command)) {
            const url = args[0];
            if (url && !this.isValidURL(url)) {
                return {
                    valid: false,
                    reason: 'Invalid or suspicious URL'
                };
            }
        }

        return { valid: true };
    }

    /**
     * Validate URL for safety
     */
    isValidURL(string) {
        try {
            const url = new URL(string);
            
            // Block localhost and private IPs
            const hostname = url.hostname.toLowerCase();
            if (hostname === 'localhost' || 
                hostname === '127.0.0.1' ||
                hostname.startsWith('192.168.') ||
                hostname.startsWith('10.') ||
                hostname.startsWith('172.16.') ||
                hostname === '0.0.0.0') {
                return false;
            }

            // Only allow http and https
            if (!['http:', 'https:'].includes(url.protocol)) {
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
        
        if (recentActivities.length > 20) {
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
        if (!this.securityEvents.has(key)) {
            this.securityEvents.set(key, 0);
        }
        this.securityEvents.set(key, this.securityEvents.get(key) + 1);
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

        // Admin-only commands for groups
        const adminOnlyInGroups = [];
        if (isGroup && adminOnlyInGroups.includes(command) && !isAdmin) {
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
            runtimeSettings: { ...this.runtimeSettings },
            recentBlocks: Array.from(this.blockedUsers.entries()).map(([id, info]) => ({
                userId: id.split('@')[0],
                reason: info.reason,
                expiresIn: Math.max(0, info.until - Date.now())
            }))
        };
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
    }
}

// Singleton instance
const securityManager = new SecurityManager();

// Auto cleanup every 5 minutes
setInterval(() => securityManager.cleanup(), 300000);

module.exports = securityManager;
