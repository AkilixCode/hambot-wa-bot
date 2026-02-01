/**
 * Brat-Style Generator (V3 - Word Style Logic)
 * Features:
 * - Smart Word Wrapping (Like MS Word)
 * - Preserves Horizontal Spacing
 * - Auto-scaling Font Size
 * - Vertical Stretch (Brat Aesthetic)
 */

const CommandBase = require('./base');
const { createCanvas, registerFont } = require('canvas');
const path = require('path');
const fs = require('fs');

class BratCommand extends CommandBase {
    constructor() {
        super({
            name: 'brat',
            aliases: ['bratgen', 'stikerbrat'],
            description: 'Buat stiker teks ala Brat (Auto-wrap & Spacing Support)',
            usage: '.brat <teks>',
            category: 'fun',
            cooldown: 5000,
            isHeavy: true
        });

        // 1. REGISTER FONT (Pastikan file ada di folder assets/fonts)
        // Kita coba load font saat class di-inisialisasi
        try {
            const fontPath = path.join(process.cwd(), 'assets', 'fonts', 'arialnarrow.ttf');
            if (fs.existsSync(fontPath)) {
                registerFont(fontPath, { family: 'BratFont' });
            } else {
                console.warn('[BRAT] ⚠️ Font arialnarrow.ttf tidak ditemukan di assets/fonts. Menggunakan font sistem.');
            }
        } catch (e) {
            console.error('[BRAT] Gagal register font:', e);
        }

        // Canvas Config
        this.canvasSize = 512; // Ukuran standar stiker
        this.padding = 20;     // Margin ala Word
    }

    async execute(sock, msg, args, context) {
        const { from } = context;
        
        // Gabungkan argumen jadi satu string, pertahankan spasi original user
        // args biasanya sudah di-split oleh handler, jadi kita join ulang
        // Note: Ini mungkin menghilangkan spasi ganda antar kata jika handler bot melakukan trim/split parah.
        // Tapi untuk kebanyakan bot, args.join(' ') cukup.
        let text = args.join(' ');

        if (!text) {
            return await this.reply(sock, from, msg, '❌ Masukkan teksnya!\nContoh: *.brat siapa     suruh login*');
        }

        if (text.length > 500) {
            return await this.reply(sock, from, msg, '❌ Teks kepanjangan, nanti gak kebaca!');
        }

        await this.react(sock, msg, '⏳');

        try {
            // Generate Image Buffer
            const imageBuffer = await this.generateSmartBrat(text);

            // Kirim sebagai Stiker
            // Note: Pastikan bot kamu punya handler untuk sendSticker atau kirim image biasa dulu
            await sock.sendMessage(from, {
                sticker: imageBuffer
            }, { quoted: msg });

            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, '❌ Gagal membuat stiker. Cek log console.');
        }
    }

    /**
     * Logic Utama: Generate Brat dengan Smart Wrapping
     */
    async generateSmartBrat(text) {
        const size = this.canvasSize;
        const padding = this.padding;
        const maxWidth = size - (padding * 2);
        const maxHeight = size - (padding * 2);

        const canvas = createCanvas(size, size);
        const ctx = canvas.getContext('2d');

        // 1. Background Putih Mutlak
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, size, size);

        // 2. Config Text Dasar
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Renggang baris (1.05 = Rapat tapi gak nempel)
        const lineHeightRatio = 1.05; 

        // 3. AUTO FIT LOOP (Mengecilkan font sampai muat)
        let fontSize = 180; // Start font size (Besar)
        let finalLines = [];
        
        // Tentukan Font Family (Prioritas BratFont, fallback ke Arial Narrow sistem, lalu Sans-serif)
        const fontConfig = (size) => `900 ${size}px "BratFont", "Arial Narrow", sans-serif`;

        do {
            ctx.font = fontConfig(fontSize);
            
            // Panggil Smart Wrapper
            const lines = this.wrapTextSmart(ctx, text, maxWidth);
            
            // Hitung estimasi tinggi total
            const totalHeight = lines.length * (fontSize * lineHeightRatio);

            // Cek apakah muat secara vertikal?
            if (totalHeight <= maxHeight) {
                finalLines = lines;
                break; // Pas! Keluar loop.
            }

            // Kalau gak muat, kecilin font
            fontSize -= 5;
        } while (fontSize > 20); // Batas minimum font 20px

        // 4. RENDERING FINAL
        const finalTotalHeight = finalLines.length * (fontSize * lineHeightRatio);
        
        // Hitung posisi Y awal (Center Vertical)
        let startY = (size / 2) - (finalTotalHeight / 2) + ((fontSize * lineHeightRatio) / 2);

        // EFEK GEPENG (Stretch Vertical 115%)
        ctx.save();
        ctx.translate(size/2, size/2);
        ctx.scale(1, 1.15); 
        ctx.translate(-size/2, -size/2);

        finalLines.forEach((line, i) => {
            // Koreksi Y (-0.15) untuk kompensasi baseline font Arial
            const yPos = startY + (i * (fontSize * lineHeightRatio)) - (fontSize * 0.15);
            ctx.fillText(line, size / 2, yPos);
        });
        ctx.restore();

        // 5. Output Low Quality (Estetik Burik)
        return canvas.toBuffer('image/jpeg', { quality: 0.5 });
    }

    /**
     * Helper: Word Wrap Pintar (Mempertahankan Spasi & Logic MS Word)
     */
    wrapTextSmart(ctx, text, maxWidth) {
        // Regex Split: Pisahkan kata tapi SIMPAN spasi sebagai elemen array
        // "sok   iye" -> ["sok", "   ", "iye"]
        const parts = text.split(/(\s+)/); 
        
        let lines = [];
        let currentLine = "";

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            
            // Cek lebar baris kalau ditambah potongan ini
            const testLine = currentLine + part;
            const metrics = ctx.measureText(testLine);
            const testWidth = metrics.width;

            if (testWidth <= maxWidth) {
                // Masih muat? Tambahkan.
                currentLine += part;
            } else {
                // GAK MUAT!
                
                // Cek: Apakah ini cuma spasi? (Spasi di ujung kanan baris biasanya diabaikan)
                if (/^\s+$/.test(part)) {
                    continue; 
                }

                // Push baris sebelumnya ke daftar
                if (currentLine.length > 0) {
                    lines.push(currentLine);
                }

                // Mulai baris baru dengan kata yang bikin overflow tadi
                currentLine = part;
            }
        }
        
        // Push sisa terakhir
        if (currentLine.length > 0) {
            lines.push(currentLine);
        }
        
        return lines;
    }
}

module.exports = BratCommand;
