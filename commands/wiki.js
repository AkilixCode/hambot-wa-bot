/**
 * Wikipedia Search Command
 * Search and get summaries from Wikipedia
 */

const CommandBase = require('./base');
const httpClient = require('../utils/http-client');
const cache = require('../utils/cache');
const logger = require('../utils/logger');

class WikiCommand extends CommandBase {
    constructor() {
        super({
            name: 'wiki',
            aliases: ['wikipedia'],
            description: 'Search Wikipedia and get article summary',
            usage: '.wiki <search term>',
            category: 'info',
            cooldown: 3000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        if (!args[0]) {
            return await this.reply(sock, from, msg, 
                '📚 *Wikipedia Search*\n\nUsage: .wiki <search term>\n\nExamples:\n• .wiki Albert Einstein\n• .wiki Python programming\n• .wiki Solar System');
        }

        await this.react(sock, msg, '📚');

        const query = args.join(' ');
        const cacheKey = `wiki:${query.toLowerCase()}`;

        // Check cache (1 hour)
        const cached = cache.get(cacheKey);
        if (cached) {
            return await this.sendWikiInfo(sock, from, msg, cached, true);
        }

        try {
            // Wikipedia API with proxy support
            logger.info(`Wiki: searching "${query}"`);
            const searchUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
            const { data } = await httpClient.get(searchUrl, { timeout: 10000 });
            logger.info('Wiki: article found');

            // Cache for 1 hour
            cache.set(cacheKey, data, 3600000);

            await this.sendWikiInfo(sock, from, msg, data, false);

        } catch (error) {
            this.logError(error, context);
            
            if (error.response?.status === 404) {
                await this.reply(sock, from, msg, `❌ No Wikipedia article found for "${query}".`);
            } else {
                await this.reply(sock, from, msg, '❌ Failed to fetch Wikipedia data.');
            }
        }
    }

    async sendWikiInfo(sock, from, msg, data, fromCache) {
        try {
            const title = data.title;
            const summary = data.extract;
            const url = data.content_urls.desktop.page;
            const thumbnail = data.thumbnail?.source;

            // Limit summary length
            const shortSummary = summary.length > 500 
                ? summary.substring(0, 500) + '...' 
                : summary;

            const info = 
`📚 *Wikipedia*

**${title}**

${shortSummary}

🔗 Read more: ${url}

${fromCache ? '📦 (cached)' : ''}`;

            if (thumbnail) {
                await sock.sendMessage(from, {
                    image: { url: thumbnail },
                    caption: info
                }, { quoted: msg });
            } else {
                await this.reply(sock, from, msg, info);
            }

            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, { context: 'send-wiki-info' });
            throw error;
        }
    }
}

module.exports = WikiCommand;
