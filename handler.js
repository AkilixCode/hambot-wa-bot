const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { exec } = require('child_process');
const fs = require('fs');
const axios = require('axios');
const sharp = require('sharp');
const os = require('os');

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const namaOwner = 'Ilham';
const namaBot = 'HamBot';

let activeProcesses = 0;
const MAX_PROCESSES = 3;
const userCooldowns = new Map();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
];
const getRandomUA = () => userAgents[Math.floor(Math.random() * userAgents.length)];

function formatSize(bytes) {
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + " GB";
    else if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + " MB";
    else if (bytes >= 1024) return (bytes / 1024).toFixed(2) + " KB";
    else return bytes + " bytes";
}


async function getBrowser() {
    return await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox', '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas',
            '--window-size=1920,1080',
            '--disable-blink-features=AutomationControlled'
        ]
    });
}


async function downloadMedia(message, type) {
    const stream = await downloadContentFromMessage(message, type);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }
    return buffer;
}

// ==========================================
// 🛠️ HELPER FUNCTIONS (TARUH DI ATAS)
// ==========================================

// 1. SMART SEARCH V2 (Lebih Pintar & Teliti)
async function smartSearchIMDb(query) {
    try {
        // Kita cari "site:imdb.com/title" biar spesifik ke halaman film utama
        const url = `https://html.duckduckgo.com/html/?q=site:imdb.com/title ${encodeURIComponent(query)}`;
        const { data } = await axios.get(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        
        // Regex untuk menangkap ID (tt1234567) dari href link
        // Kita cari yang formatnya /title/ttxxxxxxx/ (tanpa sub-path lain biar dapet main title)
        const idMatch = data.match(/\/title\/(tt\d{6,10})\/?/);
        
        if (idMatch && idMatch[1]) {
            console.log(`[SMART SEARCH] ${query} -> ID: ${idMatch[1]}`);
            return idMatch[1]; 
        }
        return null;
    } catch (e) {
        console.log(`[SMART SEARCH ERROR] ${e.message}`);
        return null;
    }
}

// 2. IMAGE VALIDATOR (Anti-Crash)
// Fungsi ini mengecek apakah link gambar hidup (200 OK) atau mati (404)
async function getValidPosterUrl(originalUrl) {
    if (!originalUrl || originalUrl === 'N/A') return 'https://via.placeholder.com/600x900?text=No+Poster';

    // Opsi 1: Coba bikin URL HD (SX2000)
    // Amazon URL biasanya punya pola: ...M@._V1_SX300.jpg
    // Kita ubah jadi: ...M@._V1_SX2000.jpg
    const hdUrl = originalUrl.replace(/\._V1_.*\.jpg$/i, '._V1_SX2000.jpg');

    try {
        // Kita "Ping" dulu link HD-nya (HEAD request)
        await axios.head(hdUrl, { timeout: 2000 });
        return hdUrl; // Kalau sukses (tidak error), kembalikan link HD
    } catch (e) {
        // Kalau link HD error (404 Not Found), kembalikan link ASLI (SD)
        // Setidaknya user masih dapet gambar walaupun resolusi biasa
        console.log(`[POSTER] HD tidak tersedia, fallback ke SD.`);
        return originalUrl;
    }
}

// 3. TRANSLATE MANUAL (No Library)
async function fungsiTranslate(text, targetLang = 'id') {
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
        const { data } = await axios.get(url);
        return data[0].map(x => x[0]).join(''); 
    } catch (e) {
        return text;
    }
}

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
        
        // Anti Spam Simple
        if (userCooldowns.has(sender)) {
             if (Date.now() - userCooldowns.get(sender) < 2000) return;
        }
        userCooldowns.set(sender, Date.now());

        // Manajemen Proses
        isHeavyCommand = ['.pinterest', '.photo', '.video', '.music'].includes(command);
        if (isHeavyCommand) {
            if (activeProcesses >= MAX_PROCESSES) {
                return sock.sendMessage(from, { text: `⚠️ Server penuh (${activeProcesses}/${MAX_PROCESSES}). Tunggu sebentar...` }, { quoted: msg });
            }
            activeProcesses++;
        }

        switch (command) {
            case '.intro':
            case '.menu':
            case '.help':
                const menuText =
`🤖 *${namaBot} Dashboard*
_Powered By My PC_

*MEDIA DOWNLOADER*
• *.music <judul/url>*
  Download lagu MP3 (YT/Soundcloud/dll).
  _Contoh: .music Bound2 Kanye West_
• *.photo <url>*
  Download Foto HD BETA.
• *.video <url>*
  Download Video kualitas tinggi.
• *.pinterest <search>*
  Mencari Gambar di Pinterest

*UTILITIES*
• *.sticker*
  Buat stiker dari gambar (Kirim/Reply).
• *.tagall*
  Tag semua member (Khusus Admin).
• *.gempa*
  Info Gempa Terkini.
• *.say <teks>*
  Text to speech.
• *.toimg*
  Mengubah Stiker Menjadi Gambar.
• *.movie <judul>*
  Rating dan info film/series.
• *.anime <judul>*
  Rating dan info anime.

*SPAM TOOLS*
• *.spam group <target> <jml> <pesan>*
• *.spam private <target> <jml> <pesan>*
  _Contoh: .spam group @ilham 5 WOI!_

*SERVER INFO*
• *.ping* (Cek Spek & Sinyal)
• *.info* (Cek Info Grup)

_2025 © ${namaOwner}_`.trim();
                await sock.sendMessage(from, { text: menuText }, { quoted: msg });
                break;

            // --- command: PING ---
            case '.ping':
                await sock.sendMessage(from, { react: { text: "💻", key: msg.key } });
                const start = Date.now();
                const cpus = os.cpus();
                const totalMem = os.totalmem();
                const freeMem = os.freemem();
                const uptime = os.uptime();
                const loadAvg = os.loadavg(); 
                const botMem = process.memoryUsage().rss; 

                exec('ping -c 4 70.153.80.13', async (error, stdout, stderr) => {
                    const latensi = Date.now() - start;
                    const output = stdout || "";

                    const lossMatch = output.match(/(\d+)% packet loss/);
                    const packetLoss = lossMatch ? lossMatch[1] + "%" : "Unknown";

                    const rttMatch = output.match(/rtt min\/avg\/max\/mdev = ([\d\.]+)\/([\d\.]+)\/([\d\.]+)\/([\d\.]+) ms/);
                    let rttStats = "N/A";
                    if (rttMatch) {
                        rttStats = `Min: ${rttMatch[1]}ms | Avg: ${rttMatch[2]}ms | Max: ${rttMatch[3]}ms`;
                    }

                    const date = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

                    const txtPing = 
`💻 *SERVER TECHNICAL REPORT* 💻

*HARDWARE STATUS*
• Host: ${os.hostname()}
• OS: ${os.type()} (${os.arch()})
• CPU: ${cpus[0].model} (${cpus.length} Cores)
• RAM Usage: ${formatSize(totalMem - freeMem)} / ${formatSize(totalMem)}
• Bot Usage: ${formatSize(botMem)} (RSS)
• Load Avg: ${loadAvg[0].toFixed(2)} (1m), ${loadAvg[1].toFixed(2)} (5m)

*NETWORK METRICS (70.153.80.13)*
• Est. Latency: ${latensi}ms
• Packet Loss: ${packetLoss}
• RTT Stats:
_${rttStats}_

*UPTIME*
⏱️ ${(uptime / 3600).toFixed(2)} Hours
📅 ${date}`.trim();

                    await sock.sendMessage(from, { text: txtPing }, { quoted: msg });
                });
                break;

            // --- command: INFO GRUP ---
            case '.info':
                if (!isGroup) return sock.sendMessage(from, { text: '❌ Khusus Grup!' }, { quoted: msg });
                
                const meta = await sock.groupMetadata(from);
                const admins = meta.participants.filter(p => p.admin).length;
                const creation = new Date(meta.creation * 1000).toLocaleDateString('id-ID');
                
                const isRestricted = meta.restrict ? "Yes (Admin Only)" : "No (All Members)";
                const isAnnounce = meta.announce ? "Yes (Admin Only)" : "No (All Members)";
                const ephemeral = meta.ephemeralDuration ? `${meta.ephemeralDuration / 86400} Hari` : "Off";
                const owner = meta.owner || meta.subjectOwner || "N/A";

                const txtInfo = 
`📋 *GROUP METADATA* 📋

*IDENTITY*
• ID: ${meta.id}
• Subject: ${meta.subject}
• Creator: @${owner.split('@')[0]}
• Created: ${creation}

*PARTICIPANTS*
• Total: ${meta.participants.length}
• Admins: ${admins}

*CONFIGURATION*
• Edit Info Locked: ${isRestricted}
• Send Msg Locked: ${isAnnounce}
• Disappearing Msg: ${ephemeral}`.trim();

                await sock.sendMessage(from, { text: txtInfo, mentions: [owner] }, { quoted: msg });
                break;

            // --- command: PINTEREST (TIDAK DIUBAH) ---
            case '.pinterest':
            case '.pin':
                if (!args[0]) return sock.sendMessage(from, { text: 'Cari apa?' }, { quoted: msg });
                await sock.sendMessage(from, { react: { text: "📌", key: msg.key } });

                let browser;
                try {
                    browser = await getBrowser();
                    const input = args.join(' ');
                    const page = await browser.newPage();
                    await page.setViewport({ width: 1920, height: 1080 });
                    await page.setUserAgent(getRandomUA());
                    
                    let targetUrl = input.startsWith('http') ? input : `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(input)}`;
                    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

                    // Scroll Logic
                    await page.evaluate(async () => {
                        await new Promise((resolve) => {
                            let totalHeight = 0;
                            const distance = 100;
                            const timer = setInterval(() => {
                                window.scrollBy(0, distance);
                                totalHeight += distance;
                                if(totalHeight >= 4000){ clearInterval(timer); resolve(); }
                            }, 50);
                        });
                    });
                    await sleep(1500);

                    const scrapedUrls = await page.evaluate(() => {
                        const results = [];
                        const images = document.querySelectorAll('img');
                        for (let img of images) {
                            if (img.src && img.src.includes('236x') && img.naturalWidth > 150) {
                                results.push(img.src.replace(/236x/, 'originals'));
                            }
                        }
                        return results;
                    });
                    
                    await browser.close();
                    browser = null;

                    const uniqueUrls = [...new Set(scrapedUrls)];
                    const finalUrls = shuffleArray(uniqueUrls).slice(0, 4);

                    if (finalUrls.length > 0) {
                        for (let i = 0; i < finalUrls.length; i++) {
                            try {
                                const buff = await axios.get(finalUrls[i], { responseType: 'arraybuffer' });
                                await sock.sendMessage(from, { 
                                    image: buff.data, 
                                    caption: `📌 Pinterest (${i+1}): ${input}` 
                                }, { quoted: msg });
                            } catch (e) { }
                        }
                        await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });
                    } else {
                        throw new Error('Gambar tidak ditemukan.');
                    }
                } catch (e) {
                    if (browser) await browser.close();
                    await sock.sendMessage(from, { text: `❌ Gagal: ${e.message}` }, { quoted: msg });
                }
                break;

            // --- command: MUSIC  ---
            case '.music': {
                if (!args[0]) return sock.sendMessage(from, { text: 'Judul?' }, { quoted: msg });
                await sock.sendMessage(from, { react: { text: "🎵", key: msg.key } });

                const qMusic = args.join(' ');
                const fMusic = `music_${Date.now()}`;
                const src = qMusic.startsWith('http') ? qMusic : `ytsearch1:${qMusic}`;
                
                console.log(`[MUSIC] 🚀 Download via WARP (Android Mode): ${qMusic}`);

                //Proxy and network
                const cmdMusic = `yt-dlp "${src}" -x --audio-format mp3 --audio-quality 0 -o "${fMusic}.%(ext)s" --no-playlist --proxy "socks5://100.93.38.17:1080" --extractor-args "youtube:player_client=android" --force-ipv4 --no-warnings`;

                exec(cmdMusic, async (err, stdout, stderr) => {
                    if (err) console.log(`❌ [MUSIC ERROR]: ${err.message}`);
                    
                    const f = fs.readdirSync('./').find(x => x.startsWith(fMusic) && x.endsWith('.mp3'));
                    if (f) {
                        await sock.sendMessage(from, { audio: fs.readFileSync(f), mimetype: 'audio/mp4', caption: `🎵 ${qMusic}` }, { quoted: msg });
                        fs.unlinkSync(f);
                        await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });
                    } else {
                        console.log("Gagal Download Music. Cek koneksi WARP.");
                        await sock.sendMessage(from, { text: '❌ Gagal Download (Server Busy).' }, { quoted: msg });
                    }
                });
                break;
            }

            // --- command: PHOTO & VIDEOS ---
            case '.photo':
            case '.video':
                if (!args[0]) return;
                await sock.sendMessage(from, { react: { text: "⏳", key: msg.key } });
                const fMedia = `media_${Date.now()}`;
                const isVid = command === '.video';
                
                console.log(`[MEDIA] 🚀 Download via WARP: ${args[0]}`);

                // Update Logic: Tambahkan Proxy & Client Spoofing ke kedua perintah
                // Cari variable cmd di case .photo / .video
            let cmd = isVid ? 
                    `yt-dlp "${args[0]}" -o "${fMedia}.mp4" --max-filesize 100M --proxy "socks5://100.93.38.17:1080" --extractor-args "youtube:player_client=android" --force-ipv4 --no-warnings` : 
                    `yt-dlp "${args[0]}" -o "${fMedia}" --write-thumbnail --skip-download --convert-thumbnails jpg --proxy "socks5://100.93.38.17:1080" --extractor-args "youtube:player_client=android" --force-ipv4 --no-warnings`;
                
                exec(cmd, async (err, stdout, stderr) => {
                    if (err) console.log(`❌ [MEDIA ERROR]: ${err.message}`);

                    if (isVid && fs.existsSync(`${fMedia}.mp4`)) {
                        await sock.sendMessage(from, { video: fs.readFileSync(`${fMedia}.mp4`), caption: 'Done' }, { quoted: msg });
                        fs.unlinkSync(`${fMedia}.mp4`);
                        await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });
                    } else {
                        const f = fs.readdirSync('./').find(x => x.startsWith(fMedia) && (x.endsWith('.jpg') || x.endsWith('.png') || x.endsWith('.webp')));
                        if (f) {
                            await sock.sendMessage(from, { image: fs.readFileSync(f), caption: 'Done' }, { quoted: msg });
                            fs.unlinkSync(f);
                            await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });
                        } else {
                            await sock.sendMessage(from, { text: '❌ Gagal (Link Private/Salah/Block).' }, { quoted: msg });
                        }
                    }
                    // Bersih-bersih file sisa
                    const sisa = fs.readdirSync('./');
                    sisa.forEach(x => { if(x.startsWith(fMedia)) fs.unlinkSync(x) });
                });
                break;

            // --- command: TAGALL ---
            case '.tagall':
                if (!isGroup) return sock.sendMessage(from, { text: '❌ Khusus Grup!' }, { quoted: msg });
                const groupMetadataTag = await sock.groupMetadata(from);
                let teksTag = `⚠️ *Tag All Members*\nTotal: ${groupMetadataTag.participants.length}\n\n`;
                let mentionsTag = [];
                for (let mem of groupMetadataTag.participants) {
                    teksTag += `@${mem.id.split('@')[0]}\n`;
                    mentionsTag.push(mem.id);
                }
                await sock.sendMessage(from, { text: teksTag, mentions: mentionsTag }, { quoted: msg });
                break;

            // --- command: STICKER ---
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

            // --- command: SPAM ---
            case '.spam':
                if (args.length < 4) return;
                let mode = args[0], trg = args[1], jml = parseInt(args[2]), txt = args.slice(3).join(' ');
                let jid = null;
                const mSpam = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
                
                if (mSpam && mSpam.length > 0) jid = mSpam[0];
                else {
                    let n = trg.replace(/[^0-9]/g, '');
                    if (n.startsWith('08')) n = '62' + n.slice(1);
                    if (n.length > 6) jid = n + '@s.whatsapp.net';
                }

                for(let i=0; i<jml; i++) {
                    if (mode==='private' && jid) await sock.sendMessage(jid, { text: txt });
                    else await sock.sendMessage(from, { text: txt, mentions: jid ? [jid] : [] });
                    await sleep(200);
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

            // --- command: STICKER TO IMAGE ---
            case '.toimg':
                if (!msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage) {
                    return sock.sendMessage(from, { text: '❌ Reply stikernya ketik .toimg' }, { quoted: msg });
                }
                await sock.sendMessage(from, { react: { text: "🖼️", key: msg.key } });
                
                try {
                    const qSticker = msg.message.extendedTextMessage.contextInfo.quotedMessage.stickerMessage;
                    const bufSticker = await downloadMedia(qSticker, 'sticker');
                    const fWebp = `sticker_${Date.now()}.webp`;
                    const fPng = `sticker_${Date.now()}.png`;

                    fs.writeFileSync(fWebp, bufSticker);

                    // Konversi Webp ke PNG pakai FFmpeg
                    exec(`ffmpeg -i ${fWebp} ${fPng}`, async (err) => {
                        fs.unlinkSync(fWebp); // Hapus file mentah
                        if (err) return sock.sendMessage(from, { text: '❌ Gagal konversi.' }, { quoted: msg });

                        await sock.sendMessage(from, { image: fs.readFileSync(fPng), caption: 'Nih gambarnya' }, { quoted: msg });
                        fs.unlinkSync(fPng); // Bersih-bersih
                    });
                } catch (e) {
                    console.log(e);
                }
                break;

                
// --- command: ELEVENLABS v3 (FIXED & FALLBACK) ---
            case '.say':
            case '.vn': 
                if (!args[0]) return sock.sendMessage(from, { text: 'Format: .say <kode_bahasa> <teks>\nContoh: .say id [screaming] Tolong aku!!' }, { quoted: msg });
                await sock.sendMessage(from, { react: { text: "🧪", key: msg.key } });

                try {
                    // --- 1. PARSING & SMART TRANSLATE ---
                    let targetLang = "id"; 
                    let textRaw = "";

                    if (args[0].length === 2) {
                        targetLang = args[0];
                        textRaw = args.slice(1).join(' ');
                    } else {
                        textRaw = args.join(' ');
                    }

                    // Pisahkan Tag Audio (Inggris) vs Teks (Translate)
                    const regexTag = /(\[.*?\])/g; 
                    const parts = textRaw.split(regexTag); 
                    let finalArray = [];
                    let hasExpressiveTag = false;

                    for (let part of parts) {
                        if (regexTag.test(part)) {
                            finalArray.push(part); 
                            hasExpressiveTag = true; 
                        } else if (part.trim() !== "") {
                            const translatedPart = await fungsiTranslate(part, targetLang);
                            finalArray.push(translatedPart);
                        }
                    }

                    const textToSpeech = finalArray.join(' ');
                    console.log(`[ELEVEN] Prompt: ${textToSpeech}`);

                    // --- 2. CONFIG: DUAL ENGINE (v3 Alpha -> Fallback v2) ---
                    const elApiKey = 'sk_2249b7b757dfdc35339e6aab044b051e2dd5e558fc6176dd'; 
                    const voiceId = 'plgKUYgnlZ1DCNh54DwJ'; // Adam
                    
                    // FUNGSI REQUEST SUARA (Bisa dipakai ulang buat fallback)
                    const generateVoice = async (modelId, stabilityVal, useStyle) => {
                        const voiceSettings = {
                            stability: stabilityVal, 
                            similarity_boost: 0.75,
                            use_speaker_boost: true
                        };

                        // HANYA pasang 'style' kalau modelnya v2. 
                        // v3 dan Turbo TIDAK support 'style', ini yang bikin error 400 kemarin.
                        if (useStyle) {
                            voiceSettings.style = 0.0; // Default style
                        }

                        return await axios({
                            method: 'post',
                            url: `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
                            data: {
                                text: textToSpeech,
                                model_id: modelId,
                                voice_settings: voiceSettings
                            },
                            headers: {
                                'Accept': 'audio/mpeg',
                                'xi-api-key': elApiKey,
                                'Content-Type': 'application/json',
                            },
                            responseType: 'arraybuffer'
                        });
                    };

                    let response;
                    
                    try {
                        // PERCOBAAN 1: Pakai v3 (Alpha)
                        // Setting: Stability 0.5 (Aman), TANPA Style
                        console.log("Mencoba ElevenLabs v3...");
                        response = await generateVoice("eleven_v3", 0.5, false);
                    
                    } catch (errV3) {
                        console.log(`[v3 Gagal] Error: ${errV3.response?.status || errV3.message}. Fallback ke v2...`);
                        
                        // PERCOBAAN 2 (FALLBACK): Pakai Multilingual v2 (Stabil)
                        // Kalau v3 error 400/404, kita pakai v2 biar bot tetep jalan
                        response = await generateVoice("eleven_multilingual_v2", 0.5, true);
                    }

                    // --- 3. KONVERSI & KIRIM ---
                    const namaFile = Date.now();
                    const mp3Path = `./${namaFile}.mp3`;
                    const opusPath = `./${namaFile}.opus`;

                    fs.writeFileSync(mp3Path, response.data);

                    exec(`ffmpeg -i ${mp3Path} -c:a libopus ${opusPath}`, async (err) => {
                        fs.unlinkSync(mp3Path);

                        if (err) {
                            console.log('FFmpeg Error:', err);
                            return sock.sendMessage(from, { text: '❌ Gagal konversi audio.' }, { quoted: msg });
                        }

                        await sock.sendMessage(from, { 
                            audio: fs.readFileSync(opusPath), 
                            mimetype: 'audio/ogg; codecs=opus', 
                            ptt: true 
                        }, { quoted: msg });

                        fs.unlinkSync(opusPath); 
                        await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });
                    });

                } catch (e) {
                    console.log(e);
                    if (e.response && e.response.status === 401) {
                         await sock.sendMessage(from, { text: '❌ Kuota ElevenLabs Habis / Key Salah.' }, { quoted: msg });
                    } else {
                         await sock.sendMessage(from, { text: '❌ Gagal generate suara (Server Sibuk/Error).' }, { quoted: msg });
                    }
                }
                break;

// --- Helper Function: Translate Manual (Tanpa Library) ---
            
            async function fungsiTranslate(text, targetLang = 'id') {
                try {
                    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
                    const { data } = await axios.get(url);
                    // Google ngasih respon berantakan (array of array), kita susun ulang
                    return data[0].map(x => x[0]).join(''); 
                } catch (e) {
                    return text; // Kalau gagal, biarin bahasa inggris
                }
            }


// --- command: RATING MOVIE/SERIES (Versi Anti-Crash + Validasi Gambar) ---
            case '.rating':
            case '.movie':
                if (!args[0]) return sock.sendMessage(from, { text: 'Judul film/series?' }, { quoted: msg });
                await sock.sendMessage(from, { react: { text: "🔍", key: msg.key } });

                try {
                    const queryMovie = args.join(' '); 
                    const apikey = '5dd480d1'; // <-- JANGAN LUPA KEY!
                    
                    // LANGKAH 1: Cari ID via Smart Search V2
                    let imdbId = await smartSearchIMDb(queryMovie);
                    
                    let urlOMDb;
                    if (imdbId) {
                        urlOMDb = `http://www.omdbapi.com/?i=${imdbId}&apikey=${apikey}&plot=full`;
                    } else {
                        urlOMDb = `http://www.omdbapi.com/?t=${queryMovie.replace(/ /g, '+')}&apikey=${apikey}&plot=full`;
                    }

                    // LANGKAH 2: Ambil Data OMDb
                    const { data } = await axios.get(urlOMDb);

                    if (data.Response === 'True') {
                        // LANGKAH 3: VALIDASI GAMBAR (CRUCIAL FIX)
                        // Bot akan mengecek dulu apakah link HD bisa dibuka.
                        // Kalau tidak, dia otomatis pakai link biasa. Gak bakal error stream lagi.
                        const validPosterUrl = await getValidPosterUrl(data.Poster);

                        // LANGKAH 4: Translate & Formatting
                        const sinopsisIndo = await fungsiTranslate(data.Plot, 'id');
                        const graphLink = `https://www.google.com/search?q=site:seriesgraph.com+${data.Title.replace(/ /g, '+')}`;

                        let captionMovie = 
`🎬 *IMDb MOVIE INFO* 🎬

🎥 *Judul:* ${data.Title}
📆 *Rilis:* ${data.Year}
⭐ *Rating:* ${data.imdbRating}/10 (${data.imdbVotes} votes)
⏱️ *Durasi:* ${data.Runtime}
🎭 *Genre:* ${data.Genre}
🏆 *Awards:* ${data.Awards}

📊 *Info Rating Per Episode:*
${data.Type === 'series' ? graphLink : '_Khusus Series/TV Show_'}

📝 *Sinopsis (ID):*
${sinopsisIndo}

_Powered by OMDb API & Smart Search_`;

                        // Kirim pesan (sekarang aman karena URL sudah divalidasi)
                        await sock.sendMessage(from, { image: { url: validPosterUrl }, caption: captionMovie }, { quoted: msg });
                        await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });

                    } else {
                        // Fallback kalau Smart Search gagal, kasih saran pakai .anime
                        await sock.sendMessage(from, { text: '❌ Film tidak ditemukan. Jika ini Anime, coba pakai command *.anime* biar lebih akurat.' }, { quoted: msg });
                    }
                } catch (e) {
                    console.log(e);
                    await sock.sendMessage(from, { text: '❌ Error sistem.' }, { quoted: msg });
                }
                break;

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

        }
    } catch (err) { console.log(err); } 
    finally {
        if (isHeavyCommand && activeProcesses > 0) activeProcesses--;
    }
};
