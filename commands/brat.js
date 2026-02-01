/**
 * Brat Command - Charli XCX Album Cover Style Generator
 * Replicates the visual style of the Gyurmatag brat generator
 * Uses Canvas for rendering and Sharp for post-processing filters
 */

const CommandBase = require('./base');
const { createCanvas, registerFont } = require('canvas');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

class BratCommand extends CommandBase {
    constructor() {
        super({
            name: 'brat',
            aliases: ['bratgen', 'stikerbrat', 'charli'],
            description: 'Generate Charli XCX "Brat" album cover style sticker',
            usage: '.brat <text>',
            category: 'fun',
            cooldown: 5000,
            isHeavy: true
        });

        this.canvasSize = 512;
        this.padding = 30;
        this.fontFamily = 'Arial Narrow';
        this.fontRegistered = false;

        // Register custom font if available
        this._registerFont();
    }

    /**
     * Register Arial Narrow font if available
     * Falls back to system fonts if not found
     */
    _registerFont() {
        const fontPaths = [
            path.join(process.cwd(), 'fonts', 'arialnarrow.ttf'),
            path.join(process.cwd(), 'fonts', 'ArialNarrow.ttf'),
            path.join(process.cwd(), 'fonts', 'arial-narrow.ttf'),
            path.join(process.cwd(), 'fonts', 'ArialNarrow-Bold.ttf')
        ];

        for (const fontPath of fontPaths) {
            try {
                if (fs.existsSync(fontPath)) {
                    registerFont(fontPath, { family: 'BratFont', weight: 'bold' });
                    this.fontFamily = 'BratFont';
                    this.fontRegistered = true;
                    return;
                }
            } catch (e) {
                // Continue to next font path
            }
        }

        // Fallback warning (only log once)
        if (!this.fontRegistered) {
            console.warn('[BRAT] Arial Narrow font not found in /fonts. Using system fallback.');
        }
    }

