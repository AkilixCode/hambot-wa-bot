/**
 * Meme Command
 * Get random memes from Reddit
 */

const CommandBase = require('./base');
const httpClient = require('../utils/http-client');

class MemeCommand extends CommandBase {
    constructor() {
        super({
            name: 'meme',
            aliases: ['memes', 'funny'],
            description: 'Get a random meme',
            usage: '.meme',
            category: 'fun',
            cooldown: 3000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        await this.react(sock, msg, '😂');

        try {
            // Using meme API with proxy support
            const { data } = await httpClient.get(
                'https://meme-api.com/gimme',
                { timeout: 10000 }
            );

            if (data && data.url) {
                await sock.sendMessage(from, {
                    image: { url: data.url },
                    caption: `😂 *${data.title}*\n\n👤 By: u/${data.author}\n⬆️ ${data.ups} upvotes\n\n_From r/${data.subreddit}_`
                }, { quoted: msg });

                await this.react(sock, msg, '✅');
            } else {
                throw new Error('No meme data received');
            }

        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, '❌ Failed to fetch meme. Try again!');
        }
    }
}

module.exports = MemeCommand;
