/**
 * Brat Sticker Command
 * Creates "Brat" style stickers (Charli XCX album cover aesthetic)
 * White bold text on pure black background with lo-fi blur effect
 * 
 * Features:
 * - .brat <text> - Static sticker with bold text
 * - .bratvid <text> - Animated sticker with flashing/jitter effect
 */

const CommandBase = require('./base');
const { createCanvas } = require('canvas');
const sharp = require('sharp');
const { spawn } = require('child_process');
const { generateFilename, cleanupFiles } = require('../utils/helpers');
const fsPromises = require('fs').promises;

class BratCommand extends CommandBase {
    constructor() {
        super({
            name: 'brat',
            aliases: ['bratvid'],
            description: 'Buat stiker gaya Brat (teks putih tebal di latar hitam)',
            usage: '.brat <teks> atau .bratvid <teks>',
            category: 'tools',
            cooldown: 3000,
            isHeavy: true
        });

        // Canvas settings - Brat aesthetic (Charli XCX album cover trend)
        this.canvasSize = 512;
        this.backgroundColor = '#000000'; // Pure black background
        this.textColor = '#FFFFFF'; // Pure white text
        this.padding = 30;
        this.lineSpacing = 0.95; // Tight leading (95% of font size)

        // Animation settings
        this.animationFramerate = 10;
        this.jitterPatterns = [
            { x: 0, y: 0 },
            { x: 3, y: -2 },
            { x: -3, y: 3 },
            { x: 2, y: -3 },
            { x: -2, y: 2 },
            { x: 3, y: 3 }
        ];
    }

