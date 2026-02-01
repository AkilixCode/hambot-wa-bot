/**
 * Advanced Rate Limiter
 * Rate limiting per pengguna dengan algoritma sliding window
 */

const logger = require('./logger');

class RateLimiter {
    constructor(windowMs = 60000, maxRequests = 10) {
        this.windowMs = windowMs;
        this.maxRequests = maxRequests;
        this.requests = new Map();
        
        // Interval cleanup lebih panjang untuk efisiensi (2 menit)
        // Validasi untuk memastikan interval positif
        const envInterval = parseInt(process.env.RATE_LIMITER_CLEANUP_INTERVAL);
        const cleanupInterval = (envInterval && envInterval > 0) ? envInterval : 120000;
        this.cleanupInterval = setInterval(() => this.cleanup(), cleanupInterval);
        
        // Batas maksimal pengguna yang dilacak untuk mencegah kebocoran memori
        this.maxTrackedUsers = 5000;
    }

    /**
     * Cek apakah pengguna terkena rate limit
     * @param {string} userId - Identifikasi pengguna
     * @returns {object} { allowed: boolean, remaining: number, resetTime: number }
     */
    check(userId) {
        const now = Date.now();
        
        if (!this.requests.has(userId)) {
            // Cegah tracking terlalu banyak pengguna
            if (this.requests.size >= this.maxTrackedUsers) {
                this._evictInactive();
            }
            this.requests.set(userId, []);
        }

        const userRequests = this.requests.get(userId);
        
        // Hapus request lama di luar jendela
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

        // Tambahkan request saat ini
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
     * Evict pengguna tidak aktif saat tracking penuh
     * @private
     */
    _evictInactive() {
        const now = Date.now();
        let evicted = 0;
        
        for (const [userId, timestamps] of this.requests.entries()) {
            // Hapus pengguna tanpa request terbaru
            const recent = timestamps.filter(ts => now - ts < this.windowMs);
            if (recent.length === 0) {
                this.requests.delete(userId);
                evicted++;
            }
            // Berhenti setelah membebaskan cukup ruang
            if (evicted >= Math.ceil(this.maxTrackedUsers * 0.1)) break;
        }
        
        logger.debug(`Rate limiter: Evicted ${evicted} pengguna tidak aktif`);
    }

    /**
     * Reset rate limit untuk pengguna
     * @param {string} userId - Identifikasi pengguna
     */
    reset(userId) {
        this.requests.delete(userId);
    }

    /**
     * Bersihkan entri lama
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
            logger.debug(`Rate limiter: Membersihkan ${cleaned} pengguna tidak aktif`);
        }

        return cleaned;
    }

    /**
     * Dapatkan statistik
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
     * Hancurkan rate limiter
     */
    destroy() {
        clearInterval(this.cleanupInterval);
        this.requests.clear();
    }
}

module.exports = RateLimiter;
