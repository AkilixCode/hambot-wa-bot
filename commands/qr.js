/**
 * QR Code Generator Command
 * Generate QR codes from text
 */

const CommandBase = require('./base');
const ui = require('../utils/ui');
const logger = require('../utils/logger');

class QRCommand extends CommandBase {
    constructor() {
        super({
            name: 'qr',
            aliases: ['qrcode', 'qrgen'],
            description: 'Buat QR code dari teks atau URL',
            usage: '.qr <text or URL>',
            category: 'utility',
            cooldown: 3000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        if (!args[0]) {
            return await this.replyUsage(sock, from, msg, {
                icon: '📱',
                title: 'Pembuat QR Code',
                description: 'Ubah teks atau tautan menjadi QR code.',
                usage: ['.qr <teks atau URL>'],
                examples: ['.qr https://google.com', '.qr Halo dunia', '.qr 08123456789']
            });
        }

        await this.react(sock, msg, '📱');

        try {
            const text = args.join(' ');
            logger.info(`QR: generating code for content length=${text.length}`);
            
            // Using API to generate QR code
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(text)}`;

            await this.replyMedia(sock, from, msg, {
                image: { url: qrUrl },
                caption: ui.card({
                    icon: '📱',
                    title: 'QR Code',
                    lines: [ui.kv('Isi', ui.mono(ui.safe(text, 100)), '📄')],
                    footer: 'Pindai dengan kamera ponsel'
                })
            });

            logger.info('QR: code generated');
            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            await this.replyError(sock, from, msg, 'Gagal membuat QR code.', {
                hint: ['Coba lagi sebentar lagi']
            });
        }
    }
}

module.exports = QRCommand;
