/**
 * Quote Command
 * Get random inspirational quotes
 */

const CommandBase = require('./base');
const axios = require('axios');

class QuoteCommand extends CommandBase {
    constructor() {
        super({
            name: 'quote',
            aliases: ['quotes', 'inspire'],
            description: 'Get a random inspirational quote',
            usage: '.quote',
            category: 'fun',
            cooldown: 3000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        await this.react(sock, msg, '💭');

        try {
            // Using quotable API
            const { data } = await axios.get(
                'https://api.quotable.io/random',
                { timeout: 10000 }
            );

            const quote = data.content;
            const author = data.author;

            const response = 
`💭 *Inspirational Quote*

"${quote}"

— _${author}_`;

            await this.reply(sock, from, msg, response);
            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            
            // Fallback quotes
            const fallbackQuotes = [
                { quote: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
                { quote: "Life is what happens when you're busy making other plans.", author: "John Lennon" },
                { quote: "The future belongs to those who believe in the beauty of their dreams.", author: "Eleanor Roosevelt" },
                { quote: "It is during our darkest moments that we must focus to see the light.", author: "Aristotle" },
                { quote: "The only impossible journey is the one you never begin.", author: "Tony Robbins" }
            ];
            
            const random = fallbackQuotes[Math.floor(Math.random() * fallbackQuotes.length)];
            await this.reply(sock, from, msg, `💭 *Quote*\n\n"${random.quote}"\n\n— _${random.author}_`);
        }
    }
}

module.exports = QuoteCommand;
