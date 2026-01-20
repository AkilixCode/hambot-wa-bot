require('dotenv').config(); 
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { spawn } = require('child_process'); // PENGGANTI EXEC (LEBIH AMAN)
const fs = require('fs');
const fsPromises = require('fs').promises; 
const axios = require('axios');
const sharp = require('sharp');
const os = require('os');

// --- PUPPETEER CONFIG (SINGLETON PATTERN) ---
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

let sharedBrowser = null;

// Fungsi Browser Anti-Crash
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

// --- HELPER FUNCTIONS ---

// 1. Spawn Promise (Pengganti Exec yang Aman & Async)
function spawnPromise(command, args) {
    return new Promise((resolve, reject) => {
        const proc = spawn(command, args);
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (data) => stdout += data);
        proc.stderr.on('data', (data) => stderr += data);
        proc.on('close', (code) => {
            if (code === 0) resolve(stdout);
            else reject(new Error(stderr || `Command failed with code ${code}`));
        });
        proc.on('error', (err) => reject(err));
    });
}

// 2. Helper Lainnya
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const formatSize = (bytes) => {
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + " GB";
    else if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + " MB";
    else if (bytes >= 1024) return (bytes / 1024).toFixed(2) + " KB";
    else return bytes + " bytes";
};

const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
];
const getRandomUA = () => userAgents[Math.floor(Math.random() * userAgents.length)];

async function downloadMedia(message, type) {
    const stream = await downloadContentFromMessage(message, type);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }
    return buffer;
}

async function fungsiTranslate(text, targetLang = 'id') {
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
        const { data } = await axios.get(url);
        return data[0].map(x => x[0]).join(''); 
    } catch (e) { return text; }
}

async function smartSearchIMDb(query) {
    try {
        const url = `https://html.duckduckgo.com/html/?q=site:imdb.com/title ${encodeURIComponent(query)}`;
        const { data } = await axios.get(url, { headers: { 'User-Agent': getRandomUA() } });
        const idMatch = data.match(/\/title\/(tt\d{6,10})\/?/);
        return (idMatch && idMatch[1]) ? idMatch[1] : null;
    } catch (e) { return null; }
}

async function getValidPosterUrl(originalUrl) {
    if (!originalUrl || originalUrl === 'N/A') return 'https://via.placeholder.com/600x900?text=No+Poster';
    const hdUrl = originalUrl.replace(/\._V1_.*\.jpg$/i, '._V1_SX2000.jpg');
    try {
        await axios.head(hdUrl, { timeout: 2000 });
        return hdUrl;
    } catch (e) { return originalUrl; }
}

// --- GLOBAL VARS ---
const namaOwner = 'Ilham';
const namaBot = 'HamBot';
const MAX_PROCESSES = 3;
let activeProcesses = 0;
const userCooldowns = new Map();

