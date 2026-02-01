/**
 * Brat-Style Text Image Generator
 * Generate brat-style text images with white or green backgrounds
 * Inspired by https://github.com/Arifzyn19/brat-generator
 * 
 * Features:
 * - .brat <text> - Generate with white background (default)
 * - .brat <text> --green - Generate with green background (#8ACE00)
 * - .brat <text> --blur <0-100> - Control blur level (default: 80)
 */

const CommandBase = require('./base');
const { createCanvas } = require('canvas');

class BratCommand extends CommandBase {
    constructor() {
        super({
            name: 'brat',
            aliases: ['bratgen', 'brattext'],
            description: 'Generate brat-style text image',
            usage: '.brat <text>',
            category: 'fun',
            cooldown: 5000,
            isHeavy: true
        });

        // Canvas settings - Brat aesthetic
        this.canvasSize = 600;
        this.whiteBackground = '#FFFFFF';
        this.greenBackground = '#8ACE00';
        this.textColor = '#000000'; // Black text
        this.padding = 32;
        this.lineHeight = 0.9;
        this.fontFamily = "'Arial Narrow', Arial, sans-serif";
        this.fontWeight = '900'; // Bold weight
        this.defaultBlur = 80;
    }

    /**
     * Execute the command
     * @param {import('@whiskeysockets/baileys').WASocket} sock - WhatsApp socket
     * @param {Object} msg - Message object from Baileys
     * @param {string[]} args - Command arguments
     * @param {Object} context - Execution context
     */
    async execute(sock, msg, args, context) {
        const { from } = context;

        // Check if text is provided
        if (!args[0]) {
            return await this.reply(sock, from, msg,
                '✨ *Brat Text Generator*\n\n' +
                '*Cara Pakai:*\n' +
                '• `.brat <teks>` - Background putih\n' +
                '• `.brat <teks> --green` - Background hijau\n' +
                '• `.brat <teks> --blur <0-100>` - Custom blur level\n\n' +
                '*Contoh:*\n' +
                '• `.brat hello world`\n' +
                '• `.brat brat --green`\n' +
                '• `.brat test --blur 50`\n' +
                '• `.brat vibe --green --blur 30`'
            );
        }

        // Parse arguments
        const { text, isGreen, blurLevel } = this.parseArgs(args);

        // Validate text
        if (!text || text.trim().length === 0) {
            return await this.reply(sock, from, msg, '❌ Teks tidak boleh kosong!');
        }

        if (text.length > 200) {
            return await this.reply(sock, from, msg, '❌ Teks terlalu panjang! Maksimal 200 karakter.');
        }

        await this.react(sock, msg, '⏳');

        try {
            // Generate brat-style image
            const imageBuffer = await this.generateBratImage(text, isGreen, blurLevel);

            // Send as image
            await sock.sendMessage(from, {
                image: imageBuffer,
                caption: `✨ *Brat Style*\n\nText: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`
            }, { quoted: msg });

            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, '❌ Gagal membuat gambar brat. Coba lagi!');
        }
    }

    /**
     * Parse command arguments to extract text and flags
     * @param {string[]} args - Command arguments
     * @returns {Object} - Parsed arguments { text, isGreen, blurLevel }
     */
    parseArgs(args) {
        let isGreen = false;
        let blurLevel = this.defaultBlur;
        const textParts = [];

        for (let i = 0; i < args.length; i++) {
            const arg = args[i];

            if (arg === '--green') {
                isGreen = true;
            } else if (arg === '--blur' && args[i + 1]) {
                // Parse blur value
                const value = parseInt(args[i + 1]);
                if (!isNaN(value) && value >= 0 && value <= 100) {
                    blurLevel = value;
                }
                i++; // Skip next argument (the blur value)
            } else {
                textParts.push(arg);
            }
        }

        const text = textParts.join(' ').toLowerCase(); // Convert to lowercase for brat style

        return { text, isGreen, blurLevel };
    }

    /**
     * Generate brat-style image
     * @param {string} text - Text to render
     * @param {boolean} isGreen - Use green background
     * @param {number} blurLevel - Blur level (0-100)
     * @returns {Buffer} - PNG image buffer
     */
    async generateBratImage(text, isGreen, blurLevel) {
        const canvas = createCanvas(this.canvasSize, this.canvasSize);
        const ctx = canvas.getContext('2d');

        // Fill background
        ctx.fillStyle = isGreen ? this.greenBackground : this.whiteBackground;
        ctx.fillRect(0, 0, this.canvasSize, this.canvasSize);

        // Set text properties
        ctx.fillStyle = this.textColor;
        ctx.textBaseline = 'top';

        // Calculate optimal font size and wrap text
        const maxWidth = this.canvasSize - (this.padding * 2);
        const maxHeight = this.canvasSize - (this.padding * 2);
        const baseFontSize = Math.min(200, this.canvasSize / 3);

        const { fontSize, lines } = this.calculateOptimalFontSize(
            ctx,
            text,
            maxWidth,
            maxHeight,
            baseFontSize
        );

        // Apply blur filter
        const blurAmount = (blurLevel / 100) * 3;
        ctx.filter = `blur(${blurAmount}px)`;

        // Set font with calculated size
        ctx.font = `${this.fontWeight} ${fontSize}px ${this.fontFamily}`;

        // Calculate line height
        const lineHeightPx = fontSize * this.lineHeight;

        // Draw each line starting from position (32, 32)
        let y = this.padding;
        for (const line of lines) {
            ctx.fillText(line, this.padding, y);
            y += lineHeightPx;
        }

        // Reset filter
        ctx.filter = 'none';

        // Return PNG buffer
        return canvas.toBuffer('image/png');
    }

    /**
     * Calculate optimal font size and wrap text
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {string} text - Text to render
     * @param {number} maxWidth - Maximum width
     * @param {number} maxHeight - Maximum height
     * @param {number} baseFontSize - Starting font size
     * @returns {Object} - { fontSize, lines }
     */
    calculateOptimalFontSize(ctx, text, maxWidth, maxHeight, baseFontSize) {
        let fontSize = baseFontSize;
        let lines = [];

        for (let size = fontSize; size >= 20; size -= 5) {
            ctx.font = `${this.fontWeight} ${size}px ${this.fontFamily}`;
            lines = this.wrapText(ctx, text, maxWidth);

            const lineHeightPx = size * this.lineHeight;
            const totalHeight = lines.length * lineHeightPx;

            if (totalHeight <= maxHeight) {
                fontSize = size;
                break;
            }
        }

        return { fontSize, lines };
    }

    /**
     * Wrap text into multiple lines
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {string} text - Text to wrap
     * @param {number} maxWidth - Maximum width per line
     * @returns {string[]} - Array of lines
     */
    wrapText(ctx, text, maxWidth) {
        const words = text.split(' ');
        const lines = [];

        // Handle single word case
        if (words.length === 1) {
            const width = ctx.measureText(text).width;
            if (width <= maxWidth) {
                lines.push(text);
            } else {
                // Split character by character for long single word
                let currentLine = '';
                for (const char of text) {
                    const testLine = currentLine + char;
                    const testWidth = ctx.measureText(testLine).width;
                    if (testWidth <= maxWidth) {
                        currentLine = testLine;
                    } else {
                        if (currentLine) lines.push(currentLine);
                        currentLine = char;
                    }
                }
                if (currentLine) lines.push(currentLine);
            }
            return lines;
        }

        // Handle multiple words
        let currentLine = words[0];

        for (let i = 1; i < words.length; i++) {
            const word = words[i];
            const testLine = currentLine + ' ' + word;
            const width = ctx.measureText(testLine).width;

            if (width <= maxWidth) {
                currentLine = testLine;
            } else {
                lines.push(currentLine);
                currentLine = word;
            }
        }
        lines.push(currentLine);

        return lines;
    }
}

module.exports = BratCommand;
