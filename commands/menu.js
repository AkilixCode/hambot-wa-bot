/**
 * Menu Command
 * Menampilkan daftar perintah dan bantuan bot
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
            usage: '.menu [kategori]',
            category: 'general',
            cooldown: 3000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        await this.react(sock, msg, '📋');

        // Jika kategori ditentukan
        if (args[0]) {
            return await this.sendCategoryHelp(sock, from, msg, args[0]);
        }

        // Buat menu lengkap dengan dekorasi
        const categories = commandRegistry.getCategories();
        const menuSections = [];

        // Header dengan dekorasi estetik
        menuSections.push('╔════════════════════════════╗');
        menuSections.push(`║  🤖 *${config.bot.name.toUpperCase()}* 🤖  ║`);
        menuSections.push('╚════════════════════════════╝');
        menuSections.push('');
        menuSections.push('┌─────────────────────────────┐');
        menuSections.push('│  _Halo! Selamat datang!_  │');
        menuSections.push('│  _Berikut daftar perintah_  │');
        menuSections.push('│  _yang tersedia:_           │');
        menuSections.push('└─────────────────────────────┘');
        menuSections.push('');

        // Daftar perintah per kategori
        for (const category of categories.sort()) {
            const commands = commandRegistry.getByCategory(category);
            if (commands.length === 0) continue;

            const categoryName = this.getCategoryNameID(category);
            menuSections.push(`╭──「 ${this.getCategoryEmoji(category)} *${categoryName}* 」`);
            menuSections.push('│');
            
            for (const cmd of commands) {
                const aliases = cmd.aliases.length > 0 ? ` _(${cmd.aliases.join(', ')})_` : '';
                menuSections.push(`│ ▸ *${config.bot.prefix}${cmd.name}*${aliases}`);
                if (cmd.description) {
                    menuSections.push(`│    └ ${this.translateDescription(cmd.description)}`);
                }
            }
            menuSections.push('│');
            menuSections.push('╰────────────────────');
            menuSections.push('');
        }

        // Footer dengan tips
        menuSections.push('┌──────────────────────────┐');
        menuSections.push('│ 💡 *Tips:*');
        menuSections.push(`│ Ketik ${config.bot.prefix}menu <kategori>`);
        menuSections.push('│ untuk melihat detail perintah');
        menuSections.push('│');
        menuSections.push('│ 📌 *Contoh Populer:*');
        menuSections.push(`│ ▸ ${config.bot.prefix}say halo dunia`);
        menuSections.push(`│ ▸ ${config.bot.prefix}music lagu favorit`);
        menuSections.push(`│ ▸ ${config.bot.prefix}sticker (reply gambar)`);
        menuSections.push('└──────────────────────────┘');
        menuSections.push('');
        menuSections.push(`© 2025 ${config.bot.owner} ⚡`);

        const menuText = menuSections.join('\n');
        await this.reply(sock, from, msg, menuText);
        await this.react(sock, msg, '✅');
    }

    async sendCategoryHelp(sock, from, msg, category) {
        const commands = commandRegistry.getByCategory(category.toLowerCase());
        
        if (commands.length === 0) {
            return await this.reply(sock, from, msg, `❌ Kategori "${category}" tidak ditemukan.`);
        }

        const categoryName = this.getCategoryNameID(category.toLowerCase());
        const sections = [];
        
        sections.push('╔════════════════════════════╗');
        sections.push(`║ ${this.getCategoryEmoji(category)} *${categoryName.toUpperCase()}*`);
        sections.push('╚════════════════════════════╝');
        sections.push('');

        for (const cmd of commands) {
            sections.push(`╭──「 *${config.bot.prefix}${cmd.name}* 」`);
            if (cmd.description) {
                sections.push(`│ 📝 ${this.translateDescription(cmd.description)}`);
            }
            if (cmd.usage) {
                sections.push(`│ 💡 Cara pakai: ${cmd.usage}`);
            }
            if (cmd.aliases.length > 0) {
                sections.push(`│ 🔄 Alias: ${cmd.aliases.join(', ')}`);
            }
            sections.push('╰────────────────────');
            sections.push('');
        }

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
            'Ask AI any question using Gemini': 'Tanya AI apapun pakai Gemini',
            'Get a random inspirational quote': 'Dapatkan kutipan inspiratif acak',
            'Get a random joke': 'Dapatkan lelucon acak',
            'Get a random fact': 'Dapatkan fakta menarik acak',
            'Get a random meme': 'Dapatkan meme acak',
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
            'Cheat sheet dan referensi networking': 'Cheat sheet networking'
        };
        
        return translations[desc] || desc;
    }
}

module.exports = MenuCommand;
