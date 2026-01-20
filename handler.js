require('dotenv').config(); 
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec); // Upgrade exec jadi Promise biar bisa di-await
const fs = require('fs');
const fsPromises = require('fs').promises; // Pakai versi Async biar server gak macet
const axios = require('axios');
const sharp = require('sharp');
const os = require('os');

const { spawn } = require('child_process');

function spawnPromise(command, args) {
    return new Promise((resolve, reject) => {
        const process = spawn(command, args);
        let stdoutData = '';
        let stderrData = '';

        process.stdout.on('data', (data) => { stdoutData += data; });
        process.stderr.on('data', (data) => { stderrData += data; });

        process.on('close', (code) => {
            if (code === 0) resolve(stdoutData);
            else reject(new Error(`Command failed with code ${code}\nStderr: ${stderrData}`));
        });

        process.on('error', (err) => reject(err));
    });
}

// --- PUPPETEER CONFIG (SINGLETON PATTERN) ---
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

let sharedBrowser = null; // Browser Induk

// Fungsi inisialisasi browser (Hanya nyala sekali)
async function getBrowserSession() {
    if (!sharedBrowser || !sharedBrowser.isConnected()) {
        console.log('[SYSTEM] 🚀 Launching Singleton Browser...');
        sharedBrowser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox', '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas',
                '--window-size=1920,1080',
                '--disable-blink-features=AutomationControlled'
            ]
        });
    }
    return sharedBrowser;
}

// --- KONFIGURASI GLOBAL ---
const namaOwner = 'Ilham';
const namaBot = 'HamBot';
const MAX_PROCESSES = 3;
let activeProcesses = 0;
const userCooldowns = new Map();

// Helper Wajib
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const formatSize = (bytes) => {
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + " GB";
    else if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + " MB";
    else if (bytes >= 1024) return (bytes / 1024).toFixed(2) + " KB";
    else return bytes + " bytes";
};

// User Agents Rotator
const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
];
const getRandomUA = () => userAgents[Math.floor(Math.random() * userAgents.length)];

// --- SMART HELPER FUNCTIONS ---

async function downloadMedia(message, type) {
    const stream = await downloadContentFromMessage(message, type);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }
    return buffer;
}

async function smartSearchIMDb(query) {
    try {
        const url = `https://html.duckduckgo.com/html/?q=site:imdb.com/title ${encodeURIComponent(query)}`;
        const { data } = await axios.get(url, { headers: { 'User-Agent': getRandomUA() } });
        const idMatch = data.match(/\/title\/(tt\d{6,10})\/?/);
        return (idMatch && idMatch[1]) ? idMatch[1] : null;
    } catch (e) {
        console.log(`[SMART SEARCH ERROR] ${e.message}`);
        return null;
    }
}

async function getValidPosterUrl(originalUrl) {
    if (!originalUrl || originalUrl === 'N/A') return 'https://via.placeholder.com/600x900?text=No+Poster';
    const hdUrl = originalUrl.replace(/\._V1_.*\.jpg$/i, '._V1_SX2000.jpg');
    try {
        await axios.head(hdUrl, { timeout: 2000 });
        return hdUrl;
    } catch (e) {
        return originalUrl;
    }
}

async function fungsiTranslate(text, targetLang = 'id') {
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
        const { data } = await axios.get(url);
        return data[0].map(x => x[0]).join(''); 
    } catch (e) {
        return text;
    }
}

