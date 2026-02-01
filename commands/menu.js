/**
 * Menu Command
 * Menampilkan daftar perintah dan bantuan bot
 * Mendukung: .menu, .menu <kategori>, dan .menu <perintah>
 */

const CommandBase = require('./base');
const commandRegistry = require('./registry');
const config = require('../config');

class MenuCommand extends CommandBase {
    constructor() {
        super({
            name: 'menu',
            aliases: ['help', 'intro', 'commands', 'bantuan'],
            description: 'Menampilkan daftar perintah bot',
            usage: '.menu [kategori/perintah]',
            category: 'general',
            cooldown: 3000
        });

        // Detailed command help - comprehensive usage guides
        this.commandGuides = this.buildCommandGuides();
    }

    /**
     * Build detailed command guides for all commands
     * @returns {Object} Command guides keyed by command name
     */
    buildCommandGuides() {
        return {
            // === MEDIA COMMANDS ===
            video: {
                title: '📹 Video Downloader',
                description: 'Download video dari berbagai platform sosial media. Mendukung 30+ platform termasuk URL pendek.',
                usage: [
                    '.video <url>'
                ],
                examples: [
                    '.video https://vt.tiktok.com/ZSaXwy6PG/',
                    '.video https://vm.tiktok.com/xxxxx/',
                    '.video https://www.tiktok.com/@user/video/123456',
                    '.video https://youtu.be/dQw4w9WgXcQ',
                    '.video https://youtube.com/shorts/xxxxx',
                    '.video https://instagram.com/reel/xxxxx',
                    '.video https://instagram.com/p/xxxxx',
                    '.video https://fb.watch/xxxxx/',
                    '.video https://facebook.com/reel/123456',
                    '.video https://x.com/user/status/123456',
                    '.video https://twitter.com/user/status/123456'
                ],
                platforms: 'TikTok, YouTube, Instagram, Facebook, Twitter/X, Reddit, Twitch, Vimeo, Dailymotion, Pinterest, LinkedIn, Tumblr, Snapchat, Bilibili, VK, Threads, Kick, Rumble, dan lainnya.',
                notes: [
                    '• Mendukung URL pendek seperti vt.tiktok.com, youtu.be, fb.watch',
                    '• Maksimal ukuran file 200MB',
                    '• Video private/restricted tidak bisa didownload',
                    '• Durasi maksimal 10 menit (bisa dikonfigurasi)'
                ]
            },

            music: {
                title: '🎵 Music Downloader',
                description: 'Download musik dari YouTube dengan pencarian atau URL langsung. Mendukung berbagai platform audio.',
                usage: [
                    '.music <nama lagu>',
                    '.music <url>'
                ],
                examples: [
                    '.music About You The 1975',
                    '.music Bohemian Rhapsody Queen',
                    '.music https://youtu.be/dQw4w9WgXcQ',
                    '.music https://youtube.com/watch?v=xxxxx',
                    '.music https://soundcloud.com/artist/track',
                    '.music https://open.spotify.com/track/xxxxx'
                ],
                platforms: 'YouTube, SoundCloud, Spotify (metadata), Bandcamp, Mixcloud, dan lainnya.',
                notes: [
                    '• Pencarian otomatis memilih lagu dengan durasi valid',
                    '• Output dalam format MP3 kualitas tinggi',
                    '• Maksimal durasi 10 menit',
                    '• Mendukung URL langsung dari berbagai platform'
                ]
            },

            say: {
                title: '🎤 Text-to-Speech (TTS)',
                description: 'Mengubah teks menjadi suara menggunakan AI ElevenLabs. Mendukung berbagai bahasa.',
                usage: [
                    '.say <teks>',
                    '.say <lang> <teks>'
                ],
                examples: [
                    '.say Halo semuanya!',
                    '.say <en> Hello everyone!',
                    '.say <ja> こんにちは',
                    '.say <ko> 안녕하세요',
                    '.say <zh> 你好世界'
                ],
                notes: [
                    '• Default bahasa Indonesia',
                    '• Gunakan tag <en>, <id>, <ja>, <ko>, <zh>, dll untuk bahasa lain',
                    '• Maksimal 500 karakter',
                    '• Output sebagai voice note WhatsApp'
                ],
                languages: '<id> Indonesia, <en> English, <es> Español, <ja> 日本語, <ko> 한국어, <zh> 中文, <fr> Français, <de> Deutsch, <pt> Português, <ru> Русский, <ar> العربية, <hi> हिन्दी'
            },

            sticker: {
                title: '🖼️ Sticker Maker',
                description: 'Mengubah gambar menjadi stiker WhatsApp.',
                usage: [
                    '.sticker (kirim dengan gambar)',
                    '.sticker (reply gambar)'
                ],
                examples: [
                    'Kirim gambar dengan caption: .sticker',
                    'Reply gambar dengan: .sticker'
                ],
                notes: [
                    '• Gambar akan di-resize ke 512x512 pixel',
                    '• Mendukung format JPG, PNG, WebP',
                    '• Background transparan dipertahankan'
                ]
            },

            toimg: {
                title: '🖼️ Sticker to Image',
                description: 'Mengubah stiker menjadi gambar.',
                usage: [
                    '.toimg (reply stiker)'
                ],
                examples: [
                    'Reply stiker dengan: .toimg'
                ],
                notes: [
                    '• Output dalam format PNG',
                    '• Mendukung stiker statis dan animasi (frame pertama)'
                ]
            },

            pinterest: {
                title: '📌 Pinterest Search',
                description: 'Cari dan kirim gambar dari Pinterest.',
                usage: [
                    '.pinterest <kata kunci>'
                ],
                examples: [
                    '.pinterest anime wallpaper',
                    '.pinterest aesthetic room',
                    '.pinterest cat meme'
                ],
                notes: [
                    '• Mengirim gambar acak dari hasil pencarian',
                    '• Gambar berkualitas tinggi'
                ]
            },

            // === FUN COMMANDS ===
            translate: {
                title: '🌐 Translator',
                description: 'Terjemahkan teks ke bahasa lain.',
                usage: [
                    '.translate <bahasa> <teks>',
                    '.translate <teks> (default ke Indonesia)'
                ],
                examples: [
                    '.translate en Halo apa kabar?',
                    '.translate ja Hello world',
                    '.translate I love you'
                ],
                notes: [
                    '• Gunakan kode bahasa: en, id, ja, ko, zh, dll',
                    '• Default terjemahan ke Bahasa Indonesia',
                    '• Deteksi bahasa otomatis'
                ]
            },

            quote: {
                title: '💭 Kutipan Inspirasional',
                description: 'Dapatkan kutipan inspiratif acak dalam Bahasa Indonesia.',
                usage: ['.quote'],
                examples: ['.quote'],
                notes: [
                    '• 300+ kutipan inspirasional',
                    '• Dari berbagai tokoh terkenal dunia dan Indonesia',
                    '• Semua dalam Bahasa Indonesia'
                ]
            },

            fact: {
                title: '📚 Fakta Menarik',
                description: 'Dapatkan fakta menarik acak dalam Bahasa Indonesia.',
                usage: ['.fact'],
                examples: ['.fact'],
                notes: [
                    '• 100+ fakta unik dan menarik',
                    '• Termasuk fakta tentang Indonesia',
                    '• Semua dalam Bahasa Indonesia'
                ]
            },

            meme: {
                title: '😂 Meme Indonesia',
                description: 'Dapatkan meme Indonesia dari Reddit r/indonesia.',
                usage: ['.meme'],
                examples: ['.meme'],
                notes: [
                    '• Meme dari subreddit Indonesia',
                    '• Konten lokal yang relatable',
                    '• Family-friendly content'
                ]
            },

            rps: {
                title: '✊ Rock Paper Scissors',
                description: 'Main batu gunting kertas dengan bot.',
                usage: ['.rps <pilihan>'],
                examples: [
                    '.rps batu',
                    '.rps gunting',
                    '.rps kertas',
                    '.rps rock',
                    '.rps paper',
                    '.rps scissors'
                ],
                notes: ['• Mendukung bahasa Indonesia dan Inggris']
            },

            dice: {
                title: '🎲 Roll Dice',
                description: 'Lempar dadu.',
                usage: [
                    '.dice',
                    '.dice <jumlah>d<sisi>'
                ],
                examples: [
                    '.dice',
                    '.dice 2d6',
                    '.dice 1d20'
                ],
                notes: ['• Default 1d6 (1 dadu 6 sisi)']
            },

            flip: {
                title: '🪙 Flip Coin',
                description: 'Lempar koin.',
                usage: ['.flip'],
                examples: ['.flip'],
                notes: ['• Hasil: Heads atau Tails']
            },

            '8ball': {
                title: '🎱 Magic 8-Ball',
                description: 'Tanya bola ajaib untuk ramalan.',
                usage: ['.8ball <pertanyaan>'],
                examples: [
                    '.8ball Apakah aku akan sukses?',
                    '.8ball Will I pass the exam?'
                ],
                notes: ['• Jawaban acak seperti Magic 8-Ball asli']
            },

            trivia: {
                title: '❓ Trivia Quiz',
                description: 'Main kuis trivia.',
                usage: ['.trivia'],
                examples: ['.trivia'],
                notes: [
                    '• Pertanyaan acak dari berbagai kategori',
                    '• Reply dengan jawaban dalam 30 detik'
                ]
            },

            // === TOOLS COMMANDS ===
            qr: {
                title: '📱 QR Code Generator',
                description: 'Buat QR code dari teks atau URL.',
                usage: ['.qr <teks/url>'],
                examples: [
                    '.qr https://example.com',
                    '.qr Hello World',
                    '.qr +6281234567890'
                ],
                notes: ['• Bisa untuk URL, teks, atau nomor telepon']
            },

            calc: {
                title: '🔢 Calculator',
                description: 'Kalkulator sederhana.',
                usage: ['.calc <ekspresi>'],
                examples: [
                    '.calc 2+2',
                    '.calc 100*50',
                    '.calc (10+5)*3',
                    '.calc sqrt(16)',
                    '.calc 2^10'
                ],
                notes: [
                    '• Mendukung +, -, *, /, ^, sqrt, sin, cos, tan',
                    '• Gunakan kurung untuk prioritas'
                ]
            },

            reminder: {
                title: '⏰ Reminder',
                description: 'Atur pengingat.',
                usage: ['.reminder <waktu> <pesan>'],
                examples: [
                    '.reminder 5m Minum air',
                    '.reminder 1h Meeting zoom',
                    '.reminder 30s Test reminder'
                ],
                notes: [
                    '• Format waktu: s (detik), m (menit), h (jam)',
                    '• Bot akan mengingatkan di chat yang sama'
                ]
            },

            // === INFO COMMANDS ===
            weather: {
                title: '🌤️ Weather',
                description: 'Cek cuaca lokasi manapun.',
                usage: ['.weather <lokasi>'],
                examples: [
                    '.weather Jakarta',
                    '.weather Tokyo',
                    '.weather New York'
                ],
                notes: ['• Data dari OpenWeatherMap']
            },

            movie: {
                title: '🎬 Movie Search',
                description: 'Cari informasi film dari IMDb.',
                usage: ['.movie <judul film>'],
                examples: [
                    '.movie Interstellar',
                    '.movie The Dark Knight',
                    '.movie Parasite'
                ],
                notes: [
                    '• Menampilkan rating, tahun, genre, dll',
                    '• Termasuk poster film'
                ]
            },

            crypto: {
                title: '💰 Cryptocurrency',
                description: 'Cek harga cryptocurrency.',
                usage: ['.crypto <symbol>'],
                examples: [
                    '.crypto BTC',
                    '.crypto ETH',
                    '.crypto DOGE'
                ],
                notes: ['• Data real-time dari CoinGecko']
            },

            wiki: {
                title: '📖 Wikipedia',
                description: 'Cari di Wikipedia.',
                usage: ['.wiki <kata kunci>'],
                examples: [
                    '.wiki Indonesia',
                    '.wiki Albert Einstein',
                    '.wiki Machine Learning'
                ],
                notes: ['• Menampilkan ringkasan artikel Wikipedia']
            },

            time: {
                title: '🕐 World Time',
                description: 'Cek waktu di berbagai zona waktu.',
                usage: ['.time <zona waktu>'],
                examples: [
                    '.time Jakarta',
                    '.time Tokyo',
                    '.time New York',
                    '.time London'
                ],
                notes: ['• Mendukung nama kota dan timezone']
            },

            gempa: {
                title: '🌍 Info Gempa BMKG',
                description: 'Info gempa terbaru dari BMKG Indonesia.',
                usage: ['.gempa'],
                examples: ['.gempa'],
                notes: ['• Data langsung dari BMKG']
            },

            // === SYSTEM COMMANDS ===
            ping: {
                title: '🏓 Ping',
                description: 'Cek status dan performa bot.',
                usage: ['.ping'],
                examples: ['.ping'],
                notes: [
                    '• Menampilkan latensi',
                    '• Info sistem (CPU, RAM, Uptime)',
                    '• Cache statistics'
                ]
            },

            menu: {
                title: '📋 Menu',
                description: 'Menampilkan daftar perintah bot.',
                usage: [
                    '.menu',
                    '.menu <kategori>',
                    '.menu <nama perintah>'
                ],
                examples: [
                    '.menu',
                    '.menu media',
                    '.menu fun',
                    '.menu video',
                    '.menu music'
                ],
                notes: [
                    '• Tanpa argumen: tampilkan semua perintah',
                    '• Dengan kategori: tampilkan perintah dalam kategori',
                    '• Dengan nama perintah: tampilkan detail perintah'
                ]
            },

            info: {
                title: 'ℹ️ Group Info',
                description: 'Tampilkan informasi dan statistik grup.',
                usage: ['.info'],
                examples: ['.info'],
                notes: ['• Hanya berfungsi di grup']
            },

            tagall: {
                title: '📢 Tag All',
                description: 'Tag semua member grup.',
                usage: ['.tagall [pesan]'],
                examples: [
                    '.tagall',
                    '.tagall Meeting jam 3 sore!'
                ],
                notes: [
                    '• Hanya berfungsi di grup',
                    '• Gunakan dengan bijak'
                ]
            },

            security: {
                title: '🔒 Security',
                description: 'Status dan kontrol keamanan bot.',
                usage: ['.security'],
                examples: ['.security'],
                notes: ['• Menampilkan status keamanan sistem']
            },

            // === NETWORKING COMMANDS ===
            subnet: {
                title: '🌐 Subnet Calculator',
                description: 'Hitung subnet dari alamat IP dan CIDR.',
                usage: ['.subnet <IP>/<CIDR>'],
                examples: [
                    '.subnet 192.168.1.0/24',
                    '.subnet 10.0.0.0/8',
                    '.subnet 172.16.0.0/16'
                ],
                notes: [
                    '• Menampilkan network, broadcast, range IP',
                    '• Jumlah host yang tersedia'
                ]
            },

            ipinfo: {
                title: '📍 IP Info',
                description: 'Dapatkan informasi alamat IP.',
                usage: ['.ipinfo <IP>'],
                examples: [
                    '.ipinfo 8.8.8.8',
                    '.ipinfo 1.1.1.1'
                ],
                notes: [
                    '• Menampilkan lokasi, ISP, timezone',
                    '• Informasi ASN'
                ]
            },

            dns: {
                title: '🔍 DNS Lookup',
                description: 'Lookup DNS untuk domain.',
                usage: ['.dns <domain>'],
                examples: [
                    '.dns google.com',
                    '.dns github.com'
                ],
                notes: ['• Menampilkan record A, AAAA, MX, dll']
            },

            port: {
                title: '🔌 Port Reference',
                description: 'Referensi port jaringan umum.',
                usage: ['.port <nomor/nama>'],
                examples: [
                    '.port 80',
                    '.port 443',
                    '.port ssh',
                    '.port http'
                ],
                notes: ['• Database port umum']
            },

            netinfo: {
                title: '📚 Referensi Jaringan Komputer',
                description: 'Cheat sheet dan referensi networking lengkap dalam Bahasa Indonesia.',
                usage: ['.netinfo', '.netinfo <topik>'],
                examples: [
                    '.netinfo',
                    '.netinfo osi',
                    '.netinfo subnetting',
                    '.netinfo protokol',
                    '.netinfo troubleshoot'
                ],
                notes: [
                    '• 20+ topik networking lengkap',
                    '• OSI, TCP/IP, Subnetting, VLAN, Routing',
                    '• Firewall, NAT, DHCP, VPN, IPv6',
                    '• Troubleshooting guide',
                    '• Semua dalam Bahasa Indonesia'
                ]
            }
        };
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        await this.react(sock, msg, '📋');

        // If argument provided
        if (args[0]) {
            const query = args[0].toLowerCase();
            
            // First, check if it's a command name
            const command = commandRegistry.get(query);
            if (command) {
                return await this.sendCommandHelp(sock, from, msg, command);
            }
            
            // Second, check if it's a category
            const categoryCommands = commandRegistry.getByCategory(query);
            if (categoryCommands.length > 0) {
                return await this.sendCategoryHelp(sock, from, msg, query);
            }
            
            // Not found - suggest similar commands
            return await this.reply(sock, from, msg, 
                `❌ Perintah atau kategori "${args[0]}" tidak ditemukan.\n\n` +
                `💡 Coba:\n` +
                `• ${config.bot.prefix}menu - Lihat semua perintah\n` +
                `• ${config.bot.prefix}menu media - Lihat perintah media\n` +
                `• ${config.bot.prefix}menu video - Detail perintah video`
            );
        }

        // Build complete menu
        const categories = commandRegistry.getCategories();
        const menuSections = [];

        // Header - simple and mobile-friendly
        menuSections.push(`🤖 *${config.bot.name}*`);
        menuSections.push('');
        menuSections.push('Halo! Selamat datang!');
        menuSections.push('Berikut daftar perintah:');
        menuSections.push('');

        // Commands per category
        for (const category of categories.sort()) {
            const commands = commandRegistry.getByCategory(category);
            if (commands.length === 0) continue;

            const categoryName = this.getCategoryNameID(category);
            menuSections.push(`${this.getCategoryEmoji(category)} *${categoryName}*`);
            
            for (const cmd of commands) {
                const aliases = cmd.aliases.length > 0 ? ` (${cmd.aliases.join(', ')})` : '';
                menuSections.push(`• *${config.bot.prefix}${cmd.name}*${aliases}`);
                if (cmd.description) {
                    menuSections.push(`  ${this.translateDescription(cmd.description)}`);
                }
            }
            menuSections.push('');
        }

        // Footer with tips - simple format
        menuSections.push('💡 *Tips*');
        menuSections.push(`Ketik ${config.bot.prefix}menu <perintah>`);
        menuSections.push('untuk detail perintah');
        menuSections.push('');
        menuSections.push('📌 *Contoh:*');
        menuSections.push(`• ${config.bot.prefix}menu video`);
        menuSections.push(`• ${config.bot.prefix}menu music`);
        menuSections.push(`• ${config.bot.prefix}menu media`);
        menuSections.push('');
        menuSections.push(`© 2025 ${config.bot.owner} ⚡`);

        const menuText = menuSections.join('\n');
        await this.reply(sock, from, msg, menuText);
        await this.react(sock, msg, '✅');
    }

