/**
 * Reminder Command
 * Simple in-memory setTimeout based reminder
 */

const CommandBase = require('./base');
const ui = require('../utils/ui');

// In-memory storage for active reminders
const activeReminders = new Map();

// Every reminder is a live timer held in memory for up to 7 days. Without a
// ceiling one user could queue thousands of them at the rate-limit pace.
const MAX_PER_USER = 5;
const MAX_TOTAL = 500;

// Monotonic suffix for reminder IDs. A timestamp alone collides when two
// reminders land in the same millisecond, and the second silently replaced
// the first in the map while its timer still ran.
let nextReminderSeq = 0;

/**
 * Number of pending reminders a sender owns.
 * @param {string} sender
 * @returns {number}
 */
function countForSender(sender) {
    let count = 0;
    for (const reminder of activeReminders.values()) {
        if (reminder.sender === sender) count++;
    }
    return count;
}

class ReminderCommand extends CommandBase {
    constructor() {
        super({
            name: 'reminder',
            aliases: ['remind', 'ingetin', 'alarm'],
            description: 'Atur pengingat untuk dirimu',
            usage: '.remind <time> <message>\n\nTime formats: 5s, 10m, 1h, 1d',
            category: 'tools',
            cooldown: 2000,
            isHeavy: false
        });
    }

    async execute(sock, msg, args, context) {
        const { from, sender } = context;

        if (args.length < 2) {
            return await this.replyUsage(sock, from, msg, {
                icon: '⏰',
                title: 'Pengingat',
                description: 'Bot akan mengingatkanmu setelah waktu yang kamu tentukan.',
                usage: ['.remind <waktu> <pesan>'],
                examples: [
                    '.remind 10m Masak mie',
                    '.remind 1h Meeting zoom',
                    '.remind 2d Bayar tagihan'
                ],
                notes: [
                    'Satuan waktu: s detik, m menit, h jam, d hari',
                    'Minimal 10 detik, maksimal 7 hari'
                ]
            });
        }

        const timeArg = args[0].toLowerCase();
        const message = args.slice(1).join(' ');

        // Parse time
        const duration = this.parseTime(timeArg);
        if (duration === null) {
            return await this.replyError(sock, from, msg, 'Format waktunya salah.', {
                title: 'Format Salah',
                hint: [
                    'Gunakan: 10s, 5m, 1h, atau 1d',
                    's = detik, m = menit, h = jam, d = hari',
                    '.reminder 5m minum air'
                ]
            });
        }

        // Limit reminder duration (max 7 days)
        const maxDuration = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
        if (duration > maxDuration) {
            return await this.replyError(sock, from, msg, 'Maksimal waktu reminder adalah 7 hari.', {
                title: 'Terlalu Lama',
                hint: ['Coba yang lebih pendek, misalnya 1d']
            });
        }

        // Minimum 10 seconds
        if (duration < 10000) {
            return await this.replyError(sock, from, msg, 'Minimal waktu reminder adalah 10 detik.', {
                title: 'Terlalu Cepat',
                hint: ['Coba 10s atau lebih']
            });
        }

        if (countForSender(sender) >= MAX_PER_USER) {
            return await this.replyError(sock, from, msg,
                `Kamu sudah punya ${MAX_PER_USER} pengingat aktif.`, {
                    title: 'Batas Tercapai',
                    hint: ['Tunggu salah satu pengingat selesai dulu']
                });
        }

        if (activeReminders.size >= MAX_TOTAL) {
            return await this.replyError(sock, from, msg,
                'Bot sedang menyimpan terlalu banyak pengingat.', {
                    title: 'Penuh',
                    hint: ['Coba lagi nanti']
                });
        }

        await this.react(sock, msg, '⏰');

        // Generate reminder ID
        const reminderId = `${sender}_${Date.now()}_${++nextReminderSeq}`;
        
        // Set the reminder
        const timeout = setTimeout(async () => {
            try {
                // Send reminder message
                await sock.sendMessage(from, {
                    text: ui.clamp(ui.card({
                        icon: '⏰',
                        title: 'Pengingat',
                        // The message is the user's own text echoed back into
                        // the chat, so markdown is stripped.
                        lines: [ui.safe(message, 800)],
                        footer: `Dipasang ${this.formatDuration(duration)} lalu`
                    }))
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
        const dueAt = new Date(Date.now() + duration);

        await this.reply(sock, from, msg, ui.success('Pengingat Dipasang', [
            ui.kv('Pesan', ui.safe(ui.truncate(message, 120)), '📝'),
            ui.kv('Waktu', `${readableTime} dari sekarang`, '⏱️'),
            ui.kv('Jatuh tempo', ui.clock(dueAt), '🔔'),
            '',
            // Reminders live in a setTimeout, not on disk. Saying so up front
            // is better than silently losing one on a restart.
            ui.italic('Pengingat hilang kalau bot direstart.')
        ]));
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
module.exports.activeReminders = activeReminders;
module.exports.MAX_PER_USER = MAX_PER_USER;
module.exports.MAX_TOTAL = MAX_TOTAL;
