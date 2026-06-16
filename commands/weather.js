/**
 * Weather Command
 * Info cuaca untuk lokasi manapun
 */

const CommandBase = require('./base');
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
            return await this.reply(sock, from, msg, 
                '🌤️ *Info Cuaca*\n\n📝 Cara Pakai: .weather <kota>\n\n📌 Contoh:\n• .weather Jakarta\n• .weather Bandung\n• .weather Surabaya');
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
            await this.reply(sock, from, msg, `❌ Tidak bisa mengambil data cuaca untuk "${location}". Periksa nama lokasinya.`);
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

            const info = 
`${emoji} *Laporan Cuaca*

📍 Lokasi: ${locationName}, ${country}
🌡️ Suhu: ${temp}°C (terasa ${feelsLike}°C)
☁️ Kondisi: ${weatherDesc}
💧 Kelembaban: ${humidity}%
💨 Angin: ${windSpeed} km/h ${windDir}
📊 Tekanan: ${pressure} mb
👁️ Visibilitas: ${visibility} km
☀️ Indeks UV: ${uvIndex}

${fromCache ? '📦 _(dari cache)_' : '🔄 _Data langsung_'}`;

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
