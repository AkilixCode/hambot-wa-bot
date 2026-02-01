/**
 * Security Command
 * Comprehensive security management for bot owners
 * 
 * Commands:
 * .security - Show status and help
 * .security status - Show detailed security status
 * .security restart - Restart PM2 bot process (no confirmation needed)
 * .security stop - Stop PM2 bot process (no confirmation needed)
 * .security disable <feature> - Disable security feature
 * .security enable <feature> - Enable security feature
 * .security unblock <number> - Unblock a specific user
 * .security unblock all - Unblock all users
 * .security block <number> <minutes> - Block a user manually
 * .security list - List all blocked users
 */

const CommandBase = require('./base');
const security = require('../utils/security');
const config = require('../config');
const { spawn } = require('child_process');

class SecurityCommand extends CommandBase {
    constructor() {
        super({
            name: 'security',
            aliases: ['sec', 'secstatus'],
            description: 'Panel manajemen keamanan (Khusus Owner)',
            usage: '.security [subcommand] [args]',
            category: 'system',
            cooldown: 2000
        });
    }

    async execute(sock, msg, args, context) {
        const { from, sender } = context;

        // CRITICAL: Verify owner identity using centralized config
        if (!config.bot.ownerId) {
            return await this.reply(sock, from, msg, 
                '⚠️ *Peringatan Keamanan*\n\n' +
                'BOT_OWNER_ID belum dikonfigurasi!\n' +
                'Atur di file .env untuk mengaktifkan perintah keamanan.\n\n' +
                'Format: BOT_OWNER_ID=6281234567890@s.whatsapp.net');
        }

        // Use centralized owner check
        if (!config.isOwner(sender)) {
            // Log unauthorized access attempt with full sender ID
            security.logSecurityEvent('unauthorized_security_access', {
                userId: sender,
                attemptedCommand: args.join(' ')
            });
            return await this.reply(sock, from, msg, 
                '🔒 *Akses Ditolak*\n\n' +
                'Perintah ini hanya untuk owner bot.\n' +
                `Pengirim: ${sender}`);
        }

        await this.react(sock, msg, '🔒');

        const subcommand = args[0]?.toLowerCase() || 'help';

        try {
            switch (subcommand) {
                case 'help':
                    return await this.showHelp(sock, from, msg);
                    
                case 'status':
                    return await this.showStatus(sock, from, msg);
                    
                case 'restart':
                    return await this.handleRestart(sock, from, msg);
                    
                case 'stop':
                    return await this.handleStop(sock, from, msg);
                    
                case 'disable':
                    return await this.handleDisable(sock, from, msg, args.slice(1));
                    
                case 'enable':
                    return await this.handleEnable(sock, from, msg, args.slice(1));
                    
                case 'unblock':
                    return await this.handleUnblock(sock, from, msg, args.slice(1));
                    
                case 'block':
                    return await this.handleBlock(sock, from, msg, args.slice(1));
                    
                case 'list':
                    return await this.listBlockedUsers(sock, from, msg);
                    
                default:
                    return await this.showHelp(sock, from, msg);
            }
        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, '❌ Perintah keamanan gagal: ' + error.message);
        }
    }

    async showHelp(sock, from, msg) {
        const helpText = 
`🔒 *PANEL MANAJEMEN KEAMANAN*

📌 *Perintah Tersedia:*

*Status & Info*
\`.security status\` - Lihat status detail
\`.security list\` - Daftar pengguna terblokir

*Kontrol Fitur*
\`.security enable <fitur>\` - Aktifkan fitur
\`.security disable <fitur>\` - Nonaktifkan fitur

*Manajemen Pengguna*
\`.security unblock <nomor>\` - Buka blokir
\`.security unblock all\` - Buka blokir semua
\`.security block <nomor> <menit>\` - Blokir pengguna

*Kontrol Bot*
\`.security restart\` - Restart bot (PM2)
\`.security stop\` - Hentikan bot (PM2)

🛡️ *Fitur:* chatFilter, rateLimit, autoBlock`;

        await this.reply(sock, from, msg, helpText);
        await this.react(sock, msg, '✅');
    }

    async showStatus(sock, from, msg) {
        const stats = security.getStats();
        const configChatFilter = config.security.chatFilterEnabled;
        
        let response = 
`🔒 *STATUS KEAMANAN*

📊 *Statistik*
• Pengguna Terblokir: ${stats.blockedUsers}
• Aktivitas Mencurigakan: ${stats.suspiciousActivityTracked}
• Event Keamanan: ${stats.securityEvents}

⚙️ *Pengaturan Config*
• Filter Chat (config): ${configChatFilter ? '✅ AKTIF' : '❌ NONAKTIF'}

🔄 *Pengaturan Runtime*
• Filter Chat: ${stats.runtimeSettings.chatFilterEnabled ? '✅ AKTIF' : '❌ NONAKTIF'}
• Rate Limiting: ${stats.runtimeSettings.rateLimitEnabled ? '✅ AKTIF' : '❌ NONAKTIF'}
• Auto-Block: ${stats.runtimeSettings.autoBlockEnabled ? '✅ AKTIF' : '❌ NONAKTIF'}

👤 *Owner ID:* ${config.bot.ownerId || 'Belum dikonfigurasi'}

`;

        if (stats.recentBlocks.length > 0) {
            response += `⛔ *Blokir Terbaru:*\n`;
            for (const block of stats.recentBlocks.slice(0, 5)) {
                const timeLeft = Math.ceil(block.expiresIn / 1000 / 60);
                response += `• ${block.userId}: ${block.reason} (${timeLeft}m tersisa)\n`;
            }
        } else {
            response += `✅ *Tidak Ada Blokir Aktif*\n`;
        }

        response += `\n🛡️ *Proteksi Aktif:*\n`;
        response += `• Sanitasi input\n`;
        response += `• Deteksi pola berbahaya\n`;
        response += `• Pemeriksaan izin\n`;
        response += `• Whitelist tag ekspresi\n`;

        await this.reply(sock, from, msg, response);
        await this.react(sock, msg, '✅');
    }

    async handleRestart(sock, from, msg) {
        // Get PM2 process name from env or default to 'hambot'
        const pm2ProcessName = process.env.PM2_PROCESS_NAME || 'hambot';
        
        await this.reply(sock, from, msg, 
            '🔄 *Me-restart proses bot...*\n\n' +
            `Proses PM2: ${pm2ProcessName}\n` +
            'Bot akan kembali dalam beberapa detik.');

        // Give time for the message to send
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Execute PM2 restart
        try {
            const pm2Restart = spawn('pm2', ['restart', pm2ProcessName], {
                detached: true,
                stdio: 'ignore'
            });
            pm2Restart.unref();
        } catch (error) {
            // If PM2 fails, try graceful restart via process exit
            // PM2 should auto-restart the process
            process.exit(0);
        }
    }

    async handleStop(sock, from, msg) {
        // Get PM2 process name from env or default to 'hambot'
        const pm2ProcessName = process.env.PM2_PROCESS_NAME || 'hambot';
        
        await this.reply(sock, from, msg, 
            '🛑 *Menghentikan proses bot...*\n\n' +
            `Selamat tinggal! Gunakan \`pm2 start ${pm2ProcessName}\` untuk restart.`);

        // Give time for the message to send
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Try PM2 stop first, then fallback to process.exit
        try {
            const pm2Stop = spawn('pm2', ['stop', pm2ProcessName], {
                detached: true,
                stdio: 'ignore'
            });
            pm2Stop.unref();
        } catch (error) {
            // If PM2 fails, exit the process directly
            process.exit(0);
        }
    }

    async handleDisable(sock, from, msg, args) {
        const feature = args[0]?.toLowerCase();
        
        if (!feature) {
            return await this.reply(sock, from, msg, 
                '❌ Tentukan fitur yang ingin dinonaktifkan.\n\n' +
                '*Fitur tersedia:*\n' +
                '• `chatFilter` - Filter konten pesan\n' +
                '• `rateLimit` - Pembatasan request\n' +
                '• `autoBlock` - Blokir otomatis pengguna');
        }

        const validFeatures = ['chatFilter', 'rateLimit', 'autoBlock'];
        const normalizedFeature = validFeatures.find(f => f.toLowerCase() === feature);
        
        if (!normalizedFeature) {
            return await this.reply(sock, from, msg, 
                `❌ Fitur tidak dikenal: ${feature}\n\n` +
                `Fitur valid: ${validFeatures.join(', ')}`);
        }

        security.toggleFeature(normalizedFeature, false);
        
        await this.reply(sock, from, msg, 
            `⚙️ *Fitur Keamanan Diperbarui*\n\n` +
            `Fitur: ${normalizedFeature}\n` +
            `Status: ❌ NONAKTIF\n\n` +
            `⚠️ Peringatan: Menonaktifkan fitur keamanan dapat membuat bot rentan terhadap penyalahgunaan.`);
        await this.react(sock, msg, '✅');
    }

    async handleEnable(sock, from, msg, args) {
        const feature = args[0]?.toLowerCase();
        
        if (!feature) {
            return await this.reply(sock, from, msg, 
                '❌ Tentukan fitur yang ingin diaktifkan.\n\n' +
                '*Fitur tersedia:*\n' +
                '• `chatFilter` - Filter konten pesan\n' +
                '• `rateLimit` - Pembatasan request\n' +
                '• `autoBlock` - Blokir otomatis pengguna');
        }

        const validFeatures = ['chatFilter', 'rateLimit', 'autoBlock'];
        const normalizedFeature = validFeatures.find(f => f.toLowerCase() === feature);
        
        if (!normalizedFeature) {
            return await this.reply(sock, from, msg, 
                `❌ Fitur tidak dikenal: ${feature}\n\n` +
                `Fitur valid: ${validFeatures.join(', ')}`);
        }

        security.toggleFeature(normalizedFeature, true);
        
        await this.reply(sock, from, msg, 
            `⚙️ *Fitur Keamanan Diperbarui*\n\n` +
            `Fitur: ${normalizedFeature}\n` +
            `Status: ✅ AKTIF`);
        await this.react(sock, msg, '✅');
    }

    async handleUnblock(sock, from, msg, args) {
        const target = args[0]?.toLowerCase();
        
        if (!target) {
            return await this.reply(sock, from, msg, 
                '❌ Tentukan pengguna yang ingin dibuka blokirnya.\n\n' +
                '*Cara Pakai:*\n' +
                '• `.security unblock 62812345678` - Buka blokir pengguna tertentu\n' +
                '• `.security unblock all` - Buka blokir semua pengguna');
        }

        if (target === 'all') {
            const count = security.clearAllBlocks();
            await this.reply(sock, from, msg, 
                `✅ *Semua Pengguna Dibuka Blokirnya*\n\n` +
                `Membersihkan ${count} pengguna terblokir.`);
            await this.react(sock, msg, '✅');
            return;
        }

        // Convert phone number to WhatsApp ID format
        const userId = target.includes('@') ? target : `${target}@s.whatsapp.net`;
        const success = security.unblockUser(userId);
        
        if (success) {
            await this.reply(sock, from, msg, 
                `✅ *Pengguna Dibuka Blokirnya*\n\n` +
                `Pengguna: ${target}`);
        } else {
            await this.reply(sock, from, msg, 
                `❌ Pengguna tidak ditemukan dalam daftar blokir: ${target}`);
        }
        await this.react(sock, msg, '✅');
    }

    async handleBlock(sock, from, msg, args) {
        const target = args[0];
        const minutes = parseInt(args[1]) || 60;
        
        if (!target) {
            return await this.reply(sock, from, msg, 
                '❌ Tentukan pengguna yang ingin diblokir.\n\n' +
                '*Cara Pakai:*\n' +
                '`.security block 62812345678 60` - Blokir selama 60 menit');
        }

        // Convert phone number to WhatsApp ID format
        const userId = target.includes('@') ? target : `${target}@s.whatsapp.net`;
        const durationMs = minutes * 60 * 1000;
        
        security.blockUser(userId, durationMs, 'Diblokir manual oleh owner');
        
        await this.reply(sock, from, msg, 
            `⛔ *Pengguna Diblokir*\n\n` +
            `Pengguna: ${target}\n` +
            `Durasi: ${minutes} menit\n` +
            `Alasan: Diblokir manual oleh owner`);
        await this.react(sock, msg, '✅');
    }

    async listBlockedUsers(sock, from, msg) {
        const blockedUsers = security.getBlockedUsers();
        
        if (blockedUsers.length === 0) {
            await this.reply(sock, from, msg, '✅ *Tidak ada pengguna yang terblokir saat ini.*');
            await this.react(sock, msg, '✅');
            return;
        }

        let response = `⛔ *PENGGUNA TERBLOKIR (${blockedUsers.length})*\n\n`;
        
        for (const user of blockedUsers.slice(0, 10)) {
            const minsLeft = Math.ceil(user.expiresIn / 1000 / 60);
            response += `• ${user.userIdShort}\n`;
            response += `  Alasan: ${user.reason}\n`;
            response += `  Berakhir dalam: ${minsLeft} menit\n\n`;
        }

        if (blockedUsers.length > 10) {
            response += `... dan ${blockedUsers.length - 10} lainnya`;
        }

        await this.reply(sock, from, msg, response);
        await this.react(sock, msg, '✅');
    }
}

module.exports = SecurityCommand;
