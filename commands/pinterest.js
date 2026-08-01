/**
 * Pinterest Command
 * Search and send aesthetic images.
 *
 * HISTORY — worth reading before "improving" this file.
 *
 * This command has been rewritten three times. It was plain HTTP scraping
 * (blocked by the login wall), then Puppeteer + stealth plugin (blocked by
 * fingerprinting), then Playwright with anti-detect patches, human-like
 * scrolling and login-wall dismissal (slow, fragile, needed a 400MB Chromium
 * and the SYS_ADMIN capability in Docker).
 *
 * All of that was working around the wrong layer. Pinterest's search page is
 * client-rendered, which is why scraping the HTML returned nothing — but the
 * XHR endpoint the page itself calls is unauthenticated and answers plain HTTP
 * requests from a datacenter IP quite happily. Measured from the production
 * VPS: HTTP 200, 25 pins, ~677 image URLs, no cookies and no CSRF token. The
 * browser was never needed; only the right endpoint was.
 *
 * Strategy now:
 *   Tier 1  Pinterest's internal BaseSearchResource JSON API
 *   Tier 2  Wallhaven (SFW-locked), so the command still returns images when
 *           Pinterest changes something
 *
 * The tiers run through utils/providers.js, so a dead tier is skipped after a
 * few failures instead of costing every user its full timeout.
 */

const CommandBase = require('./base');
const ui = require('../utils/ui');
const { getRandomUA, sleep } = require('../utils/helpers');
const httpClient = require('../utils/http-client');
const cache = require('../utils/cache');
const logger = require('../utils/logger');
const { runProviders } = require('../utils/providers');

// How many images one invocation sends.
const BATCH_SIZE = 5;

// The scraped URL pool and the "already sent" list share this TTL, so a repeat
// query keeps serving fresh images from one scrape instead of re-hitting
// Pinterest every time.
const POOL_TTL_MS = 30 * 60 * 1000;

const SEARCH_TIMEOUT_MS = 20000;
const IMAGE_TIMEOUT_MS = 15000;

// Upper bound for a single Wallhaven image. Comfortably above the ~1MB median
// so quality is untouched, but below the point where a send stalls on mobile.
const MAX_WALLHAVEN_BYTES = 8 * 1024 * 1024;

// Pinterest rejects requests that do not look like its own web app. These
// headers are what the real page sends; the app version is a build hash that
// Pinterest tolerates being stale.
const PINTEREST_APP_VERSION = '8c1c090';

