/**
 * Rock Paper Scissors Command
 * Play rock paper scissors with the bot
 */

const CommandBase = require('./base');
const ui = require('../utils/ui');

class RPSCommand extends CommandBase {
    constructor() {
        super({
            name: 'rps',
            aliases: ['rockpaperscissors', 'suit'],
            description: 'Main batu gunting kertas',
            usage: '.rps <batu/kertas/gunting>',
            category: 'fun',
            cooldown: 2000
        });

        this.choices = ['batu', 'kertas', 'gunting'];

        // Accept the English words too — plenty of people still type "rock".
        this.synonyms = {
            batu: 'batu', rock: 'batu', r: 'batu',
            kertas: 'kertas', paper: 'kertas', p: 'kertas',
            gunting: 'gunting', scissors: 'gunting', s: 'gunting'
        };

        this.emojis = {
            batu: '🪨',
            kertas: '📄',
            gunting: '✂️'
        };
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        if (!args[0]) {
            return await this.replyUsage(sock, from, msg, {
                icon: '✊',
                title: 'Batu Gunting Kertas',
                description: 'Lawan bot dalam satu ronde suit.',
                usage: ['.rps <batu/kertas/gunting>'],
                examples: ['.rps batu', '.rps kertas', '.rps gunting']
            });
        }

        await this.react(sock, msg, '✊');

        try {
            const userChoice = this.synonyms[args[0].toLowerCase()];

            if (!userChoice) {
                return await this.replyError(sock, from, msg,
                    `Pilihan ${ui.mono(ui.safe(args[0], 20))} tidak dikenal.`, {
                        title: 'Pilihan Salah',
                        hint: ['.rps batu', '.rps kertas', '.rps gunting']
                    });
            }

            const botChoice = this.choices[Math.floor(Math.random() * 3)];
            const result = this.determineWinner(userChoice, botChoice);

            const resultEmoji = result === 'win' ? '🎉' : result === 'lose' ? '😔' : '🤝';
            const resultText = result === 'win' ? 'Kamu menang!'
                : result === 'lose' ? 'Kamu kalah!'
                : 'Seri!';

            await this.reply(sock, from, msg, ui.card({
                icon: '✊',
                title: 'Batu Gunting Kertas',
                lines: [
                    ui.kv('Kamu', `${this.emojis[userChoice]} ${userChoice}`, '👤'),
                    ui.kv('Bot', `${this.emojis[botChoice]} ${botChoice}`, '🤖'),
                    '',
                    `${resultEmoji} ${ui.bold(resultText)}`
                ],
                footer: 'Ketik .rps untuk main lagi'
            }));
            await this.react(sock, msg, resultEmoji);

        } catch (error) {
            this.logError(error, context);
            await this.replyError(sock, from, msg, 'Permainan gagal dijalankan.', {
                hint: ['.rps batu']
            });
        }
    }

    determineWinner(user, bot) {
        if (user === bot) return 'tie';

        if (
            (user === 'batu' && bot === 'gunting') ||
            (user === 'kertas' && bot === 'batu') ||
            (user === 'gunting' && bot === 'kertas')
        ) {
            return 'win';
        }

        return 'lose';
    }
}

module.exports = RPSCommand;
