/**
 * Brat-Style Generator (Final Fix - Gyurmatag Style)
 
 */

const CommandBase = require('./base');
const { createCanvas, registerFont } = require('canvas');
const sharp = require('sharp'); // Wajib ada di package.json
const path = require('path');
const fs = require('fs');

class BratCommand extends CommandBase {
    constructor() {
        super({
            name: 'brat',
            aliases: ['bratgen', 'stikerbrat'],
            description: 'Buat stiker teks ala Brat (Fix Style & Overflow)',
            usage: '.brat <teks>',
            category: 'fun',
            cooldown: 5000,
            isHeavy: true
        });

        // 1. REGISTER FONT
        try {
            const fontPath = path.join(process.cwd(), 'fonts', 'arialnarrow.ttf');
            if (fs.existsSync(fontPath)) {
                registerFont(fontPath, { family: 'BratFont' });
            } else {
                console.warn('[BRAT] ⚠️ Font arialnarrow.ttf tidak ditemukan. Style mungkin beda.');
            }
        } catch (e) {
            console.error('[BRAT] Error register font:', e);
        }

        this.canvasSize = 512; 
        this.padding = 24; // Padding sedikit lebih luas biar aman
    }

    async execute(sock, msg, args, context) {
        const { from } = context;
        
        // Gabungkan argumen, support enter/newline dari pesan asli jika memungkinkan
        // Di banyak handler, args sudah di-split spasi. Kita join dulu.
        // Jika user pake enter, biasanya args akan terpisah.
        // Cara terbaik ambil full text adalah dari msg content langsung, tapi args.join cukup untuk v1.
        let text = args.join(' ');

        if (!text) {
            return await this.reply(sock, from, msg, '❌ Masukkan teksnya!\nContoh: *.brat siapa suruh*');
        }

        if (text.length > 500) {
            return await this.reply(sock, from, msg, '❌ Teks kepanjangan, nanti kekecilan!');
        }

        await this.react(sock, msg, '⏳');

        try {
            // 1. Generate Raw Canvas (Teks Hitam, Background Putih)
            const rawBuffer = await this.generateCanvas(text);

            // 2. Post-Processing dengan Sharp (Tiru Filter Gyurmatag)
            // CSS asli: filter: blur(1px) contrast(1.25);
            const finalBuffer = await sharp(rawBuffer)
                .blur(0.5) // Blur sedikit aja biar 'crispy' (1.0 kadang terlalu buram buat stiker kecil)
                .linear(1.25, -(128 * 1.25) + 128) // Rumus Contrast 1.25 manual
                .toFormat('webp')
                .toBuffer();

            // 3. Kirim Stiker
            await sock.sendMessage(from, {
                sticker: finalBuffer
            }, { quoted: msg });

            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, '❌ Gagal membuat stiker. Cek log.');
        }
    }

    async generateCanvas(text) {
        const size = this.canvasSize;
        const padding = this.padding;
        const maxWidth = size - (padding * 2);
        const maxHeight = size - (padding * 2);

        const canvas = createCanvas(size, size);
        const ctx = canvas.getContext('2d');

        // Background Putih
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, size, size);

        // Config Dasar
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Logika Scaling Font Anti-Jebol
        let fontSize = 200; // Mulai dari gede
        let finalLines = [];
        let lineHeightRatio = 1.05; // Style Brat Rapat

        do {
            // Reset font
            // Gunakan weight 900 biar tebal ala album asli
            ctx.font = `900 ${fontSize}px "BratFont", "Arial Narrow", sans-serif`;

            // Coba wrap text dengan ukuran segini
            const lines = this.smartWrap(ctx, text, maxWidth);
            
            // Cek Tinggi
            const totalHeight = lines.length * (fontSize * lineHeightRatio);
            
            // Cek Lebar (Double Check: Apakah ada baris yang masih tembus?)
            const isTooWide = lines.some(line => ctx.measureText(line).width > maxWidth + 10); // Toleransi 10px

            if (totalHeight <= maxHeight && !isTooWide) {
                finalLines = lines;
                break; // Muat!
            }

            // Kalau gak muat, kecilin
            fontSize -= 5;
        } while (fontSize > 10);

        // Rendering Final
        const totalBlockHeight = finalLines.length * (fontSize * lineHeightRatio);
        let startY = (size / 2) - (totalBlockHeight / 2) + ((fontSize * lineHeightRatio) / 2);

        // Terapkan Stretch (Gepeng)
        ctx.save();
        ctx.translate(size/2, size/2);
        ctx.scale(1, 1.15); // Stretch Vertikal 115%
        ctx.translate(-size/2, -size/2);

        finalLines.forEach((line, i) => {
            // Koreksi posisi Y
            const yPos = startY + (i * (fontSize * lineHeightRatio)) - (fontSize * 0.12);
            ctx.fillText(line, size / 2, yPos);
        });
        
        ctx.restore();

        return canvas.toBuffer();
    }

    /**
     * Logic Wrap Pintar yang support Newline & Spasi
     */
    smartWrap(ctx, text, maxWidth) {
        // 1. Split berdasarkan Baris Baru (\n) dulu (Manual Enter dari user)
        const paragraphs = text.split('\n');
        let allLines = [];

        for (let paragraph of paragraphs) {
            // 2. Split berdasarkan Spasi tapi simpan spasinya (Regex capture group)
            const parts = paragraph.split(/(\s+)/);
            let currentLine = "";

            for (let part of parts) {
                const testLine = currentLine + part;
                const metrics = ctx.measureText(testLine);
                
                if (metrics.width <= maxWidth) {
                    currentLine += part;
                } else {
                    // Overflow!
                    // Jangan push baris kosong (misal spasi doang di awal)
                    if (currentLine.trim() !== "") {
                        allLines.push(currentLine);
                    }
                    
                    // Reset current line dengan kata yang bikin overflow
                    // Tapi cek dulu, kalau kata ini SENDIRIAN aja udah overflow (misal: "AAAAAAAAAAAA")
                    // Kita harus paksa potong (Break-Word/Character)
                    if (ctx.measureText(part).width > maxWidth) {
                        // Kasus Kata Super Panjang: Biarkan dia masuk currentLine, 
                        // nanti loop utama (do-while) yang akan mengecilkan font size sampai kata ini muat.
                        currentLine = part;
                    } else {
                        currentLine = part;
                    }
                }
            }
            if (currentLine) allLines.push(currentLine);
        }
        
        return allLines;
    }
}

module.exports = BratCommand;
