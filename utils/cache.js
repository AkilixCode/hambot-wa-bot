/**
 * In-Memory Cache System
 * Sistem cache ringan dengan kedaluwarsa otomatis dan manajemen memori
 */

const logger = require('./logger');

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
        
        // Interval cleanup lebih panjang untuk efisiensi memori (5 menit)
        // Validasi untuk memastikan interval positif
        const envInterval = parseInt(process.env.CACHE_CLEANUP_INTERVAL);
        const cleanupInterval = (envInterval && envInterval > 0) ? envInterval : 300000;
        this.cleanupInterval = setInterval(() => this.cleanup(), cleanupInterval);
        
        // Batas maksimal entri untuk mencegah kebocoran memori
        this.maxEntries = 1000;
    }

    /**
     * Simpan nilai dengan TTL opsional
     * @param {string} key - Kunci cache
     * @param {*} value - Nilai untuk di-cache
     * @param {number} ttl - Time to live dalam milidetik
     */
    set(key, value, ttl = 300000) {
        // Cegah cache tumbuh terlalu besar
        if (this.store.size >= this.maxEntries) {
            this._evictOldest();
        }
        
        this.store.set(key, value);
        this.stats.sets++;
        
        if (ttl > 0) {
            const expiration = Date.now() + ttl;
            this.expirations.set(key, expiration);
        }
        
        return true;
    }

    /**
     * Evict entri terlama saat cache penuh
     * @private
     */
    _evictOldest() {
        // Hapus 10% entri terlama
        const toDelete = Math.ceil(this.maxEntries * 0.1);
        const keys = Array.from(this.store.keys()).slice(0, toDelete);
        for (const key of keys) {
            this.delete(key);
        }
        logger.debug(`Cache evicted ${toDelete} entri terlama`);
    }

    /**
     * Ambil nilai yang di-cache
     * @param {string} key - Kunci cache
     * @returns {*} Nilai yang di-cache atau undefined
     */
    get(key) {
        if (!this.store.has(key)) {
            this.stats.misses++;
            return undefined;
        }

        // Cek kedaluwarsa
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
     * Cek apakah kunci ada dan belum kedaluwarsa
     * @param {string} key - Kunci cache
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
     * Hapus nilai yang di-cache
     * @param {string} key - Kunci cache
     * @returns {boolean}
     */
    delete(key) {
        this.expirations.delete(key);
        this.stats.deletes++;
        return this.store.delete(key);
    }

    /**
     * Bersihkan semua nilai yang di-cache
     */
    clear() {
        this.store.clear();
        this.expirations.clear();
    }

    /**
     * Hapus entri yang kedaluwarsa
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
            logger.debug(`Cache: Membersihkan ${cleaned} entri kedaluwarsa`);
        }

        return cleaned;
    }

    /**
     * Dapatkan statistik cache
     * @returns {object} Stats cache
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
     * Dapatkan estimasi penggunaan memori
     * @returns {number} Perkiraan memori dalam bytes
     */
    getMemoryUsage() {
        let size = 0;
        for (const [key, value] of this.store.entries()) {
            size += key.length * 2; // Perkiraan ukuran string
            size += JSON.stringify(value).length * 2;
        }
        return size;
    }

    /**
     * Hancurkan cache dan bersihkan
     */
    destroy() {
        clearInterval(this.cleanupInterval);
        this.clear();
    }
}

module.exports = new Cache();
