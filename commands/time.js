/**
 * Time Command
 * Get current time in different timezones
 */

const CommandBase = require('./base');

class TimeCommand extends CommandBase {
    constructor() {
        super({
            name: 'time',
            aliases: ['timezone', 'clock'],
            description: 'Get current time in different timezones',
            usage: '.time [city/timezone]',
            category: 'utility',
            cooldown: 2000
        });

        this.timezones = {
            // Major cities
            'london': 'Europe/London',
            'paris': 'Europe/Paris',
            'berlin': 'Europe/Berlin',
            'tokyo': 'Asia/Tokyo',
            'seoul': 'Asia/Seoul',
            'singapore': 'Asia/Singapore',
            'jakarta': 'Asia/Jakarta',
            'dubai': 'Asia/Dubai',
            'moscow': 'Europe/Moscow',
            'sydney': 'Australia/Sydney',
            'auckland': 'Pacific/Auckland',
            'newyork': 'America/New_York',
            'losangeles': 'America/Los_Angeles',
            'chicago': 'America/Chicago',
            'toronto': 'America/Toronto',
            'mexico': 'America/Mexico_City',
            'saopaulo': 'America/Sao_Paulo',
            'bangkok': 'Asia/Bangkok',
            'hongkong': 'Asia/Hong_Kong',
            'mumbai': 'Asia/Kolkata',
            'karachi': 'Asia/Karachi',
            'istanbul': 'Europe/Istanbul',
            'cairo': 'Africa/Cairo',
            'lagos': 'Africa/Lagos',
            'nairobi': 'Africa/Nairobi',
            
            // Timezone shortcuts
            'utc': 'UTC',
            'gmt': 'GMT',
            'est': 'America/New_York',
            'pst': 'America/Los_Angeles',
            'cst': 'America/Chicago',
            'jst': 'Asia/Tokyo',
            'ist': 'Asia/Kolkata',
            'wib': 'Asia/Jakarta'
        };
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        if (!args[0]) {
            return await this.showMultipleTimes(sock, from, msg);
        }

        await this.react(sock, msg, '🕐');

        const location = args[0].toLowerCase().replace(/\s+/g, '');
        const timezone = this.timezones[location];

        if (!timezone) {
            const cities = Object.keys(this.timezones).slice(0, 10).join(', ');
            return await this.reply(sock, from, msg, 
                `❌ City not found.\n\nTry: ${cities}...\n\nOr type .time to see multiple timezones`);
        }

        try {
            const time = new Date().toLocaleString('en-US', {
                timeZone: timezone,
                dateStyle: 'full',
                timeStyle: 'long'
            });

            const response = 
`🕐 *Time in ${args[0]}*

📅 ${time}

🌍 Timezone: ${timezone}`;

            await this.reply(sock, from, msg, response);
            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, '❌ Failed to get time for that location.');
        }
    }

    async showMultipleTimes(sock, from, msg) {
        const majorTimezones = [
            { city: 'London', tz: 'Europe/London' },
            { city: 'New York', tz: 'America/New_York' },
            { city: 'Los Angeles', tz: 'America/Los_Angeles' },
            { city: 'Tokyo', tz: 'Asia/Tokyo' },
            { city: 'Sydney', tz: 'Australia/Sydney' },
            { city: 'Jakarta', tz: 'Asia/Jakarta' }
        ];

        let response = '🌍 *World Clock*\n\n';

        for (const { city, tz } of majorTimezones) {
            try {
                const time = new Date().toLocaleString('en-US', {
                    timeZone: tz,
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true
                });
                
                response += `🕐 ${city}: ${time}\n`;
            } catch (e) {
                // Skip on error
            }
        }

        response += `\n_Type .time <city> for specific location_`;

        await this.reply(sock, from, msg, response);
        await this.react(sock, msg, '✅');
    }
}

module.exports = TimeCommand;
