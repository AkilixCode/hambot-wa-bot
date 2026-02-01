/**
 * Meme Command
 * Get random Indonesian memes from Reddit r/indonesia
 */

const CommandBase = require('./base');
const httpClient = require('../utils/http-client');

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

        // Indonesian subreddits for memes
        this.subreddits = [
            'indonesia',        // Main Indonesia subreddit
            'indowibu',         // Indonesian weebs/memes
            'indonesian_memes'  // Indonesian memes specific
        ];

        // Flair/tags to look for (funny, meme, shitpost related)
        this.allowedFlairs = [
            'meme', 'funny', 'shitpost', 'humor', 'lucu',
            'question/discussion', 'news', 'casual discussion'
        ];
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        await this.react(sock, msg, '😂');

        try {
            // Try to fetch from Indonesian subreddits
            const meme = await this.fetchIndonesianMeme();

            if (meme && meme.url) {
                // Check if it's an image
                if (!this.isImageUrl(meme.url)) {
                    throw new Error('Not an image post');
                }

                await sock.sendMessage(from, {
                    image: { url: meme.url },
                    caption: `😂 *${meme.title}*\n\n👤 By: u/${meme.author}\n⬆️ ${meme.ups} upvotes\n\n_Dari r/${meme.subreddit}_`
                }, { quoted: msg });

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
        // Try primary: meme-api with indonesia subreddit
        const subreddit = this.subreddits[Math.floor(Math.random() * this.subreddits.length)];
        
        try {
            const { data } = await httpClient.get(
                `https://meme-api.com/gimme/${subreddit}`,
                { timeout: 10000 }
            );

            if (data && data.url && !data.nsfw) {
                return data;
            }
        } catch {
            // Try backup: direct Reddit JSON API
        }

        // Backup: fetch directly from Reddit
        try {
            const { data } = await httpClient.get(
                `https://www.reddit.com/r/indonesia/hot.json?limit=50`,
                { 
                    timeout: 15000,
                    headers: {
                        'User-Agent': 'HamBot/1.0'
                    }
                }
            );

            if (data && data.data && data.data.children) {
                // Filter for image posts only
                const imagePosts = data.data.children.filter(post => {
                    const p = post.data;
                    return p.post_hint === 'image' && 
                           !p.over_18 && 
                           !p.stickied &&
                           this.isImageUrl(p.url);
                });

                if (imagePosts.length > 0) {
                    const randomPost = imagePosts[Math.floor(Math.random() * imagePosts.length)];
                    const p = randomPost.data;
                    return {
                        title: p.title,
                        url: p.url,
                        author: p.author,
                        ups: p.ups,
                        subreddit: p.subreddit
                    };
                }
            }
        } catch {
            // Will use fallback
        }

        return null;
    }

    isImageUrl(url) {
        if (!url) return false;
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
        const lowerUrl = url.toLowerCase();
        
        // Check for image extensions
        if (imageExtensions.some(ext => lowerUrl.includes(ext))) {
            return true;
        }
        
        // Check for Reddit/Imgur image hosts
        if (lowerUrl.includes('i.redd.it') || 
            lowerUrl.includes('i.imgur.com') ||
            lowerUrl.includes('preview.redd.it')) {
            return true;
        }
        
        return false;
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