    /**
     * Execute the command
     * @param {import('@whiskeysockets/baileys').WASocket} sock - WhatsApp socket
     * @param {Object} msg - Message object from Baileys
     * @param {string[]} args - Command arguments
     * @param {Object} context - Execution context
     */
    async execute(sock, msg, args, context) {
        const { from, commandName } = context;

        // Check if text is provided
        if (!args[0]) {
            return await this.reply(sock, from, msg,
                '📝 *Brat Sticker*\n\n' +
                '*Cara Pakai:*\n' +
                '• `.brat <teks>` - Stiker statis\n' +
                '• `.bratvid <teks>` - Stiker animasi\n\n' +
                '*Contoh:*\n' +
                '• `.brat hello world`\n' +
                '• `.bratvid brat summer`'
            );
        }

        const text = args.join(' ').trim();

        // Validate text length
        if (text.length > 200) {
            return await this.reply(sock, from, msg, '❌ Teks terlalu panjang! Maksimal 200 karakter.');
        }

        await this.react(sock, msg, '⏳');

        try {
            // Check which command was used
            const isAnimated = commandName === 'bratvid';

            if (isAnimated) {
                await this.createAnimatedSticker(sock, msg, from, text, context);
            } else {
                await this.createStaticSticker(sock, msg, from, text);
            }

            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, '❌ Gagal membuat stiker Brat. Coba lagi!');
        }
    }

    /**
     * Create static brat sticker
     * @param {Object} sock - WhatsApp socket
     * @param {Object} msg - Message object
     * @param {string} from - Chat JID
     * @param {string} text - Text to render
     */
    async createStaticSticker(sock, msg, from, text) {
        // Create canvas and render text
        const canvas = this.createBratCanvas(text);
        const pngBuffer = canvas.toBuffer('image/png');

        // Apply lo-fi effect with subtle blur and convert to WebP sticker
        // Lower quality setting creates subtle compression artifacts for the anti-design aesthetic
        const stickerBuffer = await sharp(pngBuffer)
            .resize(512, 512, {
                fit: 'contain',
                background: { r: 0, g: 0, b: 0, alpha: 1 } // Black background
            })
            .blur(0.5) // Subtle Gaussian blur for lo-fi aesthetic
            .webp({ quality: 70 }) // Lower quality for subtle compression artifacts
            .toBuffer();

        // Send sticker
        await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: msg });
    }

    /**
     * Create animated brat sticker with flashing/jitter effect
     * @param {Object} sock - WhatsApp socket
     * @param {Object} msg - Message object
     * @param {string} from - Chat JID
     * @param {string} text - Text to render
     * @param {Object} context - Execution context
     */
    async createAnimatedSticker(sock, msg, from, text, context) {
        const filePrefix = generateFilename('brat', '');
        const frameCount = this.jitterPatterns.length;
        const framePaths = [];

        try {
            // Generate frames with jitter effect
            for (let i = 0; i < frameCount; i++) {
                const canvas = this.createBratCanvas(text, {
                    jitter: true,
                    frameIndex: i
                });
                const framePath = `${filePrefix}_frame${i.toString().padStart(3, '0')}.png`;
                await fsPromises.writeFile(framePath, canvas.toBuffer('image/png'));
                framePaths.push(framePath);
            }

            // Create animated WebP using ffmpeg
            const outputPath = `${filePrefix}_animated.webp`;
            await this.createAnimatedWebP(framePaths, outputPath, frameCount);

            // Read and send the animated sticker
            const stickerBuffer = await fsPromises.readFile(outputPath);
            await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: msg });

        } finally {
            // Cleanup all temporary files
            await cleanupFiles(filePrefix);
        }
    }

    /**
     * Create a canvas with Brat-style text
     * @param {string} text - Text to render
     * @param {Object} options - Rendering options
     * @returns {Canvas} - Canvas with rendered text
     */
    createBratCanvas(text, options = {}) {
        const { jitter = false, frameIndex = 0 } = options;
        const canvas = createCanvas(this.canvasSize, this.canvasSize);
        const ctx = canvas.getContext('2d');

        // Fill background (pure black)
        ctx.fillStyle = this.backgroundColor;
        ctx.fillRect(0, 0, this.canvasSize, this.canvasSize);

        // Apply jitter effect for animation
        let offsetX = 0;
        let offsetY = 0;
        if (jitter) {
            // Use jitter pattern from class settings
            const pattern = this.jitterPatterns[frameIndex % this.jitterPatterns.length];
            offsetX = pattern.x;
            offsetY = pattern.y;
        }

        // Set text properties
        ctx.fillStyle = this.textColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Calculate optimal font size and wrap text
        const maxWidth = this.canvasSize - (this.padding * 2);
        const lines = this.wrapText(ctx, text, maxWidth);
        const fontSize = this.calculateOptimalFontSize(ctx, lines, maxWidth);

        // Apply font with calculated size - use system bold fonts
        ctx.font = `bold ${fontSize}px "Arial Black", "Impact", "Helvetica Neue", Arial, sans-serif`;

        // Calculate total text height
        const lineHeight = fontSize * this.lineSpacing;
        const totalHeight = lines.length * lineHeight;

        // Starting Y position (centered)
        let startY = (this.canvasSize - totalHeight) / 2 + (lineHeight / 2);

        // Draw each line
        for (const line of lines) {
            ctx.fillText(
                line,
                (this.canvasSize / 2) + offsetX,
                startY + offsetY
            );
            startY += lineHeight;
        }

        return canvas;
    }

    /**
     * Wrap text into multiple lines
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {string} text - Text to wrap
     * @param {number} maxWidth - Maximum width per line
     * @returns {string[]} - Array of lines
     */
    wrapText(ctx, text, maxWidth) {
        // Start with a large font to measure
        ctx.font = `bold 80px "Arial Black", "Impact", "Helvetica Neue", Arial, sans-serif`;
        
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';

        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const metrics = ctx.measureText(testLine);

            if (metrics.width > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }

        if (currentLine) {
            lines.push(currentLine);
        }

        // If still no lines (single long word), force split
        if (lines.length === 0) {
            lines.push(text);
        }

        return lines;
    }

    /**
     * Calculate optimal font size to fit text in canvas
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {string[]} lines - Text lines
     * @param {number} maxWidth - Maximum width
     * @returns {number} - Optimal font size
     */
    calculateOptimalFontSize(ctx, lines, maxWidth) {
        const maxHeight = this.canvasSize - (this.padding * 2);
        let fontSize = 120; // Start with large size
        const minFontSize = 24;

        while (fontSize > minFontSize) {
            ctx.font = `bold ${fontSize}px "Arial Black", "Impact", "Helvetica Neue", Arial, sans-serif`;

            // Check if all lines fit width
            let allFit = true;
            for (const line of lines) {
                if (ctx.measureText(line).width > maxWidth) {
                    allFit = false;
                    break;
                }
            }

            // Check if total height fits
            const totalHeight = lines.length * fontSize * this.lineSpacing;
            if (allFit && totalHeight <= maxHeight) {
                break;
            }

            fontSize -= 4;
        }

        return fontSize;
    }

    /**
     * Create animated WebP from frames using ffmpeg
     * @param {string[]} framePaths - Paths to frame images
     * @param {string} outputPath - Output WebP path
     * @param {number} frameCount - Number of frames
     * @returns {Promise<void>}
     */
    createAnimatedWebP(framePaths, outputPath, frameCount) {
        return new Promise((resolve, reject) => {
            // Get the frame pattern from the first frame path
            const framePattern = framePaths[0].replace('_frame000.png', '_frame%03d.png');

            const proc = spawn('ffmpeg', [
                '-y',
                '-framerate', String(this.animationFramerate),
                '-i', framePattern,
                '-vf', `scale=${this.canvasSize}:${this.canvasSize}:flags=lanczos`,
                '-loop', '0', // Infinite loop
                '-c:v', 'libwebp',
                '-lossless', '0',
                '-compression_level', '4',
                '-q:v', '80',
                '-preset', 'default',
                outputPath
            ]);

            let stderr = '';
            proc.stderr.on('data', (data) => stderr += data);
            proc.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`ffmpeg failed with code ${code}: ${stderr}`));
            });
            proc.on('error', (err) => reject(err));
        });
    }
}

module.exports = BratCommand;
