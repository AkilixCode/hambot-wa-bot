/**
 * ToImg Command
 * Convert WhatsApp stickers to images
 */

const CommandBase = require('./base');
const logger = require('../utils/logger');
const { downloadMedia, generateFilename } = require('../utils/helpers');
const { spawnPromise } = require('../utils/helpers');
const fsPromises = require('fs').promises;

class ToImgCommand extends CommandBase {
    constructor() {
        super({
            name: 'toimg',
            aliases: ['toimage', 'stickertoimg'],
            description: 'Ubah stiker menjadi gambar',
            usage: '.toimg (reply to a sticker)',
            category: 'tools',
            cooldown: 3000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        // Check if replying to a sticker
        const quotedSticker = msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage;

        if (!quotedSticker) {
            return await this.reply(sock, from, msg, '❌ Please reply to a sticker!\n\nUsage: Reply to a sticker and type .toimg');
        }

        await this.react(sock, msg, '🖼️');

        const webpFile = generateFilename('sticker', 'webp');
        const pngFile = generateFilename('sticker', 'png');

        try {
            // Download sticker
            logger.info('ToImg: converting sticker to image...');
            const stickerBuffer = await downloadMedia(quotedSticker, 'sticker');

            // Save as webp
            await fsPromises.writeFile(webpFile, stickerBuffer);

            // Convert to PNG using ffmpeg
            await spawnPromise('ffmpeg', [
                '-i', webpFile,
                pngFile,
                '-y'
            ]);

            // Read and send PNG
            const imageBuffer = await fsPromises.readFile(pngFile);
            logger.info('ToImg: conversion done');
            await sock.sendMessage(from, {
                image: imageBuffer,
                caption: '✅ Sticker converted to image'
            }, { quoted: msg });

            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            await this.replyError(sock, from, msg, 'Failed to convert sticker. Make sure FFmpeg is installed.');
        } finally {
            // Cleanup
            await fsPromises.unlink(webpFile).catch(() => {});
            await fsPromises.unlink(pngFile).catch(() => {});
        }
    }
}

module.exports = ToImgCommand;
