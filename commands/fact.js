/**
 * Random Fact Command
 * Dapatkan fakta menarik acak
 */

const CommandBase = require('./base');
const httpClient = require('../utils/http-client');

class FactCommand extends CommandBase {
    constructor() {
        super({
            name: 'fact',
            aliases: ['randomfact', 'funfact', 'fakta'],
            description: 'Dapatkan fakta menarik acak',
            usage: '.fact',
            category: 'fun',
            cooldown: 3000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        await this.react(sock, msg, '💡');

        try {
            // Using uselessfacts API with proxy support
            const { data } = await httpClient.get(
                'https://uselessfacts.jsph.pl/random.json?language=en',
                { timeout: 10000 }
            );

            const fact = data.text;

            const response = 
`💡 *Fakta Menarik*

${fact}

🎲 _Mau lagi? Ketik .fact_`;

            await this.reply(sock, from, msg, response);
            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            // Fallback ke fakta lokal
            const localFacts = [
                'Madu tidak pernah basi. Arkeolog menemukan madu berumur 3000 tahun yang masih bisa dimakan.',
                'Satu hari di Venus lebih panjang dari satu tahunnya.',
                'Gurita memiliki tiga jantung.',
                'Pisang adalah buah beri, tapi stroberi bukan.',
                'Pohon tertua di dunia berumur lebih dari 5.000 tahun.',
                'Hiu sudah ada lebih lama dari pohon.',
                'Lidah adalah otot terkuat di tubuh manusia relatif terhadap ukurannya.',
                'Sambaran petir lima kali lebih panas dari permukaan matahari.'
            ];
            
            const randomFact = localFacts[Math.floor(Math.random() * localFacts.length)];
            await this.reply(sock, from, msg, `💡 *Fakta Menarik*\n\n${randomFact}`);
        }
    }
}

module.exports = FactCommand;
