/**
 * Spam Command
 * Prank spam chat (Owner Only)
 * With safety mechanisms: max limit, random delay, stop on error
 */

const CommandBase = require('./base');
const { sleep } = require('../utils/helpers');
const config = require('../config');

class SpamCommand extends CommandBase {
    constructor() {
        super({
            name: 'spam',
            aliases: ['prank'],
            description: 'Prank spam chat (Owner Only)',
            usage: '.spam <target> <amount> <message>',
            category: 'fun',
            cooldown: 10000, // 10 second cooldown
            isHeavy: true
        });

        // Maximum messages allowed per command
        this.MAX_LIMIT = 50;
    }

    /**
     * Generate random delay between min and max milliseconds
     * @param {number} min - Minimum delay in ms
     * @param {number} max - Maximum delay in ms
     * @returns {number} Random delay value
     */
    randomDelay(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    /**
     * Convert phone number to WhatsApp JID format
     * @param {string} input - Phone number or mention
     * @returns {string|null} JID or null if invalid
     */
    parseTarget(input) {
        if (!input) return null;

        // If it's already a JID format
        if (input.includes('@s.whatsapp.net')) {
            return input;
        }

        // Remove @ if it's a mention
        let number = input.replace('@', '');

        // Remove any non-digit characters
        number = number.replace(/\D/g, '');

        // Handle Indonesian number formats
        if (number.startsWith('0')) {
            // Convert 0812xxx to 62812xxx
            number = '62' + number.substring(1);
        } else if (!number.startsWith('62') && number.length >= 10) {
            // Assume Indonesian if not starting with country code
            number = '62' + number;
        }

        // Validate length (Indonesian numbers are typically 10-13 digits)
        if (number.length < 10 || number.length > 15) {
            return null;
        }

        return number + '@s.whatsapp.net';
    }

    /**
     * Check if sender is the owner
     * @param {string} sender - Sender JID
     * @returns {boolean}
     */
    isOwner(sender) {
        // Get owner number from environment or config
        const ownerNumber = process.env.OWNER_NUMBER || '';
        
        // Extract number from sender JID
        const senderNumber = sender.split('@')[0];
        
        // Check if sender is owner (compare numbers)
        return ownerNumber && senderNumber === ownerNumber.replace(/\D/g, '');
    }

    /**
     * Execute the spam command
     * @param {import('@whiskeysockets/baileys').WASocket} sock - WhatsApp socket
     * @param {Object} msg - Message object from Baileys
     * @param {string[]} args - Command arguments
     * @param {Object} context - Execution context
     */
    async execute(sock, msg, args, context) {
        const { from, sender } = context;

        // Check if user is owner
        if (!this.isOwner(sender)) {
            return await this.reply(sock, from, msg, 
                '🔒 *Akses Ditolak*\n\n' +
                'Perintah ini hanya untuk owner bot.');
        }

        // Show usage if no arguments
        if (args.length < 3) {
            return await this.reply(sock, from, msg,
                '📨 *Spam Command*\n\n' +
                '📝 *Cara Pakai:*\n' +
                '`.spam <target> <jumlah> <pesan>`\n\n' +
                '📌 *Contoh:*\n' +
                '• `.spam @mention 10 Hello!`\n' +
                '• `.spam 081234567890 5 Test`\n' +
                '• `.spam 6281234567890 20 Hi`\n\n' +
                '⚠️ *Batas:*\n' +
                `• Maksimal ${this.MAX_LIMIT} pesan\n` +
                '• Owner only\n' +
                '• Delay random 1.5-3 detik');
        }

        // Parse arguments
        const targetInput = args[0];
        const amountInput = parseInt(args[1]);
        const message = args.slice(2).join(' ');

        // Validate target
        const targetJid = this.parseTarget(targetInput);
        if (!targetJid) {
            return await this.reply(sock, from, msg,
                '❌ Format target tidak valid!\n\n' +
                'Gunakan @mention atau nomor telepon');
        }

        // Validate amount
        if (isNaN(amountInput) || amountInput < 1) {
            return await this.reply(sock, from, msg,
                '❌ Jumlah harus angka positif!');
        }

        // Enforce max limit
        let amount = amountInput;
        let limitWarning = '';
        if (amount > this.MAX_LIMIT) {
            amount = this.MAX_LIMIT;
            limitWarning = `\n⚠️ Dibatasi ke ${this.MAX_LIMIT} pesan`;
        }

        // Validate message
        if (!message || message.trim().length === 0) {
            return await this.reply(sock, from, msg,
                '❌ Pesan tidak boleh kosong!');
        }

        // React to show processing
        await this.react(sock, msg, '🚀');

        // Send starting message
        const targetNumber = targetJid.split('@')[0];
        await this.reply(sock, from, msg,
            `📨 *Spam Dimulai*\n\n` +
            `🎯 Target: ${targetNumber}\n` +
            `📝 Pesan: ${message.substring(0, 30)}${message.length > 30 ? '...' : ''}\n` +
            `🔢 Jumlah: ${amount}${limitWarning}\n` +
            `⏱️ Delay: 1.5-3 detik\n\n` +
            `⏳ Mengirim...`);

        // Send spam messages with random delay
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < amount; i++) {
            try {
                // Send message to target
                await sock.sendMessage(targetJid, { text: message });
                successCount++;

                // Don't delay after last message
                if (i < amount - 1) {
                    // Random delay between 1500ms and 3000ms
                    const delay = this.randomDelay(1500, 3000);
                    await sleep(delay);
                }
            } catch (error) {
                failCount++;
                this.logError(error, context);
                
                // Stop on error to prevent ban
                await this.reply(sock, from, msg,
                    `⚠️ *Dihentikan karena error*\n\n` +
                    `✅ Terkirim: ${successCount}\n` +
                    `❌ Gagal: ${failCount}\n\n` +
                    `Error: ${error.message || 'Unknown error'}`);
                
                await this.react(sock, msg, '⚠️');
                return;
            }
        }

        // Send completion message
        await this.reply(sock, from, msg,
            `✅ *Spam Selesai*\n\n` +
            `🎯 Target: ${targetNumber}\n` +
            `✅ Terkirim: ${successCount}\n` +
            `❌ Gagal: ${failCount}`);

        await this.react(sock, msg, '✅');
    }
}

module.exports = SpamCommand;
