/**
 * Spam Command
 * Prank spam chat (Khusus Owner)
 * Dengan mekanisme keamanan: batas maksimal, delay acak, berhenti saat error
 * 
 * Supports:
 * - .spam <target> <jumlah> <pesan> - Spam ke target tertentu
 * - .spam - <jumlah> <pesan> - Spam ke chat saat ini
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
            usage: '.spam <target/-/self> <jumlah> <pesan>',
            category: 'fun',
            cooldown: 10000, // 10 detik cooldown
            isHeavy: true
        });

        // Batas maksimal pesan per perintah
        this.MAX_LIMIT = 50;
        
        // Human-like typing behavior patterns
        this.typingPatterns = [
            { typing: 500, pause: 200 },   // Quick typer
            { typing: 800, pause: 300 },   // Normal typer
            { typing: 1200, pause: 500 },  // Slow typer
        ];
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
     * Simulate human-like behavior between messages
     * Includes variable delays, occasional longer pauses, and typing indicators
     * @param {Object} sock - WhatsApp socket
     * @param {string} targetJid - Target chat JID
     * @param {number} messageIndex - Current message index
     * @param {number} totalMessages - Total messages to send
     */
    async humanBehaviorDelay(sock, targetJid, messageIndex, totalMessages) {
        // Base delay between 1.5 and 3.5 seconds
        let baseDelay = this.randomDelay(1500, 3500);
        
        // Occasionally add longer "thinking" pauses (10% chance)
        if (Math.random() < 0.1) {
            baseDelay += this.randomDelay(2000, 5000);
        }
        
        // Slow down slightly as messages progress (fatigue simulation)
        const fatigueMultiplier = 1 + (messageIndex / totalMessages) * 0.3;
        baseDelay = Math.floor(baseDelay * fatigueMultiplier);
        
        // Random variation in typing speed
        const pattern = this.typingPatterns[Math.floor(Math.random() * this.typingPatterns.length)];
        
        try {
            // Send typing indicator (presence) to look more human
            await sock.sendPresenceUpdate('composing', targetJid);
            
            // Wait for "typing" duration
            await sleep(this.randomDelay(pattern.typing, pattern.typing * 2));
            
            // Stop typing
            await sock.sendPresenceUpdate('paused', targetJid);
            
            // Small pause before sending
            await sleep(this.randomDelay(pattern.pause, pattern.pause * 2));
            
        } catch (presenceError) {
            // Ignore presence errors, just wait the base delay
            await sleep(baseDelay);
        }
    }

    /**
     * Konversi input ke format JID WhatsApp
     * @param {string} input - Nomor telepon, mention, atau "-"/"self"
     * @param {string} currentChatJid - JID chat saat ini
     * @param {Object} msg - Message object untuk extract mention
     * @returns {Object|null} { jid, displayName } atau null jika tidak valid
     */
    parseTarget(input, currentChatJid, msg) {
        if (!input) return null;
        
        // Check for "-" or "self" - spam to current chat
        if (input === '-' || input.toLowerCase() === 'self' || input.toLowerCase() === 'here') {
            return { 
                jid: currentChatJid, 
                displayName: currentChatJid.endsWith('@g.us') ? 'Chat Grup Ini' : 'Chat Ini'
            };
        }

        // Check for mentioned users in the message
        const mentionedJid = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
        if (mentionedJid && mentionedJid.length > 0) {
            const jid = mentionedJid[0];
            return { 
                jid, 
                displayName: jid.split('@')[0] 
            };
        }

        // Jika sudah dalam format JID
        if (input.includes('@s.whatsapp.net') || input.includes('@g.us') || input.includes('@lid')) {
            return { 
                jid: input, 
                displayName: input.split('@')[0] 
            };
        }

        // Hapus @ jika mention format manual
        let number = input.replace('@', '');

        // Hapus karakter non-digit
        number = number.replace(/\D/g, '');

        // Handle format nomor Indonesia
        if (number.startsWith('0')) {
            // Konversi 0812xxx ke 62812xxx
            number = '62' + number.substring(1);
        } else if (!number.startsWith('62') && number.length >= 10 && number.length <= 12) {
            // Asumsikan Indonesia jika tidak ada kode negara
            number = '62' + number;
        }

        // Validasi panjang (nomor biasanya 10-15 digit)
        if (number.length < 10 || number.length > 15) {
            return null;
        }

        return { 
            jid: number + '@s.whatsapp.net',
            displayName: number
        };
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
                '• `.spam - 10 Halo!` - Spam ke chat ini\n' +
                '• `.spam self 5 Test` - Spam ke chat ini\n' +
                '• `.spam @mention 10 Hi!` - Spam ke user\n' +
                '• `.spam 081234567890 5 Test` - Spam ke nomor\n' +
                '• `.spam 6281234567890 20 Hi` - Spam ke nomor\n\n' +
                '⚠️ *Batasan:*\n' +
                `• Maksimal ${this.MAX_LIMIT} pesan\n` +
                '• Khusus owner\n' +
                '• Delay acak human-like (1.5-5 detik)\n' +
                '• Simulasi typing indicator');
        }

        // Parse argumen
        const targetInput = args[0];
        const amountInput = parseInt(args[1]);
        const message = args.slice(2).join(' ');

        // Validasi target dengan smart detection
        const targetResult = this.parseTarget(targetInput, from, msg);
        if (!targetResult) {
            return await this.reply(sock, from, msg,
                '❌ Format target tidak valid!\n\n' +
                '*Gunakan:*\n' +
                '• `-` atau `self` untuk chat ini\n' +
                '• `@mention` untuk mention user\n' +
                '• Nomor telepon (081xxx atau 62xxx)');
        }

        const targetJid = targetResult.jid;
        const targetDisplay = targetResult.displayName;

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
        await this.reply(sock, from, msg,
            `📨 *Spam Dimulai*\n\n` +
            `🎯 Target: ${targetDisplay}\n` +
            `📝 Pesan: ${message.substring(0, 30)}${message.length > 30 ? '...' : ''}\n` +
            `🔢 Jumlah: ${amount}${limitWarning}\n` +
            `⏱️ Delay: 1.5-5 detik (human-like)\n` +
            `✨ Mode: Typing indicator aktif\n\n` +
            `⏳ Mengirim...`);

        // Kirim pesan spam dengan delay acak dan human-like behavior
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < amount; i++) {
            try {
                // Human-like delay before sending (except for first message)
                if (i > 0) {
                    await this.humanBehaviorDelay(sock, targetJid, i, amount);
                }
                
                // Kirim pesan ke target
                await sock.sendMessage(targetJid, { text: message });
                successCount++;

            } catch (error) {
                failCount++;
                this.logError(error, context);
                
                // Jika sudah ada beberapa sukses, coba lanjutkan dengan delay lebih lama
                if (successCount > 0 && failCount < 3) {
                    // Wait longer and retry
                    await sleep(this.randomDelay(5000, 10000));
                    continue;
                }
                
                // Berhenti jika terlalu banyak error
                await this.reply(sock, from, msg,
                    `⚠️ *Dihentikan karena error*\n\n` +
                    `🎯 Target: ${targetDisplay}\n` +
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
            `🎯 Target: ${targetDisplay}\n` +
            `✅ Terkirim: ${successCount}\n` +
            `❌ Gagal: ${failCount}`);

        await this.react(sock, msg, '✅');
    }
}

module.exports = SpamCommand;
