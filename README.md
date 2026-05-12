# HamBot - Advanced WhatsApp Bot 🤖

Bot WhatsApp canggih yang dibangun dengan Baileys, dilengkapi dengan fitur download media, text-to-speech AI, referensi jaringan, dan banyak lagi. Semua dalam **Bahasa Indonesia**!

## 🚀 Fitur Utama

### 🎵 Media Downloader
- **Music Download** - Cari dan download lagu dari YouTube
- **Video Download** - Download video dari berbagai platform (TikTok, Instagram, Facebook, dll)
- **Pinterest Search** - Cari gambar estetik dan inspirasi

### 🛠️ Creative Tools
- **Sticker Maker** - Ubah gambar jadi stiker WhatsApp
- **Image Converter** - Ubah stiker kembali jadi gambar
- **Text-to-Speech** - Buat voice message dengan AI (ElevenLabs)
- **QR Generator** - Buat QR code dari teks

### 🎬 Entertainment & Info
- **Movie Info** - Dapatkan rating dan info film dari OMDb
- **Gempa Info** - Data gempa real-time dari BMKG
- **Cuaca** - Cek cuaca lokasi manapun
- **Kutipan Inspirasional** - 300+ kutipan dalam Bahasa Indonesia
- **Fakta Menarik** - 100+ fakta unik termasuk fakta Indonesia
- **Meme Indonesia** - Meme dari subreddit r/indonesia

### 🖥️ Teknikal & Networking
- **Network Reference** - 20+ topik networking lengkap dalam Bahasa Indonesia:
  - Model OSI 7 Layer & TCP/IP
  - Panduan Subnetting lengkap
  - Protokol Jaringan
  - Routing & Gateway
  - VLAN, NAT, DHCP, VPN
  - IPv6, Firewall, ACL
  - Troubleshooting Guide
- **Subnet Calculator** - Hitung subnet dari IP/CIDR
- **IP Info** - Lookup informasi alamat IP
- **DNS Lookup** - Query DNS untuk domain
- **Port Reference** - Database port umum

### 👥 Group Management
- **Tag All** - Mention semua member grup
- **Group Info** - Lihat statistik dan metadata grup

### ⚡ Performance Features
- **Smart Caching** - Cache otomatis untuk respon lebih cepat
- **Rate Limiting** - Throttling per-user untuk stabilitas
- **Queue Management** - Handle operasi concurrent dengan efisien
- **Browser Pooling** - Reuse browser instance untuk scraping
- **Memory Optimization** - Cleanup dan garbage collection otomatis

## 📋 Daftar Perintah

### Umum
| Perintah | Deskripsi |
|----------|-----------|
| `.menu` | Menampilkan daftar perintah |
| `.menu <kategori>` | Lihat perintah dalam kategori |
| `.menu <perintah>` | Lihat detail perintah |
| `.ping` | Cek status bot |

### Media
| Perintah | Deskripsi |
|----------|-----------|
| `.music <nama lagu>` | Download musik |
| `.video <url>` | Download video |
| `.pinterest <query>` | Cari gambar Pinterest |
| `.sticker` | Ubah gambar jadi stiker |
| `.toimg` | Ubah stiker jadi gambar |

### Entertainment
| Perintah | Deskripsi |
|----------|-----------|
| `.quote` | Kutipan inspirasional Indonesia |
| `.fact` | Fakta menarik dalam Bahasa Indonesia |
| `.meme` | Meme Indonesia dari Reddit |
| `.rps` | Main batu gunting kertas |
| `.dice` | Lempar dadu |
| `.8ball` | Tanya bola ajaib |

### Teknikal
| Perintah | Deskripsi |
|----------|-----------|
| `.netinfo` | Referensi jaringan lengkap |
| `.netinfo osi` | Model OSI 7 Layer |
| `.netinfo subnetting` | Panduan subnet |
| `.netinfo protokol` | Protokol jaringan |
| `.netinfo routing` | Routing & gateway |
| `.netinfo troubleshoot` | Troubleshooting guide |
| `.subnet <IP/CIDR>` | Kalkulator subnet |
| `.ipinfo <IP>` | Info alamat IP |
| `.dns <domain>` | DNS lookup |
| `.port <nomor>` | Info port jaringan |