// ==========================================
// 🧠 MAIN LOGIC (The Brain)
// ==========================================
module.exports = async (sock, m) => {
    let isHeavyCommand = false;
    try {
        const msg = m.messages[0];
        if (!msg.message) return;
        if (msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const sender = msg.key.participant || from;
        const isGroup = from.endsWith('@g.us');

        const content = msg.message?.conversation ||
                        msg.message?.extendedTextMessage?.text ||
                        msg.message?.imageMessage?.caption ||
                        "";

        let textBody = content.trim();
        if (!textBody.startsWith('.')) return;
        if (textBody.startsWith('. ')) textBody = '.' + textBody.slice(2).trim();

        const command = textBody.split(' ')[0].toLowerCase();
        const args = textBody.trim().split(/ +/).slice(1);
        
        // --- PRO COOLDOWN (Auto-Delete Memory) ---
        if (userCooldowns.has(sender)) {
             return; // Silent ignore kalau spam
        }
        userCooldowns.set(sender, true);
        setTimeout(() => userCooldowns.delete(sender), 2000); // Hapus memori setelah 2 detik

        // --- QUEUE MANAGEMENT ---
        isHeavyCommand = ['.pinterest', '.photo', '.video', '.music'].includes(command);
        if (isHeavyCommand) {
            if (activeProcesses >= MAX_PROCESSES) {
                return sock.sendMessage(from, { text: `⚠️ Server penuh (${activeProcesses}/${MAX_PROCESSES}). Coba lagi nanti.` }, { quoted: msg });
            }
            activeProcesses++;
        }

        switch (command) {
            case '.intro':
            case '.menu':
            case '.help':
                const menuText =
`🤖 *${namaBot} Pro Dashboard*
_Running on Redmi Proxy Tunnel_

*MEDIA*
• .music <judul>
• .photo <link>
• .video <link>
• .pinterest <query>

*TOOLS*
• .sticker (Reply/Kirim Gambar)
• .toimg (Reply Sticker)
• .say <teks> (TTS)
• .gempa
• .movie <judul>
• .anime <judul>

*SYSTEM*
• .ping
• .info

_© 2025 ${namaOwner}_`.trim();
                await sock.sendMessage(from, { text: menuText }, { quoted: msg });
                break;

            case '.ping':
                const start = Date.now();
                await execPromise('ping -c 1 8.8.8.8'); // Fake ping buat trigger
                const latensi = Date.now() - start;
                const cpus = os.cpus();
                const mem = process.memoryUsage().rss;
                
                const txtPing = `💻 *SYSTEM STATUS*
• Speed: ${latensi}ms
• RAM Bot: ${formatSize(mem)}
• CPU: ${cpus[0].model}`;
                await sock.sendMessage(from, { text: txtPing }, { quoted: msg });
                break;

            // --- PINTEREST  ---
            case '.pinterest':
            case '.pin':
                if (!args[0]) return sock.sendMessage(from, { text: 'Cari apa?' }, { quoted: msg });
                await sock.sendMessage(from, { react: { text: "📌", key: msg.key } });

                let page;
                try {
                    const browser = await getBrowserSession(); // Pakai browser induk
                    page = await browser.newPage(); // Cuma buka tab baru
                    
                    await page.setViewport({ width: 1920, height: 1080 });
                    await page.setUserAgent(getRandomUA());
                    
                    const query = args.join(' ');
                    const targetUrl = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`;
                    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

                    // Scroll dikit biar loading
                    await page.evaluate(async () => {
                        window.scrollBy(0, 1000);
                    });
                    await sleep(2000);

                    const scrapedUrls = await page.evaluate(() => {
                        return Array.from(document.querySelectorAll('img'))
                            .filter(img => img.src.includes('236x') && img.naturalWidth > 150)
                            .map(img => img.src.replace(/236x/, 'originals'));
                    });

                    // Randomize & Pick 3
                    const results = scrapedUrls.sort(() => 0.5 - Math.random()).slice(0, 3);

                    if (results.length > 0) {
                        for (let url of results) {
                            await sock.sendMessage(from, { image: { url: url }, caption: `📌 ${query}` }, { quoted: msg });
                        }
                        await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });
                    } else {
                        await sock.sendMessage(from, { text: '❌ Tidak ditemukan.' }, { quoted: msg });
                    }

                } catch (e) {
                    await sock.sendMessage(from, { text: `❌ Error: ${e.message}` }, { quoted: msg });
                } finally {
                    if (page) await page.close(); // PENTING: Tutup tab, jangan browsernya
                }
                break;

           // --- MUSIC DOWNLOADER ---
case '.music': {
    if (!args[0]) return sock.sendMessage(from, { text: 'Judul?' }, { quoted: msg });
    await sock.sendMessage(from, { react: { text: "🔍", key: msg.key } }); // React kaca pembesar dulu

    const qMusic = args.join(' ');
    const fMusic = `music_${Date.now()}`;
    
    // Gunakan Proxy dari ENV
    const proxyArgs = process.env.HB_PROXY_URL ? ['--proxy', process.env.HB_PROXY_URL] : [];

    try {
        // LANGKAH 1: Cari 5 kandidat, ambil metadata-nya saja (Cepat, cuma teks)
        // Kita pakai spawn agar aman dari hack symbol
        const searchArgs = [
            `ytsearch5:${qMusic}`,
            '--dump-json',            
            '--no-playlist',
            '--flat-playlist',        
            ...proxyArgs
        ];

        // Jalankan pencarian
        const searchResult = await spawnPromise('yt-dlp', searchArgs);
        
        // Parsing hasil JSON (karena yt-dlp output json per baris, kita split)
        const videos = searchResult.trim().split('\n').map(line => {
            try { return JSON.parse(line); } catch { return null; }
        }).filter(v => v !== null);

        // LANGKAH 2: FILTER DURASI (Maksimal 10 menit / 600 detik)
        const validVideo = videos.find(v => v.duration && v.duration < 600);

        if (!validVideo) {
            return sock.sendMessage(from, { text: '❌ Tidak ditemukan lagu yang pas. Lagu hanya bisa berdurasi maksimal 10 menit.' }, { quoted: msg });
        }

        // Kalau ketemu, update React jadi Note
        await sock.sendMessage(from, { react: { text: "🎵", key: msg.key } });
        console.log(`[MUSIC] Selected: ${validVideo.title} (${validVideo.duration}s)`);

        // LANGKAH 3: DOWNLOAD VIDEO TERPILIH (by ID)
        const outputParams = `${fMusic}.%(ext)s`;
        const downloadArgs = [
            `https://youtu.be/${validVideo.id}`, // Download pakai ID pasti akurat
            '-x', 
            '--audio-format', 'mp3', 
            '--audio-quality', '0', 
            '-o', outputParams,
            '--max-filesize', '20M',
            ...proxyArgs,
            '--extractor-args', 'youtube:player_client=android',
            '--force-ipv4',
            '--no-warnings'
        ];

        await spawnPromise('yt-dlp', downloadArgs);

        // Kirim File
        const files = await fsPromises.readdir('./');
        const file = files.find(x => x.startsWith(fMusic) && x.endsWith('.mp3'));

        if (file) {
            await sock.sendMessage(from, { 
                audio: await fsPromises.readFile(file), 
                mimetype: 'audio/mp4', 
                caption: `🎵 ${validVideo.title}` // Caption judul asli
            }, { quoted: msg });
            await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });
        } else {
            throw new Error('File hasil download tidak muncul.');
        }

    } catch (err) {
        console.error('[MUSIC ERROR]', err.message);
        await sock.sendMessage(from, { text: '❌ Gagal (Server/Proxy Error).' }, { quoted: msg });
    } finally {
        // Garbage Collector
        const files = await fsPromises.readdir('./');
        const junk = files.filter(x => x.startsWith(fMusic));
        for (const j of junk) await fsPromises.unlink(j).catch(() => {});
    }
    break;
}
                
        // --- VIDEO & PHOTO ---