    /**
     * Execute the brat command
     * @param {import('@whiskeysockets/baileys').WASocket} sock - WhatsApp socket
     * @param {Object} msg - Message object from Baileys
     * @param {string[]} args - Command arguments
     * @param {Object} context - Execution context
     */
    async execute(sock, msg, args, context) {
        const { from } = context;

        // Preserve all whitespace by joining with single space
        // Args are already split by handler, so we rejoin them
        let text = args.join(' ');

        // Validation
        if (!text || text.trim() === '') {
            return await this.reply(sock, from, msg, 
                '❌ Please provide text!\n\n' +
                '*Usage:* `.brat your text here`\n' +
                '*Example:* `.brat brat`'
            );
        }

        if (text.length > 500) {
            return await this.reply(sock, from, msg, 
                '❌ Text too long! Maximum 500 characters.'
            );
        }

        await this.react(sock, msg, '⏳');

        try {
            // Step 1: Generate raw canvas with text
            const rawBuffer = await this.generateCanvas(text);

            // Step 2: Apply Gyurmatag-style post-processing filter
            // CSS equivalent: filter: blur(1px) contrast(1.25)
            const finalBuffer = await sharp(rawBuffer)
                .blur(0.5) // Slight blur for "low-res" aesthetic
                .linear(1.25, -(128 * 1.25) + 128) // Contrast 1.25 formula
                .toFormat('webp', { quality: 90 })
                .toBuffer();

            // Step 3: Send as sticker
            await sock.sendMessage(from, {
                sticker: finalBuffer
            }, { quoted: msg });

            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, '❌ Failed to generate sticker.');
        }
    }

    /**
     * Generate the Brat-style canvas
     * @param {string} text - Text to render
     * @returns {Promise<Buffer>} PNG buffer
     */
    async generateCanvas(text) {
        const size = this.canvasSize;
        const padding = this.padding;
        const maxWidth = size - (padding * 2);
        const maxHeight = size - (padding * 2);
        const verticalStretch = 1.15; // 115% vertical stretch
        const lineHeightRatio = 1.05; // Tight line spacing like album cover

        const canvas = createCanvas(size, size);
        const ctx = canvas.getContext('2d');

        // Background: Pure White (#FFFFFF)
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, size, size);

        // Text config: Pure Black (#000000)
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Auto-scaling loop: Start large, shrink until text fits
        let fontSize = 200;
        let finalLines = [];
        const minFontSize = 10;

        do {
            // Set font with weight 900 for bold look
            ctx.font = `900 ${fontSize}px "${this.fontFamily}", "Arial Narrow", Arial, sans-serif`;

            // Smart wrap the text
            const lines = this.smartWrap(ctx, text, maxWidth);

            // Calculate total height with stretch factor
            const lineHeight = fontSize * lineHeightRatio;
            const totalHeight = lines.length * lineHeight * verticalStretch;

            // Check if any single word/line exceeds max width
            const widestLine = Math.max(...lines.map(line => ctx.measureText(line).width));
            const isTooWide = widestLine > maxWidth;

            // Check if total height exceeds max height
            const isTooTall = totalHeight > maxHeight;

            if (!isTooWide && !isTooTall) {
                finalLines = lines;
                break;
            }

            // Reduce font size and try again
            fontSize -= 5;

        } while (fontSize >= minFontSize);

        // Fallback if font is still too large (shouldn't happen)
        if (finalLines.length === 0) {
            ctx.font = `900 ${minFontSize}px "${this.fontFamily}", "Arial Narrow", Arial, sans-serif`;
            finalLines = this.smartWrap(ctx, text, maxWidth);
        }

        // Calculate vertical positioning
        const lineHeight = fontSize * lineHeightRatio;
        const totalBlockHeight = finalLines.length * lineHeight * verticalStretch;
        const startY = (size - totalBlockHeight) / 2 + (lineHeight * verticalStretch) / 2;

        // Apply vertical stretch transformation
        ctx.save();
        ctx.translate(size / 2, size / 2);
        ctx.scale(1, verticalStretch); // Vertical stretch 115%
        ctx.translate(-size / 2, -size / 2);

        // Render each line
        finalLines.forEach((line, index) => {
            // Adjust Y position for stretch
            const yPos = (startY / verticalStretch) + (index * lineHeight);
            ctx.fillText(line, size / 2, yPos);
        });

        ctx.restore();

        return canvas.toBuffer('image/png');
    }

    /**
     * Smart word wrap that preserves whitespace and handles manual newlines
     * Microsoft Word-like behavior: preserves multiple spaces and respects \n
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {string} text - Input text
     * @param {number} maxWidth - Maximum line width
     * @returns {string[]} Array of lines
     */
    smartWrap(ctx, text, maxWidth) {
        // Step 1: Split by manual newlines first
        const paragraphs = text.split('\n');
        const allLines = [];

        for (const paragraph of paragraphs) {
            // Handle empty paragraphs (consecutive newlines)
            if (paragraph === '') {
                allLines.push('');
                continue;
            }

            // Step 2: Split by whitespace but PRESERVE the whitespace tokens
            // Regex captures whitespace as separate tokens
            const tokens = paragraph.split(/(\s+)/);
            let currentLine = '';

            for (const token of tokens) {
                const testLine = currentLine + token;
                const testWidth = ctx.measureText(testLine).width;

                if (testWidth <= maxWidth) {
                    // Fits - add to current line
                    currentLine = testLine;
                } else {
                    // Doesn't fit - handle overflow
                    
                    // Push current line if it has content
                    if (currentLine !== '') {
                        allLines.push(currentLine);
                    }

                    // Check if this single token is wider than maxWidth
                    const tokenWidth = ctx.measureText(token).width;
                    
                    if (tokenWidth > maxWidth) {
                        // Token itself is too wide - character-level break
                        const brokenLines = this.breakLongWord(ctx, token, maxWidth);
                        
                        // Add all but the last line
                        for (let i = 0; i < brokenLines.length - 1; i++) {
                            allLines.push(brokenLines[i]);
                        }
                        
                        // Continue with the last fragment
                        currentLine = brokenLines[brokenLines.length - 1] || '';
                    } else {
                        // Token fits on a new line
                        // Trim leading whitespace for new lines (optional behavior)
                        currentLine = token.trimStart() || token;
                    }
                }
            }

            // Push remaining content
            if (currentLine !== '') {
                allLines.push(currentLine);
            }
        }

        return allLines;
    }

    /**
     * Break a long word that exceeds maxWidth into multiple lines
     * Character-level breaking for super long words
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {string} word - Long word to break
     * @param {number} maxWidth - Maximum width
     * @returns {string[]} Array of word fragments
     */
    breakLongWord(ctx, word, maxWidth) {
        const fragments = [];
        let currentFragment = '';

        for (const char of word) {
            const testFragment = currentFragment + char;
            const testWidth = ctx.measureText(testFragment).width;

            if (testWidth <= maxWidth) {
                currentFragment = testFragment;
            } else {
                if (currentFragment !== '') {
                    fragments.push(currentFragment);
                }
                currentFragment = char;
            }
        }

        if (currentFragment !== '') {
            fragments.push(currentFragment);
        }

        return fragments;
    }
}

module.exports = BratCommand;
