/**
 * Weather Command
 * Info cuaca untuk lokasi manapun
 */

const CommandBase = require('./base');
const ui = require('../utils/ui');
const httpClient = require('../utils/http-client');
const cache = require('../utils/cache');
const logger = require('../utils/logger');

class WeatherCommand extends CommandBase {
    constructor() {
        super({
            name: 'weather',
            aliases: ['cuaca', 'wthr'],
            description: 'Info cuaca untuk lokasi manapun',
            usage: '.weather <nama kota>',
            category: 'utility',
            cooldown: 3000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        if (!args[0]) {
            return await this.replyUsage(sock, from, msg, {
                icon: '🌤️',
                title: 'Info Cuaca',
                description: 'Cek kondisi cuaca terkini di kota manapun.',
                usage: ['.weather <kota>'],
                examples: ['.weather Jakarta', '.weather Bandung', '.weather Tokyo']
            });
        }

        await this.react(sock, msg, '🌤️');

        const location = args.join(' ');
        const cacheKey = `weather:${location.toLowerCase()}`;

        // Check cache (10 minute cache)
        const cached = cache.get(cacheKey);
        if (cached) {
            return await this.sendWeatherInfo(sock, from, msg, cached, true);
        }

        try {
            // Using wttr.in free weather API with proxy support
            logger.info(`Weather: fetching data for "${location}"`);
            const { data } = await httpClient.get(
                `https://wttr.in/${encodeURIComponent(location)}?format=j1`,
                { timeout: 10000 }
            );
            logger.info('Weather: data received');

            // Cache for 10 minutes
            cache.set(cacheKey, data, 600000);

            await this.sendWeatherInfo(sock, from, msg, data, false);

        } catch (error) {
            this.logError(error, context);
            await this.replyError(sock, from, msg,
                `Data cuaca untuk ${ui.mono(ui.safe(location, 40))} tidak ditemukan.`, {
                    title: 'Lokasi Tidak Ditemukan',
                    hint: ['Periksa ejaan nama kotanya', '.weather Jakarta']
                });
        }
    }

    async sendWeatherInfo(sock, from, msg, data, fromCache) {
        try {
            const current = data.current_condition[0];
            const location = data.nearest_area[0];

            const weatherDesc = current.weatherDesc[0].value;
            const temp = current.temp_C;
            const feelsLike = current.FeelsLikeC;
            const humidity = current.humidity;
            const windSpeed = current.windspeedKmph;
            const windDir = current.winddir16Point;
            const pressure = current.pressure;
            const visibility = current.visibility;
            const uvIndex = current.uvIndex;

            const locationName = location.areaName[0].value;
            const country = location.country[0].value;

            const emoji = this.getWeatherEmoji(weatherDesc);

            const info = ui.card({
                icon: emoji,
                title: `${locationName}, ${country}`,
                lines: [
                    ui.kv('Suhu', `${temp}°C (terasa ${feelsLike}°C)`, '🌡️'),
                    ui.kv('Kondisi', weatherDesc, '☁️'),
                    ui.kv('Kelembapan', `${humidity}%`, '💧'),
                    ui.kv('Angin', `${windSpeed} km/j ${windDir}`, '💨'),
                    ui.kv('Tekanan', `${pressure} mb`, '📊'),
                    ui.kv('Jarak pandang', `${visibility} km`, '👁️'),
                    ui.kv('Indeks UV', uvIndex, '☀️')
                ],
                footer: `${ui.sourceBadge(fromCache)} ${ui.SYM.dot} ${ui.clock()}`
            });

            await this.reply(sock, from, msg, info);
            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, { context: 'send-weather-info' });
            throw error;
        }
    }

    getWeatherEmoji(description) {
        const desc = description.toLowerCase();
        if (desc.includes('sunny') || desc.includes('clear')) return '☀️';
        if (desc.includes('cloud')) return '☁️';
        if (desc.includes('rain') || desc.includes('drizzle')) return '🌧️';
        if (desc.includes('storm') || desc.includes('thunder')) return '⛈️';
        if (desc.includes('snow')) return '❄️';
        if (desc.includes('fog') || desc.includes('mist')) return '🌫️';
        return '🌤️';
    }
}

module.exports = WeatherCommand;
