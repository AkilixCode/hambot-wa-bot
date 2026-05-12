/**
 * Pinterest Command
 * Search and download images from Pinterest
 * 
 * Uses HTTP-based scraping instead of Puppeteer to bypass
 * Pinterest's aggressive login wall modal (introduced late 2024).
 * 
 * Strategy: Fetch the raw HTML via HTTP GET and extract image URLs
 * from the __PWS_DATA__ JSON blob that Pinterest embeds in the
 * initial server-rendered HTML — no browser needed.
 */

const CommandBase = require('./base');
const { getRandomUA } = require('../utils/helpers');
const httpClient = require('../utils/http-client');
const cache = require('../utils/cache');
const logger = require('../utils/logger');

class PinterestCommand extends CommandBase {
    constructor() {
        super({
            name: 'pinterest',
            aliases: ['pin', 'pint'],
            description: 'Search aesthetic images from Pinterest',
            usage: '.pinterest <search query>',
            category: 'media',
            cooldown: 5000,
            isHeavy: false // No longer spawns a browser — much lighter
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

        try {
            // Get all scraped URLs from cache (full pool of images)
            let allScrapedUrls = cache.get(cacheKey);
            
            if (!allScrapedUrls || !Array.isArray(allScrapedUrls) || allScrapedUrls.length === 0) {
                // Scrape fresh images via HTTP (no browser needed)
                allScrapedUrls = await this.searchPinterest(query);

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
        }
    }

    /**
     * Search Pinterest for images using HTTP-based scraping.
     * Fetches the search page HTML and extracts image URLs from
     * the embedded __PWS_DATA__ / __PWS_INITIAL_PROPS__ JSON,
     * or falls back to regex extraction from raw HTML.
     * 
     * @param {string} query - Search query
     * @returns {Promise<string[]>} Array of image URLs (originals or 736x)
     */
    async searchPinterest(query) {
        const url = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`;
        
        const { data: html } = await httpClient.get(url, {
            timeout: 20000,
            headers: {
                'User-Agent': getRandomUA(),
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Connection': 'keep-alive',
                'Cache-Control': 'no-cache',
            }
        });

        let imageUrls = [];

        // Method 1: Extract from __PWS_DATA__ embedded JSON
        imageUrls = this.extractFromPwsData(html);

        // Method 2: Fallback — regex scan entire HTML for pinimg URLs
        if (imageUrls.length < 5) {
            const regexUrls = this.extractFromRegex(html);
            // Merge, deduplicate
            const combined = new Set([...imageUrls, ...regexUrls]);
            imageUrls = Array.from(combined);
        }

        logger.info(`Pinterest HTTP scrape for "${query}": found ${imageUrls.length} images`);
        return imageUrls;
    }

    /**
     * Extract image URLs from Pinterest's __PWS_DATA__ script tag.
     * This JSON blob contains the server-side rendered search results.
     * @param {string} html - Raw HTML string
     * @returns {string[]} Array of deduplicated image URLs
     */
    extractFromPwsData(html) {
        const urls = new Set();

        // Try __PWS_DATA__ first (primary data source)
        const pwsMatch = html.match(/<script\s+id="__PWS_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        if (pwsMatch) {
            this._extractPinimgUrls(pwsMatch[1], urls);
        }

        // Also try __PWS_INITIAL_PROPS__ (secondary data source)
        const propsMatch = html.match(/<script\s+id="__PWS_INITIAL_PROPS__"[^>]*>([\s\S]*?)<\/script>/);
        if (propsMatch) {
            this._extractPinimgUrls(propsMatch[1], urls);
        }

        return Array.from(urls);
    }

    /**
     * Extract i.pinimg.com image URLs from a JSON string and add to the Set.
     * Converts thumbnail sizes (236x, 474x) to high-resolution (originals).
     * @param {string} jsonStr - Raw JSON string to scan
     * @param {Set} urls - Set to add discovered URLs to
     */
    _extractPinimgUrls(jsonStr, urls) {
        // Match all pinimg.com URLs in the JSON
        const matches = jsonStr.match(/https?:\/\/i\.pinimg\.com\/[^"\\)\s}]+/g);
        if (!matches) return;

        for (const rawUrl of matches) {
            // Clean URL (remove trailing punctuation artifacts from regex)
            let cleanUrl = rawUrl.replace(/[,;}\]]+$/, '');

            // Only keep actual image files
            if (!/\.(jpg|jpeg|png|webp|gif)$/i.test(cleanUrl)) continue;

            // Skip tiny icons, avatars, and UI assets (75x75, 30x30, etc.)
            if (/\/\d{1,2}x\d{1,2}\//.test(cleanUrl)) continue;
            if (/\/30x30_RS\/|\/75x75_RS\/|\/140x140_RS\//.test(cleanUrl)) continue;

            // Convert thumbnails to high-res originals
            if (cleanUrl.includes('/236x/') || cleanUrl.includes('/474x/')) {
                cleanUrl = cleanUrl.replace(/\/236x\/|\/474x\//, '/originals/');
            }

            urls.add(cleanUrl);
        }
    }

    /**
     * Fallback: Extract image URLs via regex scan of raw HTML.
     * Used when __PWS_DATA__ parsing fails or yields too few results.
     * @param {string} html - Raw HTML string
     * @returns {string[]} Array of image URLs
     */
    extractFromRegex(html) {
        const urls = new Set();
        
        // Match all pinimg.com URLs anywhere in the HTML
        const matches = html.match(/https?:\/\/i\.pinimg\.com\/[^"'\\)\s}>]+/g);
        if (!matches) return [];

        for (const rawUrl of matches) {
            let cleanUrl = rawUrl.replace(/[,;}\]]+$/, '');

            if (!/\.(jpg|jpeg|png|webp|gif)$/i.test(cleanUrl)) continue;
            if (/\/\d{1,2}x\d{1,2}\//.test(cleanUrl)) continue;
            if (/\/30x30_RS\/|\/75x75_RS\/|\/140x140_RS\//.test(cleanUrl)) continue;

            // Convert to originals
            if (cleanUrl.includes('/236x/') || cleanUrl.includes('/474x/')) {
                cleanUrl = cleanUrl.replace(/\/236x\/|\/474x\//, '/originals/');
            }

            urls.add(cleanUrl);
        }

        return Array.from(urls);
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