case '.video':
case '.photo': {
    if (!args[0]) return sock.sendMessage(from, { text: 'Link?' }, { quoted: msg });
    await sock.sendMessage(from, { react: { text: "⏳", key: msg.key } });

    const fMedia = `media_${Date.now()}`;
    const isVid = command === '.video';
    
    // Siapkan Argumen Proxy (Array)
    const proxyArgs = process.env.HB_PROXY_URL ? ['--proxy', process.env.HB_PROXY_URL] : [];

    // Argumen Dasar (Aman dari Injection karena dipisah dalam Array)
    const commonArgs = [
        args[0], // Input user langsung aman di sini
        '-o', isVid ? `${fMedia}.mp4` : fMedia,
        '--max-filesize', '100M', // Batasi size biar server gak meledak
        ...proxyArgs,
        '--extractor-args', 'youtube:player_client=android',
        '--force-ipv4',
        '--no-warnings'
    ];

    // Argumen Khusus Foto (Thumbnail Only)
    const specificArgs = isVid 
        ? [] 
        : ['--write-thumbnail', '--skip-download', '--convert-thumbnails', 'jpg'];

    try {
        // PENTING: Pakai spawnPromise, bukan execPromise!
        await spawnPromise('yt-dlp', [...commonArgs, ...specificArgs]);
        
        const files = await fsPromises.readdir('./');
        
        if (isVid) {
            const vidFile = files.find(x => x.startsWith(fMedia) && x.endsWith('.mp4'));
            if (vidFile) {
                await sock.sendMessage(from, { video: await fsPromises.readFile(vidFile), caption: 'Done' }, { quoted: msg });
            } else throw new Error('Video gagal di-download (Mungkin oversize/private).');
        } else {
            // Cari file gambar (bisa jpg/png/webp tergantung yt-dlp)
            const imgFile = files.find(x => x.startsWith(fMedia) && (x.endsWith('.jpg') || x.endsWith('.png') || x.endsWith('.webp')));
            if (imgFile) {
                await sock.sendMessage(from, { image: await fsPromises.readFile(imgFile), caption: 'Done' }, { quoted: msg });
            } else throw new Error('Foto gagal di-download.');
        }
        
        await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });

    } catch (e) {
        console.error('[MEDIA ERROR]', e.message);
        await sock.sendMessage(from, { text: '❌ Gagal (Link Error/Size > 100MB).' }, { quoted: msg });
    } finally {
        // GARBAGE COLLECTOR: Hapus sisa file
        const files = await fsPromises.readdir('./');
        const junk = files.filter(x => x.startsWith(fMedia));
        for (const j of junk) await fsPromises.unlink(j).catch(() => {});
    }
    break;
}
                

            // --- STICKER ---
            case '.sticker':
                const isImg = msg.message.imageMessage;
                const isQ = msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
                if(isImg || isQ) {
                    await sock.sendMessage(from, { react: { text: "⏳", key: msg.key } });
                    const buf = await downloadMedia(isImg ? isImg : isQ, 'image');
                    const s = await sharp(buf).resize(512,512,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).webp().toBuffer();
                    await sock.sendMessage(from, { sticker: s }, { quoted: msg });
                    await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });
                } else {
                    await sock.sendMessage(from, { text: 'Kirim/Reply gambar dengan caption .sticker' }, { quoted: msg });
                }
                break;

            // --- STICKER TO IMAGE ---
            case '.toimg':
                if (!msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage) {
                    return sock.sendMessage(from, { text: '❌ Reply stikernya!' }, { quoted: msg });
                }
                await sock.sendMessage(from, { react: { text: "🖼️", key: msg.key } });
                
                const fWebp = `sticker_${Date.now()}.webp`;
                const fPng = `sticker_${Date.now()}.png`;

                try {
                    const qSticker = msg.message.extendedTextMessage.contextInfo.quotedMessage.stickerMessage;
                    const bufSticker = await downloadMedia(qSticker, 'sticker');
                    
                    await fsPromises.writeFile(fWebp, bufSticker);
                    await execPromise(`ffmpeg -i ${fWebp} ${fPng}`); // Convert

                    await sock.sendMessage(from, { image: await fsPromises.readFile(fPng), caption: 'Nih gambarnya' }, { quoted: msg });
                } catch (e) {
                    console.log(e);
                    await sock.sendMessage(from, { text: '❌ Gagal konversi.' }, { quoted: msg });
                } finally {
                    // Bersih-bersih
                    await fsPromises.unlink(fWebp).catch(()=>{});
                    await fsPromises.unlink(fPng).catch(()=>{});
                }
                break;

            // --- ELEVENLABS TTS (ELEVEN V3 ALPHA + SMART LANG) ---
            case '.say':
            case '.vn':
                // Cek argumen kosong
                if (!args[0]) return sock.sendMessage(from, { text: 'Format: .say <kode_bahasa> <teks>\nContoh: .say en Hello World' }, { quoted: msg });
                
                // Cek API Key
                if (!process.env.ELEVENLABS_API_KEY) return sock.sendMessage(from, { text: '❌ API Key belum diset di .env' }, { quoted: msg });

                await sock.sendMessage(from, { react: { text: "🗣️", key: msg.key } });

                const fTTS = `tts_${Date.now()}`;
                const mp3Path = `./${fTTS}.mp3`;
                const opusPath = `./${fTTS}.opus`;

                try {
                    // --- 1. LOGIKA SMART LANGUAGE TAG ---
                    let targetLang = 'id'; // Default Bahasa Indonesia
                    let textRaw = '';

                    // Cek apakah kata pertama adalah kode bahasa (tepat 2 huruf)
                    // Contoh: "id Halo" -> Lang: id, Teks: Halo
                    // Contoh: "Halo Dunia" -> Lang: id (default), Teks: Halo Dunia
                    if (args[0].length === 2 && /^[a-zA-Z]{2}$/.test(args[0])) {
                        targetLang = args[0].toLowerCase();
                        textRaw = args.slice(1).join(' '); // Ambil sisanya
                    } else {
                        textRaw = args.join(' '); // Anggap semua teks
                    }

                    if (!textRaw) return sock.sendMessage(from, { text: 'Mana teksnya?' }, { quoted: msg });

                    // --- 2. AUTO TRANSLATE ---
                    // Penting: Translate dulu biar aksen ElevenLabs sesuai bahasa target
                    const textToSpeech = await fungsiTranslate(textRaw, targetLang);
                    
                    // Fallback Voice ID (Adam)
                    const voiceId = process.env.ELEVENLABS_VOICE_ID || 'plgKUYgnlZ1DCNh54DwJ'; 
                    
                    // --- 3. REQUEST ELEVENLABS V3 (ALPHA) ---
                    const response = await axios({
                        method: 'post',
                        url: `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
                        data: {
                            text: textToSpeech,
                            model_id: "eleven_v3", // <-- MODEL V3 ALPHA SESUAI DOKUMENTASI
                            voice_settings: { 
                                stability: 0.5, 
                                similarity_boost: 0.75,
                                use_speaker_boost: true
                                // PENTING: Jangan pakai 'style' di v3, nanti error 400!
                            }
                        },
                        headers: {
                            'Accept': 'audio/mpeg',
                            'xi-api-key': process.env.ELEVENLABS_API_KEY,
                            'Content-Type': 'application/json',
                        },
                        responseType: 'arraybuffer'
                    });

                    // --- 4. SAVE & CONVERT ---
                    await fsPromises.writeFile(mp3Path, response.data);
                    
                    // Convert MP3 ke OPUS (Voice Note WA) pakai spawnPromise
                    await spawnPromise('ffmpeg', ['-i', mp3Path, '-c:a', 'libopus', opusPath, '-y']);

                    // --- 5. KIRIM VOICE NOTE ---
                    await sock.sendMessage(from, { 
                        audio: await fsPromises.readFile(opusPath), 
                        mimetype: 'audio/ogg; codecs=opus', 
                        ptt: true // Kirim sebagai Voice Note (bukan file audio biasa)
                    }, { quoted: msg });
                    
                    await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });

                } catch (e) {
                    console.error('[ELEVENLABS ERROR]', e.response?.data || e.message);
                    const errMsg = e.response?.status === 401 ? '❌ API Key Salah/Expired.' : '❌ Gagal generate suara (Server/Limit Habis).';
                    await sock.sendMessage(from, { text: errMsg }, { quoted: msg });
                } finally {
                    // GARBAGE COLLECTOR: Bersihkan file sampah
                    await fsPromises.unlink(mp3Path).catch(()=>{});
                    await fsPromises.unlink(opusPath).catch(()=>{});
                }
                break;

            // --- MOVIE INFO ---
            case '.movie':
                if (!args[0]) return;
                await sock.sendMessage(from, { react: { text: "🎬", key: msg.key } });
                try {
                    const qMovie = args.join(' ');
                    const apiKey = process.env.OMDB_API_KEY;
                    if (!apiKey) throw new Error('API Key OMDb kosong');

                    const imdbId = await smartSearchIMDb(qMovie);
                    const fetchUrl = imdbId 
                        ? `http://www.omdbapi.com/?i=${imdbId}&apikey=${apiKey}&plot=full`
                        : `http://www.omdbapi.com/?t=${qMovie.replace(/ /g, '+')}&apikey=${apiKey}&plot=full`;

                    const { data } = await axios.get(fetchUrl);
                    if (data.Response === 'True') {
                        const poster = await getValidPosterUrl(data.Poster);
                        const sinopsis = await fungsiTranslate(data.Plot, 'id');
                        const txt = `🎬 *${data.Title}* (${data.Year})\n⭐ ${data.imdbRating}/10\n\n📝 ${sinopsis}`;
                        
                        await sock.sendMessage(from, { image: { url: poster }, caption: txt }, { quoted: msg });
                    } else {
                        await sock.sendMessage(from, { text: '❌ Film tidak ditemukan.' }, { quoted: msg });
                    }
                } catch (e) {
                    console.log(e);
                    await sock.sendMessage(from, { text: '❌ Error.' }, { quoted: msg });
                }
                break;
            
            // --- GEMPA & ANIME (Sisanya sama, sudah oke) ---
            // --- command: ANIME SEARCH (Max Quality + Translate + Full) ---
            case '.anime':
                if (!args[0]) return sock.sendMessage(from, { text: 'Judul anime?' }, { quoted: msg });
                await sock.sendMessage(from, { react: { text: "⛩️", key: msg.key } });

                try {
                    const queryAnime = args.join(' ');
                    const { data } = await axios.get(`https://api.jikan.moe/v4/anime?q=${queryAnime}&limit=1`);

                    if (data.data && data.data.length > 0) {
                        const anime = data.data[0];
                        
                        // 1. Gambar Max Quality
                        const images = anime.images;
                        const imageUrl = 
                            images.webp?.maximum_image_url || 
                            images.jpg?.maximum_image_url || 
                            images.webp?.large_image_url || 
                            images.jpg?.large_image_url;
                        
                        // 2. TRANSLATE OTOMATIS
                        // Kalau sinopsis kosong, kasih strip
                        const rawSyn = anime.synopsis || 'No synopsis available.';
                        const sinopsisIndo = await fungsiTranslate(rawSyn, 'id');

                        const status = anime.status;
                        const score = anime.score ? anime.score : 'N/A';
                        const episodes = anime.episodes ? anime.episodes : '?';
                        const rank = anime.rank ? `#${anime.rank}` : 'N/A';
                        const graphLink = `https://www.google.com/search?q=site:seriesgraph.com+${anime.title.replace(/ /g, '+')}`;

                        const captionAnime = 
`⛩️ *ANIME INFO (MAL)* ⛩️

🇯🇵 *Judul:* ${anime.title} (${anime.title_japanese || '-'})
⭐ *Score:* ${score}/10 (Rank ${rank})
📺 *Episode:* ${episodes} (${status})
🎭 *Studio:* ${anime.studios[0]?.name || '-'}
📅 *Rilis:* ${anime.year || '-'}
⏱️ *Durasi:* ${anime.duration}

📊 *Info Rating Per Episode:*
${graphLink}

📝 *Sinopsis (ID):*
${sinopsisIndo}

🔗 *Link MAL:* ${anime.url}`;

                        await sock.sendMessage(from, { image: { url: imageUrl }, caption: captionAnime }, { quoted: msg });
                        await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });
                    } else {
                        await sock.sendMessage(from, { text: '❌ Anime tidak ditemukan.' }, { quoted: msg });
                    }
                } catch (e) {
                    console.log(e);
                    await sock.sendMessage(from, { text: '❌ Error Jikan API.' }, { quoted: msg });
                }
                break;


             // --- command: INFO GEMPA (BMKG) ---
            case '.gempa':
                await sock.sendMessage(from, { react: { text: "🌍", key: msg.key } });
                try {
                    const { data } = await axios.get('https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json');
                    const g = data.Infogempa.gempa;
                    
                    const teksGempa = 
`⚠️ *INFO GEMPA TERKINI* ⚠️
📅 Tanggal: ${g.Tanggal}
ZE Jam: ${g.Jam}
📍 Koordinat: ${g.Coordinates}
📉 Magnitudo: ${g.Magnitude}
🌊 Kedalaman: ${g.Kedalaman}
🚩 Lokasi: ${g.Wilayah}
📢 Potensi: ${g.Potensi}`;

                    // Ambil gambar peta gempa
                    const imgUrl = `https://data.bmkg.go.id/DataMKG/TEWS/${g.Shakemap}`;
                    
                    await sock.sendMessage(from, { image: { url: imgUrl }, caption: teksGempa }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Gagal mengambil data BMKG.' }, { quoted: msg });
                }
                break;

                
        
                
            // ... Tambahkan case lain jika perlu ...
        }

    } catch (err) {
        console.error('[FATAL ERROR]', err);
    } finally {
        // Kurangi counter process hanya jika command berat
        if (isHeavyCommand && activeProcesses > 0) activeProcesses--;
    }
};
