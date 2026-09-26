/**
 * Menu Command
 * Menampilkan daftar perintah dan bantuan bot
 * Mendukung: .menu, .menu <kategori>, dan .menu <perintah>
 */

const CommandBase = require('./base');
const commandRegistry = require('./registry');
const config = require('../config');
const ui = require('../utils/ui');
const menuImage = require('../utils/menu-image');
const { withCorrectionNote, correctionNote } = require('../utils/correction');

// WhatsApp truncates long captions; base.replyMedia clamps to this too.
const CAPTION_LIMIT = 1024;
// Command-name rows stay under this so they never wrap on a small screen
// (the 3-space indent brings the full line to about 30 characters).
const ROW_WIDTH = 27;

// Deliberate ordering for the menu. Alphabetical order buried the everyday
// commands (media, tools) below novelty ones, so categories are listed roughly
// by how often people reach for them. Anything not listed falls to the end.
const CATEGORY_ORDER = [
    'general', 'media', 'tools', 'utility', 'technical',
    'info', 'entertainment', 'fun', 'group', 'system', 'security'
];

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
                title: '🔒 Security — Owner Control Panel',
                description: 'Panel informasi dan kontrol penuh bot. Khusus owner.',
                usage: [
                    '.security help',
                    '.security <subcommand> [args]'
                ],
                examples: [
                    '.security status',
                    '.security health',
                    '.security env',
                    '.security audit 20',
                    '.security threats',
                    '.security lock',
                    '.security cmd disable spam',
                    '.security block 62812345678 60'
                ],
                notes: [
                    '• Hanya owner yang bisa memakai perintah ini',
                    '• Output sensitif dikirim ke chat pribadi, bukan grup',
                    '• Kunci API tidak pernah ditampilkan, hanya status & sidik jari',
                    '• Aksi berbahaya butuh konfirmasi token sekali pakai',
                    '• Percobaan akses berulang oleh non-owner diblokir otomatis'
                ]
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

    /**
     * Hide owner-only commands from everyone but the owner.
     * Advertising the owner control panel to every user is free reconnaissance
     * for anyone looking for a way in.
     * @param {Array} commands - Commands to filter
     * @param {boolean} isOwnerViewer - Whether the requester is the bot owner
     * @returns {Array} Commands the requester is allowed to see
     * @private
     */
    _visibleCommands(commands, isOwnerViewer) {
        if (isOwnerViewer) return commands;
        return commands.filter(cmd => !config.isOwnerOnlyCommand(cmd.name));
    }

    /**
     * Order categories by CATEGORY_ORDER, with unknown ones appended
     * alphabetically so a new category never silently disappears.
     * @param {string[]} categories
     * @returns {string[]}
     * @private
     */
    _orderCategories(categories) {
        const known = CATEGORY_ORDER.filter(c => categories.includes(c));
        const rest = categories.filter(c => !CATEGORY_ORDER.includes(c)).sort();
        return [...known, ...rest];
    }

    async execute(sock, msg, args, context) {
        const { from } = context;
        const isOwnerViewer = context.isOwner ?? config.isOwner(context.sender);

        await this.react(sock, msg, '📋');

        // If argument provided
        if (args[0]) {
            const query = args[0].toLowerCase();

            // First, check if it's a command name
            const command = commandRegistry.get(query);
            if (command && (isOwnerViewer || !config.isOwnerOnlyCommand(command.name))) {
                return await this.sendCommandHelp(sock, from, msg, command);
            }

            // Second, check if it's a category
            const categoryCommands = this._visibleCommands(commandRegistry.getByCategory(query), isOwnerViewer);
            if (categoryCommands.length > 0) {
                return await this.sendCategoryHelp(sock, from, msg, query, isOwnerViewer);
            }

            // A clear typo of a command or category: show that page, with a
            // note saying what was assumed.
            const visible = name => isOwnerViewer || !config.isOwnerOnlyCommand(name);
            const guess = commandRegistry.match(query, {
                extra: commandRegistry.getCategories(),
                filter: visible
            });
            if (guess.confident) {
                const noted = withCorrectionNote(sock, correctionNote(query, guess.name));
                const guessedCommand = commandRegistry.get(guess.name);
                return guessedCommand
                    ? await this.sendCommandHelp(noted, from, msg, guessedCommand)
                    : await this.sendCategoryHelp(noted, from, msg, guess.name, isOwnerViewer);
            }

            // Not found - point at the closest matches rather than a generic list
            const near = [...new Set([...guess.candidates, ...this._suggest(query, isOwnerViewer)])].slice(0, 3);
            return await this.replyError(sock, from, msg,
                `Tidak ada perintah atau kategori bernama ${ui.mono(ui.truncate(args[0], 24))}.`,
                {
                    title: 'Tidak Ditemukan',
                    hint: near.length
                        ? near.map(n => `${config.bot.prefix}menu ${n}`)
                        : [`${config.bot.prefix}menu — lihat semua perintah`]
                }
            );
        }

        const { header, body } = this.buildOverview(msg.pushName, isOwnerViewer);
        const caption = `${header}\n${body}`;

        // One message: the picture with the menu as its caption. If there is
        // no picture, or sending it fails, the same text still goes out.
        const image = await menuImage.getMenuImage().catch(() => null);
        if (image) {
            try {
                if (caption.length <= CAPTION_LIMIT) {
                    await this.replyMedia(sock, from, msg, { image, caption });
                } else {
                    // Only reachable once the command list outgrows a caption:
                    // keep the greeting on the picture, the list right after.
                    await this.replyMedia(sock, from, msg, { image, caption: header });
                    await this.reply(sock, from, msg, body);
                }
                await this.react(sock, msg, '✅');
                return;
            } catch (error) {
                this.logError(error, { context: 'menu-image-send' });
            }
        }

        await this.reply(sock, from, msg, caption);
        await this.react(sock, msg, '✅');
    }

    /**
     * The `.menu` overview, split into the greeting header and the command
     * list so the two can be sent apart if the caption ever gets too long.
     *
     * Compact on purpose: every command name, grouped by category and packed
     * onto short lines. Descriptions live behind `.menu <kategori>` — with them
     * the menu ran past 2,000 characters, twice what fits in a caption.
     *
     * @param {string} [pushName] Sender's WhatsApp display name
     * @param {boolean} isOwnerViewer
     * @returns {{header: string, body: string}}
     */
    buildOverview(pushName, isOwnerViewer) {
        const prefix = config.bot.prefix;
        const visible = this._visibleCommands(commandRegistry.getAll(), isOwnerViewer);

        const header = [
            ui.frame(config.bot.name),
            ui.italic(ui.safe(config.bot.tagline, 40)),
            '',
            ui.greeting(pushName),
            `⏰ ${ui.clock()}  ${ui.SYM.dot}  📦 ${visible.length} perintah`
        ].join('\n');

        const lines = [ui.rule()];
        for (const category of this._orderCategories(commandRegistry.getCategories())) {
            const commands = this._visibleCommands(commandRegistry.getByCategory(category), isOwnerViewer);
            if (commands.length === 0) continue;

            const names = commands.map(cmd => prefix + cmd.name).sort();
            lines.push(ui.section(this.getCategoryNameID(category), this.getCategoryEmoji(category)));
            lines.push(...this._packNames(names).map(row => `   ${row}`));
        }
        lines.push(ui.rule());
        lines.push(`💡 ${ui.mono(prefix + 'menu <perintah>')} detail`);
        lines.push(`📂 ${ui.mono(prefix + 'menu <kategori>')} isi`);
        lines.push(`> ${config.bot.name} ${ui.fancyMono('v' + config.bot.version)} ${ui.SYM.dot} ${ui.safe(config.bot.owner, 24)}`);

        return { header, body: lines.join('\n') };
    }

    /**
     * Pack command names onto rows no wider than ROW_WIDTH characters, so a
     * row never wraps on a narrow phone and breaks the grid.
     * @param {string[]} names
     * @returns {string[]}
     * @private
     */
    _packNames(names) {
        const rows = [];
        let row = '';
        for (const name of names) {
            const next = row ? `${row}  ${name}` : name;
            if (row && next.length > ROW_WIDTH) {
                rows.push(row);
                row = name;
            } else {
                row = next;
            }
        }
        if (row) rows.push(row);
        return rows;
    }

    /**
     * Find commands and categories whose name is close to what the user typed,
     * so a typo gets a useful pointer instead of a dead end.
     * @param {string} query Lowercased user input
     * @param {boolean} isOwnerViewer
     * @returns {string[]} Up to 3 suggestions
     * @private
     */
    _suggest(query, isOwnerViewer) {
        return commandRegistry.suggest(query, {
            extra: commandRegistry.getCategories(),
            filter: name => isOwnerViewer || !config.isOwnerOnlyCommand(name)
        });
    }

    /**
     * Send detailed help for a specific command
     */
    /**
     * Detailed help for one command. Falls back to the command's own metadata
     * when no hand-written guide exists, so newly added commands still get a
     * usable help page for free.
     */
    async sendCommandHelp(sock, from, msg, command) {
        const prefix = config.bot.prefix;
        const guide = this.commandGuides[command.name];
        const lines = [];

        const description = guide?.description || command.description;
        if (description) {
            lines.push(description, '');
        }

        const forms = guide?.usage?.length
            ? guide.usage
            : (command.usage ? [command.usage] : []);
        if (forms.length) {
            lines.push(`${ui.EMOJI.usage} ${ui.bold('Cara pakai')}`);
            lines.push(...ui.bullets(forms.map(form => ui.mono(form))));
        }

        if (guide?.examples?.length) {
            if (forms.length) lines.push('');
            lines.push(`${ui.EMOJI.example} ${ui.bold('Contoh')}`);

            const shown = guide.examples.slice(0, 5);
            lines.push(...ui.bullets(shown.map(example => ui.mono(example))));
            if (guide.examples.length > shown.length) {
                lines.push(ui.italic(`…dan ${guide.examples.length - shown.length} contoh lain`));
            }
        }

        if (guide?.platforms) {
            lines.push('', `🌐 ${ui.bold('Platform')}`, guide.platforms);
        }

        if (guide?.languages) {
            lines.push('', `🗣️ ${ui.bold('Bahasa')}`, guide.languages);
        }

        if (guide?.notes?.length) {
            lines.push('', `${ui.EMOJI.info} ${ui.bold('Catatan')}`);
            // Guide notes carry their own leading bullet; normalise it so the
            // whole panel uses one bullet character.
            lines.push(...guide.notes.map(note => note.replace(/^\s*[•\-*]\s*/, `${ui.SYM.dot} `)));
        }

        if (command.aliases?.length) {
            lines.push('', `${ui.EMOJI.alias} ${ui.bold('Alias')}`);
            lines.push(command.aliases.map(alias => ui.mono(prefix + alias)).join('  '));
        }

        await this.reply(sock, from, msg, ui.card({
            icon: this.getCategoryEmoji(command.category),
            title: prefix + command.name,
            rawTitle: true,
            lines,
            footer: `${this.getCategoryNameID(command.category)} ${ui.SYM.dot} ${config.bot.name}`
        }));
    }

    async sendCategoryHelp(sock, from, msg, category, isOwnerViewer = false) {
        const commands = this._visibleCommands(
            commandRegistry.getByCategory(category.toLowerCase()),
            isOwnerViewer
        );

        if (commands.length === 0) {
            return await this.replyError(sock, from, msg,
                `Kategori ${ui.mono(ui.truncate(category, 24))} tidak ada.`,
                { title: 'Tidak Ditemukan', hint: [`${config.bot.prefix}menu — lihat semua kategori`] }
            );
        }

        const prefix = config.bot.prefix;
        const lines = [];

        for (const cmd of commands.slice().sort((a, b) => a.name.localeCompare(b.name))) {
            const aliases = cmd.aliases?.length ? ` ${ui.SYM.dot} ${ui.italic(cmd.aliases.join(', '))}` : '';
            lines.push(`${ui.SYM.bullet} ${ui.bold(prefix + cmd.name)}${aliases}`);
            if (cmd.description) {
                lines.push(`   ${cmd.description}`);
            }
            if (cmd.usage) {
                lines.push(`   ${ui.mono(cmd.usage)}`);
            }
            lines.push('');
        }
        // Drop the trailing spacer so the card closes tight against the content.
        if (lines[lines.length - 1] === '') lines.pop();

        await this.reply(sock, from, msg, ui.card({
            icon: this.getCategoryEmoji(category),
            title: ui.smallCaps(this.getCategoryNameID(category.toLowerCase())),
            lines,
            footer: `${commands.length} perintah ${ui.SYM.dot} ${prefix}menu <perintah> untuk detail`
        }));
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
            'networking': '🌐',
            'security': '🔒'
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
            'networking': 'Jaringan',
            'security': 'Keamanan (Owner)'
        };
        return names[category.toLowerCase()] || category;
    }

}

module.exports = MenuCommand;
