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
            browser: ['HamBot', 'Chrome', '1.0.0']
        };

        this.performance = {
            maxProcesses: parseInt(process.env.MAX_PROCESSES) || 3,
            cooldownMs: parseInt(process.env.COOLDOWN_MS) || 2000,
            rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW) || 60000, // 1 minute
            rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX) || 10,
            cacheExpiration: parseInt(process.env.CACHE_EXPIRATION) || 300000 // 5 minutes
        };

        this.media = {
            maxDuration: parseInt(process.env.MAX_MUSIC_DURATION) || 600, // 10 minutes
            maxFileSize: process.env.MAX_FILE_SIZE || '100M',
            proxyUrl: process.env.HB_PROXY_URL || null
        };

        this.apis = {
            elevenlabs: {
                key: process.env.ELEVENLABS_API_KEY,
                voiceId: process.env.ELEVENLABS_VOICE_ID || 'plgKUYgnlZ1DCNh54DwJ'
            },
            omdb: {
                key: process.env.OMDB_API_KEY
            }
        };

        this.logging = {
            level: process.env.LOG_LEVEL || 'info',
            silent: process.env.LOG_SILENT === 'true'
        };
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
