/**
 * Translate Command
 * Translate text between languages
 */

const CommandBase = require('./base');
const { fungsiTranslate } = require('../utils/helpers');

class TranslateCommand extends CommandBase {
    constructor() {
        super({
            name: 'translate',
            aliases: ['tr', 'trans'],
            description: 'Translate text to another language',
            usage: '.translate <lang> <text>',
            category: 'utility',
            cooldown: 3000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        if (!args[0] || !args[1]) {
            return await this.reply(sock, from, msg, 
`🌐 *Translator*

Usage: .translate <language> <text>

Language codes:
• en - English
• id - Indonesian
• es - Spanish
• fr - French
• de - German
• ja - Japanese
• ko - Korean
• zh - Chinese
• ar - Arabic
• hi - Hindi

Example: .translate id Hello World`);
        }

        await this.react(sock, msg, '🌐');

        try {
            const targetLang = args[0].toLowerCase();
            const text = args.slice(1).join(' ');

            const translated = await fungsiTranslate(text, targetLang);

            const response = 
`🌐 *Translation*

📝 Original:
${text}

🔄 Translated (${targetLang}):
${translated}`;

            await this.reply(sock, from, msg, response);
            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, '❌ Translation failed. Check language code.');
        }
    }
}

module.exports = TranslateCommand;
