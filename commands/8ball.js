/**
 * 8Ball Command
 * Magic 8-ball fortune telling
 */

const CommandBase = require('./base');

class EightBallCommand extends CommandBase {
    constructor() {
        super({
            name: '8ball',
            aliases: ['8b', 'ask'],
            description: 'Ask the magic 8-ball a yes/no question',
            usage: '.8ball <question>',
            category: 'fun',
            cooldown: 2000
        });

        this.responses = [
            // Positive
            '✅ It is certain',
            '✅ It is decidedly so',
            '✅ Without a doubt',
            '✅ Yes definitely',
            '✅ You may rely on it',
            '✅ As I see it, yes',
            '✅ Most likely',
            '✅ Outlook good',
            '✅ Yes',
            '✅ Signs point to yes',
            
            // Non-committal
            '🤔 Reply hazy, try again',
            '🤔 Ask again later',
            '🤔 Better not tell you now',
            '🤔 Cannot predict now',
            '🤔 Concentrate and ask again',
            
            // Negative
            '❌ Don\'t count on it',
            '❌ My reply is no',
            '❌ My sources say no',
            '❌ Outlook not so good',
            '❌ Very doubtful'
        ];
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        if (!args[0]) {
            return await this.reply(sock, from, msg, 
                '🔮 *Magic 8-Ball*\n\nAsk a yes/no question!\n\nUsage: .8ball <question>\n\nExample: .8ball Will I be rich?');
        }

        await this.react(sock, msg, '🔮');

        const question = args.join(' ');
        const answer = this.responses[Math.floor(Math.random() * this.responses.length)];

        const response = 
`🔮 *Magic 8-Ball*

❓ Question: _${question}_

🎱 Answer: **${answer}**`;

        await this.reply(sock, from, msg, response);
        await this.react(sock, msg, '✅');
    }
}

module.exports = EightBallCommand;
