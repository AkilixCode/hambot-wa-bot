/**
 * QR Code Generator Command
 * Generate QR codes from text
 */

const CommandBase = require('./base');

class QRCommand extends CommandBase {
    constructor() {
        super({
            name: 'qr',
            aliases: ['qrcode', 'qrgen'],
            description: 'Generate QR code from text or URL',
            usage: '.qr <text or URL>',
            category: 'utility',
            cooldown: 3000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        if (!args[0]) {
            return await this.reply(sock, from, msg, 
                '📱 *QR Code Generator*\n\nUsage: .qr <text or URL>\n\nExamples:\n• .qr https://google.com\n• .qr Hello World\n• .qr +1234567890');
        }

        await this.react(sock, msg, '📱');

        try {
            const text = args.join(' ');
            
            // Using API to generate QR code
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(text)}`;

            await sock.sendMessage(from, {
                image: { url: qrUrl },
                caption: `📱 *QR Code Generated*\n\nContent: ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`
            }, { quoted: msg });

            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, '❌ Failed to generate QR code.');
        }
    }
}

module.exports = QRCommand;
