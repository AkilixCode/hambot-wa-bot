/**
 * Rock Paper Scissors Command
 * Play rock paper scissors with the bot
 */

const CommandBase = require('./base');

class RPSCommand extends CommandBase {
    constructor() {
        super({
            name: 'rps',
            aliases: ['rockpaperscissors'],
            description: 'Play Rock Paper Scissors',
            usage: '.rps <rock/paper/scissors>',
            category: 'fun',
            cooldown: 2000
        });

        this.choices = ['rock', 'paper', 'scissors'];
        this.emojis = {
            rock: '🪨',
            paper: '📄',
            scissors: '✂️'
        };
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        if (!args[0]) {
            return await this.reply(sock, from, msg, 
                '✊✋✌️ *Rock Paper Scissors*\n\nUsage: .rps <choice>\n\nChoices:\n• rock\n• paper\n• scissors');
        }

        await this.react(sock, msg, '✊');

        const userChoice = args[0].toLowerCase();
        
        if (!this.choices.includes(userChoice)) {
            return await this.reply(sock, from, msg, 
                '❌ Invalid choice! Use: rock, paper, or scissors');
        }

        const botChoice = this.choices[Math.floor(Math.random() * 3)];
        const result = this.determineWinner(userChoice, botChoice);

        const resultEmoji = result === 'win' ? '🎉' : result === 'lose' ? '😔' : '🤝';
        const resultText = result === 'win' ? 'You Win!' : result === 'lose' ? 'You Lose!' : 'It\'s a Tie!';

        const response = 
`✊✋✌️ *Rock Paper Scissors*

You chose: ${this.emojis[userChoice]} ${userChoice}
Bot chose: ${this.emojis[botChoice]} ${botChoice}

${resultEmoji} **${resultText}**`;

        await this.reply(sock, from, msg, response);
        await this.react(sock, msg, resultEmoji);
    }

    determineWinner(user, bot) {
        if (user === bot) return 'tie';
        
        if (
            (user === 'rock' && bot === 'scissors') ||
            (user === 'paper' && bot === 'rock') ||
            (user === 'scissors' && bot === 'paper')
        ) {
            return 'win';
        }
        
        return 'lose';
    }
}

module.exports = RPSCommand;