class PinterestCommand extends CommandBase {
    constructor() {
        super({
            name: 'pinterest',
            aliases: ['pin', 'pint'],
            description: 'Cari gambar estetik dari Pinterest',
            usage: '.pinterest <search query>',
            category: 'media',
            cooldown: 5000,
            // No longer heavy: this is a couple of HTTP calls now, not a
            // headless browser. Keeping it heavy would pointlessly occupy one
            // of only three concurrent slots.
            isHeavy: false
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        if (!args[0]) {
            return await this.replyUsage(sock, from, msg, {
                icon: '📌',
                title: 'Pencarian Pinterest',
                description: 'Cari dan kirim gambar estetik dari Pinterest.',
                usage: ['.pinterest <kata kunci>'],
                examples: ['.pinterest wallpaper anime', '.pinterest kamar aesthetic', '.pinterest kucing lucu']
            });
        }

        await this.react(sock, msg, '📌');

        const query = args.join(' ');
        const cacheKey = `pinterest:${query.toLowerCase()}`;
        const sentKey = `pinterest_sent:${query.toLowerCase()}`;

        try {
            let pool = cache.get(cacheKey);
            let sourceLabel = null;

            if (!pool || !Array.isArray(pool.urls) || pool.urls.length === 0) {
                const outcome = await this.searchImages(query);

                if (!outcome.result || outcome.result.length === 0) {
                    this.setFailed(context, 'No images found');
                    return await this.replyError(sock, from, msg, 'Tidak ada gambar yang cocok.', {
                        title: 'Tidak Ditemukan',
                        hint: ['Coba kata kunci yang lain', '.pinterest wallpaper anime']
                    });
                }

                pool = { urls: outcome.result, source: outcome.providerLabel, degraded: outcome.degraded };
                cache.set(cacheKey, pool, POOL_TTL_MS);
                cache.delete(sentKey);
            }

            sourceLabel = pool.degraded ? pool.source : null;

            // Prefer images this query has not shown yet, so repeated calls
            // keep feeling fresh rather than cycling the same five pins.
            let sent = cache.get(sentKey) || [];
            let available = pool.urls.filter(url => !sent.includes(url));

            if (available.length < BATCH_SIZE) {
                sent = [];
                available = pool.urls;
                cache.delete(sentKey);
            }

            const picks = this.shuffle(available).slice(0, BATCH_SIZE);
            cache.set(sentKey, [...sent, ...picks], POOL_TTL_MS);

            await this.sendResults(sock, from, msg, picks, query, sourceLabel);
        } catch (error) {
            this.logError(error, context);
            await this.replyError(sock, from, msg, 'Gagal mengambil gambar dari Pinterest.', {
                hint: ['Coba lagi sebentar lagi']
            });
        }
    }

    /**
     * Run the provider cascade for a query.
     * @param {string} query - Search terms
     * @returns {Promise<Object>} runProviders outcome
     */
    async searchImages(query) {
        return runProviders('pinterest', [
            {
                id: 'pinterest-api',
                label: 'Pinterest',
                run: () => this.searchPinterest(query)
            },
            {
                id: 'wallhaven',
                label: 'Wallhaven',
                run: () => this.searchWallhaven(query)
            }
        ]);
    }

    /**
     * Tier 1 — Pinterest's own search XHR endpoint.
     *
     * This is the same request the web app makes after the page loads. It needs
     * no session, but it does need to look like it came from the app, hence the
     * X-Pinterest-* headers and the matching Referer.
     *
     * @param {string} query - Search terms
     * @returns {Promise<string[]>} Image URLs, highest resolution first
     */
    async searchPinterest(query) {
        const sourceUrl = `/search/pins/?q=${encodeURIComponent(query)}`;
        const data = JSON.stringify({
            options: {
                query,
                scope: 'pins',
                bookmarks: [''],
                page_size: 25
            },
            context: {}
        });

        const url = 'https://www.pinterest.com/resource/BaseSearchResource/get/' +
            `?source_url=${encodeURIComponent(sourceUrl)}&data=${encodeURIComponent(data)}`;

        const response = await httpClient.get(url, {
            timeout: SEARCH_TIMEOUT_MS,
            headers: {
                'User-Agent': getRandomUA(),
                'Accept': 'application/json, text/javascript, */*, q=0.01',
                'Accept-Language': 'en-US,en;q=0.9',
                'X-Requested-With': 'XMLHttpRequest',
                'X-APP-VERSION': PINTEREST_APP_VERSION,
                'X-Pinterest-AppState': 'active',
                'X-Pinterest-Source-Url': sourceUrl,
                'X-Pinterest-PWS-Handler': 'www/search/[scope].js',
                'Referer': `https://www.pinterest.com${sourceUrl}`
            }
        });

        const results = response.data?.resource_response?.data?.results;
        if (!Array.isArray(results)) {
            throw new Error('Unexpected Pinterest response shape');
        }

        const urls = new Set();

        for (const pin of results) {
            const picked = this.pickBestImage(pin);
            if (picked) urls.add(picked);
        }

        logger.debug(`[Pinterest] API returned ${urls.size} image(s) for "${query}"`);
        return Array.from(urls);
    }

    /**
     * Choose the largest usable image from a pin object.
     *
     * Pinterest returns a map of size buckets per pin. 736x is the sweet spot:
     * large enough to look good in WhatsApp, small enough to send quickly, and
     * reliably present. `orig` exists but is sometimes many megabytes.
     *
     * @param {Object} pin - A pin from the API response
     * @returns {string|null} Image URL, or null when the pin carries no usable image
     */
    pickBestImage(pin) {
        const images = pin?.images;
        if (!images || typeof images !== 'object') return null;

        // Ordered by preference, not by size — see above on `orig`.
        for (const key of ['736x', '564x', 'orig', '474x', '236x']) {
            const url = images[key]?.url;
            if (typeof url === 'string' && this.isUsableImageUrl(url)) {
                return url;
            }
        }
        return null;
    }

    /**
     * Reject avatars, sprites and other non-content images.
     * @param {string} url
     * @returns {boolean}
     */
    isUsableImageUrl(url) {
        if (!/^https:\/\/i\.pinimg\.com\//.test(url)) return false;
        // Profile pictures and UI chrome live in these buckets.
        if (/\/\d{1,2}x\d{1,2}\//.test(url)) return false;
        if (/\/(30x30|75x75|140x140|150x150|60x60)(_RS)?\//.test(url)) return false;
        return /\.(jpg|jpeg|png|webp|gif)$/i.test(url);
    }

    /**
     * Tier 2 — Wallhaven.
     *
     * Key-free and, unlike Pinterest and YouTube, entirely uninterested in
     * whether the caller is a datacenter. `purity=100` restricts results to
     * SFW, which is not optional for a bot that sits in group chats.
     *
     * @param {string} query - Search terms
     * @returns {Promise<string[]>} Image URLs
     */
    async searchWallhaven(query) {
        const params = new URLSearchParams({
            q: query,
            categories: '111',  // general + anime + people
            purity: '100',      // SFW only — never widen this
            sorting: 'relevance',
            order: 'desc'
        });

        // A key is not required, but raises the rate limit if the owner adds one.
        const apiKey = (process.env.WALLHAVEN_API_KEY || '').trim();
        if (apiKey) params.set('apikey', apiKey);

        const response = await httpClient.get(
            `https://wallhaven.cc/api/v1/search?${params.toString()}`,
            {
                timeout: SEARCH_TIMEOUT_MS,
                headers: { 'User-Agent': getRandomUA(), 'Accept': 'application/json' }
            }
        );

        const data = response.data?.data;
        if (!Array.isArray(data)) {
            throw new Error('Unexpected Wallhaven response shape');
        }

        const urls = data
            // Belt and braces: honour the purity flag on each item too, in case
            // the query parameter is ever ignored.
            .filter(item => item?.purity === 'sfw' && typeof item.path === 'string')
            // Wallhaven serves true originals — mostly ~1MB, but the occasional
            // 4592x3448 desktop wallpaper runs to 12MB+, which is slow to send
            // and unpleasant on mobile data. The API hands us file_size for
            // free, so oversized entries are dropped here rather than being
            // discovered after downloading them. The thumbnails are only ~35KB
            // and far too small to substitute.
            .filter(item => !item.file_size || item.file_size <= MAX_WALLHAVEN_BYTES)
            .map(item => item.path);

        logger.debug(`[Pinterest] Wallhaven returned ${urls.length} image(s) for "${query}"`);
        return urls;
    }

    /**
     * Fisher-Yates shuffle on a copy.
     * @param {Array} items
     * @returns {Array} Shuffled copy
     */
    shuffle(items) {
        const out = [...items];
        for (let i = out.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [out[i], out[j]] = [out[j], out[i]];
        }
        return out;
    }

    /**
     * Download an image, verifying it really is one.
     *
     * Pinterest answers a missing or rate-limited image with an HTML error page
     * and a 200, so the magic-byte check is what stops WhatsApp being handed a
     * chunk of HTML labelled as a JPEG.
     *
     * @param {string} url - Image URL
     * @returns {Promise<Buffer|null>} Image bytes, or null on any failure
     */
    async downloadImage(url) {
        // A batch is five downloads fired back to back, and image hosts
        // rate-limit that. A single retry after a short pause recovers those.
        const attempts = 2;

        // The referer must match the host being fetched. Both CDNs run
        // hotlink protection, so sending Pinterest's referer to Wallhaven
        // gets a hard 403 — which is exactly how this was first found.
        const headers = {
            'User-Agent': getRandomUA(),
            'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8'
        };
        if (url.includes('pinimg.com')) {
            headers.Referer = 'https://www.pinterest.com/';
        } else if (url.includes('wallhaven.cc')) {
            headers.Referer = 'https://wallhaven.cc/';
        }

        for (let attempt = 0; attempt < attempts; attempt++) {
            try {
                const response = await httpClient.get(url, {
                    responseType: 'arraybuffer',
                    timeout: IMAGE_TIMEOUT_MS,
                    headers
                });

                const buffer = Buffer.from(response.data);
                if (this.isValidImageBuffer(buffer)) return buffer;

                // Not image data — retrying will not change that.
                logger.debug(`[Pinterest] Not image data: ${url}`);
                return null;
            } catch (error) {
                const isLast = attempt === attempts - 1;
                if (isLast) {
                    // Individual failures are expected; the caller falls back to
                    // a lower resolution or simply sends fewer images.
                    logger.debug(`[Pinterest] Download failed: ${url} - ${error.message}`);
                    return null;
                }
                await sleep(400);
            }
        }

        return null;
    }

    /**
     * Validate image data by magic bytes.
     * @param {Buffer} buffer
     * @returns {boolean}
     */
    isValidImageBuffer(buffer) {
        if (!buffer || buffer.length < 12) return false;

        // JPEG: FF D8 FF
        if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return true;
        // PNG: 89 50 4E 47
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return true;
        // GIF: 47 49 46
        if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return true;
        // WebP: RIFF....WEBP
        if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
            buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return true;

        return false;
    }

    /**
     * Download and send the selected images.
     *
     * @param {Object} sock - Baileys socket
     * @param {string} from - Chat JID
     * @param {Object} msg - Original message
     * @param {string[]} urls - Image URLs to send
     * @param {string} query - Original search terms, used in the caption
     * @param {string|null} sourceLabel - Set when a fallback tier served, for the badge
     */
    async sendResults(sock, from, msg, urls, query, sourceLabel) {
        let sent = 0;

        for (const url of urls) {
            try {
                let buffer = await this.downloadImage(url);

                // Step down the resolution ladder before giving up on a pin.
                if (!buffer) {
                    for (const smaller of ['/564x/', '/474x/', '/236x/']) {
                        const alt = url.replace(/\/(736x|orig|564x|474x)\//, smaller);
                        if (alt === url) continue;
                        buffer = await this.downloadImage(alt);
                        if (buffer) break;
                    }
                }

                if (buffer && buffer.length > 0) {
                    const caption = sourceLabel
                        ? `📌 ${ui.safe(query)}\n${ui.SYM.dot} via ${sourceLabel}`
                        : `📌 ${ui.safe(query)}`;

                    await this.replyMedia(sock, from, msg, { image: buffer, caption });
                    sent++;
                }
            } catch (error) {
                this.logError(error, { context: 'pinterest-send' });
            }
        }

        if (sent === 0) {
            return await this.replyError(sock, from, msg, 'Gambar gagal diunduh.', {
                hint: ['Coba kata kunci yang lain']
            });
        }

        await this.react(sock, msg, '✅');

        if (sent < urls.length) {
            await this.reply(sock, from, msg, ui.info('Sebagian Terkirim', [
                `Berhasil mengirim ${sent} dari ${urls.length} gambar.`
            ]));
        }
    }
}

module.exports = PinterestCommand;
