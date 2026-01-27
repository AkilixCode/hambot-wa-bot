/**
 * Random Fact Command
 * Get interesting random facts
 */

const CommandBase = require('./base');
const axios = require('axios');

class FactCommand extends CommandBase {
    constructor() {
        super({
            name: 'fact',
            aliases: ['randomfact', 'funfact'],
            description: 'Get a random interesting fact',
            usage: '.fact',
            category: 'fun',
            cooldown: 3000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        await this.react(sock, msg, '💡');

        try {
            // Using uselessfacts API
            const { data } = await axios.get(
                'https://uselessfacts.jsph.pl/random.json?language=en',
                { timeout: 10000 }
            );

            const fact = data.text;

            const response = 
`💡 *Random Fact*

${fact}

🎲 _Want another? Type .fact_`;

            await this.reply(sock, from, msg, response);
            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            // Fallback to local facts
            const localFacts = [
                'Honey never spoils. Archaeologists have found 3000-year-old honey that is still edible.',
                'A day on Venus is longer than its year.',
                'Octopuses have three hearts.',
                'Bananas are berries, but strawberries are not.',
                'The world\'s oldest known living tree is over 5,000 years old.',
                'Sharks have been around longer than trees.',
                'The tongue is the strongest muscle in the human body relative to its size.',
                'A bolt of lightning is five times hotter than the surface of the sun.'
            ];
            
            const randomFact = localFacts[Math.floor(Math.random() * localFacts.length)];
            await this.reply(sock, from, msg, `💡 *Random Fact*\n\n${randomFact}`);
        }
    }
}

module.exports = FactCommand;