### Informasi
| Perintah | Deskripsi |
|----------|-----------|
| `.movie <judul>` | Info film dari OMDb |
| `.gempa` | Info gempa terbaru dari BMKG |
| `.weather <lokasi>` | Info cuaca |
| `.wiki <query>` | Cari di Wikipedia |
| `.crypto <coin>` | Harga cryptocurrency |

### Grup
| Perintah | Deskripsi |
|----------|-----------|
| `.tagall` | Tag semua member |
| `.info` | Info grup |

## 🔧 Instalasi

### Prasyarat
- Node.js 16+
- npm atau yarn
- Akun WhatsApp
- Koneksi internet

### Langkah Instalasi

1. **Clone repository**
```bash
git clone https://github.com/AkilixCode/hambot-wa-bot.git
cd hambot-wa-bot
```

2. **Install dependencies**
```bash
npm install
```

3. **Install external tools** (untuk fitur media)
```bash
# Install yt-dlp
pip install yt-dlp
# ATAU download dari: https://github.com/yt-dlp/yt-dlp/releases

# Install FFmpeg
# Ubuntu/Debian:
sudo apt install ffmpeg
# macOS:
brew install ffmpeg
# Windows: Download dari https://ffmpeg.org/download.html
```

4. **Konfigurasi environment**
```bash
cp .env.example .env
# Edit .env dengan API keys dan settings kamu
```

5. **Jalankan bot**
```bash
npm start
```

6. **Scan QR Code**
Buka WhatsApp di HP dan scan QR code yang muncul di terminal.

## 🐳 Setup Menggunakan Docker (Rekomendasi)

Menjalankan HamBot menggunakan Docker adalah cara termudah dan paling aman. Docker secara otomatis menginstal Node.js, Python, FFmpeg, Chromium, dan semua dependensi sistem yang dibutuhkan tanpa mengotori server/komputer asli Anda.

