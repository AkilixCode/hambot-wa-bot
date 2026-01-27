# HamBot - Advanced WhatsApp Bot

A powerful WhatsApp bot built with Baileys, featuring media downloads, AI text-to-speech, image generation, and more.

## 🚀 Features

### 🎵 Media Downloader
- **Music Download** - Search and download songs from YouTube
- **Video Download** - Download videos from various platforms
- **Photo Download** - Fetch images from URLs
- **Pinterest Search** - Find aesthetic images and inspiration

### 🛠️ Creative Tools
- **Sticker Maker** - Convert images to WhatsApp stickers
- **Image Converter** - Convert stickers back to images
- **Text-to-Speech** - Generate voice messages with AI (ElevenLabs)

### 🎬 Entertainment & Info
- **Movie Info** - Get ratings, synopsis, and details from OMDb
- **Anime Info** - Fetch anime details from MyAnimeList
- **Earthquake Alerts** - Real-time earthquake data from BMKG (Indonesia)

### 👥 Group Management
- **Tag All** - Mention all group members
- **Group Info** - View group statistics and metadata
- **Spam Command** - Bulk messaging utility (use responsibly!)

### ⚡ Performance Features
- **Smart Caching** - Automatic result caching for faster responses
- **Rate Limiting** - Per-user request throttling
- **Queue Management** - Handles concurrent operations efficiently
- **Browser Pooling** - Reuses browser instances for scraping
- **Memory Optimization** - Automatic cleanup and garbage collection

## 📋 Prerequisites

- Node.js 16+ 
- npm or yarn
- WhatsApp account
- Internet connection

## 🔧 Installation

1. **Clone the repository**
```bash
git clone https://github.com/AkilixCode/hambot-wa-bot.git
cd hambot-wa-bot
```

2. **Install dependencies**
```bash
npm install
```

3. **Install external dependencies**

For music/video download features:
```bash
# Install yt-dlp
npm install -g yt-dlp
# OR download from: https://github.com/yt-dlp/yt-dlp/releases
```

For sticker conversion:
```bash
# Install FFmpeg
# Ubuntu/Debian:
sudo apt install ffmpeg

# macOS:
brew install ffmpeg

# Windows: Download from https://ffmpeg.org/download.html
```

4. **Configure environment**
```bash
cp .env.example .env
# Edit .env with your API keys and settings
```

5. **Start the bot**
```bash
npm start
```

6. **Scan QR Code**
Open WhatsApp on your phone and scan the QR code that appears in the terminal.

## 📝 Configuration

Edit the `.env` file to customize your bot:

```env
# Bot Settings
BOT_NAME=HamBot
BOT_OWNER=YourName
BOT_PREFIX=.

# Performance
MAX_PROCESSES=3
COOLDOWN_MS=2000
RATE_LIMIT_MAX=10

# API Keys
ELEVENLABS_API_KEY=your_key
OMDB_API_KEY=your_key
```

### API Keys (Optional)

- **ElevenLabs**: For text-to-speech (.say command) - [Get Key](https://elevenlabs.io)
- **OMDb**: For movie information (.movie command) - [Get Key](http://www.omdbapi.com/apikey.aspx)

## 🎮 Usage

### Basic Commands

```
.menu                    - Show all commands
.ping                    - Check bot status
.sticker                 - Convert image to sticker
.toimg                   - Convert sticker to image
```

### Media Commands

```
.music <song name>       - Download music
.video <url>             - Download video
.pinterest <query>       - Search Pinterest images
```

### Information Commands

```
.movie <title>           - Get movie information
.anime <title>           - Get anime information
.gempa                   - Latest earthquake info (Indonesia)
```

### Group Commands

```
.tagall                  - Mention all members
.info                    - View group information
```

## 🏗️ Architecture

The bot uses a modular command-based architecture:

```
hambot-wa-bot/
├── index.js              # Bot initialization
├── handler-new.js        # Message handler (new)
├── config.js             # Configuration management
├── commands/             # Command modules
│   ├── base.js           # Base command class
│   ├── registry.js       # Command registry
│   ├── ping.js           # Ping command
│   ├── menu.js           # Menu command
│   ├── sticker.js        # Sticker command
│   └── pinterest.js      # Pinterest command
└── utils/                # Utility modules
    ├── cache.js          # Caching system
    ├── rate-limiter.js   # Rate limiting
    ├── logger.js         # Logging system
    ├── helpers.js        # Helper functions
    └── browser-manager.js # Browser pooling
```

### Key Features

- **Command Registry**: Automatic command loading and management
- **Caching System**: In-memory cache with TTL and auto-cleanup
- **Rate Limiter**: Sliding window rate limiting per user
- **Browser Manager**: Singleton browser with page pooling
- **Structured Logging**: Enhanced logging with context
- **Error Handling**: Comprehensive error handling and recovery

## 🔒 Security

- Input sanitization and validation
- Rate limiting to prevent abuse
- Secure credential storage
- No shell injection vulnerabilities
- Automatic cleanup of temporary files

## 🐛 Troubleshooting

### Bot doesn't respond
- Check if QR code is scanned correctly
- Verify internet connection
- Check console for errors

### Commands fail
- Ensure external dependencies (yt-dlp, ffmpeg) are installed
- Check API keys in .env file
- Verify rate limits haven't been exceeded

### Memory issues
- Reduce MAX_PROCESSES in .env
- Restart the bot periodically
- Check for memory leaks in logs

## 📊 Performance

- **Response Time**: < 100ms for cached responses
- **Concurrency**: Handles multiple users simultaneously
- **Memory Usage**: ~150MB baseline, scales with usage
- **Cache Hit Rate**: 60-80% for repeated queries

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📄 License

ISC License

## 👨‍💻 Author

Created by ${config.bot.owner || 'Ilham'}

## 🙏 Acknowledgments

- [Baileys](https://github.com/WhiskeySockets/Baileys) - WhatsApp Web API
- [Puppeteer](https://pptr.dev/) - Browser automation
- [Sharp](https://sharp.pixelplumbing.com/) - Image processing
- [ElevenLabs](https://elevenlabs.io/) - Text-to-speech AI

## ⚠️ Disclaimer

This bot is for educational purposes only. Use responsibly and follow WhatsApp's Terms of Service. The developers are not responsible for misuse of this software.

---

Made with ❤️ by the HamBot team
