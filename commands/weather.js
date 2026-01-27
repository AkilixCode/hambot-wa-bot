/**
 * Weather Command
 * Get weather information for any location
 */

const CommandBase = require('./base');
const httpClient = require('../utils/http-client');
const cache = require('../utils/cache');

class WeatherCommand extends CommandBase {
    constructor() {
        super({
            name: 'weather',
            aliases: ['cuaca', 'wthr'],
            description: 'Get current weather for any location',
            usage: '.weather <city name>',
            category: 'utility',
            cooldown: 3000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        if (!args[0]) {
            return await this.reply(sock, from, msg, 
                '🌤️ *Weather Information*\n\nUsage: .weather <city>\n\nExamples:\n• .weather London\n• .weather Jakarta\n• .weather New York');
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
            const { data } = await httpClient.get(
                `https://wttr.in/${encodeURIComponent(location)}?format=j1`,
                { timeout: 10000 }
            );

            // Cache for 10 minutes
            cache.set(cacheKey, data, 600000);

            await this.sendWeatherInfo(sock, from, msg, data, false);

        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, `❌ Could not fetch weather for "${location}". Please check the location name.`);
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
`${emoji} *Weather Report*

📍 Location: ${locationName}, ${country}
🌡️ Temperature: ${temp}°C (feels like ${feelsLike}°C)
☁️ Condition: ${weatherDesc}
💧 Humidity: ${humidity}%
💨 Wind: ${windSpeed} km/h ${windDir}
📊 Pressure: ${pressure} mb
👁️ Visibility: ${visibility} km
☀️ UV Index: ${uvIndex}

${fromCache ? '📦 (cached)' : '🔄 Live data'}`;

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
