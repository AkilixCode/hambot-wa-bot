/**
 * Pinterest Command
 * Search and download images from Pinterest
 */

const CommandBase = require('./base');
const { getRandomUA, sleep } = require('../utils/helpers');
const browserManager = require('../utils/browser-manager');
const cache = require('../utils/cache');

class PinterestCommand extends CommandBase {
    constructor() {
        super({
            name: 'pinterest',
            aliases: ['pin', 'pint'],
            description: 'Search aesthetic images from Pinterest',
            usage: '.pinterest <search query>',
            category: 'media',
            cooldown: 5000,
            isHeavy: true
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        if (!args[0]) {
            return await this.reply(sock, from, msg, '❓ What do you want to search for?\n\nExample: .pinterest Cyberpunk City');
        }

        await this.react(sock, msg, '📌');

        const query = args.join(' ');
        const cacheKey = `pinterest:${query.toLowerCase()}`;

        // Check cache
        const cached = cache.get(cacheKey);
        if (cached && Array.isArray(cached) && cached.length > 0) {
            return await this.sendResults(sock, from, msg, cached, query, true);
        }

        let page = null;

        try {
            // Create new page
            page = await browserManager.newPage();
            await page.setUserAgent(getRandomUA());

            const targetUrl = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`;
            await page.goto(targetUrl, { 
                waitUntil: 'networkidle2', 
                timeout: 60000 
            });

            // Scroll to load more images
            await page.evaluate(async () => {
                window.scrollBy(0, 800);
            });
            await sleep(2000);

            // Scrape image URLs
            const scrapedUrls = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('img'))
                    .filter(img => img.src.includes('236x') && img.naturalWidth > 150)
                    .map(img => img.src.replace(/236x/, 'originals'))
                    .slice(0, 10); // Get up to 10 images
            });

            if (scrapedUrls.length === 0) {
                return await this.reply(sock, from, msg, '❌ No images found. Try a different search term.');
            }

            // Random selection of 3 images
            const results = scrapedUrls
                .sort(() => 0.5 - Math.random())
                .slice(0, 3);

            // Cache results for 10 minutes
            cache.set(cacheKey, results, 600000);

            await this.sendResults(sock, from, msg, results, query, false);

        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, `❌ Failed to fetch images. Error: ${error.message}`);
        } finally {
            if (page) {
                await browserManager.closePage(page);
            }
        }
    }

    async sendResults(sock, from, msg, results, query, fromCache) {
        try {
            for (const url of results) {
                const caption = fromCache 
                    ? `📌 ${query} (cached)` 
                    : `📌 ${query}`;
                    
                await sock.sendMessage(from, { 
                    image: { url: url }, 
                    caption 
                }, { quoted: msg });
            }

            await this.react(sock, msg, '✅');
        } catch (error) {
            this.logError(error, { context: 'send-results' });
            throw error;
        }
    }
}

module.exports = PinterestCommand;