// ==========================================
// 🧠 MAIN LOGIC
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
        
        // --- COOLDOWN (Auto-Delete Memory) ---
        if (userCooldowns.has(sender)) return; 
        userCooldowns.set(sender, true);
        setTimeout(() => userCooldowns.delete(sender), 2000); 

        // --- QUEUE MANAGEMENT ---
        isHeavyCommand = ['.pinterest', '.photo', '.video', '.music'].includes(command);
        if (isHeavyCommand) {
            if (activeProcesses >= MAX_PROCESSES) {
                return sock.sendMessage(from, { text: `⚠️ Server penuh (${activeProcesses}/${MAX_PROCESSES}). Tunggu sebentar...` }, { quoted: msg });
            }
            activeProcesses++;
        }

        switch (command) {
            // --- MENU / INTRO (VERSI RAMAH & LENGKAP) ---
            case '.intro':
            case '.menu':
            case '.help':
                const menuText =
`🤖 *${namaBot}* 🤖
_Halo! Berikut adalah daftar perintah lengkap dan cara penggunaannya._

🎵 *MEDIA DOWNLOADER*
• *.music <judul lagu>*
  Mencari & download lagu MP3 secara otomatis.
  _Contoh: .music About you the 1975_
  
• *.video <link>*
  Download video dari YouTube/sosmed.
  _Contoh: .video https://youtu.be/xyz..._
  
• *.photo <link>*
  Download foto dari link.
  
• *.pinterest <kata kunci>*
  Mencari referensi gambar aesthetic.
  _Contoh: .pinterest Cyberpunk City_

🛠️ *CREATIVE TOOLS*
• *.sticker*
  Ubah gambar jadi stiker WA.
  _Cara: Kirim gambar pakai caption .sticker ATAU Reply gambar._
  
• *.toimg*
  Ubah stiker jadi gambar.
  _Cara: Reply stikernya ketik .toimg_
  
• *.say <kode_bahasa> <teks>*
  Ubah teks jadi pesan suara (TTS).
  _Contoh: .say id Halo semuanya_
  _(Kode: id=Indo, en=Inggris, ja=Jepang, dll)_

🎬 *INFO & ENTERTAINMENT*
• *.movie <judul>*
  Cek rating, sinopsis, & info film.
  _Contoh: .movie Interstellar_
  
• *.anime <judul>*
  Cek detail anime (skor, episode, dll).
  _Contoh: .anime Naruto_
  
• *.gempa*
  Info gempa terkini dari BMKG (Peta & Potensi).

👨‍👩‍👧‍👦 *GROUP & SYSTEM*
• *.tagall* (Admin Only)
  Mention semua member grup sekaligus.
  
• *.info*
  Lihat data statistik & metadata grup.
  
• *.ping*
  Cek kecepatan respon bot & status server.
  
• *.spam <mode> <target> <jml> <pesan>*
  Fitur spam chat (Gunakan dengan bijak!).
  _Contoh: .spam group @teman 5 Bangun woi!_

_Tips: Jangan spam command terlalu cepat agar tidak terkena cooldown._
© 2025 ${namaOwner}`;

                // Kirim menu dengan foto profil bot (jika ada) atau text saja
                await sock.sendMessage(from, { text: menuText }, { quoted: msg });
                break;

            // --- PING (UPGRADED: Pakai Spawn & Detail OS) ---
            case '.ping':
                await sock.sendMessage(from, { react: { text: "💻", key: msg.key } });
                const start = Date.now();
                const cpus = os.cpus();
                const mem = process.memoryUsage().rss;
                const totalMem = os.totalmem();
                const freeMem = os.freemem();
                
                try {
                    // Pakai spawn ping (lebih stabil)
                    const output = await spawnPromise('ping', ['-c', '1', '8.8.8.8']);
                    const latensi = Date.now() - start;
                    
                    const txtPing = 
`💻 *SYSTEM STATUS*
• Host: ${os.hostname()}
• OS: ${os.type()} ${os.arch()}
• CPU: ${cpus[0].model}
• RAM: ${formatSize(totalMem - freeMem)} / ${formatSize(totalMem)}
• Latency: ${latensi}ms`;
                    
                    await sock.sendMessage(from, { text: txtPing }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: `Pong! (Error details hidden)` }, { quoted: msg });
                }
                break;

            // --- INFO GROUP (RESTORED) ---
            case '.info':
                if (!isGroup) return sock.sendMessage(from, { text: '❌ Khusus Grup!' }, { quoted: msg });
                const meta = await sock.groupMetadata(from);
                const admins = meta.participants.filter(p => p.admin).length;
                const creation = new Date(meta.creation * 1000).toLocaleDateString('id-ID');
                
                const txtInfo = 
