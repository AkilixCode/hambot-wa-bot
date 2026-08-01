/**
 * Earthquake Info Command
 * Get latest earthquake information from BMKG (Indonesia)
 */

const CommandBase = require('./base');
const ui = require('../utils/ui');
const httpClient = require('../utils/http-client');
const cache = require('../utils/cache');
const logger = require('../utils/logger');

class GempaCommand extends CommandBase {
    constructor() {
        super({
            name: 'gempa',
            aliases: ['earthquake', 'quake'],
            description: 'Info gempa terbaru dari BMKG',
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
            await this.replyError(sock, from, msg, 'Gagal mengambil data gempa dari BMKG.', {
                hint: ['Coba lagi sebentar lagi']
            });
        }
    }

    async sendQuakeInfo(sock, from, msg, quake, fromCache) {
        try {
            const info = ui.card({
                icon: '⚠️',
                title: ui.smallCaps('Gempa Terkini'),
                lines: [
                    ui.kv('Waktu', `${quake.Tanggal}, ${quake.Jam}`, '📅'),
                    ui.kv('Magnitudo', `${quake.Magnitude} SR`, '📉'),
                    ui.kv('Kedalaman', quake.Kedalaman, '📏'),
                    ui.kv('Koordinat', quake.Coordinates, '📍'),
                    ui.kv('Wilayah', quake.Wilayah, '🗺️'),
                    '',
                    `⚠️ ${ui.bold('Potensi:')} ${quake.Potensi}`
                ],
                footer: `Sumber BMKG ${ui.SYM.dot} ${ui.sourceBadge(fromCache)}`
            });

            const imageUrl = `https://data.bmkg.go.id/DataMKG/TEWS/${quake.Shakemap}`;

            await this.replyMedia(sock, from, msg, {
                image: { url: imageUrl },
                caption: info
            });

            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, { context: 'send-quake-info' });
            throw error;
        }
    }
}

module.exports = GempaCommand;
