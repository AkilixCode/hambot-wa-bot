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

        // Rate limit tracking for security events
        this.securityEvents = new Map();
        
        // Blocked users (temporary)
        this.blockedUsers = new Map();
        
        // Command execution limits per user
        this.commandLimits = new Map();
        
        // Suspicious activity tracking
        this.suspiciousActivity = new Map();
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
     * Check for malicious patterns in input
     */
    detectMaliciousPatterns(input) {
        if (!input) return { isMalicious: false };

        for (const pattern of this.blacklistedPatterns) {
            if (pattern.test(input)) {
                return {
                    isMalicious: true,
                    pattern: pattern.toString(),
                    matched: input.match(pattern)
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
     */
    isUserBlocked(userId) {
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
     * Block user temporarily
     */
    blockUser(userId, durationMs = 3600000, reason = 'Security violation') {
        const until = Date.now() + durationMs;
        this.blockedUsers.set(userId, { until, reason });
        
        logger.warn(`User blocked`, {
            userId: userId.split('@')[0],
            duration: `${durationMs / 1000}s`,
            reason
        });
    }

    /**
     * Track suspicious activity
     */
    trackSuspiciousActivity(userId, activityType) {
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
            this.blockUser(userId, 1800000, 'Excessive suspicious activity');
            return true;
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
     */
    checkPermission(userId, command, isGroup, isAdmin = false) {
        // Owner-only commands (configure in .env)
        const ownerOnly = (process.env.OWNER_ONLY_COMMANDS || '').split(',').filter(c => c);
        if (ownerOnly.includes(command)) {
            const ownerId = process.env.BOT_OWNER_ID;
            // If owner ID is not set, allow in development mode
            // In production, owner ID MUST be set
            if (ownerId && userId !== ownerId) {
                return {
                    allowed: false,
                    reason: 'Owner-only command'
                };
            }
        }

        // Admin-only commands for groups
        const adminOnlyInGroups = ['tagall'];
        if (isGroup && adminOnlyInGroups.includes(command) && !isAdmin) {
            return {
                allowed: false,
                reason: 'Admin-only command in groups'
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
            recentBlocks: Array.from(this.blockedUsers.entries()).map(([id, info]) => ({
                userId: id.split('@')[0],
                reason: info.reason,
                expiresIn: Math.max(0, info.until - Date.now())
            }))
        };
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
