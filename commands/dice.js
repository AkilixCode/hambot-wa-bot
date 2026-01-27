/**
 * Dice Roll Command
 * Roll dice with various configurations
 */

const CommandBase = require('./base');

class DiceCommand extends CommandBase {
    constructor() {
        super({
            name: 'dice',
            aliases: ['roll', 'd'],
            description: 'Roll dice (supports multiple dice)',
            usage: '.dice [number]d[sides]',
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

            const diceEmoji = '🎲';
            const rollsText = rolls.join(', ');

            let response = `${diceEmoji} *Dice Roll*\n\n`;
            response += `🎯 Rolling ${numDice}d${numSides}\n\n`;
            response += `📊 Results: ${rollsText}\n`;
            
            if (numDice > 1) {
                response += `➕ Total: **${total}**\n`;
                response += `📈 Average: ${(total / numDice).toFixed(2)}`;
            }

            await this.reply(sock, from, msg, response);
            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, '❌ Invalid dice format. Use: .dice 2d20');
        }
    }
}

module.exports = DiceCommand;