    /**
     * Send detailed help for a specific command
     */
    async sendCommandHelp(sock, from, msg, command) {
        const sections = [];
        const guide = this.commandGuides[command.name];
        
        // Header - simple format
        if (guide) {
            sections.push(`${guide.title}`);
            sections.push('');
            
            // Description
            sections.push(`📝 *Deskripsi*`);
            sections.push(guide.description);
            sections.push('');
            
            // Usage
            sections.push('💡 *Cara Pakai*');
            for (const usage of guide.usage) {
                sections.push(`  ${usage}`);
            }
            sections.push('');
            
            // Examples
            sections.push('📌 *Contoh*');
            for (const example of guide.examples.slice(0, 5)) {
                sections.push(`  ${example}`);
            }
            if (guide.examples.length > 5) {
                sections.push(`  ...dan ${guide.examples.length - 5} contoh lagi`);
            }
            sections.push('');
            
            // Platforms (if applicable)
            if (guide.platforms) {
                sections.push('🌐 *Platform*');
                sections.push(guide.platforms);
                sections.push('');
            }
            
            // Languages (if applicable)
            if (guide.languages) {
                sections.push('🗣️ *Bahasa*');
                sections.push(guide.languages);
                sections.push('');
            }
            
            // Notes
            if (guide.notes && guide.notes.length > 0) {
                sections.push('📋 *Catatan*');
                for (const note of guide.notes) {
                    sections.push(note);
                }
                sections.push('');
            }
        } else {
            // Fallback for commands without detailed guide
            sections.push(`📌 *${config.bot.prefix}${command.name.toUpperCase()}*`);
            sections.push('');
            
            if (command.description) {
                sections.push(`📝 *Deskripsi*`);
                sections.push(this.translateDescription(command.description));
                sections.push('');
            }
            
            if (command.usage) {
                sections.push('💡 *Cara Pakai*');
                sections.push(`  ${command.usage}`);
                sections.push('');
            }
        }
        
        // Aliases
        if (command.aliases && command.aliases.length > 0) {
            sections.push('🔄 *Alias*');
            sections.push(`  ${command.aliases.map(a => config.bot.prefix + a).join(', ')}`);
            sections.push('');
        }
        
        // Category
        sections.push('📁 *Kategori*');
        sections.push(`  ${this.getCategoryEmoji(command.category)} ${this.getCategoryNameID(command.category)}`);
        
        await this.reply(sock, from, msg, sections.join('\n'));
    }

