/**
 * Pinterest Command
 * Search and download images from Pinterest
 * 
 * Uses Playwright with anti-detect measures to bypass
 * Pinterest's aggressive login wall and bot detection.
 * 
 * Strategy: 
 *   1. Launch Playwright Chromium with anti-detect patches
 *   2. Navigate to Pinterest search page
 *   3. Dismiss login wall if detected
 *   4. Extract image URLs from page data or DOM
 *   5. Download images using /736x/ (reliable without auth)
 */

const CommandBase = require('./base');
const { getRandomUA, getRandomPinterestHeaders, sleep } = require('../utils/helpers');
const httpClient = require('../utils/http-client');
const cache = require('../utils/cache');
const logger = require('../utils/logger');
const config = require('../config');

// Lazy-load Playwright to avoid blocking bot startup
let chromium = null;

async function getChromium() {
    if (!chromium) {
        try {
            const pw = require('playwright');
            chromium = pw.chromium;
        } catch (err) {
            logger.error('Playwright not installed. Run: npm install playwright');
            throw new Error('Playwright dependency missing');
        }
    }
    return chromium;
}

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

        try {
            // Get all scraped URLs from cache (full pool of images)
            let allScrapedUrls = cache.get(cacheKey);
            
            if (!allScrapedUrls || !Array.isArray(allScrapedUrls) || allScrapedUrls.length === 0) {
                // Scrape fresh images via Playwright
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
     * Search Pinterest for images using Playwright.
     * Uses proxy if configured (via .env PROXY_ENABLED), with fallback to local IP.
     * 
     * @param {string} query - Search query
     * @returns {Promise<string[]>} Array of image URLs (736x resolution)
     */
    async searchPinterest(query) {
        const proxyConfig = config.getPlaywrightProxyConfig();

        if (proxyConfig) {
            logger.info(`Pinterest scraping via proxy: ${proxyConfig.server}`);
            try {
                const results = await this._scrapeWithBrowser(query, proxyConfig);
                if (results.length > 0) return results;
                logger.warn('Pinterest proxy returned 0 images, falling back to local IP');
            } catch (error) {
                logger.warn(`Pinterest proxy failed: ${error.message}`);
            }

            // Fallback to local IP if enabled
            if (config.network.fallbackToLocal) {
                logger.info('Pinterest falling back to local IP');
                return await this._scrapeWithBrowser(query, null);
            }
            return [];
        }

        // No proxy configured — scrape directly
        logger.info('Pinterest scraping via local IP (no proxy configured)');
        return await this._scrapeWithBrowser(query, null);
    }

    /**
     * Core scraping logic using Playwright.
     * Separated from searchPinterest() to support proxy/fallback switching.
     * 
     * @param {string} query - Search query
     * @param {Object|null} proxyConfig - Playwright proxy config or null for direct
     * @returns {Promise<string[]>} Array of image URLs
     */
    async _scrapeWithBrowser(query, proxyConfig) {
        const url = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`;
        let browser = null;
        let imageUrls = [];

        try {
            const chromiumBrowser = await getChromium();
            
            browser = await chromiumBrowser.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-blink-features=AutomationControlled',
                    '--disable-features=IsolateOrigins,site-per-process'
                ]
            });

            const contextOptions = {
                userAgent: getRandomUA(),
                viewport: { width: 1920, height: 1080 },
                locale: 'en-US',
                timezoneId: 'America/New_York',
                javaScriptEnabled: true,
                bypassCSP: true,
                extraHTTPHeaders: {
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Sec-CH-UA': '"Chromium";v="125", "Google Chrome";v="125", "Not-A.Brand";v="24"',
                    'Sec-CH-UA-Mobile': '?0',
                    'Sec-CH-UA-Platform': '"Windows"'
                }
            };

            // Apply proxy if provided
            if (proxyConfig) {
                contextOptions.proxy = proxyConfig;
            }

            const context = await browser.newContext(contextOptions);
            const page = await context.newPage();

            // Anti-detect: Override navigator.webdriver
            await page.addInitScript(() => {
                // Remove webdriver flag
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined
                });
                
                // Override plugins to look like a real browser
                Object.defineProperty(navigator, 'plugins', {
                    get: () => [1, 2, 3, 4, 5]
                });
                
                // Override languages
                Object.defineProperty(navigator, 'languages', {
                    get: () => ['en-US', 'en']
                });
                
                // Override platform
                Object.defineProperty(navigator, 'platform', {
                    get: () => 'Win32'
                });

                // Override chrome runtime
                window.chrome = {
                    runtime: {},
                    loadTimes: function() {},
                    csi: function() {},
                    app: {}
                };

                // Override permissions query
                const originalQuery = window.navigator.permissions?.query;
                if (originalQuery) {
                    window.navigator.permissions.query = (parameters) => {
                        if (parameters.name === 'notifications') {
                            return Promise.resolve({ state: 'denied' });
                        }
                        return originalQuery(parameters);
                    };
                }
            });

            // Navigate with a reasonable timeout
            await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });

            // Wait a bit for initial content to load
            await sleep(2000 + Math.random() * 1000);

            // Attempt to dismiss login wall if present
            await this.dismissLoginWall(page);

            // Try to extract from page data (inline JSON) first
            const html = await page.content();
            imageUrls = this.extractFromPageData(html);

            // If not enough, try scrolling and extracting from DOM
            if (imageUrls.length < 10) {
                // Human-like scrolling with random delays
                for (let i = 0; i < 4; i++) {
                    const scrollAmount = 800 + Math.floor(Math.random() * 600);
                    await page.evaluate((amount) => window.scrollBy(0, amount), scrollAmount);
                    await sleep(1500 + Math.random() * 1500);
                    
                    // Try to dismiss login wall again (Pinterest re-shows it after scroll)
                    await this.dismissLoginWall(page);
                }

                const domUrls = await page.evaluate(() => {
                    const urls = new Set();
                    const images = document.querySelectorAll('img[src*="pinimg.com"]');
                    
                    for (const img of images) {
                        if (img.src) {
                            // Convert to high-res. 736x is reliable for JPG, but breaks PNG/GIF
                            let cleaned = img.src;
                            if (/\.(jpg|jpeg|webp)$/i.test(cleaned)) {
                                cleaned = cleaned
                                    .replace(/\/originals\//, '/736x/')
                                    .replace(/\/236x\//, '/736x/')
                                    .replace(/\/474x\//, '/736x/');
                            } else {
                                // For PNG/GIF, use originals
                                cleaned = cleaned
                                    .replace(/\/236x\//, '/originals/')
                                    .replace(/\/474x\//, '/originals/')
                                    .replace(/\/736x\//, '/originals/');
                            }
                            
                            // Skip tiny icons and avatars
                            if (/\/\d{1,2}x\d{1,2}\//.test(cleaned)) continue;
                            if (/\/30x30_RS\/|\/75x75_RS\/|\/140x140_RS\//.test(cleaned)) continue;
                            
                            urls.add(cleaned);
                        }
                    }
                    return Array.from(urls);
                });
                
                // Merge and deduplicate
                const combined = new Set([...imageUrls, ...domUrls]);
                imageUrls = Array.from(combined);
            }

            // Fallback to regex scan if still not enough
            if (imageUrls.length < 5) {
                const updatedHtml = await page.content();
                const regexUrls = this.extractFromRegex(updatedHtml);
                const combined = new Set([...imageUrls, ...regexUrls]);
                imageUrls = Array.from(combined);
            }

            logger.info(`Pinterest scrape for "${query}": found ${imageUrls.length} images (${proxyConfig ? 'via proxy' : 'local IP'})`);
            return imageUrls;
        } catch (error) {
            logger.error(`Error scraping Pinterest: ${error.message}`);
            throw error;
        } finally {
            if (browser) {
                await browser.close().catch(() => {});
            }
        }
    }

    /**
     * Attempt to dismiss Pinterest's login wall / signup modal.
     * Pinterest shows various overlay modals to force login.
     * @param {Object} page - Playwright page instance
     */
    async dismissLoginWall(page) {
        try {
            // Common selectors for Pinterest's login/signup wall
            const dismissSelectors = [
                // Close buttons on modals
                'button[aria-label="close"]',
                'button[aria-label="Close"]',
                '[data-test-id="login-modal-close-button"]',
                '[data-test-id="signup-modal-close-button"]',
                // Generic close/dismiss patterns
                'div[role="dialog"] button[aria-label="close"]',
                'div[role="dialog"] button[aria-label="Close"]',
                // The "X" button on the unauth banner
                '.UnauthBanner button',
                '.Closeup button[aria-label="Close"]'
            ];

            for (const selector of dismissSelectors) {
                const btn = await page.$(selector);
                if (btn) {
                    await btn.click().catch(() => {});
                    await sleep(500);
                    logger.debug(`Pinterest: Dismissed login wall via ${selector}`);
                    return;
                }
            }

            // Fallback: Press Escape key to dismiss any modal
            await page.keyboard.press('Escape').catch(() => {});
            await sleep(300);

            // Fallback: Try to remove overlay elements via JS
            await page.evaluate(() => {
                // Remove any full-screen modal overlays
                const modals = document.querySelectorAll('[role="dialog"], .Modal, .Closeup');
                modals.forEach(m => m.remove());
                
                // Remove any backdrop/overlay
                const overlays = document.querySelectorAll('.Modal__overlay, [class*="overlay"]');
                overlays.forEach(o => o.remove());
                
                // Re-enable scrolling on body
                document.body.style.overflow = 'auto';
            }).catch(() => {});
        } catch {
            // Silently continue — login wall dismissal is best-effort
        }
    }

    /**
     * Extract image URLs from Pinterest's inline page data.
     * Looks for __PWS_DATA__, __PWS_INITIAL_PROPS__, and other JSON data.
     * @param {string} html - Raw HTML string
     * @returns {string[]} Array of deduplicated image URLs
     */
    extractFromPageData(html) {
        const urls = new Set();

        // Try multiple known script tag IDs that Pinterest uses
        const scriptPatterns = [
            /<script\s+id="__PWS_DATA__"[^>]*>([\s\S]*?)<\/script>/,
            /<script\s+id="__PWS_INITIAL_PROPS__"[^>]*>([\s\S]*?)<\/script>/,
            /<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
            /<script\s+type="application\/json"[^>]*>([\s\S]*?)<\/script>/g
        ];

        for (const pattern of scriptPatterns) {
            const matches = html.match(pattern);
            if (matches) {
                // For global patterns, matches is an array of full matches
                const matchList = Array.isArray(matches) ? matches : [matches[0]];
                for (const match of matchList) {
                    // Extract content between script tags
                    const contentMatch = match.match(/>([^<]+)</);
                    if (contentMatch) {
                        this._extractPinimgUrls(contentMatch[1], urls);
                    }
                }
            }
        }

        return Array.from(urls);
    }

    /**
     * Extract i.pinimg.com image URLs from a JSON string and add to the Set.
     * Converts all sizes to 736x (reliable without authentication).
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

            // Skip tiny icons, avatars, and UI assets
            if (/\/\d{1,2}x\d{1,2}\//.test(cleanUrl)) continue;
            if (/\/30x30_RS\/|\/75x75_RS\/|\/140x140_RS\//.test(cleanUrl)) continue;

            // Convert to high-res. 736x is reliable for JPG, but breaks PNG/GIF
            if (/\.(jpg|jpeg|webp)$/i.test(cleanUrl)) {
                cleanUrl = cleanUrl
                    .replace(/\/originals\//, '/736x/')
                    .replace(/\/236x\//, '/736x/')
                    .replace(/\/474x\//, '/736x/');
            } else {
                // For PNG/GIF, use originals
                cleanUrl = cleanUrl
                    .replace(/\/236x\//, '/originals/')
                    .replace(/\/474x\//, '/originals/')
                    .replace(/\/736x\//, '/originals/');
            }

            urls.add(cleanUrl);
        }
    }

    /**
     * Fallback: Extract image URLs via regex scan of raw HTML.
     * Used when page data parsing fails or yields too few results.
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

            // Convert to high-res. 736x is reliable for JPG, but breaks PNG/GIF
            if (/\.(jpg|jpeg|webp)$/i.test(cleanUrl)) {
                cleanUrl = cleanUrl
                    .replace(/\/originals\//, '/736x/')
                    .replace(/\/236x\//, '/736x/')
                    .replace(/\/474x\//, '/736x/');
            } else {
                // For PNG/GIF, use originals
                cleanUrl = cleanUrl
                    .replace(/\/236x\//, '/originals/')
                    .replace(/\/474x\//, '/originals/')
                    .replace(/\/736x\//, '/originals/');
            }

            urls.add(cleanUrl);
        }

        return Array.from(urls);
    }

    /**
     * Download image as buffer with validation.
     * Validates that the response is actually an image, not an HTML error page.
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
                    'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8'
                }
            });

            const buffer = Buffer.from(response.data);
            
            // Validate this is actually an image, not an HTML error page
            if (!this.isValidImageBuffer(buffer)) {
                logger.debug(`[Pinterest] Invalid image data from URL: ${url}`);
                return null;
            }

            return buffer;
        } catch (error) {
            logger.debug(`[Pinterest Fetch Error] Failed to download from URL: ${url}`);
            logger.error(error, { context: 'pinterest-downloadImage' });
            return null;
        }
    }

    /**
     * Validate that a buffer contains actual image data.
     * Checks magic bytes (file signatures) for common image formats.
     * @param {Buffer} buffer - Buffer to validate
     * @returns {boolean} true if buffer appears to be a valid image
     */
    isValidImageBuffer(buffer) {
        if (!buffer || buffer.length < 8) return false;

        // Check magic bytes for common image formats
        // JPEG: FF D8 FF
        if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return true;
        // PNG: 89 50 4E 47
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return true;
        // GIF: 47 49 46
        if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return true;
        // WebP: 52 49 46 46 ... 57 45 42 50
        if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
            buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return true;

        return false;
    }

    async sendResults(sock, from, msg, results, query) {
        let successCount = 0;
        const totalRequested = results.length;
        
        for (const url of results) {
            try {
                // Download image as buffer to avoid URL fetch issues
                let imageBuffer = await this.downloadImage(url);
                
                // If 736x failed, try 474x as fallback
                if (!imageBuffer) {
                    const fallbackUrl = url.replace('/736x/', '/474x/');
                    if (fallbackUrl !== url) {
                        imageBuffer = await this.downloadImage(fallbackUrl);
                    }
                }

                // If 474x also failed, try 236x as last resort
                if (!imageBuffer) {
                    const lastResortUrl = url.replace('/736x/', '/236x/');
                    if (lastResortUrl !== url) {
                        imageBuffer = await this.downloadImage(lastResortUrl);
                    }
                }

                if (imageBuffer && imageBuffer.length > 0) {
                    await sock.sendMessage(from, { 
                        image: imageBuffer,
                        caption: `📌 ${query}`
                    }, { quoted: msg });
                    successCount++;
                }
            } catch (error) {
                // Skip this image silently
                this.logError(error, { context: 'pinterest-send' });
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