`📋 *GROUP DATA*
• ID: ${meta.id}
• Nama: ${meta.subject}
• Dibuat: ${creation}
• Member: ${meta.participants.length}
• Admin: ${admins}`;
                await sock.sendMessage(from, { text: txtInfo }, { quoted: msg });
                break;

            // --- TAGALL (RESTORED) ---
            case '.tagall':
                if (!isGroup) return sock.sendMessage(from, { text: '❌ Khusus Grup!' }, { quoted: msg });
                // Cek Admin (Opsional: Tambahkan logika cek sender admin di sini jika mau)
                
                const groupMetadataTag = await sock.groupMetadata(from);
                let teksTag = `🔊 *TAG ALL MEMBERS*\nTotal: ${groupMetadataTag.participants.length}\n\n`;
                let mentionsTag = [];
                for (let mem of groupMetadataTag.participants) {
                    teksTag += `@${mem.id.split('@')[0]}\n`;
                    mentionsTag.push(mem.id);
                }
                await sock.sendMessage(from, { text: teksTag, mentions: mentionsTag }, { quoted: msg });
                break;

            // --- SPAM (RESTORED & SAFER) ---
            case '.spam':
                if (args.length < 4) return sock.sendMessage(from, { text: 'Format: .spam <group/private> <nomor/target> <jml> <pesan>' }, { quoted: msg });
                // Logic Spam
                let mode = args[0];
                let trg = args[1];
                let jml = parseInt(args[2]);
                let txtSpam = args.slice(3).join(' ');
                
                // Limit jumlah biar ga crash
                if (jml > 50) jml = 50; 
                
                let jid = null;
                const mSpam = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
                
                if (mSpam && mSpam.length > 0) jid = mSpam[0];
                else {
                    let n = trg.replace(/[^0-9]/g, '');
                    if (n.startsWith('08')) n = '62' + n.slice(1);
                    if (n.length > 5) jid = n + '@s.whatsapp.net';
                }

                await sock.sendMessage(from, { text: `🚀 Mengirim ${jml} pesan...` }, { quoted: msg });

                for(let i=0; i<jml; i++) {
                    if (mode === 'private' && jid) {
                        await sock.sendMessage(jid, { text: txtSpam });
                    } else {
                        await sock.sendMessage(from, { text: txtSpam, mentions: jid ? [jid] : [] });
                    }
                    await sleep(500); // DELAY 0.5s AGAR TIDAK DIBANNED WA
                }
                break;

            // --- GEMPA (RESTORED) ---
            case '.gempa':
                await sock.sendMessage(from, { react: { text: "🌍", key: msg.key } });
                try {
                    const { data } = await axios.get('https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json');
                    const g = data.Infogempa.gempa;
                    const teksGempa = 
`⚠️ *GEMPA TERKINI (BMKG)*
📅 ${g.Tanggal} | ${g.Jam}
📍 ${g.Coordinates}
📉 Mag: ${g.Magnitude} | Dlm: ${g.Kedalaman}
🚩 ${g.Wilayah}
📢 ${g.Potensi}`;
                    await sock.sendMessage(from, { image: { url: `https://data.bmkg.go.id/DataMKG/TEWS/${g.Shakemap}` }, caption: teksGempa }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Gagal ambil data BMKG.' }, { quoted: msg });
                }
                break;

            // --- PINTEREST (UPGRADED: Singleton Browser) ---
            case '.pinterest':
            case '.pin':
                if (!args[0]) return sock.sendMessage(from, { text: 'Cari apa?' }, { quoted: msg });
                await sock.sendMessage(from, { react: { text: "📌", key: msg.key } });

                let page;
                try {
                    const browser = await getBrowserSession(); // Pakai browser induk
                    page = await browser.newPage(); // Cuma buka tab
                    await page.setUserAgent(getRandomUA());
                    
                    const query = args.join(' ');
                    const targetUrl = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`;
                    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

                    // Scroll dikit
                    await page.evaluate(async () => window.scrollBy(0, 500));
                    await sleep(1000);

                    const scrapedUrls = await page.evaluate(() => {
                        return Array.from(document.querySelectorAll('img'))
                            .filter(img => img.src.includes('236x') && img.naturalWidth > 150)
                            .map(img => img.src.replace(/236x/, 'originals'));
                    });

                    // Random Pick 3
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
                    if (page) await page.close(); // Tutup TAB saja
                }
                break;

            // --- MUSIC (UPGRADED: Smart Duration & Proxy & Spawn) ---
            case '.music': {
                if (!args[0]) return sock.sendMessage(from, { text: 'Judul?' }, { quoted: msg });
                await sock.sendMessage(from, { react: { text: "🔍", key: msg.key } });

                const qMusic = args.join(' ');
                const fMusic = `music_${Date.now()}`;
                const proxyArgs = process.env.HB_PROXY_URL ? ['--proxy', process.env.HB_PROXY_URL] : [];

                try {
                    // 1. Cek Metadata (Durasi < 8 menit)
                    const searchArgs = [
                        `ytsearch5:${qMusic}`, '--dump-json', '--no-playlist', '--flat-playlist',
                        ...proxyArgs
                    ];
                    const searchResult = await spawnPromise('yt-dlp', searchArgs);
                    
                    const videos = searchResult.trim().split('\n').map(line => {
                        try { return JSON.parse(line); } catch { return null; }
                    }).filter(v => v !== null);

                    const validVideo = videos.find(v => v.duration && v.duration < 600); // < 10 menit
                    
                    if (!validVideo) return sock.sendMessage(from, { text: '❌ Lagu mempunyai durasi terlalu panjang.' }, { quoted: msg });

                    await sock.sendMessage(from, { react: { text: "🎵", key: msg.key } });

                    // 2. Download
                    const outputParams = `${fMusic}.%(ext)s`;
                    const downloadArgs = [
                        `https://youtu.be/${validVideo.id}`, '-x', 
                        '--audio-format', 'mp3', '--audio-quality', '0', 
                        '-o', outputParams, '--max-filesize', '20M',
                        ...proxyArgs,
                        '--extractor-args', 'youtube:player_client=android',
                        '--force-ipv4', '--no-warnings'
                    ];

                    await spawnPromise('yt-dlp', downloadArgs);

                    const files = await fsPromises.readdir('./');
                    const file = files.find(x => x.startsWith(fMusic) && x.endsWith('.mp3'));

                    if (file) {
                        await sock.sendMessage(from, { 
                            audio: await fsPromises.readFile(file), 
                            mimetype: 'audio/mp4', 
                            caption: `🎵 ${validVideo.title}` 
                        }, { quoted: msg });
                        await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });
                    } else { throw new Error('File not found'); }

                } catch (err) {
                    console.error('[MUSIC ERROR]', err.message);
                    await sock.sendMessage(from, { text: '❌ Gagal Download.' }, { quoted: msg });
                } finally {
                    const files = await fsPromises.readdir('./');
                    const junk = files.filter(x => x.startsWith(fMusic));
                    for (const j of junk) await fsPromises.unlink(j).catch(() => {});
                }
                break;
            }

            // --- VIDEO & PHOTO (UPGRADED: Spawn & Proxy) ---
            case '.video':
            case '.photo': {
                if (!args[0]) return sock.sendMessage(from, { text: 'Link?' }, { quoted: msg });
                await sock.sendMessage(from, { react: { text: "⏳", key: msg.key } });

                const fMedia = `media_${Date.now()}`;
                const isVid = command === '.video';
                const proxyArgs = process.env.HB_PROXY_URL ? ['--proxy', process.env.HB_PROXY_URL] : [];

                const commonArgs = [
                    args[0], 
                    '-o', isVid ? `${fMedia}.mp4` : fMedia,
                    '--max-filesize', '100M',
                    ...proxyArgs,
                    '--extractor-args', 'youtube:player_client=android',
                    '--force-ipv4', '--no-warnings'
                ];
                const specificArgs = isVid ? [] : ['--write-thumbnail', '--skip-download', '--convert-thumbnails', 'jpg'];

                try {
                    await spawnPromise('yt-dlp', [...commonArgs, ...specificArgs]);
                    const files = await fsPromises.readdir('./');
                    
                    if (isVid) {
                        const vidFile = files.find(x => x.startsWith(fMedia) && x.endsWith('.mp4'));
                        if (vidFile) await sock.sendMessage(from, { video: await fsPromises.readFile(vidFile), caption: 'Done' }, { quoted: msg });
                        else throw new Error('Video Failed');
                    } else {
                        const imgFile = files.find(x => x.startsWith(fMedia) && (x.endsWith('.jpg') || x.endsWith('.png') || x.endsWith('.webp')));
                        if (imgFile) await sock.sendMessage(from, { image: await fsPromises.readFile(imgFile), caption: 'Done' }, { quoted: msg });
                        else throw new Error('Photo Failed');
                    }
                    await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });

                } catch (e) {
                    console.error('[MEDIA ERROR]', e.message);
                    await sock.sendMessage(from, { text: '❌ Gagal Download.' }, { quoted: msg });
                } finally {
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
                }
                break;

            // --- TOIMG (RESTORED & UPGRADED: Spawn + Async) ---
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
                    // Convert pakai spawn (aman)
                    await spawnPromise('ffmpeg', ['-i', fWebp, fPng, '-y']);

                    await sock.sendMessage(from, { image: await fsPromises.readFile(fPng), caption: 'Done' }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Gagal konversi.' }, { quoted: msg });
                } finally {
                    await fsPromises.unlink(fWebp).catch(()=>{});
                    await fsPromises.unlink(fPng).catch(()=>{});
                }
                break;

            // --- SAY / VN (UPGRADED: V3 Alpha + Lang Tag) ---
            case '.say':
            case '.vn':
                if (!args[0]) return sock.sendMessage(from, { text: 'Format: .say <lang> <teks>' }, { quoted: msg });
                if (!process.env.ELEVENLABS_API_KEY) return sock.sendMessage(from, { text: '❌ API Key Missing' }, { quoted: msg });
                await sock.sendMessage(from, { react: { text: "🗣️", key: msg.key } });

                const fTTS = `tts_${Date.now()}`;
                const mp3Path = `./${fTTS}.mp3`;
                const opusPath = `./${fTTS}.opus`;

                try {
                    let targetLang = 'id';
                    let textRaw = '';

                    // Smart Lang Detect
                    if (args[0].length === 2 && /^[a-zA-Z]{2}$/.test(args[0])) {
                        targetLang = args[0].toLowerCase();
                        textRaw = args.slice(1).join(' ');
                    } else {
                        textRaw = args.join(' ');
                    }

                    if (!textRaw) return sock.sendMessage(from, { text: 'Mana teksnya?' }, { quoted: msg });

                    const textToSpeech = await fungsiTranslate(textRaw, targetLang);
                    const voiceId = process.env.ELEVENLABS_VOICE_ID || 'plgKUYgnlZ1DCNh54DwJ'; 

                    // API REQUEST V3
                    const response = await axios({
                        method: 'post',
                        url: `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
                        data: {
                            text: textToSpeech,
                            model_id: "eleven_v3", // V3 ALPHA
                            voice_settings: { 
                                stability: 0.5, 
                                similarity_boost: 0.75,
                                use_speaker_boost: true
                                // NO STYLE HERE
                            }
                        },
                        headers: {
                            'Accept': 'audio/mpeg',
                            'xi-api-key': process.env.ELEVENLABS_API_KEY,
                            'Content-Type': 'application/json',
                        },
                        responseType: 'arraybuffer'
                    });

                    await fsPromises.writeFile(mp3Path, response.data);
                    await spawnPromise('ffmpeg', ['-i', mp3Path, '-c:a', 'libopus', opusPath, '-y']);

                    await sock.sendMessage(from, { 
                        audio: await fsPromises.readFile(opusPath), 
                        mimetype: 'audio/ogg; codecs=opus', 
                        ptt: true 
                    }, { quoted: msg });
                    
                    await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });

                } catch (e) {
                    console.log(e.response?.data);
                    await sock.sendMessage(from, { text: '❌ Gagal TTS.' }, { quoted: msg });
                } finally {
                    await fsPromises.unlink(mp3Path).catch(()=>{});
                    await fsPromises.unlink(opusPath).catch(()=>{});
                }
                break;

            // --- MOVIE (UPGRADED: Env + Valid Poster) ---
            case '.movie':
                if (!args[0]) return;
                await sock.sendMessage(from, { react: { text: "🎬", key: msg.key } });
                try {
                    const q = args.join(' ');
                    const key = process.env.OMDB_API_KEY;
                    if (!key) return sock.sendMessage(from, { text: '❌ API Key Missing' }, { quoted: msg });

                    const id = await smartSearchIMDb(q);
                    const url = id ? `http://www.omdbapi.com/?i=${id}&apikey=${key}&plot=full` : `http://www.omdbapi.com/?t=${q.replace(/ /g, '+')}&apikey=${key}&plot=full`;

                    const { data } = await axios.get(url);
                    if (data.Response === 'True') {
                        const poster = await getValidPosterUrl(data.Poster);
                        const sinopsis = await fungsiTranslate(data.Plot, 'id');
                        const txt = `🎬 *${data.Title}*\n⭐ ${data.imdbRating}\n📅 ${data.Year}\n\n📝 ${sinopsis}`;
                        await sock.sendMessage(from, { image: { url: poster }, caption: txt }, { quoted: msg });
                    } else {
                        await sock.sendMessage(from, { text: '❌ Not Found.' }, { quoted: msg });
                    }
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Error.' }, { quoted: msg });
                }
                break;
            
            // --- ANIME (RESTORED) ---
            case '.anime':
                // (Sama seperti logika lama tapi dibungkus try catch yg rapi)
                if (!args[0]) return sock.sendMessage(from, { text: 'Judul anime?' }, { quoted: msg });
                await sock.sendMessage(from, { react: { text: "⛩️", key: msg.key } });
                try {
                    const { data } = await axios.get(`https://api.jikan.moe/v4/anime?q=${args.join(' ')}&limit=1`);
                    if (data.data && data.data.length > 0) {
                        const anime = data.data[0];
                        const img = anime.images.webp?.large_image_url || anime.images.jpg?.large_image_url;
                        const sinopsis = await fungsiTranslate(anime.synopsis || '-', 'id');
                        const txt = `⛩️ *${anime.title}*\n⭐ ${anime.score}\neps: ${anime.episodes}\n\n${sinopsis}`;
                        await sock.sendMessage(from, { image: { url: img }, caption: txt }, { quoted: msg });
                        await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });
                    } else {
                        await sock.sendMessage(from, { text: '❌ Not Found' }, { quoted: msg });
                    }
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Error API' }, { quoted: msg });
                }
                break;
        }

    } catch (err) {
        console.error('[FATAL ERROR]', err);
    } finally {
        if (isHeavyCommand && activeProcesses > 0) activeProcesses--;
    }
};
