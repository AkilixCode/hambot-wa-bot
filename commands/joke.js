/**
 * Joke Command
 * Dapatkan lelucon acak
 */

const CommandBase = require('./base');
const httpClient = require('../utils/http-client');

class JokeCommand extends CommandBase {
    constructor() {
        super({
            name: 'joke',
            aliases: ['jokes', 'funny', 'lelucon'],
            description: 'Dapatkan lelucon acak',
            usage: '.joke',
            category: 'fun',
            cooldown: 3000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        await this.react(sock, msg, '😂');

        try {
            // Using JokeAPI with proxy support
            const { data } = await httpClient.get(
                'https://v2.jokeapi.dev/joke/Any?safe-mode',
                { timeout: 10000 }
            );

            let jokeText = '';
            
            if (data.type === 'single') {
                jokeText = data.joke;
            } else {
                jokeText = `${data.setup}\n\n${data.delivery}`;
            }

            const response = `😂 *Lelucon Acak*\n\n${jokeText}`;

            await this.reply(sock, from, msg, response);
            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            
            // Lelucon cadangan
            const fallbackJokes = [
                "Kenapa ilmuwan tidak percaya atom? Karena mereka membuat segalanya!",
                "Kenapa orang-orangan sawah menang penghargaan? Karena dia luar biasa di ladangnya!",
                "Kenapa telur tidak suka bercerita lelucon? Karena mereka akan pecah tertawa!",
                "Apa yang kamu sebut mie palsu? Impasta!",
                "Kenapa sepeda jatuh? Karena terlalu lelah (dua ban)!"
            ];
            
            const randomJoke = fallbackJokes[Math.floor(Math.random() * fallbackJokes.length)];
            await this.reply(sock, from, msg, `😂 *Lelucon*\n\n${randomJoke}`);
        }
    }
}

module.exports = JokeCommand;
