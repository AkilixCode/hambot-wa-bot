/**
 * Joke Command
 * Get random jokes
 */

const CommandBase = require('./base');
const axios = require('axios');

class JokeCommand extends CommandBase {
    constructor() {
        super({
            name: 'joke',
            aliases: ['jokes', 'funny'],
            description: 'Get a random joke',
            usage: '.joke',
            category: 'fun',
            cooldown: 3000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        await this.react(sock, msg, '😂');

        try {
            // Using JokeAPI
            const { data } = await axios.get(
                'https://v2.jokeapi.dev/joke/Any?safe-mode',
                { timeout: 10000 }
            );

            let jokeText = '';
            
            if (data.type === 'single') {
                jokeText = data.joke;
            } else {
                jokeText = `${data.setup}\n\n${data.delivery}`;
            }

            const response = `😂 *Random Joke*\n\n${jokeText}`;

            await this.reply(sock, from, msg, response);
            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            
            // Fallback jokes
            const fallbackJokes = [
                "Why don't scientists trust atoms? Because they make up everything!",
                "Why did the scarecrow win an award? He was outstanding in his field!",
                "Why don't eggs tell jokes? They'd crack each other up!",
                "What do you call a fake noodle? An impasta!",
                "Why did the bicycle fall over? Because it was two-tired!"
            ];
            
            const randomJoke = fallbackJokes[Math.floor(Math.random() * fallbackJokes.length)];
            await this.reply(sock, from, msg, `😂 *Joke*\n\n${randomJoke}`);
        }
    }
}

module.exports = JokeCommand;