    async sendCategoryHelp(sock, from, msg, category) {
        const commands = commandRegistry.getByCategory(category.toLowerCase());
        
        if (commands.length === 0) {
            return await this.reply(sock, from, msg, `❌ Kategori "${category}" tidak ditemukan.`);
        }

        const categoryName = this.getCategoryNameID(category.toLowerCase());
        const sections = [];
        
        sections.push(`${this.getCategoryEmoji(category)} *${categoryName.toUpperCase()}*`);
        sections.push('');

        for (const cmd of commands) {
            sections.push(`*${config.bot.prefix}${cmd.name}*`);
            if (cmd.description) {
                sections.push(`📝 ${this.translateDescription(cmd.description)}`);
            }
            if (cmd.usage) {
                sections.push(`💡 ${cmd.usage}`);
            }
            if (cmd.aliases.length > 0) {
                sections.push(`🔄 ${cmd.aliases.join(', ')}`);
            }
            sections.push('');
        }
        
        sections.push(`💡 Ketik ${config.bot.prefix}menu <perintah>`);
        sections.push('untuk detail lengkap');

        await this.reply(sock, from, msg, sections.join('\n'));
    }

    getCategoryEmoji(category) {
        const emojis = {
            'system': '⚙️',
            'general': '📋',
            'media': '🎵',
            'tools': '🛠️',
            'utility': '🔧',
            'info': 'ℹ️',
            'entertainment': '🎬',
            'group': '👥',
            'fun': '🎉',
            'technical': '🖥️',
            'networking': '🌐'
        };
        return emojis[category.toLowerCase()] || '📌';
    }

