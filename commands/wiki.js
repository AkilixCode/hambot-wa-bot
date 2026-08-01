/**
 * Wikipedia Search Command
 * Search and get summaries from Wikipedia
 */

const CommandBase = require('./base');
const ui = require('../utils/ui');
const httpClient = require('../utils/http-client');
const cache = require('../utils/cache');
const logger = require('../utils/logger');

class WikiCommand extends CommandBase {
    constructor() {
        super({
            name: 'wiki',
            aliases: ['wikipedia'],
            description: 'Cari ringkasan artikel Wikipedia',
            usage: '.wiki <search term>',
            category: 'info',
            cooldown: 3000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        if (!args[0]) {
            return await this.replyUsage(sock, from, msg, {
                icon: '📚',
                title: 'Wikipedia',
                description: 'Cari ringkasan artikel dari Wikipedia.',
                usage: ['.wiki <kata kunci>'],
                examples: ['.wiki Albert Einstein', '.wiki Tata Surya', '.wiki Bahasa Python']
            });
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
                await this.replyError(sock, from, msg,
                    `Tidak ada artikel Wikipedia untuk ${ui.mono(ui.safe(query, 60))}.`, {
                        title: 'Tidak Ditemukan',
                        hint: ['Coba kata kunci yang lebih umum', '.wiki Albert Einstein']
                    });
            } else {
                await this.replyError(sock, from, msg, 'Gagal mengambil data dari Wikipedia.', {
                    hint: ['Coba lagi sebentar lagi']
                });
            }
        }
    }

    async sendWikiInfo(sock, from, msg, data, fromCache) {
        try {
            const title = data.title;
            const summary = data.extract;
            const url = data.content_urls.desktop.page;
            const thumbnail = data.thumbnail?.source;

            const info = ui.card({
                icon: '📚',
                title: 'Wikipedia',
                lines: [
                    ui.bold(title),
                    '',
                    ui.truncate(summary, 500),
                    '',
                    `🔗 ${url}`
                ],
                footer: ui.sourceBadge(fromCache)
            });

            if (thumbnail) {
                await this.replyMedia(sock, from, msg, {
                    image: { url: thumbnail },
                    caption: info
                });
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
