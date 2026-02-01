/**
 * Quote Command
 * Dapatkan kutipan inspirasional acak
 */

const CommandBase = require('./base');
const httpClient = require('../utils/http-client');

class QuoteCommand extends CommandBase {
    constructor() {
        super({
            name: 'quote',
            aliases: ['quotes', 'inspire', 'kutipan'],
            description: 'Dapatkan kutipan inspirasional acak',
            usage: '.quote',
            category: 'fun',
            cooldown: 3000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        await this.react(sock, msg, '💭');

        try {
            // Using quotable API with proxy support
            const { data } = await httpClient.get(
                'https://api.quotable.io/random',
                { timeout: 10000 }
            );

            const quote = data.content;
            const author = data.author;

            const response = 
`💭 *Kutipan Inspirasional*

"${quote}"

— _${author}_`;

            await this.reply(sock, from, msg, response);
            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            
            // Kutipan cadangan
            const fallbackQuotes = [
                { quote: "Satu-satunya cara untuk melakukan pekerjaan hebat adalah mencintai apa yang kamu lakukan.", author: "Steve Jobs" },
                { quote: "Hidup adalah apa yang terjadi saat kamu sibuk membuat rencana lain.", author: "John Lennon" },
                { quote: "Masa depan milik mereka yang percaya pada keindahan mimpi mereka.", author: "Eleanor Roosevelt" },
                { quote: "Di saat-saat tergelap, kita harus fokus untuk melihat cahaya.", author: "Aristoteles" },
                { quote: "Perjalanan yang mustahil adalah perjalanan yang tidak pernah dimulai.", author: "Tony Robbins" }
            ];
            
            const random = fallbackQuotes[Math.floor(Math.random() * fallbackQuotes.length)];
            await this.reply(sock, from, msg, `💭 *Kutipan*\n\n"${random.quote}"\n\n— _${random.author}_`);
        }
    }
}

module.exports = QuoteCommand;
