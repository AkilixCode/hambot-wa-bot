/**
 * Dice Roll Command
 * Roll dice with various configurations
 */

const CommandBase = require('./base');
const ui = require('../utils/ui');

class DiceCommand extends CommandBase {
    constructor() {
        super({
            name: 'dice',
            aliases: ['roll', 'd'],
            description: 'Lempar dadu, bisa banyak sekaligus',
            usage: '.dice [jumlah]d[sisi]',
            category: 'fun',
            cooldown: 2000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        await this.react(sock, msg, '🎲');

        try {
            let numDice = 1;
            let numSides = 6;

            if (args[0]) {
                // Parse dice notation (e.g., 2d20, 3d6)
                const match = args[0].match(/^(\d+)?d(\d+)$/i);
                if (match) {
                    numDice = parseInt(match[1]) || 1;
                    numSides = parseInt(match[2]) || 6;
                } else {
                    const num = parseInt(args[0]);
                    if (!isNaN(num) && num > 0) {
                        numSides = num;
                    }
                }
            }

            // Limit to reasonable numbers
            numDice = Math.min(numDice, 10);
            numSides = Math.min(numSides, 1000);

            const rolls = [];
            let total = 0;

            for (let i = 0; i < numDice; i++) {
                const roll = Math.floor(Math.random() * numSides) + 1;
                rolls.push(roll);
                total += roll;
            }

            const lines = [
                ui.kv('Lemparan', `${numDice}d${numSides}`, '🎯'),
                ui.kv('Hasil', rolls.join(' · '), '📊')
            ];

            if (numDice > 1) {
                lines.push(ui.kv('Total', ui.bold(String(total)), '➕'));
                lines.push(ui.kv('Rata-rata', (total / numDice).toFixed(2), '📈'));
            }

            await this.reply(sock, from, msg, ui.card({
                icon: '🎲',
                title: 'Lempar Dadu',
                lines,
                footer: 'Ketik .dice 2d20 untuk dadu lain'
            }));
            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            await this.replyError(sock, from, msg, 'Format dadu tidak dikenali.', {
                title: 'Format Salah',
                hint: ['.dice', '.dice 2d20', '.dice 3d6']
            });
        }
    }
}

module.exports = DiceCommand;
