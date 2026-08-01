/**
 * 8Ball Command
 * Magic 8-ball fortune telling
 */

const CommandBase = require('./base');
const ui = require('../utils/ui');

class EightBallCommand extends CommandBase {
    constructor() {
        super({
            name: '8ball',
            aliases: ['8b', 'ask'],
            description: 'Tanya bola ajaib ya atau tidak',
            usage: '.8ball <pertanyaan>',
            category: 'fun',
            cooldown: 2000
        });

        this.responses = [
            // Positive
            { emoji: '✅', text: 'Sudah pasti' },
            { emoji: '✅', text: 'Jelas begitu' },
            { emoji: '✅', text: 'Tanpa ragu sedikit pun' },
            { emoji: '✅', text: 'Ya, pasti' },
            { emoji: '✅', text: 'Kamu bisa mengandalkannya' },
            { emoji: '✅', text: 'Menurutku, ya' },
            { emoji: '✅', text: 'Kemungkinan besar iya' },
            { emoji: '✅', text: 'Prospeknya bagus' },
            { emoji: '✅', text: 'Ya' },
            { emoji: '✅', text: 'Semua tanda mengarah ke ya' },

            // Non-committal
            { emoji: '🤔', text: 'Jawabannya masih kabur, coba lagi' },
            { emoji: '🤔', text: 'Tanyakan lagi nanti' },
            { emoji: '🤔', text: 'Sebaiknya belum kuberitahu sekarang' },
            { emoji: '🤔', text: 'Belum bisa diramalkan' },
            { emoji: '🤔', text: 'Fokus dulu, lalu tanya lagi' },

            // Negative
            { emoji: '❌', text: 'Jangan terlalu berharap' },
            { emoji: '❌', text: 'Jawabanku tidak' },
            { emoji: '❌', text: 'Sumberku bilang tidak' },
            { emoji: '❌', text: 'Prospeknya kurang bagus' },
            { emoji: '❌', text: 'Sangat diragukan' }
        ];
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        if (!args[0]) {
            return await this.replyUsage(sock, from, msg, {
                icon: '🔮',
                title: 'Bola Ajaib',
                description: 'Ajukan pertanyaan yang jawabannya ya atau tidak.',
                usage: ['.8ball <pertanyaan>'],
                examples: ['.8ball Apakah aku akan kaya?', '.8ball Besok hujan tidak?']
            });
        }

        await this.react(sock, msg, '🔮');

        const question = ui.safe(args.join(' '), 200);
        const answer = this.responses[Math.floor(Math.random() * this.responses.length)];

        await this.reply(sock, from, msg, ui.card({
            icon: '🔮',
            title: 'Bola Ajaib',
            lines: [
                `❓ ${ui.italic(question)}`,
                '',
                `${answer.emoji} ${ui.bold(answer.text)}`
            ]
        }));
        await this.react(sock, msg, '✅');
    }
}

module.exports = EightBallCommand;
