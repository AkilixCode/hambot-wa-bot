/**
 * Coin Flip Command
 * Flip a coin (heads or tails)
 */

const CommandBase = require('./base');

class FlipCommand extends CommandBase {
    constructor() {
        super({
            name: 'flip',
            aliases: ['coin', 'coinflip'],
            description: 'Flip a coin',
            usage: '.flip',
            category: 'fun',
            cooldown: 2000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        await this.react(sock, msg, '🪙');

        // Simulate coin flip
        const isHeads = Math.random() < 0.5;
        const result = isHeads ? 'Heads' : 'Tails';
        const emoji = isHeads ? '🗣️' : '🦅';

        const response = 
`🪙 *Coin Flip*

🔄 Flipping...
.
.
.
${emoji} **${result}!**`;

        await this.reply(sock, from, msg, response);
        await this.react(sock, msg, '✅');
    }
}

module.exports = FlipCommand;
