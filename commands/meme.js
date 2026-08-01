/**
 * Meme Command
 * Get random Indonesian memes from Reddit r/indonesia
 */

const CommandBase = require('./base');
const ui = require('../utils/ui');
const httpClient = require('../utils/http-client');
const logger = require('../utils/logger');

class MemeCommand extends CommandBase {
    constructor() {
        super({
            name: 'meme',
            aliases: ['memes', 'memeindo'],
            description: 'Dapatkan meme Indonesia acak',
            usage: '.meme',
            category: 'fun',
            cooldown: 3000
        });

        // Only r/indonesia for Indonesian memes
        this.subreddit = 'indonesia';
        
        // Flair filters for meme content in r/indonesia
        this.memeFlairs = [
            'meme', 'memes', 'funny', 'shitpost', 'humor', 
            'comedy', 'lol', 'lucu', 'humoris'
        ];
        
        // Cache for memes to avoid repetition
        this.memeCache = [];
        this.lastCacheRefresh = 0;
        this.cacheExpiry = 15 * 60 * 1000; // 15 minutes
        this.usedMemes = new Set(); // Track recently shown memes
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        await this.react(sock, msg, '😂');

        try {
            // Try to fetch from Indonesian subreddits
            logger.info('Meme: fetching random meme...');
            const meme = await this.fetchIndonesianMeme();

            if (meme && meme.url) {
                // Check if it's an image
                if (!this.isImageUrl(meme.url)) {
                    throw new Error('Not an image post');
                }

                logger.info(`Meme: fetched from r/${meme.subreddit}`);

                // Fetched into a Buffer rather than passing { url } to Baileys.
                // Baileys would fetch the URL itself, bypassing utils/http-client
                // and therefore the proxy — so with the proxy on, this one
                // request would still have gone out over the datacenter IP.
                const buffer = await this.downloadImage(meme.url);
                if (!buffer) throw new Error('Meme image download failed');

                await this.replyMedia(sock, from, msg, {
                    image: buffer,
                    caption: ui.card({
                        icon: '😂',
                        title: ui.safe(ui.truncate(meme.title, 70)),
                        lines: [
                            ui.kv('Oleh', `u/${ui.safe(meme.author, 30)}`, '👤'),
                            ui.kv('Upvote', ui.compactNumber(meme.ups || 0), '⬆️')
                        ],
                        footer: `r/${meme.subreddit} ${ui.SYM.dot} ${ui.clock()}`
                    })
                });

                await this.react(sock, msg, '✅');
            } else {
                throw new Error('No meme data received');
            }

        } catch (error) {
            this.logError(error, context);
            
            // Try fallback with local Indonesian memes
            await this.sendFallbackMeme(sock, from, msg);
        }
    }

    async fetchIndonesianMeme() {
        const now = Date.now();
        
        // Refresh cache if expired or empty
        if (this.memeCache.length === 0 || (now - this.lastCacheRefresh) > this.cacheExpiry) {
            await this.refreshMemeCache();
        }
        
        // Get unused meme from cache
        const unusedMemes = this.memeCache.filter(m => !this.usedMemes.has(m.id));
        
        // If all memes used, clear the used set and use full cache
        if (unusedMemes.length === 0) {
            this.usedMemes.clear();
            if (this.memeCache.length === 0) {
                return null;
            }
        }
        
        const availableMemes = unusedMemes.length > 0 ? unusedMemes : this.memeCache;
        const randomMeme = availableMemes[Math.floor(Math.random() * availableMemes.length)];
        
        if (randomMeme) {
            this.usedMemes.add(randomMeme.id);
            return randomMeme;
        }
        
        return null;
    }
    
    async refreshMemeCache() {
        const memes = [];
        const categories = ['hot', 'top', 'rising'];
        
        for (const category of categories) {
            try {
                const limitParam = category === 'top' ? '&t=week&limit=100' : '&limit=100';
                const { data } = await httpClient.get(
                    `https://www.reddit.com/r/${this.subreddit}/${category}.json?raw_json=1${limitParam}`,
                    { 
                        timeout: 15000,
                        headers: {
                            'User-Agent': 'HamBot/2.0 (WhatsApp Bot)'
                        }
                    }
                );

                if (data && data.data && data.data.children) {
                    const filteredPosts = data.data.children.filter(post => {
                        const p = post.data;
                        // Filter for image posts with meme-related flairs
                        const flair = (p.link_flair_text || '').toLowerCase();
                        const title = (p.title || '').toLowerCase();
                        
                        // Check if it's meme/funny content
                        const isMemeContent = this.memeFlairs.some(f => 
                            flair.includes(f) || title.includes(f)
                        ) || p.post_hint === 'image';
                        
                        return isMemeContent && 
                               p.post_hint === 'image' && 
                               !p.over_18 && 
                               !p.stickied &&
                               this.isImageUrl(p.url);
                    });

                    for (const post of filteredPosts) {
                        const p = post.data;
                        memes.push({
                            id: p.id,
                            title: p.title,
                            url: p.url,
                            author: p.author,
                            ups: p.ups,
                            subreddit: p.subreddit,
                            flair: p.link_flair_text || ''
                        });
                    }
                }
            } catch {
                // Continue with next category
            }
        }
        
        // Remove duplicates and update cache
        const uniqueMemes = [...new Map(memes.map(m => [m.id, m])).values()];
        this.memeCache = uniqueMemes;
        this.lastCacheRefresh = Date.now();
        
        // Also try meme-api as additional source
        try {
            const { data } = await httpClient.get(
                `https://meme-api.com/gimme/${this.subreddit}/20`,
                { timeout: 10000 }
            );

            if (data && data.memes && Array.isArray(data.memes)) {
                for (const meme of data.memes) {
                    if (meme.url && !meme.nsfw && this.isImageUrl(meme.url)) {
                        const id = meme.postLink?.split('/').pop() || `api_${Date.now()}_${Math.random()}`;
                        if (!this.memeCache.some(m => m.id === id)) {
                            this.memeCache.push({
                                id: id,
                                title: meme.title,
                                url: meme.url,
                                author: meme.author,
                                ups: meme.ups,
                                subreddit: meme.subreddit,
                                flair: ''
                            });
                        }
                    }
                }
            }
        } catch {
            // Continue without meme-api
        }
    }

