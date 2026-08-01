/**
 * Coin Flip Command
 * Flip a coin (heads or tails)
 */

const CommandBase = require('./base');
const ui = require('../utils/ui');

class FlipCommand extends CommandBase {
    constructor() {
        super({
            name: 'flip',
            aliases: ['coin', 'coinflip'],
            description: 'Lempar koin, angka atau gambar',
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
        const result = isHeads ? 'ANGKA' : 'GAMBAR';
        const emoji = isHeads ? '🪙' : '🦅';

        await this.reply(sock, from, msg, ui.card({
            icon: '🪙',
            title: 'Lempar Koin',
            lines: [
                ui.italic('Koin berputar di udara…'),
                '',
                `${emoji} ${ui.bold(result)}`
            ],
            footer: 'Ketik .flip untuk lempar lagi'
        }));
        await this.react(sock, msg, '✅');
    }
}

module.exports = FlipCommand;
