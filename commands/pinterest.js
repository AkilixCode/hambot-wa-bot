/**
 * Pinterest Command
 * Search and download images from Pinterest
 */

const CommandBase = require('./base');
const { getRandomUA, sleep } = require('../utils/helpers');
const browserManager = require('../utils/browser-manager');
const httpClient = require('../utils/http-client');
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
        const sentKey = `pinterest_sent:${query.toLowerCase()}`;

        let page = null;

        try {
            // Get all scraped URLs from cache (full pool of images)
            let allScrapedUrls = cache.get(cacheKey);
            
            if (!allScrapedUrls || !Array.isArray(allScrapedUrls) || allScrapedUrls.length === 0) {
                // Need to scrape fresh images
                page = await browserManager.newPage();
                await page.setUserAgent(getRandomUA());

                const targetUrl = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`;
                await page.goto(targetUrl, { 
                    waitUntil: 'networkidle2', 
                    timeout: 60000 
                });

                // Scroll multiple times to load more images for better variety
                for (let i = 0; i < 3; i++) {
                    await page.evaluate(() => {
                        window.scrollBy(0, 1000);
                    });
                    await sleep(1500);
                }

                // Scrape image URLs - get more images for better randomization
                allScrapedUrls = await page.evaluate(() => {
                    const urls = new Set();
                    const images = document.querySelectorAll('img');
                    
                    for (const img of images) {
                        // Pinterest uses 236x for thumbnails, we want originals
                        if (img.src && img.src.includes('236x') && img.naturalWidth > 100) {
                            // Convert thumbnail URL to original size
                            const originalUrl = img.src.replace(/236x/, 'originals');
                            urls.add(originalUrl);
                        }
                        // Also check for 474x (medium size) images
                        if (img.src && img.src.includes('474x') && img.naturalWidth > 100) {
                            const originalUrl = img.src.replace(/474x/, 'originals');
                            urls.add(originalUrl);
                        }
                    }
                    
                    return Array.from(urls);
                });

                if (allScrapedUrls.length === 0) {
                    return await this.reply(sock, from, msg, '❌ No images found. Try a different search term.');
                }

                // Cache all scraped URLs for 30 minutes (pool of images)
                cache.set(cacheKey, allScrapedUrls, 1800000);
                
                // Reset sent images tracking for this query
                cache.delete(sentKey);
            }

            // Get previously sent images for this query
            let sentImages = cache.get(sentKey) || [];
            
            // Filter out already sent images to get different ones
            let availableUrls = allScrapedUrls.filter(url => !sentImages.includes(url));
            
            // If we've sent all images, reset and start over
            if (availableUrls.length < 5) {
                sentImages = [];
                availableUrls = allScrapedUrls;
                cache.delete(sentKey);
            }

            // Randomly select 5 images from available pool using Fisher-Yates shuffle
            const shuffled = [...availableUrls];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            const results = shuffled.slice(0, 5);

            // Track these images as sent
            const newSentImages = [...sentImages, ...results];
            cache.set(sentKey, newSentImages, 1800000);

            await this.sendResults(sock, from, msg, results, query);

        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, '❌ Failed to fetch images. Please try again later.');
        } finally {
            if (page) {
                await browserManager.closePage(page);
            }
        }
    }

    /**
     * Download image as buffer
     * @param {string} url - Image URL
     * @returns {Promise<Buffer|null>} - Image buffer or null on failure
     */
    async downloadImage(url) {
        try {
            const response = await httpClient.get(url, {
                responseType: 'arraybuffer',
                timeout: 15000,
                headers: {
                    'User-Agent': getRandomUA(),
                    'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
                    'Referer': 'https://www.pinterest.com/'
                }
            });
            return Buffer.from(response.data);
        } catch (error) {
            return null;
        }
    }

    async sendResults(sock, from, msg, results, query) {
        let successCount = 0;
        const totalRequested = results.length;
        
        for (const url of results) {
            try {
                // Download image as buffer to avoid URL fetch issues
                const imageBuffer = await this.downloadImage(url);
                
                if (imageBuffer && imageBuffer.length > 0) {
                    await sock.sendMessage(from, { 
                        image: imageBuffer,
                        caption: `📌 ${query}`
                    }, { quoted: msg });
                    successCount++;
                }
            } catch (error) {
                // Try fallback: use 736x size instead of originals
                try {
                    const fallbackUrl = url.replace('/originals/', '/736x/');
                    const fallbackBuffer = await this.downloadImage(fallbackUrl);
                    
                    if (fallbackBuffer && fallbackBuffer.length > 0) {
                        await sock.sendMessage(from, { 
                            image: fallbackBuffer,
                            caption: `📌 ${query}`
                        }, { quoted: msg });
                        successCount++;
                    }
                } catch (fallbackError) {
                    // Skip this image silently
                    this.logError(fallbackError, { context: 'pinterest-fallback' });
                }
            }
        }

        if (successCount === totalRequested) {
            await this.react(sock, msg, '✅');
        } else if (successCount > 0) {
            await this.react(sock, msg, '✅');
            if (successCount < totalRequested) {
                await this.reply(sock, from, msg, `📌 Sent ${successCount} of ${totalRequested} images (some failed to download)`);
            }
        } else {
            await this.reply(sock, from, msg, '❌ Could not download images. Please try a different search term.');
        }
    }
}

module.exports = PinterestCommand;
