/**
 * ToImg Command
 * Convert WhatsApp stickers to images
 */

const CommandBase = require('./base');
const logger = require('../utils/logger');
const ui = require('../utils/ui');
const { downloadMedia, generateFilename, spawnPromise } = require('../utils/helpers');
const tempdir = require('../utils/tempdir');
const fsPromises = require('fs').promises;

// A sticker is small; anything slower than this means ffmpeg is stuck.
const CONVERT_TIMEOUT_MS = 30000;

class ToImgCommand extends CommandBase {
    constructor() {
        super({
            name: 'toimg',
            aliases: ['toimage', 'stickertoimg'],
            description: 'Ubah stiker menjadi gambar',
            usage: '.toimg (reply stiker)',
            category: 'tools',
            cooldown: 3000
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

        // Scratch files live in tmp/, not the repo root.
        const webpFile = tempdir.tempPath(generateFilename('sticker', 'webp'));
        const pngFile = tempdir.tempPath(generateFilename('sticker', 'png'));

        try {
            logger.info('ToImg: converting sticker to image...');
            const stickerBuffer = await downloadMedia(quotedSticker, 'sticker');

            await fsPromises.writeFile(webpFile, stickerBuffer);

            // -y goes before the output path. It was previously placed after,
            // where ffmpeg treats it as a trailing global flag rather than an
            // overwrite instruction for this output — so a leftover file could
            // make ffmpeg block on an interactive prompt that never gets
            // answered. With the timeout below that is now survivable either
            // way, but the flag order is the actual fix.
            await spawnPromise('ffmpeg', ['-y', '-i', webpFile, pngFile], {
                timeout: CONVERT_TIMEOUT_MS
            });

            const imageBuffer = await fsPromises.readFile(pngFile);
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

            const isMissingFfmpeg = /enoent|not found/i.test(error.message || '');
            await this.replyError(sock, from, msg,
                isMissingFfmpeg
                    ? 'Komponen konversi belum terpasang di server.'
                    : 'Gagal mengubah stiker jadi gambar.', {
                    hint: isMissingFfmpeg
                        ? ['Hubungi admin bot']
                        : ['Coba stiker yang lain', 'Stiker animasi belum didukung']
                });
        } finally {
            await fsPromises.unlink(webpFile).catch(() => {});
            await fsPromises.unlink(pngFile).catch(() => {});
        }
    }
}

module.exports = ToImgCommand;
