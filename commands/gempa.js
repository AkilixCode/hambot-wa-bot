/**
 * Earthquake Info Command
 * Get latest earthquake information from BMKG (Indonesia)
 */

const CommandBase = require('./base');
const httpClient = require('../utils/http-client');
const cache = require('../utils/cache');
const logger = require('../utils/logger');

class GempaCommand extends CommandBase {
    constructor() {
        super({
            name: 'gempa',
            aliases: ['earthquake', 'quake'],
            description: 'Get latest earthquake information from BMKG',
            usage: '.gempa',
            category: 'info',
            cooldown: 5000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        await this.react(sock, msg, '🌍');

        const cacheKey = 'gempa:latest';

        // Check cache (5 minute cache)
        const cached = cache.get(cacheKey);
        if (cached) {
            return await this.sendQuakeInfo(sock, from, msg, cached, true);
        }

        try {
            // BMKG API with proxy support
            logger.info('Gempa: fetching latest earthquake data...');
            const { data } = await httpClient.get(
                'https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json',
                { timeout: 10000 }
            );
            logger.info('Gempa: data received');

            const quake = data.Infogempa.gempa;

            // Cache for 5 minutes
            cache.set(cacheKey, quake, 300000);

            await this.sendQuakeInfo(sock, from, msg, quake, false);

        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, '❌ Failed to fetch earthquake data from BMKG.');
        }
    }

    async sendQuakeInfo(sock, from, msg, quake, fromCache) {
        try {
            const info = 
`⚠️ *LATEST EARTHQUAKE INFO*
_Data from BMKG (Indonesia)_

📅 Date: ${quake.Tanggal}
⏰ Time: ${quake.Jam} WIB
📍 Location: ${quake.Coordinates}
📉 Magnitude: ${quake.Magnitude} SR
📏 Depth: ${quake.Kedalaman}
🗺️ Region: ${quake.Wilayah}

⚠️ *Potential:* ${quake.Potensi}

${fromCache ? '📦 (cached data)' : '🔄 Live data'}`;

            const imageUrl = `https://data.bmkg.go.id/DataMKG/TEWS/${quake.Shakemap}`;

            await sock.sendMessage(from, {
                image: { url: imageUrl },
                caption: info
            }, { quoted: msg });

            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, { context: 'send-quake-info' });
            throw error;
        }
    }
}

module.exports = GempaCommand;
