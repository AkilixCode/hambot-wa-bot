/**
 * Translate Command
 * Terjemahkan teks ke bahasa lain
 */

const CommandBase = require('./base');
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
            return await this.reply(sock, from, msg, 
`🌐 *Penerjemah*

📝 Cara Pakai: .translate <bahasa> <teks>

🌍 Kode Bahasa:
• en - English
• id - Indonesia
• es - Español
• fr - Français
• de - Deutsch
• ja - 日本語
• ko - 한국어
• zh - 中文
• ar - العربية
• hi - हिंदी

📌 Contoh: .translate id Hello World`);
        }

        await this.react(sock, msg, '🌐');

        try {
            const targetLang = args[0].toLowerCase();
            const text = args.slice(1).join(' ');

            logger.info(`Translate: translating to ${targetLang}`);
            const translated = await fungsiTranslate(text, targetLang);
            logger.info('Translate: done');

            const response = 
`🌐 *Hasil Terjemahan*

📝 Asli:
${text}

🔄 Terjemahan (${targetLang}):
${translated}`;

            await this.reply(sock, from, msg, response);
            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, '❌ Terjemahan gagal. Periksa kode bahasa.');
        }
    }
}

module.exports = TranslateCommand;
