/**
 * Security Command - Full Owner Control Panel
 * Comprehensive bot management and security for bot owners
 * 
 * Commands:
 * .security - Show status and help
 * .security status - Show detailed security status
 * .security uptime - Show bot uptime, memory, and system info
 * .security env - View current runtime configuration (non-sensitive)
 * .security logs [lines] - Pull recent logs and send as text to chat
 * .security restart - Restart PM2 bot process (no confirmation needed)
 * .security stop - Stop PM2 bot process (no confirmation needed)
 * .security disable <feature> - Disable security feature
 * .security enable <feature> - Enable security feature
 * .security owneronly <on|off> - Toggle owner-only/group-only mode
 * .security setcooldown <ms> - Change default cooldown at runtime
 * .security setprefix <prefix> - Change bot command prefix at runtime
 * .security setmaxproc <n> - Change max concurrent heavy processes
 * .security clearcache - Clear bot cache
 * .security broadcast <jid> <message> - Send message to a specific chat
 * .security unblock <number> - Unblock a specific user
 * .security unblock all - Unblock all users
 * .security block <number> <minutes> - Block a user manually
 * .security list - List all blocked users
 */

const CommandBase = require('./base');
const security = require('../utils/security');
const config = require('../config');
const cache = require('../utils/cache');
const logger = require('../utils/logger');
const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

