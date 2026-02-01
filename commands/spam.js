/**
 * Spam Command
 * Prank spam chat (Khusus Owner)
 * Dengan mekanisme keamanan: batas maksimal, delay acak, berhenti saat error
 */

const CommandBase = require('./base');
const { sleep } = require('../utils/helpers');
const config = require('../config');

class SpamCommand extends CommandBase {
    constructor() {
        super({
            name: 'spam',
            aliases: ['prank'],
            description: 'Prank spam chat (Khusus Owner)',
            usage: '.spam <target> <jumlah> <pesan>',
            category: 'fun',
            cooldown: 10000, // 10 detik cooldown
            isHeavy: true
        });

        // Batas maksimal pesan per perintah
        this.MAX_LIMIT = 50;
    }

    /**
     * Generate delay acak antara min dan max milidetik
     * @param {number} min - Delay minimum dalam ms
     * @param {number} max - Delay maksimum dalam ms
     * @returns {number} Nilai delay acak
     */
    randomDelay(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    /**
     * Konversi nomor telepon ke format JID WhatsApp
     * @param {string} input - Nomor telepon atau mention
     * @returns {string|null} JID atau null jika tidak valid
     */
    parseTarget(input) {
        if (!input) return null;

        // Jika sudah dalam format JID
        if (input.includes('@s.whatsapp.net')) {
            return input;
        }

        // Hapus @ jika mention
        let number = input.replace('@', '');

        // Hapus karakter non-digit
        number = number.replace(/\D/g, '');

        // Handle format nomor Indonesia
        if (number.startsWith('0')) {
            // Konversi 0812xxx ke 62812xxx
            number = '62' + number.substring(1);
        } else if (!number.startsWith('62') && number.length >= 10) {
            // Asumsikan Indonesia jika tidak ada kode negara
            number = '62' + number;
        }

        // Validasi panjang (nomor Indonesia biasanya 10-13 digit)
        if (number.length < 10 || number.length > 15) {
            return null;
        }

        return number + '@s.whatsapp.net';
    }

    /**
     * Execute perintah spam
     * @param {import('@whiskeysockets/baileys').WASocket} sock - WhatsApp socket
     * @param {Object} msg - Objek pesan dari Baileys
     * @param {string[]} args - Argumen perintah
     * @param {Object} context - Konteks eksekusi
     */
    async execute(sock, msg, args, context) {
        const { from, sender } = context;

        // Gunakan pengecekan owner terpusat dari config
        if (!config.isOwner(sender)) {
            return await this.reply(sock, from, msg, 
                '🔒 *Akses Ditolak*\n\n' +
                'Perintah ini hanya untuk owner bot.\n' +
                `Pengirim: ${sender}`);
        }

        // Tampilkan cara pakai jika tidak ada argumen
        if (args.length < 3) {
            return await this.reply(sock, from, msg,
                '📨 *Perintah Spam*\n\n' +
                '📝 *Cara Pakai:*\n' +
                '`.spam <target> <jumlah> <pesan>`\n\n' +
                '📌 *Contoh:*\n' +
                '• `.spam @mention 10 Halo!`\n' +
                '• `.spam 081234567890 5 Test`\n' +
                '• `.spam 6281234567890 20 Hi`\n\n' +
                '⚠️ *Batasan:*\n' +
                `• Maksimal ${this.MAX_LIMIT} pesan\n` +
                '• Khusus owner\n' +
                '• Delay acak 1.5-3 detik');
        }

        // Parse argumen
        const targetInput = args[0];
        const amountInput = parseInt(args[1]);
        const message = args.slice(2).join(' ');

        // Validasi target
        const targetJid = this.parseTarget(targetInput);
        if (!targetJid) {
            return await this.reply(sock, from, msg,
                '❌ Format target tidak valid!\n\n' +
                'Gunakan @mention atau nomor telepon');
        }

        // Validasi jumlah
        if (isNaN(amountInput) || amountInput < 1) {
            return await this.reply(sock, from, msg,
                '❌ Jumlah harus angka positif!');
        }

        // Terapkan batas maksimal
        let amount = amountInput;
        let limitWarning = '';
        if (amount > this.MAX_LIMIT) {
            amount = this.MAX_LIMIT;
            limitWarning = `\n⚠️ Dibatasi ke ${this.MAX_LIMIT} pesan`;
        }

        // Validasi pesan
        if (!message || message.trim().length === 0) {
            return await this.reply(sock, from, msg,
                '❌ Pesan tidak boleh kosong!');
        }

        // React untuk menunjukkan proses
        await this.react(sock, msg, '🚀');

        // Kirim pesan mulai
        const targetNumber = targetJid.split('@')[0];
        await this.reply(sock, from, msg,
            `📨 *Spam Dimulai*\n\n` +
            `🎯 Target: ${targetNumber}\n` +
            `📝 Pesan: ${message.substring(0, 30)}${message.length > 30 ? '...' : ''}\n` +
            `🔢 Jumlah: ${amount}${limitWarning}\n` +
            `⏱️ Delay: 1.5-3 detik\n\n` +
            `⏳ Mengirim...`);

        // Kirim pesan spam dengan delay acak
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < amount; i++) {
            try {
                // Kirim pesan ke target
                await sock.sendMessage(targetJid, { text: message });
                successCount++;

                // Jangan delay setelah pesan terakhir
                if (i < amount - 1) {
                    // Delay acak antara 1500ms dan 3000ms
                    const delay = this.randomDelay(1500, 3000);
                    await sleep(delay);
                }
            } catch (error) {
                failCount++;
                this.logError(error, context);
                
                // Berhenti saat error untuk mencegah ban
                await this.reply(sock, from, msg,
                    `⚠️ *Dihentikan karena error*\n\n` +
                    `✅ Terkirim: ${successCount}\n` +
                    `❌ Gagal: ${failCount}\n\n` +
                    `Error: ${error.message || 'Error tidak dikenal'}`);
                
                await this.react(sock, msg, '⚠️');
                return;
            }
        }

        // Kirim pesan selesai
        await this.reply(sock, from, msg,
            `✅ *Spam Selesai*\n\n` +
            `🎯 Target: ${targetNumber}\n` +
            `✅ Terkirim: ${successCount}\n` +
            `❌ Gagal: ${failCount}`);

        await this.react(sock, msg, '✅');
    }
}

module.exports = SpamCommand;
