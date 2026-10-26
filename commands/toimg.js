/**
 * ToImg Command
 * Convert WhatsApp stickers to images
 */

const CommandBase = require('./base');
const logger = require('../utils/logger');
const ui = require('../utils/ui');
const { downloadMedia } = require('../utils/helpers');
const incomingMedia = require('../utils/incoming-media');

class ToImgCommand extends CommandBase {
    constructor() {
        super({
            name: 'toimg',
            aliases: ['toimage', 'stickertoimg'],
            description: 'Ubah stiker menjadi gambar',
            usage: '.toimg (reply stiker)',
            category: 'tools',
            cooldown: 3000,
            // Download + decode + encode: it waits for a heavy slot like
            // the other conversions, so a burst cannot pile up unbounded.
            isHeavy: true
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        const quotedSticker = msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage;

        if (!quotedSticker) {
            return await this.replyUsage(sock, from, msg, {
                icon: '🖼️',
                title: 'Stiker ke Gambar',
                description: 'Ubah stiker jadi file gambar biasa.',
                usage: ['.toimg (sambil reply stiker)'],
                notes: ['Reply stikernya dulu, baru ketik perintahnya']
            });
        }

        await this.react(sock, msg, '🖼️');

        try {
            logger.info('ToImg: converting sticker to image...');
            const stickerBuffer = await downloadMedia(quotedSticker, 'sticker');
            const imageBuffer = await this.convert(stickerBuffer);
            logger.info('ToImg: conversion done');

            await this.replyMedia(sock, from, msg, {
                image: imageBuffer,
                caption: ui.card({
                    icon: '🖼️',
                    title: 'Stiker Jadi Gambar',
                    lines: ['Stiker berhasil diubah jadi PNG.'],
                    footer: ui.clock()
                })
            });

            await this.react(sock, msg, '✅');
        } catch (error) {
            this.logError(error, context);
            const refused = incomingMedia.describe(error);
            await this.replyError(sock, from, msg, refused ? refused.reason : 'Gagal mengubah stiker jadi gambar.', {
                ...(refused ? { title: refused.title } : {}),
                hint: ['Coba stiker yang lain']
            });
        }
    }

    /**
     * WebP sticker → PNG, in memory.
     *
     * This used ffmpeg, whose WebP decoder (5.x, as in the Docker image)
     * cannot read animated WebP — so every animated sticker failed. sharp
     * (already used by .sticker) reads both; an animated sticker gives its
     * first frame. No temp files and no ffmpeg needed.
     *
     * @param {Buffer} webp
     * @returns {Promise<Buffer>} PNG bytes
     */
    async convert(webp) {
        // Required here, not at load: sharp is ~22 MB an idle bot need not hold.
        const sharp = require('sharp');
        // Pixel ceiling: a tiny file cannot unpack into gigabytes.
        return sharp(webp, { animated: false, ...incomingMedia.SHARP_INPUT }).png().toBuffer();
    }
}

module.exports = ToImgCommand;