### Prasyarat Docker
- [Docker](https://docs.docker.com/get-docker/) terinstall
- [Docker Compose](https://docs.docker.com/compose/install/) terinstall

### Langkah Setup Docker dari Awal (Zero to Hero)

**1. Clone Repository & Masuk ke Folder**
```bash
git clone https://github.com/AkilixCode/hambot-wa-bot.git
cd hambot-wa-bot
```

**2. Siapkan File Konfigurasi (.env)**
Gandakan template konfigurasi yang sudah disediakan:
```bash
cp .env.example .env
```
Buka file `.env` (bisa pakai `nano .env` di Linux atau Notepad di Windows) dan isikan informasi penting seperti `BOT_OWNER_ID` dan API Keys.

**3. Build & Jalankan Container di Background**
Jalankan perintah ini (mungkin butuh `sudo` di Linux). Ini akan mendownload semua kebutuhan dan memakan waktu sekitar 5-10 menit saat pertama kali dijalankan:
```bash
docker compose up -d
```

**4. Scan QR Code WhatsApp**
Setelah container berjalan, lihat logs untuk mendapatkan QR Code:
```bash
docker compose logs -f
```
Scan QR code tersebut dari HP yang akan dijadikan bot (WhatsApp -> Tautkan Perangkat). Jika berhasil, akan muncul tulisan "Bot successfully connected". 
Tekan `Ctrl+C` untuk keluar dari logs (bot tetap berjalan di background).

### Perintah Penting Docker

- **Melihat Log**: `docker compose logs -f`
- **Menghentikan Bot**: `docker compose down`
- **Menjalankan Kembali**: `docker compose up -d`
- **Update & Build Ulang**: (Jika ada update kode baru)
  ```bash
  git pull
  docker compose up -d --build
  ```

*Catatan: Sesi login WhatsApp (`auth_info_baileys/`) dan Logs (`logs/`) akan tersimpan aman meskipun container dimatikan karena sudah dilindungi oleh Docker Volumes.*

## 📝 Konfigurasi

Edit file `.env` untuk kustomisasi:

```env
# Pengaturan Bot
BOT_NAME=HamBot
BOT_OWNER=YourName
BOT_PREFIX=.

# Performance
MAX_PROCESSES=3
COOLDOWN_MS=2000
RATE_LIMIT_MAX=10

# API Keys (Optional)
ELEVENLABS_API_KEY=your_key
OMDB_API_KEY=your_key
```

### API Keys (Opsional)

| API | Kegunaan | Link |
|-----|----------|------|
| ElevenLabs | Text-to-Speech (.say) | [Get Key](https://elevenlabs.io) |
| OMDb | Info Film (.movie) | [Get Key](http://www.omdbapi.com/apikey.aspx) |

## 🌐 Konfigurasi Proxy

HamBot mendukung custom proxy untuk semua fitur internet. Berguna untuk routing traffic melalui proxy server, seperti HP dengan Tailscale + Every Proxy.

### Setup dengan Tailscale + Every Proxy

```env
# Enable proxy globally
PROXY_ENABLED=true

# Tipe proxy (http, https, atau socks5)
PROXY_TYPE=socks5

# IP Tailscale HP kamu
PROXY_HOST=100.64.0.2

# Port Every Proxy (1080 untuk SOCKS5, 8080 untuk HTTP)
PROXY_PORT=1080
```

## 🏗️ Arsitektur

```
hambot-wa-bot/
├── index.js              # Inisialisasi bot
├── handler.js            # Message handler
├── config.js             # Konfigurasi
├── commands/             # Modul perintah
│   ├── base.js           # Base command class
│   ├── registry.js       # Command registry
│   ├── menu.js           # Menu command
│   ├── netinfo.js        # Network reference
│   ├── quote.js          # Kutipan inspirasional
│   ├── fact.js           # Fakta menarik
│   └── ...               # Perintah lainnya
└── utils/                # Modul utilitas
    ├── cache.js          # Sistem caching
    ├── rate-limiter.js   # Rate limiting
    ├── logger.js         # Logging
    └── helpers.js        # Helper functions
```

## 🔒 Keamanan

- Sanitisasi dan validasi input
- Rate limiting untuk mencegah abuse
- Penyimpanan kredensial yang aman
- Tidak ada kerentanan shell injection
- Cleanup otomatis file temporary

## 🐛 Troubleshooting

### Bot tidak merespon
- Pastikan QR code sudah di-scan dengan benar
- Cek koneksi internet
- Lihat console untuk error

### Perintah gagal
- Pastikan external dependencies (yt-dlp, ffmpeg) sudah terinstall
- Cek API keys di file .env
- Pastikan rate limit belum terlampaui

### Masalah memory
- Kurangi MAX_PROCESSES di .env
- Restart bot secara berkala
- Cek logs untuk memory leaks

## 📊 Performance

- **Response Time**: < 100ms untuk cached responses
- **Concurrency**: Handle multiple users secara bersamaan
- **Memory Usage**: ~150MB baseline
- **Cache Hit Rate**: 60-80% untuk query berulang

## 🤝 Kontribusi

Kontribusi sangat diterima! Silakan:

1. Fork repository
2. Buat feature branch
3. Lakukan perubahan
4. Submit pull request

## 📄 Lisensi

ISC License

## 👨‍💻 Author

Created by Ilham

## 🙏 Acknowledgments

- [Baileys](https://github.com/WhiskeySockets/Baileys) - WhatsApp Web API
- [Puppeteer](https://pptr.dev/) - Browser automation
- [Sharp](https://sharp.pixelplumbing.com/) - Image processing
- [ElevenLabs](https://elevenlabs.io/) - Text-to-speech AI

## ⚠️ Disclaimer

Bot ini hanya untuk tujuan edukasi. Gunakan dengan bijak dan patuhi Terms of Service WhatsApp. Developer tidak bertanggung jawab atas penyalahgunaan software ini.

---

Made with ❤️ by the HamBot team
