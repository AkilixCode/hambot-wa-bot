/**
 * Translate Command
 * Terjemahkan teks ke bahasa lain
 */

const CommandBase = require('./base');
const ui = require('../utils/ui');
const { fungsiTranslate } = require('../utils/helpers');
const logger = require('../utils/logger');

class TranslateCommand extends CommandBase {
    constructor() {
        super({
            name: 'translate',
            aliases: ['tr', 'trans', 'terjemah'],
            description: 'Terjemahkan teks ke bahasa lain',
            usage: '.translate <kode bahasa> <teks>',
            category: 'utility',
            cooldown: 3000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        if (!args[0] || !args[1]) {
            return await this.replyUsage(sock, from, msg, {
                icon: '🌐',
                title: 'Penerjemah',
                description: 'Terjemahkan teks ke bahasa lain.',
                usage: ['.translate <kode bahasa> <teks>'],
                examples: [
                    '.translate id Hello World',
                    '.translate en Selamat pagi',
                    '.translate ja Terima kasih'
                ],
                notes: [
                    'en Inggris · id Indonesia · es Spanyol · fr Prancis',
                    'de Jerman · ja Jepang · ko Korea · zh Mandarin',
                    'ar Arab · hi Hindi'
                ]
            });
        }

        await this.react(sock, msg, '🌐');

        try {
            const targetLang = args[0].toLowerCase();
            const text = args.slice(1).join(' ');

            logger.info(`Translate: translating to ${targetLang}`);
            const translated = await fungsiTranslate(text, targetLang);
            logger.info('Translate: done');

            await this.reply(sock, from, msg, ui.card({
                icon: '🌐',
                title: 'Hasil Terjemahan',
                lines: [
                    `📝 ${ui.bold('Asli')}`,
                    ui.safe(text, 800),
                    '',
                    `🔄 ${ui.bold(`Terjemahan (${ui.safe(targetLang, 8)})`)}`,
                    ui.safe(translated, 800)
                ]
            }));
            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            await this.replyError(sock, from, msg, 'Terjemahan gagal dijalankan.', {
                hint: ['Periksa kode bahasanya', '.translate id Hello World']
            });
        }
    }
}

module.exports = TranslateCommand;
