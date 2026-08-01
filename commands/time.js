/**
 * Time Command
 * Get current time in different timezones
 */

const CommandBase = require('./base');
const ui = require('../utils/ui');

class TimeCommand extends CommandBase {
    constructor() {
        super({
            name: 'time',
            aliases: ['timezone', 'clock'],
            description: 'Cek waktu di berbagai zona waktu',
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
            const cities = Object.keys(this.timezones).slice(0, 8);
            return await this.replyError(sock, from, msg,
                `Kota ${ui.mono(ui.safe(args[0], 30))} belum ada di daftar.`, {
                    title: 'Kota Tidak Ditemukan',
                    hint: [
                        `Kota tersedia: ${cities.join(', ')}`,
                        '.time — lihat jam dunia'
                    ]
                });
        }

        try {
            const date = new Intl.DateTimeFormat('id-ID', {
                timeZone: timezone,
                dateStyle: 'full'
            }).format(new Date());

            const time = new Intl.DateTimeFormat('en-GB', {
                timeZone: timezone,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            }).format(new Date());

            await this.reply(sock, from, msg, ui.card({
                icon: '🕐',
                title: `Waktu di ${ui.safe(args[0], 30)}`,
                lines: [
                    ui.kv('Jam', ui.bold(time), '⏰'),
                    ui.kv('Tanggal', date, '📅'),
                    ui.kv('Zona', timezone, '🌍')
                ]
            }));
            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            await this.replyError(sock, from, msg, 'Gagal membaca waktu untuk lokasi itu.', {
                hint: ['.time jakarta', '.time tokyo']
            });
        }
    }

    async showMultipleTimes(sock, from, msg) {
        const majorTimezones = [
            { city: 'Jakarta', tz: 'Asia/Jakarta' },
            { city: 'Tokyo', tz: 'Asia/Tokyo' },
            { city: 'Sydney', tz: 'Australia/Sydney' },
            { city: 'London', tz: 'Europe/London' },
            { city: 'New York', tz: 'America/New_York' },
            { city: 'Los Angeles', tz: 'America/Los_Angeles' }
        ];

        const lines = [];
        for (const { city, tz } of majorTimezones) {
            try {
                const time = new Intl.DateTimeFormat('en-GB', {
                    timeZone: tz,
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                }).format(new Date());

                lines.push(ui.kv(city, ui.bold(time), '🕐'));
            } catch (e) {
                // A timezone the runtime does not know is skipped rather than
                // failing the whole clock.
            }
        }

        await this.reply(sock, from, msg, ui.card({
            icon: '🌍',
            title: 'Jam Dunia',
            lines,
            footer: 'Ketik .time <kota> untuk kota tertentu'
        }));
        await this.react(sock, msg, '✅');
    }
}

module.exports = TimeCommand;
