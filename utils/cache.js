/**
 * In-Memory Cache System
 * Lightweight caching with automatic expiration and memory management
 */

class Cache {
    constructor() {
        this.store = new Map();
        this.expirations = new Map();
        this.stats = {
            hits: 0,
            misses: 0,
            sets: 0,
            deletes: 0
        };
        
        // Auto cleanup every 5 minutes
        this.cleanupInterval = setInterval(() => this.cleanup(), 300000);
    }

    /**
     * Store a value with optional TTL
     * @param {string} key - Cache key
     * @param {*} value - Value to cache
     * @param {number} ttl - Time to live in milliseconds
     */
    set(key, value, ttl = 300000) {
        this.store.set(key, value);
        this.stats.sets++;
        
        if (ttl > 0) {
            const expiration = Date.now() + ttl;
            this.expirations.set(key, expiration);
        }
        
        return true;
    }

    /**
     * Retrieve a cached value
     * @param {string} key - Cache key
     * @returns {*} Cached value or undefined
     */
    get(key) {
        if (!this.store.has(key)) {
            this.stats.misses++;
            return undefined;
        }

        // Check expiration
        if (this.expirations.has(key)) {
            const expiration = this.expirations.get(key);
            if (Date.now() > expiration) {
                this.delete(key);
                this.stats.misses++;
                return undefined;
            }
        }

        this.stats.hits++;
        return this.store.get(key);
    }

    /**
     * Check if key exists and is not expired
     * @param {string} key - Cache key
     * @returns {boolean}
     */
    has(key) {
        if (!this.store.has(key)) return false;
        
        if (this.expirations.has(key)) {
            const expiration = this.expirations.get(key);
            if (Date.now() > expiration) {
                this.delete(key);
                return false;
            }
        }
        
        return true;
    }

    /**
     * Delete a cached value
     * @param {string} key - Cache key
     * @returns {boolean}
     */
    delete(key) {
        this.expirations.delete(key);
        this.stats.deletes++;
        return this.store.delete(key);
    }

    /**
     * Clear all cached values
     */
    clear() {
        this.store.clear();
        this.expirations.clear();
    }

    /**
     * Remove expired entries
     */
    cleanup() {
        const now = Date.now();
        let cleaned = 0;

        for (const [key, expiration] of this.expirations.entries()) {
            if (now > expiration) {
                this.delete(key);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            console.log(`[CACHE] Cleaned ${cleaned} expired entries`);
        }

        return cleaned;
    }

    /**
     * Get cache statistics
     * @returns {object} Cache stats
     */
    getStats() {
        const hitRate = this.stats.hits + this.stats.misses > 0 
            ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
            : 0;

        return {
            ...this.stats,
            size: this.store.size,
            hitRate: `${hitRate}%`
        };
    }

    /**
     * Get memory usage estimate
     * @returns {number} Approximate memory in bytes
     */
    getMemoryUsage() {
        let size = 0;
        for (const [key, value] of this.store.entries()) {
            size += key.length * 2; // Approximate string size
            size += JSON.stringify(value).length * 2;
        }
        return size;
    }

    /**
     * Destroy cache and cleanup
     */
    destroy() {
        clearInterval(this.cleanupInterval);
        this.clear();
    }
}

module.exports = new Cache();