    isImageUrl(url) {
        if (!url) return false;
        
        try {
            const parsedUrl = new URL(url);
            const hostname = parsedUrl.hostname.toLowerCase();
            const pathname = parsedUrl.pathname.toLowerCase();
            
            // Check for image extensions in pathname
            const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
            if (imageExtensions.some(ext => pathname.endsWith(ext))) {
                return true;
            }
            
            // Check for trusted Reddit/Imgur image hosts (exact hostname match)
            const trustedImageHosts = [
                'i.redd.it',
                'i.imgur.com',
                'preview.redd.it',
                'external-preview.redd.it'
            ];
            
            if (trustedImageHosts.includes(hostname)) {
                return true;
            }
            
            return false;
        } catch {
            // Invalid URL
            return false;
        }
    }

    /**
     * Fetch a meme image through the shared HTTP client.
     *
     * Goes through utils/http-client so the request honours the proxy setting
     * and the magic-byte check below can reject Reddit's HTML error pages,
     * which are served with a 200 and would otherwise reach WhatsApp labelled
     * as an image.
     *
     * @param {string} url - Image URL
     * @returns {Promise<Buffer|null>} Image bytes, or null on failure
     */
    async downloadImage(url) {
        try {
            const response = await httpClient.get(url, {
                responseType: 'arraybuffer',
                timeout: 15000,
                headers: {
                    'User-Agent': 'HamBot/3.2 (WhatsApp Bot)',
                    'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8'
                }
            });

            const buffer = Buffer.from(response.data);
            if (buffer.length < 12) return null;

            const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
            const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
            const isGif = buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46;
            const isWebp = buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
                buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;

            return (isJpeg || isPng || isGif || isWebp) ? buffer : null;
        } catch (error) {
            logger.debug(`Meme: image download failed - ${error.message}`);
            return null;
        }
    }

    async sendFallbackMeme(sock, from, msg) {
        // Fallback Indonesian meme messages
        const fallbackMemes = [
            {
                text: "😂 *Meme Indonesia*\n\n" +
                      "Ketika WiFi lemot tapi quota masih banyak:\n" +
                      "🐢 \"Sabar ya, internet lagi healing...\"\n\n" +
                      "_Meme lokal HamBot_"
            },
            {
                text: "😂 *Meme Indonesia*\n\n" +
                      "Bos: \"Kamu bisa lembur hari ini?\"\n" +
                      "Karyawan: \"Bisa, tapi besok saya izin sakit ya.\"\n\n" +
                      "_Meme lokal HamBot_"
            },
            {
                text: "😂 *Meme Indonesia*\n\n" +
                      "Ibu-ibu di grup WA:\n" +
                      "\"Selamat pagi, semoga hari ini penuh berkah 🌸🌺🌷\"\n" +
                      "*attachment: gambar bunga 240p*\n\n" +
                      "_Meme lokal HamBot_"
            },
            {
                text: "😂 *Meme Indonesia*\n\n" +
                      "Programmer Indonesia be like:\n" +
                      "\"Kode error? Coba restart.\"\n" +
                      "\"Masih error? Copy dari StackOverflow.\"\n" +
                      "\"Masih error juga? Pasrah.\"\n\n" +
                      "_Meme lokal HamBot_"
            },
            {
                text: "😂 *Meme Indonesia*\n\n" +
                      "Orang Indonesia kalau ditanya:\n" +
                      "\"Udah makan belum?\"\n" +
                      "Padahal baru aja ketemu:\n" +
                      "\"Sudah, tadi makan [insert makanan].\"\n\n" +
                      "_Meme lokal HamBot_"
            },
            {
                text: "😂 *Meme Indonesia*\n\n" +
                      "Playlist Spotify: Lo-fi Hip Hop\n" +
                      "Realita: Dangdut koplo di angkot 🚐🎶\n\n" +
                      "_Meme lokal HamBot_"
            },
            {
                text: "😂 *Meme Indonesia*\n\n" +
                      "Ekspektasi: Meeting 30 menit\n" +
                      "Realita: 2 jam bahas hal yang bisa di-email 📧\n\n" +
                      "_Meme lokal HamBot_"
            },
            {
                text: "😂 *Meme Indonesia*\n\n" +
                      "Tukang parkir: *tepuk tangan sekali*\n" +
                      "Aku: Terima kasih pak, hidupku terselamatkan 🙏\n\n" +
                      "_Meme lokal HamBot_"
            }
        ];

        const randomMeme = fallbackMemes[Math.floor(Math.random() * fallbackMemes.length)];
        await this.reply(sock, from, msg, randomMeme.text);
        await this.react(sock, msg, '✅');
    }
}

module.exports = MemeCommand;