    getCategoryNameID(category) {
        const names = {
            'system': 'Sistem',
            'general': 'Umum',
            'media': 'Media & Audio',
            'tools': 'Alat',
            'utility': 'Utilitas',
            'info': 'Informasi',
            'entertainment': 'Hiburan',
            'group': 'Grup',
            'fun': 'Seru-seruan',
            'technical': 'Teknikal',
            'networking': 'Jaringan'
        };
        return names[category.toLowerCase()] || category;
    }

    translateDescription(desc) {
        // Translate common descriptions to Indonesian
        const translations = {
            'Check bot response time and system status': 'Cek waktu respon dan status sistem',
            'Display bot help and command list': 'Menampilkan daftar perintah bot',
            'Translate text to another language': 'Terjemahkan teks ke bahasa lain',
            'Get current weather for any location': 'Dapatkan info cuaca lokasi manapun',
            'Search and download music from YouTube': 'Cari dan download musik dari YouTube',
            'Convert image to sticker': 'Ubah gambar menjadi stiker',
            'Convert sticker to image': 'Ubah stiker menjadi gambar',
            'Get a random inspirational quote': 'Dapatkan kutipan inspiratif acak',
            'Get a random fact': 'Dapatkan fakta menarik acak',
            'Get a random meme': 'Dapatkan meme Indonesia acak',
            'Play Rock Paper Scissors': 'Main Batu Gunting Kertas',
            'Roll dice': 'Lempar dadu',
            'Flip a coin': 'Lempar koin',
            'Magic 8-ball prediction': 'Ramalan bola ajaib 8',
            'Search movies on IMDb': 'Cari film di IMDb',
            'Search and send images from Pinterest': 'Cari dan kirim gambar dari Pinterest',
            'Generate QR code': 'Buat QR code',
            'Simple calculator': 'Kalkulator sederhana',
            'Get cryptocurrency prices': 'Cek harga cryptocurrency',
            'Display group information and statistics': 'Tampilkan info dan statistik grup',
            'Tag all members in group': 'Tag semua member grup',
            'Get current time for any timezone': 'Cek waktu zona waktu manapun',
            'Set a reminder': 'Atur pengingat',
            'Search Wikipedia': 'Cari di Wikipedia',
            'Play trivia quiz': 'Main kuis trivia',
            'Get latest earthquake info from BMKG': 'Info gempa terbaru dari BMKG',
            'Security status and controls': 'Status dan kontrol keamanan',
            'Mengubah teks menjadi suara menggunakan AI': 'Ubah teks menjadi suara AI',
            // Technical/Networking commands
            'Hitung subnet dari alamat IP dan CIDR': 'Hitung subnet dari IP dan CIDR',
            'Dapatkan informasi alamat IP': 'Dapatkan info alamat IP',
            'Lookup DNS untuk domain': 'Lookup DNS untuk domain',
            'Referensi port jaringan umum': 'Referensi port jaringan',
            'Cheat sheet dan referensi networking': 'Cheat sheet networking',
            'Cheat sheet dan referensi networking lengkap': 'Referensi jaringan lengkap',
            // Updated descriptions
            'Dapatkan kutipan inspirasional acak': 'Kutipan inspirasional dalam Bahasa Indonesia',
            'Dapatkan fakta menarik acak': 'Fakta menarik dalam Bahasa Indonesia',
            'Dapatkan meme Indonesia acak': 'Meme Indonesia dari Reddit'
        };
        
        return translations[desc] || desc;
    }
}

module.exports = MenuCommand;