// Track bot start time for uptime calculation
const botStartTime = Date.now();

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

    /**
     * Execute the security owner panel command
     * @param {import('@whiskeysockets/baileys').WASocket} sock - WhatsApp socket
     * @param {Object} msg - Message object from Baileys
     * @param {string[]} args - Command arguments
     * @param {Object} context - Execution context
     */
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
                    
                case 'uptime':
                    return await this.showUptime(sock, from, msg);

                case 'env':
                    return await this.showEnv(sock, from, msg);

                case 'logs':
                case 'log':
                    return await this.handleLogs(sock, from, msg, args.slice(1));

                case 'restart':
                    return await this.handleRestart(sock, from, msg);
                    
                case 'stop':
                    return await this.handleStop(sock, from, msg);
                    
                case 'disable':
                    return await this.handleDisable(sock, from, msg, args.slice(1));
                    
                case 'enable':
                    return await this.handleEnable(sock, from, msg, args.slice(1));

                case 'owneronly':
                    return await this.handleOwnerOnly(sock, from, msg, args.slice(1));

                case 'setcooldown':
                    return await this.handleSetCooldown(sock, from, msg, args.slice(1));

                case 'setprefix':
                    return await this.handleSetPrefix(sock, from, msg, args.slice(1));

                case 'setmaxproc':
                    return await this.handleSetMaxProc(sock, from, msg, args.slice(1));

                case 'clearcache':
                    return await this.handleClearCache(sock, from, msg);

                case 'broadcast':
                case 'bc':
                    return await this.handleBroadcast(sock, from, msg, args.slice(1));
                    
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
`🔒 *OWNER CONTROL PANEL*

📌 *Perintah Tersedia:*

*📊 Status & Info*
\`.security status\` - Lihat status keamanan detail
\`.security uptime\` - Info uptime, memori & sistem
\`.security env\` - Lihat pengaturan runtime
\`.security list\` - Daftar pengguna terblokir

*📋 Log*
\`.security logs\` - Lihat 20 baris log terakhir
\`.security logs <jumlah>\` - Lihat N baris log terakhir

*⚙️ Kontrol Fitur Keamanan*
\`.security enable <fitur>\` - Aktifkan fitur
\`.security disable <fitur>\` - Nonaktifkan fitur
  _Fitur: chatFilter, rateLimit, autoBlock_

*🔧 Pengaturan Bot*
\`.security owneronly <on|off>\` - Mode owner-only (abaikan chat privat)
\`.security setcooldown <ms>\` - Ubah cooldown default
\`.security setprefix <prefix>\` - Ubah prefix perintah
\`.security setmaxproc <n>\` - Ubah maks proses berat

*🗑️ Maintenance*
\`.security clearcache\` - Bersihkan cache bot

*👤 Manajemen Pengguna*
\`.security block <nomor> <menit>\` - Blokir pengguna
\`.security unblock <nomor>\` - Buka blokir
\`.security unblock all\` - Buka blokir semua

*📢 Komunikasi*
\`.security broadcast <jid> <pesan>\` - Kirim pesan ke chat tertentu

*🔄 Kontrol Bot*
\`.security restart\` - Restart bot (PM2)
\`.security stop\` - Hentikan bot (PM2)`;

        await this.reply(sock, from, msg, helpText);
        await this.react(sock, msg, '✅');
    }

    async showStatus(sock, from, msg) {
        const stats = security.getStats();
        const configChatFilter = config.security.chatFilterEnabled;
        const uptimeMs = Date.now() - botStartTime;
        const uptimeStr = this._formatDuration(uptimeMs);
        
        let response = 
`🔒 *STATUS KEAMANAN*

⏱️ *Uptime:* ${uptimeStr}

📊 *Statistik*
• Pengguna Terblokir: ${stats.blockedUsers}
• Aktivitas Mencurigakan: ${stats.suspiciousActivityTracked}
• Event Keamanan: ${stats.securityEvents}

⚙️ *Pengaturan Config*
• Filter Chat (config): ${configChatFilter ? '✅ AKTIF' : '❌ NONAKTIF'}
• Owner-Only Mode: ${config.bot.onlyGroupMode ? '✅ AKTIF' : '❌ NONAKTIF'}

🔄 *Pengaturan Runtime*
• Filter Chat: ${stats.runtimeSettings.chatFilterEnabled ? '✅ AKTIF' : '❌ NONAKTIF'}
• Rate Limiting: ${stats.runtimeSettings.rateLimitEnabled ? '✅ AKTIF' : '❌ NONAKTIF'}
• Auto-Block: ${stats.runtimeSettings.autoBlockEnabled ? '✅ AKTIF' : '❌ NONAKTIF'}

🔧 *Bot Settings*
• Prefix: ${config.bot.prefix}
• Cooldown: ${config.performance.cooldownMs}ms
• Max Proses: ${config.performance.maxProcesses}

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

    /**
     * Show bot uptime, memory usage, and system information
     */
    async showUptime(sock, from, msg) {
        const uptimeMs = Date.now() - botStartTime;
        const uptimeStr = this._formatDuration(uptimeMs);
        const systemUptime = this._formatDuration(os.uptime() * 1000);
        
        const memUsage = process.memoryUsage();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const cacheStats = cache.getStats();

        const response = 
`⏱️ *BOT UPTIME & SYSTEM INFO*

🤖 *Bot*
• Uptime: ${uptimeStr}
• PID: ${process.pid}
• Node.js: ${process.version}
• Platform: ${process.platform} ${process.arch}

💾 *Memori Bot*
• Heap Used: ${this._formatBytes(memUsage.heapUsed)}
• Heap Total: ${this._formatBytes(memUsage.heapTotal)}
• RSS: ${this._formatBytes(memUsage.rss)}
• External: ${this._formatBytes(memUsage.external)}

🖥️ *Sistem*
• OS: ${os.type()} ${os.release()}
• Uptime Sistem: ${systemUptime}
• CPU: ${os.cpus()[0]?.model || 'N/A'} (${os.cpus().length} core)
• RAM Total: ${this._formatBytes(totalMem)}
• RAM Free: ${this._formatBytes(freeMem)}
• RAM Used: ${((1 - freeMem / totalMem) * 100).toFixed(1)}%

📦 *Cache*
• Entri: ${cacheStats.size}
• Hits: ${cacheStats.hits}
• Misses: ${cacheStats.misses}
• Hit Rate: ${cacheStats.hitRate}`;

        await this.reply(sock, from, msg, response);
        await this.react(sock, msg, '✅');
    }

    /**
     * Show current runtime environment settings (non-sensitive only)
     */
    async showEnv(sock, from, msg) {
        const response = 
`⚙️ *PENGATURAN RUNTIME*

🤖 *Bot*
• Nama: ${config.bot.name}
• Owner: ${config.bot.owner}
• Prefix: ${config.bot.prefix}
• Owner-Only Mode: ${config.bot.onlyGroupMode ? '✅ AKTIF' : '❌ NONAKTIF'}
• Owner IDs: ${config.bot.ownerIds.length > 0 ? config.bot.ownerIds.map(id => id.split('@')[0]).join(', ') : 'Belum dikonfigurasi'}
• Owner-Only Commands: ${config.bot.ownerOnlyCommands.join(', ')}

⚡ *Performance*
• Max Proses: ${config.performance.maxProcesses}
• Cooldown: ${config.performance.cooldownMs}ms
• Rate Limit Window: ${config.performance.rateLimitWindow}ms
• Rate Limit Max: ${config.performance.rateLimitMax}
• Cache Expiration: ${config.performance.cacheExpiration}ms

🎵 *Media*
• Max Durasi: ${config.media.maxDuration}s
• Max File Size: ${config.media.maxFileSize}
• Proxy: ${config.media.proxyUrl ? '✅ Dikonfigurasi' : '❌ Tidak ada'}

🔒 *Keamanan*
• Chat Filter (config): ${config.security.chatFilterEnabled ? '✅' : '❌'}

🌐 *Proxy*
• Enabled: ${config.proxy.enabled ? '✅' : '❌'}
• Type: ${config.proxy.type}
• Host: ${config.proxy.host || 'N/A'}
• Port: ${config.proxy.port || 'N/A'}

📊 *Logging*
• Level: ${config.logging.level}
• Silent: ${config.logging.silent ? '✅' : '❌'}

🔑 *API Keys*
• ElevenLabs: ${config.apis.elevenlabs.key ? '✅ Dikonfigurasi' : '❌ Belum'}
• OMDB: ${config.apis.omdb.key ? '✅ Dikonfigurasi' : '❌ Belum'}
• Gemini: ${config.apis.gemini.key ? '✅ Dikonfigurasi' : '❌ Belum'}`;

        await this.reply(sock, from, msg, response);
        await this.react(sock, msg, '✅');
    }

    /**
     * Pull recent logs and send as text to WhatsApp chat
     * Captures stdout/stderr from PM2 log files or process output
     */
    async handleLogs(sock, from, msg, args) {
        const lineCount = Math.min(parseInt(args[0]) || 20, 100);
        
        await this.react(sock, msg, '⏳');

        try {
            // Try multiple log sources in order of preference
            let logContent = null;

            // 1. Try PM2 log files first
            const pm2ProcessName = process.env.PM2_PROCESS_NAME || 'hambot';
            const pm2LogPaths = [
                path.join(os.homedir(), `.pm2/logs/${pm2ProcessName}-out.log`),
                path.join(os.homedir(), `.pm2/logs/${pm2ProcessName}-error.log`),
                '/var/log/hambot.log'
            ];

            for (const logPath of pm2LogPaths) {
                try {
                    if (fs.existsSync(logPath)) {
                        const content = fs.readFileSync(logPath, 'utf8');
                        const lines = content.trim().split('\n');
                        const recentLines = lines.slice(-lineCount);
                        logContent = {
                            source: path.basename(logPath),
                            lines: recentLines,
                            totalLines: lines.length
                        };
                        break;
                    }
                } catch (readErr) {
                    // Try next log source
                }
            }

            // 2. If no PM2 logs, try to get PM2 logs via command
            if (!logContent) {
                try {
                    logContent = await this._getPm2Logs(pm2ProcessName, lineCount);
                } catch (pm2Err) {
                    // PM2 not available
                }
            }

            // 3. Fallback: Show security event logs from memory
            if (!logContent) {
                logContent = this._getInMemoryLogs(lineCount);
            }

            if (!logContent || logContent.lines.length === 0) {
                return await this.reply(sock, from, msg, 
                    '📋 *Log Bot*\n\n' +
                    'Tidak ada log yang tersedia.\n\n' +
                    '_Tip: Pastikan PM2 digunakan untuk manajemen log, atau log file tersedia._');
            }

            const logText = logContent.lines.join('\n');
            
            // If log is short enough, send as text message
            if (logText.length <= 4000) {
                await this.reply(sock, from, msg, 
                    `📋 *Log Bot* (${logContent.lines.length} baris terakhir)\n` +
                    `📂 Sumber: ${logContent.source}\n` +
                    `📊 Total: ${logContent.totalLines} baris\n\n` +
                    logText);
            } else {
                // Send as document/file for longer logs
                const logBuffer = Buffer.from(
                    `HamBot Log Export\n` +
                    `Source: ${logContent.source}\n` +
                    `Date: ${new Date().toISOString()}\n` +
                    `Lines: ${logContent.lines.length} of ${logContent.totalLines}\n` +
                    `${'='.repeat(60)}\n\n` +
                    logText,
                    'utf8'
                );

                await sock.sendMessage(from, {
                    document: logBuffer,
                    mimetype: 'text/plain',
                    fileName: `hambot-logs-${Date.now()}.txt`,
                    caption: `📋 Log Bot (${logContent.lines.length} baris dari ${logContent.source})`
                }, { quoted: msg });
            }

            await this.react(sock, msg, '✅');
        } catch (error) {
            this.logError(error, { context: 'logs-retrieval' });
            await this.reply(sock, from, msg, '❌ Gagal mengambil log: ' + error.message);
        }
    }

    /**
     * Get PM2 logs via spawn command
     * @param {string} processName - PM2 process name
     * @param {number} lineCount - Number of lines to retrieve
     * @returns {Promise<Object>} Log content
     */
    _getPm2Logs(processName, lineCount) {
        return new Promise((resolve, reject) => {
            const chunks = [];
            const pm2Log = spawn('pm2', ['logs', processName, '--nostream', '--lines', String(lineCount)], {
                timeout: 5000
            });

            pm2Log.stdout.on('data', (data) => chunks.push(data.toString()));
            pm2Log.stderr.on('data', (data) => chunks.push(data.toString()));

            pm2Log.on('close', (code) => {
                const output = chunks.join('').trim();
                if (output) {
                    const lines = output.split('\n').filter(l => l.trim());
                    resolve({
                        source: `pm2 logs ${processName}`,
                        lines: lines.slice(-lineCount),
                        totalLines: lines.length
                    });
                } else {
                    reject(new Error('No PM2 log output'));
                }
            });

            pm2Log.on('error', reject);
        });
    }

    /**
     * Get in-memory security event logs as fallback
     * @param {number} lineCount - Number of entries to retrieve
     * @returns {Object} Log content from memory
     */
    _getInMemoryLogs(lineCount) {
        const stats = security.getStats();
        const lines = [];

        lines.push(`[${new Date().toISOString()}] Bot uptime: ${this._formatDuration(Date.now() - botStartTime)}`);
        lines.push(`[${new Date().toISOString()}] Blocked users: ${stats.blockedUsers}`);
        lines.push(`[${new Date().toISOString()}] Security events: ${stats.securityEvents}`);
        lines.push(`[${new Date().toISOString()}] Suspicious activity tracked: ${stats.suspiciousActivityTracked}`);
        
        // Add recent blocks info
        for (const block of stats.recentBlocks.slice(0, 10)) {
            const timeLeft = Math.ceil(block.expiresIn / 1000 / 60);
            lines.push(`[BLOCK] ${block.userId}: ${block.reason} (${timeLeft}m left)`);
        }

        // Add runtime settings
        lines.push(`[CONFIG] chatFilter: ${stats.runtimeSettings.chatFilterEnabled}`);
        lines.push(`[CONFIG] rateLimit: ${stats.runtimeSettings.rateLimitEnabled}`);
        lines.push(`[CONFIG] autoBlock: ${stats.runtimeSettings.autoBlockEnabled}`);
        lines.push(`[CONFIG] ownerOnly: ${config.bot.onlyGroupMode}`);
        lines.push(`[CONFIG] prefix: ${config.bot.prefix}`);
        lines.push(`[CONFIG] cooldown: ${config.performance.cooldownMs}ms`);
        lines.push(`[CONFIG] maxProcesses: ${config.performance.maxProcesses}`);
        
        // Memory info
        const mem = process.memoryUsage();
        lines.push(`[MEMORY] heap: ${this._formatBytes(mem.heapUsed)}/${this._formatBytes(mem.heapTotal)}`);
        lines.push(`[MEMORY] rss: ${this._formatBytes(mem.rss)}`);

        return {
            source: 'in-memory (no log file available)',
            lines: lines.slice(-lineCount),
            totalLines: lines.length
        };
    }

    /**
     * Toggle owner-only mode (ignore private chat messages)
     */
    async handleOwnerOnly(sock, from, msg, args) {
        const mode = args[0]?.toLowerCase();

        if (!mode || !['on', 'off'].includes(mode)) {
            return await this.reply(sock, from, msg, 
                '❌ Tentukan mode: on atau off\n\n' +
                '*Cara Pakai:*\n' +
                '• `.security owneronly on` - Aktifkan (abaikan chat privat)\n' +
                '• `.security owneronly off` - Nonaktifkan (respon semua chat)\n\n' +
                `Status saat ini: ${config.bot.onlyGroupMode ? '✅ AKTIF' : '❌ NONAKTIF'}`);
        }

        const newState = mode === 'on';
        config.bot.onlyGroupMode = newState;

        await this.reply(sock, from, msg, 
            `⚙️ *Owner-Only Mode Diperbarui*\n\n` +
            `Status: ${newState ? '✅ AKTIF' : '❌ NONAKTIF'}\n\n` +
            `${newState 
                ? '_Bot hanya akan merespon di grup. Chat privat akan diabaikan._' 
                : '_Bot akan merespon semua chat (privat & grup)._'}`);
        await this.react(sock, msg, '✅');
    }

    /**
     * Change default cooldown at runtime
     */
    async handleSetCooldown(sock, from, msg, args) {
        const newCooldown = parseInt(args[0]);

        if (!args[0] || isNaN(newCooldown)) {
            return await this.reply(sock, from, msg,
                '❌ Tentukan cooldown dalam milidetik.\n\n' +
                '*Cara Pakai:*\n' +
                '• `.security setcooldown 2000` - Set cooldown 2 detik\n' +
                '• `.security setcooldown 5000` - Set cooldown 5 detik\n\n' +
                `Cooldown saat ini: ${config.performance.cooldownMs}ms`);
        }

        if (newCooldown < 500 || newCooldown > 30000) {
            return await this.reply(sock, from, msg,
                '❌ Cooldown harus antara 500ms dan 30000ms (30 detik).');
        }

        const oldCooldown = config.performance.cooldownMs;
        config.performance.cooldownMs = newCooldown;

        await this.reply(sock, from, msg,
            `⚙️ *Cooldown Diperbarui*\n\n` +
            `Sebelum: ${oldCooldown}ms\n` +
            `Sesudah: ${newCooldown}ms\n\n` +
            `_Perubahan berlaku untuk perintah selanjutnya._`);
        await this.react(sock, msg, '✅');
    }

    /**
     * Change bot command prefix at runtime
     */
    async handleSetPrefix(sock, from, msg, args) {
        const newPrefix = args[0];

        if (!newPrefix) {
            return await this.reply(sock, from, msg,
                '❌ Tentukan prefix baru.\n\n' +
                '*Cara Pakai:*\n' +
                '• `.security setprefix !` - Ubah prefix ke !\n' +
                '• `.security setprefix /` - Ubah prefix ke /\n' +
                '• `.security setprefix .` - Ubah prefix ke .\n\n' +
                `Prefix saat ini: ${config.bot.prefix}`);
        }

        if (newPrefix.length > 3) {
            return await this.reply(sock, from, msg,
                '❌ Prefix terlalu panjang (maks 3 karakter).');
        }

        const oldPrefix = config.bot.prefix;
        config.bot.prefix = newPrefix;

        await this.reply(sock, from, msg,
            `⚙️ *Prefix Diperbarui*\n\n` +
            `Sebelum: ${oldPrefix}\n` +
            `Sesudah: ${newPrefix}\n\n` +
            `_Gunakan \`${newPrefix}security\` untuk perintah selanjutnya._`);
        await this.react(sock, msg, '✅');
    }

    /**
     * Change max concurrent heavy processes
     */
    async handleSetMaxProc(sock, from, msg, args) {
        const newMax = parseInt(args[0]);

        if (!args[0] || isNaN(newMax)) {
            return await this.reply(sock, from, msg,
                '❌ Tentukan jumlah maks proses.\n\n' +
                '*Cara Pakai:*\n' +
                '• `.security setmaxproc 3` - Maks 3 proses berat\n' +
                '• `.security setmaxproc 5` - Maks 5 proses berat\n\n' +
                `Saat ini: ${config.performance.maxProcesses}`);
        }

        if (newMax < 1 || newMax > 20) {
            return await this.reply(sock, from, msg,
                '❌ Jumlah maks proses harus antara 1 dan 20.');
        }

        const oldMax = config.performance.maxProcesses;
        config.performance.maxProcesses = newMax;

        await this.reply(sock, from, msg,
            `⚙️ *Max Proses Diperbarui*\n\n` +
            `Sebelum: ${oldMax}\n` +
            `Sesudah: ${newMax}\n\n` +
            `_Perubahan berlaku segera._`);
        await this.react(sock, msg, '✅');
    }

    /**
     * Clear bot cache
     */
    async handleClearCache(sock, from, msg) {
        const statsBefore = cache.getStats();
        cache.clear();
        const statsAfter = cache.getStats();

        await this.reply(sock, from, msg,
            `🗑️ *Cache Dibersihkan*\n\n` +
            `📦 Entri dihapus: ${statsBefore.size}\n` +
            `📊 Stats sebelum:\n` +
            `  • Hits: ${statsBefore.hits}\n` +
            `  • Misses: ${statsBefore.misses}\n` +
            `  • Hit Rate: ${statsBefore.hitRate}\n\n` +
            `✅ Cache sekarang kosong.`);
        await this.react(sock, msg, '✅');
    }

    /**
     * Broadcast a message to a specific chat JID
     */
    async handleBroadcast(sock, from, msg, args) {
        if (args.length < 2) {
            return await this.reply(sock, from, msg,
                '❌ Tentukan tujuan dan pesan.\n\n' +
                '*Cara Pakai:*\n' +
                '• `.security broadcast 6281234567890@s.whatsapp.net Halo!`\n' +
                '• `.security broadcast 120363xxx@g.us Pengumuman penting`\n\n' +
                '_Format JID: nomor@s.whatsapp.net (privat) atau id@g.us (grup)_');
        }

        const targetJid = args[0];
        const message = args.slice(1).join(' ');

        // Basic JID validation
        if (!targetJid.includes('@')) {
            return await this.reply(sock, from, msg,
                '❌ Format JID tidak valid.\n\n' +
                'Gunakan format:\n' +
                '• `nomor@s.whatsapp.net` untuk chat privat\n' +
                '• `id@g.us` untuk grup');
        }

        try {
            await sock.sendMessage(targetJid, { text: message });
            await this.reply(sock, from, msg,
                `📢 *Pesan Terkirim*\n\n` +
                `📬 Tujuan: ${targetJid}\n` +
                `💬 Pesan: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`);
            await this.react(sock, msg, '✅');
        } catch (error) {
            this.logError(error, { context: 'broadcast' });
            await this.reply(sock, from, msg,
                `❌ Gagal mengirim pesan ke ${targetJid}\n\n` +
                `Error: ${error.message}`);
        }
    }

    async handleRestart(sock, from, msg) {
        // Get PM2 process name from env or default to 'hambot'
        const pm2ProcessName = process.env.PM2_PROCESS_NAME || 'hambot';
        
        await this.reply(sock, from, msg, 
            '🔄 *Me-restart proses bot...*\n\n' +
            `Proses PM2: ${pm2ProcessName}\n` +
            'Bot akan kembali dalam beberapa detik.\n' +
            '_Catatan: Pastikan PM2 dikonfigurasi dengan auto-restart._');

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
            // Note: This assumes PM2 is configured with auto-restart enabled
            // If not using PM2, the process will simply exit
            this.logError(error, { context: 'pm2-restart-fallback' });
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

    /**
     * Parse target user from various input formats
     * Supports: mentions, phone numbers, @lid format, @s.whatsapp.net format
     * @param {string} input - User input
     * @param {Object} msg - Message object (for extracting mentioned users)
     * @returns {Object} { userId: string, displayName: string } or null
     */
    parseBlockTarget(input, msg) {
        if (!input) return null;
        
        // Check if there's a mentioned user in the message
        const mentionedJid = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
        if (mentionedJid && mentionedJid.length > 0) {
            // Use the first mentioned user
            const jid = mentionedJid[0];
            return { userId: jid, displayName: jid.split('@')[0] };
        }
        
        // Check if input already has @ suffix
        if (input.includes('@')) {
            return { userId: input.trim(), displayName: input.split('@')[0] };
        }
        
        // Handle phone number input
        let number = input.replace(/\D/g, ''); // Remove non-digit characters
        
        if (!number) return null;
        
        // Handle Indonesian format (0xxx -> 62xxx)
        if (number.startsWith('0')) {
            number = '62' + number.substring(1);
        }
        
        // Validate length (typical phone numbers are 10-15 digits)
        if (number.length < 10 || number.length > 15) {
            return null;
        }
        
        // Default to @s.whatsapp.net format for phone numbers
        return { 
            userId: `${number}@s.whatsapp.net`, 
            displayName: number 
        };
    }

    async handleBlock(sock, from, msg, args) {
        const targetInput = args[0];
        const minutes = parseInt(args[1]) || 60;
        
        if (!targetInput) {
            return await this.reply(sock, from, msg, 
                '❌ Tentukan pengguna yang ingin diblokir.\n\n' +
                '*Cara Pakai:*\n' +
                '• `.security block @mention 60` - Blokir via mention\n' +
                '• `.security block 62812345678 60` - Blokir via nomor\n' +
                '• `.security block 081234567890 30` - Blokir 30 menit\n' +
                '• `.security block user@lid 60` - Blokir via @lid format\n\n' +
                '*Catatan:*\n' +
                '• Owner bot tidak dapat diblokir\n' +
                '• Format ID: @s.whatsapp.net (privat) atau @lid (grup)');
        }

        // Parse the target using smart detection
        const target = this.parseBlockTarget(targetInput, msg);
        
        if (!target) {
            return await this.reply(sock, from, msg,
                '❌ Format target tidak valid!\n\n' +
                'Gunakan @mention, nomor telepon, atau ID WhatsApp lengkap');
        }
        
        const durationMs = minutes * 60 * 1000;
        
        // Try to block (this will fail if target is owner)
        const result = security.blockUser(target.userId, durationMs, 'Diblokir manual oleh owner');
        
        if (!result.success) {
            return await this.reply(sock, from, msg, 
                `❌ *Gagal Memblokir*\n\n` +
                `Alasan: ${result.reason}\n` +
                `Target: ${target.displayName}`);
        }
        
        await this.reply(sock, from, msg, 
            `⛔ *Pengguna Diblokir*\n\n` +
            `📱 Pengguna: ${target.displayName}\n` +
            `🆔 ID: ${target.userId}\n` +
            `⏱️ Durasi: ${minutes} menit\n` +
            `📝 Alasan: Diblokir manual oleh owner\n\n` +
            `_Bot tidak akan merespon pengguna ini selama durasi blokir._`);
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

    /**
     * Format duration in milliseconds to human-readable string
     * @param {number} ms - Duration in milliseconds
     * @returns {string} Formatted duration
     */
    _formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        const parts = [];
        if (days > 0) parts.push(`${days} hari`);
        if (hours % 24 > 0) parts.push(`${hours % 24} jam`);
        if (minutes % 60 > 0) parts.push(`${minutes % 60} menit`);
        if (seconds % 60 > 0 || parts.length === 0) parts.push(`${seconds % 60} detik`);

        return parts.join(' ');
    }

    /**
     * Format bytes to human-readable string
     * @param {number} bytes - Size in bytes
     * @returns {string} Formatted size
     */
    _formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
    }
}

module.exports = SecurityCommand;
