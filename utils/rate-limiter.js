/**
 * Advanced Rate Limiter
 * Per-user rate limiting with sliding window algorithm
 */

class RateLimiter {
    constructor(windowMs = 60000, maxRequests = 10) {
        this.windowMs = windowMs;
        this.maxRequests = maxRequests;
        this.requests = new Map();
        
        // Auto cleanup old entries every minute
        this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
    }

    /**
     * Check if user is rate limited
     * @param {string} userId - User identifier
     * @returns {object} { allowed: boolean, remaining: number, resetTime: number }
     */
    check(userId) {
        const now = Date.now();
        
        if (!this.requests.has(userId)) {
            this.requests.set(userId, []);
        }

        const userRequests = this.requests.get(userId);
        
        // Remove old requests outside the window
        const validRequests = userRequests.filter(timestamp => now - timestamp < this.windowMs);
        this.requests.set(userId, validRequests);

        if (validRequests.length >= this.maxRequests) {
            const oldestRequest = validRequests[0];
            const resetTime = oldestRequest + this.windowMs;
            
            return {
                allowed: false,
                remaining: 0,
                resetTime: resetTime,
                retryAfter: Math.ceil((resetTime - now) / 1000)
            };
        }

        // Add current request
        validRequests.push(now);
        this.requests.set(userId, validRequests);

        return {
            allowed: true,
            remaining: this.maxRequests - validRequests.length,
            resetTime: now + this.windowMs,
            retryAfter: 0
        };
    }

    /**
     * Reset rate limit for a user
     * @param {string} userId - User identifier
     */
    reset(userId) {
        this.requests.delete(userId);
    }

    /**
     * Clean up old entries
     */
    cleanup() {
        const now = Date.now();
        let cleaned = 0;

        for (const [userId, timestamps] of this.requests.entries()) {
            const validRequests = timestamps.filter(ts => now - ts < this.windowMs);
            
            if (validRequests.length === 0) {
                this.requests.delete(userId);
                cleaned++;
            } else {
                this.requests.set(userId, validRequests);
            }
        }

        if (cleaned > 0) {
            console.log(`[RATE-LIMITER] Cleaned ${cleaned} inactive users`);
        }

        return cleaned;
    }

    /**
     * Get statistics
     * @returns {object}
     */
    getStats() {
        return {
            trackedUsers: this.requests.size,
            windowMs: this.windowMs,
            maxRequests: this.maxRequests
        };
    }

    /**
     * Destroy rate limiter
     */
    destroy() {
        clearInterval(this.cleanupInterval);
        this.requests.clear();
    }
}

module.exports = RateLimiter;
