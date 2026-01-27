/**
 * Sticker Command
 * Convert images to WhatsApp stickers
 */

const CommandBase = require('./base');
const sharp = require('sharp');
const { downloadMedia } = require('../utils/helpers');

class StickerCommand extends CommandBase {
    constructor() {
        super({
            name: 'sticker',
            aliases: ['s', 'stiker', 'stik'],
            description: 'Convert image to sticker',
            usage: '.sticker (send with image or reply to image)',
            category: 'tools',
            cooldown: 3000,
            isHeavy: false,
            requiresMedia: true
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        await this.react(sock, msg, '⏳');

        try {
            // Get image from message or quoted message
            const isImg = msg.message.imageMessage;
            const isQuoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;

            const imageMessage = isImg || isQuoted;
            if (!imageMessage) {
                return await this.reply(sock, from, msg, '❌ Please send or reply to an image!');
            }

            // Download image
            const buffer = await downloadMedia(imageMessage, 'image');

            // Convert to sticker format
            const stickerBuffer = await sharp(buffer)
                .resize(512, 512, {
                    fit: 'contain',
                    background: { r: 0, g: 0, b: 0, alpha: 0 }
                })
                .webp({ quality: 90 })
                .toBuffer();

            // Send sticker
            await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: msg });
            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, '❌ Failed to create sticker. Make sure the image is valid.');
        }
    }
}

module.exports = StickerCommand;
