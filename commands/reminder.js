/**
 * Reminder Command
 * Simple in-memory setTimeout based reminder
 */

const CommandBase = require('./base');

// In-memory storage for active reminders
const activeReminders = new Map();

class ReminderCommand extends CommandBase {
    constructor() {
        super({
            name: 'reminder',
            aliases: ['remind', 'ingetin', 'alarm'],
            description: 'Set a reminder for yourself',
            usage: '.remind <time> <message>\n\nTime formats: 5s, 10m, 1h, 1d',
            category: 'tools',
            cooldown: 2000,
            isHeavy: false
        });
    }

    async execute(sock, msg, args, context) {
        const { from, sender } = context;

        if (args.length < 2) {
            return await this.reply(sock, from, msg, 
                '⏰ *Reminder*\n\n' +
                'Set pengingat untuk dirimu!\n\n' +
                '*Format:*\n' +
                '.remind <waktu> <pesan>\n\n' +
                '*Contoh:*\n' +
                '• .remind 10m Masak mie\n' +
                '• .remind 1h Meeting zoom\n' +
                '• .remind 30s Cek hp\n' +
                '• .remind 2d Bayar tagihan\n\n' +
                '*Format waktu:*\n' +
                's = detik, m = menit, h = jam, d = hari'
            );
        }

        const timeArg = args[0].toLowerCase();
        const message = args.slice(1).join(' ');

        // Parse time
        const duration = this.parseTime(timeArg);
        if (duration === null) {
            return await this.reply(sock, from, msg, 
                '❌ Format waktu salah!\n\n' +
                'Gunakan: 10s, 5m, 1h, atau 1d\n' +
                's = detik, m = menit, h = jam, d = hari'
            );
        }

        // Limit reminder duration (max 7 days)
        const maxDuration = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
        if (duration > maxDuration) {
            return await this.reply(sock, from, msg, 
                '⚠️ Maksimal waktu reminder adalah 7 hari!'
            );
        }

        // Minimum 10 seconds
        if (duration < 10000) {
            return await this.reply(sock, from, msg, 
                '⚠️ Minimal waktu reminder adalah 10 detik!'
            );
        }

        await this.react(sock, msg, '⏰');

        // Generate reminder ID
        const reminderId = `${sender}_${Date.now()}`;
        
        // Set the reminder
        const timeout = setTimeout(async () => {
            try {
                // Send reminder message
                await sock.sendMessage(from, {
                    text: `⏰ *REMINDER!*\n\n${message}\n\n_Reminder set ${this.formatDuration(duration)} ago_`
                });
                
                // Clean up from active reminders
                activeReminders.delete(reminderId);
            } catch (error) {
                console.error('Failed to send reminder:', error);
                activeReminders.delete(reminderId);
            }
        }, duration);

        // Store the reminder
        activeReminders.set(reminderId, {
            timeout,
            message,
            sender,
            from,
            createdAt: Date.now(),
            duration
        });

        // Confirm reminder set
        const readableTime = this.formatDuration(duration);
        await this.reply(sock, from, msg, 
            `✅ Reminder set!\n\n` +
            `📝 *Pesan:* ${message}\n` +
            `⏱️ *Waktu:* ${readableTime} dari sekarang\n\n` +
            `_Bot akan mengingatkanmu nanti!_`
        );
    }

    /**
     * Parse time string to milliseconds
     * Supports: 30s, 5m, 1h, 1d
     */
    parseTime(timeStr) {
        const match = timeStr.match(/^(\d+)(s|m|h|d)$/);
        if (!match) return null;

        const value = parseInt(match[1]);
        const unit = match[2];

        if (value <= 0 || value > 9999) return null;

        const multipliers = {
            's': 1000,           // seconds
            'm': 60 * 1000,      // minutes
            'h': 60 * 60 * 1000, // hours
            'd': 24 * 60 * 60 * 1000 // days
        };

        return value * multipliers[unit];
    }

    /**
     * Format duration to human readable string
     */
    formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) {
            return `${days} hari${hours % 24 > 0 ? ` ${hours % 24} jam` : ''}`;
        }
        if (hours > 0) {
            return `${hours} jam${minutes % 60 > 0 ? ` ${minutes % 60} menit` : ''}`;
        }
        if (minutes > 0) {
            return `${minutes} menit${seconds % 60 > 0 ? ` ${seconds % 60} detik` : ''}`;
        }
        return `${seconds} detik`;
    }
}

// Note: Cleanup of active reminders is handled in index.js during graceful shutdown
// The activeReminders Map will be garbage collected when the process exits

module.exports = ReminderCommand;
