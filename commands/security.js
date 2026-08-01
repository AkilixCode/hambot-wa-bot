/**
 * Security Command — Owner Control Panel
 *
 * The single most dangerous command in the bot: it can read logs, reveal
 * configuration, mute the bot, message arbitrary chats and kill the process.
 * Everything here is written defensively, on the assumption that someone will
 * eventually try to reach it who should not.
 *
 * Security model
 * ──────────────
 *  1. Authorisation   — handler.js gates on the canonical command name, and
 *                       this class re-checks `config.isOwner()` independently.
 *                       Neither layer trusts the other.
 *  2. Anti-probing    — every rejected attempt is audited and feeds an
 *                       escalating auto-block, so the panel cannot be brute
 *                       forced or fuzzed for free.
 *  3. Secrecy         — no subcommand ever prints credential material. API
 *                       keys are reported as "configured + fingerprint" only,
 *                       and all free-text output (logs, errors, audit detail)
 *                       is passed through utils/redact.
 *  4. Channel control — output that describes the bot's internals is never
 *                       posted into a group; it is delivered to the owner's
 *                       private chat instead.
 *  5. Confirmation    — destructive or irreversible actions require a
 *                       single-use, short-lived, sender-bound token.
 *
 * Subcommands
 * ───────────
 *   Info      help · status · uptime · env [full] · whoami · health
 *             audit [n] · threats · list · logs [n]
 *   Security  enable <fitur> · disable <fitur> · lock · unlock
 *   Commands  cmd list · cmd disable <nama> · cmd enable <nama> · cmd enableall
 *   Settings  owneronly <on|off> · setcooldown <ms> · setprefix <p> · setmaxproc <n>
 *   Users     block <target> <menit> · unblock <target|all>
 *   Ops       clearcache · broadcast <jid> <pesan> · restart · stop
 *   Flow      confirm <token> · cancel
 */

const CommandBase = require('./base');
const security = require('../utils/security');
const config = require('../config');
const cache = require('../utils/cache');
const registry = require('./registry');
const redact = require('../utils/redact');
const { spawn } = require('child_process');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');

// Track bot start time for uptime calculation
const botStartTime = Date.now();

// Subcommands whose output describes the bot's internals. Never posted in a
// group — a single screenshot of `.security env` in a group chat hands an
// attacker the bot's whole attack surface.
const SENSITIVE_SUBCOMMANDS = new Set([
    'status', 'env', 'logs', 'log', 'audit', 'threats', 'list', 'whoami', 'health'
]);

// Actions that need an explicit second step before they run.
const CONFIRM_TTL_MS = 90 * 1000;

// Runtime-toggleable security features
const SECURITY_FEATURES = ['chatFilter', 'rateLimit', 'autoBlock'];

// Prefix must be punctuation only: letters/digits/spaces would make the bot
// react to ordinary conversation, and whitespace would break command parsing.
// Characters the chat filter treats as injection markers ($ & | ; ( ) [ ] { } < >)
// are excluded — a prefix built from those would be unusable, because every
// command typed with it would be rejected before reaching the handler.
const SAFE_PREFIX_PATTERN = /^[!#%*+\-./:=?@^~,]{1,3}$/;

// Strict JID shapes accepted as a broadcast target.
const PRIVATE_JID_PATTERN = /^\d{5,20}@s\.whatsapp\.net$/;
const GROUP_JID_PATTERN = /^[\d-]{5,40}@g\.us$/;

// Hard caps
const MAX_LOG_LINES = 200;
const MAX_LOG_BYTES = 512 * 1024;      // never read more than this from a log file
const MAX_BROADCAST_LENGTH = 2000;
const MAX_MESSAGE_LENGTH = 3500;       // keep replies inside one WhatsApp message

class SecurityCommand extends CommandBase {
    constructor() {
        super({
            name: 'security',
            aliases: ['sec', 'secstatus'],
            description: 'Panel manajemen keamanan (Khusus Owner)',
            usage: '.security [subcommand] [args]',
            category: 'security',
            cooldown: 2000
        });

        // Pending confirmations, keyed by the requesting sender's JID.
        // One at a time per sender: a new request replaces the old one.
        this.pendingActions = new Map();
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

        // Layer 1: the panel is unusable until an owner is configured.
        // Fail closed — an unconfigured bot must not be an open control panel.
        if (!config.bot.ownerIds || config.bot.ownerIds.length === 0) {
            security.recordAudit('owner.panel.unconfigured', { actor: sender, outcome: 'denied' });
            return await this.reply(sock, from, msg,
                '⚠️ *Peringatan Keamanan*\n\n' +
                'BOT_OWNER_ID belum dikonfigurasi, jadi panel owner dinonaktifkan total.\n' +
                'Atur di file .env lalu restart bot.\n\n' +
                'Format: `BOT_OWNER_ID=6281234567890@s.whatsapp.net`');
        }

        // Layer 2: independent owner verification. handler.js already gates on
        // the canonical command name; this check exists so a misconfigured
        // OWNER_ONLY_COMMANDS list can never expose the panel.
        if (!config.isOwner(sender)) {
            const attempt = security.registerUnauthorizedAttempt(sender, `security ${args.join(' ')}`);

            return await this.reply(sock, from, msg,
                '🔒 *Akses Ditolak*\n\n' +
                'Perintah ini hanya untuk owner bot.' +
                (attempt.blocked
                    ? `\n\n⛔ Terlalu banyak percobaan. Kamu diblokir selama ${attempt.blockMinutes} menit.`
                    : ''));
        }

        await this.react(sock, msg, '🔒');

        const subcommand = args[0]?.toLowerCase() || 'help';
        const rest = args.slice(1);

        try {
            // Sensitive output is redirected to the owner's private chat when
            // the command was typed in a group.
            if (SENSITIVE_SUBCOMMANDS.has(subcommand) && context.isGroup) {
                const allowed = await this._announcePrivateDelivery(sock, from, msg);
                if (!allowed) return;
            }

            switch (subcommand) {
                case 'help':
                case 'menu':
                    return await this.showHelp(sock, from, msg, context, rest);

                case 'status':
                    return await this.showStatus(sock, from, msg, context);

                case 'uptime':
                    return await this.showUptime(sock, from, msg, context);

                case 'env':
                case 'config':
                    return await this.showEnv(sock, from, msg, context, rest);

                case 'whoami':
                    return await this.showWhoami(sock, from, msg, context);

                case 'health':
                    return await this.showHealth(sock, from, msg, context);

                case 'audit':
                    return await this.showAudit(sock, from, msg, context, rest);

                case 'threats':
                    return await this.showThreats(sock, from, msg, context);

                case 'logs':
                case 'log':
                    return await this.handleLogs(sock, from, msg, context, rest);

                case 'list':
                    return await this.listBlockedUsers(sock, from, msg, context);

                case 'enable':
                    return await this.handleEnable(sock, from, msg, context, rest);

                case 'disable':
                    return await this.handleDisable(sock, from, msg, context, rest);

                case 'lock':
                case 'lockdown':
                    return await this.handleLock(sock, from, msg, context, true);

                case 'unlock':
                    return await this.handleLock(sock, from, msg, context, false);

                case 'cmd':
                case 'command':
                    return await this.handleCommandControl(sock, from, msg, context, rest);

                case 'owneronly':
                    return await this.handleOwnerOnly(sock, from, msg, context, rest);

                case 'setcooldown':
                    return await this.handleSetCooldown(sock, from, msg, context, rest);

                case 'setprefix':
                    return await this.handleSetPrefix(sock, from, msg, context, rest);

                case 'setmaxproc':
                    return await this.handleSetMaxProc(sock, from, msg, context, rest);

                case 'clearcache':
                    return await this.handleClearCache(sock, from, msg, context);

                case 'block':
                    return await this.handleBlock(sock, from, msg, context, rest);

                case 'unblock':
                    return await this.handleUnblock(sock, from, msg, context, rest);

                case 'broadcast':
                case 'bc':
                    return await this.handleBroadcast(sock, from, msg, context, rest);

                case 'restart':
                    return await this._requestConfirmation(sock, from, msg, context, {
                        action: 'restart',
                        label: 'Restart proses bot',
                        warning: 'Bot akan terputus beberapa detik.'
                    });

                case 'stop':
                    return await this._requestConfirmation(sock, from, msg, context, {
                        action: 'stop',
                        label: 'Hentikan proses bot',
                        warning: 'Bot akan MATI dan hanya bisa dinyalakan dari server.'
                    });

                case 'confirm':
                    return await this.handleConfirm(sock, from, msg, context, rest);

                case 'cancel':
                    return await this.handleCancel(sock, from, msg, context);

                default:
                    return await this.showUnknownSubcommand(sock, from, msg, subcommand);
            }
        } catch (error) {
            this.logError(error, context);
            security.recordAudit('owner.command.error', {
                actor: sender,
                outcome: 'error',
                detail: `${subcommand}: ${error.message}`
            });
            // Redact before echoing: error messages routinely embed request URLs
            // that carry API keys.
            await this.reply(sock, from, msg,
                '❌ Perintah keamanan gagal.\n\n' + redact.redact(error.message));
        }
    }

    // ─────────────────────────────────────────────────────
    //  DELIVERY HELPERS
    // ─────────────────────────────────────────────────────

    /**
     * The owner's private-chat JID, if one is configured.
     * @returns {string|null}
     * @private
     */
    _ownerDmJid() {
        return (config.bot.ownerIds || []).find(id => id.endsWith('@s.whatsapp.net')) || null;
    }

    /**
     * Called when a sensitive subcommand is typed in a group. Posts a neutral
     * notice in the group and lets the caller continue only if a private
     * destination exists.
     * @returns {Promise<boolean>} Whether the subcommand may proceed
     * @private
     */
    async _announcePrivateDelivery(sock, from, msg) {
        if (!this._ownerDmJid()) {
            await this.reply(sock, from, msg,
                '🔒 *Ditolak di Grup*\n\n' +
                'Output perintah ini bersifat sensitif dan tidak boleh tampil di grup.\n' +
                'Jalankan lagi lewat chat pribadi dengan bot.');
            return false;
        }

        await this.reply(sock, from, msg, '📩 Info sensitif dikirim ke chat pribadi owner.');
        return true;
    }

    /**
     * Send panel output to the right place: in a group, sensitive text goes to
     * the owner's private chat instead of the group.
     * @private
     */
    async _deliver(sock, from, msg, context, text, { sensitive = true } = {}) {
        const safeText = text.length > MAX_MESSAGE_LENGTH
            ? text.slice(0, MAX_MESSAGE_LENGTH) + '\n\n…(dipotong)'
            : text;

        if (sensitive && context.isGroup) {
            const dm = this._ownerDmJid();
            if (dm) {
                await sock.sendMessage(dm, { text: safeText });
                await this.react(sock, msg, '✅');
                return;
            }
        }

        await this.reply(sock, from, msg, safeText);
        await this.react(sock, msg, '✅');
    }

    /**
     * Record an owner action in the audit trail.
     * @private
     */
    _audit(action, context, details = {}) {
        return security.recordAudit(action, { actor: context.sender, ...details });
    }

    // ─────────────────────────────────────────────────────
    //  CONFIRMATION FLOW
    // ─────────────────────────────────────────────────────

    /**
     * Stage a destructive action and ask the owner to confirm it with a
     * one-time token. The token is bound to the sender and expires quickly, so
     * a stray "yes" in another chat, or an old message replayed later, cannot
     * trigger it.
     * @private
     */
    async _requestConfirmation(sock, from, msg, context, { action, label, warning, payload = {} }) {
        const token = crypto.randomBytes(3).toString('hex').toUpperCase();

        this.pendingActions.set(context.sender, {
            action,
            label,
            payload,
            token,
            expiresAt: Date.now() + CONFIRM_TTL_MS
        });

        this._audit(`owner.${action}.requested`, context, { outcome: 'pending', detail: label });

        await this.reply(sock, from, msg,
            `⚠️ *Konfirmasi Diperlukan*\n\n` +
            `Aksi: *${label}*\n` +
            (warning ? `\n${warning}\n` : '') +
            `\nKetik dalam ${Math.round(CONFIRM_TTL_MS / 1000)} detik:\n` +
            `\`${config.bot.prefix}security confirm ${token}\`\n\n` +
            `Batalkan dengan \`${config.bot.prefix}security cancel\`.`);
        await this.react(sock, msg, '⚠️');
    }

    /**
     * Validate a confirmation token and run the staged action.
     */
    async handleConfirm(sock, from, msg, context, args) {
        const pending = this.pendingActions.get(context.sender);

        if (!pending) {
            return await this.replyError(sock, from, msg, 'Tidak ada aksi yang menunggu konfirmasi.');
        }

        if (Date.now() > pending.expiresAt) {
            this.pendingActions.delete(context.sender);
            this._audit(`owner.${pending.action}.expired`, context, { outcome: 'expired' });
            return await this.reply(sock, from, msg,
                '⌛ Konfirmasi kedaluwarsa. Jalankan perintahnya lagi kalau masih diperlukan.');
        }

        const supplied = (args[0] || '').trim().toUpperCase();
        if (!supplied || supplied !== pending.token) {
            // Consume the pending action on a wrong token so it cannot be
            // guessed by repeated attempts.
            this.pendingActions.delete(context.sender);
            this._audit(`owner.${pending.action}.badtoken`, context, { outcome: 'denied' });
            return await this.reply(sock, from, msg,
                '❌ Token konfirmasi salah. Aksi dibatalkan demi keamanan.\n\n' +
                'Jalankan perintahnya lagi untuk mendapat token baru.');
        }

        // Single use: remove before executing so a retry cannot double-fire.
        this.pendingActions.delete(context.sender);
        this._audit(`owner.${pending.action}.confirmed`, context, { detail: pending.label });

        return await this._runConfirmedAction(sock, from, msg, context, pending);
    }

    /**
     * Drop a staged action without running it.
     */
    async handleCancel(sock, from, msg, context) {
        const pending = this.pendingActions.get(context.sender);

        if (!pending) {
            return await this.reply(sock, from, msg, '✅ Tidak ada aksi yang menunggu konfirmasi.');
        }

        this.pendingActions.delete(context.sender);
        this._audit(`owner.${pending.action}.cancelled`, context, { outcome: 'cancelled' });

        await this.reply(sock, from, msg, `✅ Dibatalkan: *${pending.label}*`);
        await this.react(sock, msg, '✅');
    }

    /**
     * Dispatch a confirmed action to its executor.
     * @private
     */
    async _runConfirmedAction(sock, from, msg, context, pending) {
        switch (pending.action) {
            case 'restart':
                return await this._doRestart(sock, from, msg, context);
            case 'stop':
                return await this._doStop(sock, from, msg, context);
            case 'unblockAll':
                return await this._doUnblockAll(sock, from, msg, context);
            case 'broadcast':
                return await this._doBroadcast(sock, from, msg, context, pending.payload);
            case 'disableFeature':
                return await this._doDisableFeature(sock, from, msg, context, pending.payload);
            case 'setprefix':
                return await this._doSetPrefix(sock, from, msg, context, pending.payload);
            default:
                return await this.replyError(sock, from, msg, 'Aksi tertunda tidak dikenal.');
        }
    }

    // ─────────────────────────────────────────────────────
    //  INFO SUBCOMMANDS
    // ─────────────────────────────────────────────────────

    async showHelp(sock, from, msg, context, args) {
        const p = config.bot.prefix;
        const section = args[0]?.toLowerCase();

        if (section === 'security' || section === 'ops') {
            return await this._deliver(sock, from, msg, context, this._helpOps(p), { sensitive: false });
        }

        const helpText =
`🔒 *OWNER CONTROL PANEL*

*📊 Informasi*
\`${p}security status\` — ringkasan keamanan
\`${p}security uptime\` — uptime, memori, sistem
\`${p}security health\` — cek kesehatan subsistem
\`${p}security env\` — pengaturan runtime (rahasia disembunyikan)
\`${p}security whoami\` — identitas & status owner-mu
\`${p}security audit [n]\` — jejak audit terakhir
\`${p}security threats\` — aktivitas mencurigakan
\`${p}security list\` — daftar pengguna terblokir
\`${p}security logs [n]\` — log bot (sudah disensor)

*🛡️ Kontrol Keamanan*
\`${p}security enable <fitur>\` — aktifkan fitur
\`${p}security disable <fitur>\` — nonaktifkan fitur
  _Fitur: ${SECURITY_FEATURES.join(', ')}_
\`${p}security lock\` — mode panik (hanya owner dilayani)
\`${p}security unlock\` — matikan mode panik

*🧩 Kontrol Perintah*
\`${p}security cmd list\` — perintah yang dinonaktifkan
\`${p}security cmd disable <nama>\`
\`${p}security cmd enable <nama>\`
\`${p}security cmd enableall\`

*👤 Manajemen Pengguna*
\`${p}security block <target> <menit>\`
\`${p}security unblock <target>\`
\`${p}security unblock all\`

Lanjut ke pengaturan & operasi: \`${p}security help ops\``;

        await this._deliver(sock, from, msg, context, helpText, { sensitive: false });
    }

    /**
     * Second help page — settings and operational commands.
     * @private
     */
    _helpOps(p) {
        return `🔧 *OWNER PANEL — PENGATURAN & OPERASI*

*⚙️ Pengaturan Runtime*
\`${p}security owneronly <on|off>\` — abaikan chat privat
\`${p}security setcooldown <ms>\` — 500–30000
\`${p}security setprefix <prefix>\` — simbol, maks 3 karakter
\`${p}security setmaxproc <n>\` — 1–20

*🗑️ Maintenance*
\`${p}security clearcache\`

*📢 Komunikasi*
\`${p}security broadcast <jid> <pesan>\`
  _Satu tujuan per perintah, butuh konfirmasi._

*🔄 Kontrol Proses*
\`${p}security restart\` — restart bot
\`${p}security stop\` — matikan bot

*✅ Alur Konfirmasi*
\`${p}security confirm <token>\` — jalankan aksi tertunda
\`${p}security cancel\` — batalkan aksi tertunda

_Catatan: perubahan runtime tidak menulis ke .env dan hilang saat bot restart._`;
    }

    async showUnknownSubcommand(sock, from, msg, subcommand) {
        // Echo back sanitised — the subcommand is raw user input.
        const safe = String(subcommand).replace(/[^\w-]/g, '').slice(0, 20);
        await this.reply(sock, from, msg,
            `❌ Subcommand tidak dikenal: \`${safe || '?'}\`\n\n` +
            `Lihat daftar lengkap dengan \`${config.bot.prefix}security help\`.`);
    }

    async showStatus(sock, from, msg, context) {
        const stats = security.getStats();
        const disabledCommands = registry.getDisabled();
        const uptimeStr = this._formatDuration(Date.now() - botStartTime);

        let response =
`🔒 *STATUS KEAMANAN*

⏱️ *Uptime:* ${uptimeStr}
${stats.lockdownEnabled ? '\n🚨 *MODE PANIK AKTIF* — hanya owner yang dilayani\n' : ''}
📊 *Statistik*
• Pengguna terblokir: ${stats.blockedUsers}
• Aktivitas mencurigakan: ${stats.suspiciousActivityTracked}
• Event keamanan: ${stats.securityEvents}
• Percobaan akses owner: ${stats.unauthorizedTracked}
• Entri audit: ${stats.auditEntries}

🛡️ *Fitur Keamanan (runtime)*
• Filter chat: ${this._flag(stats.runtimeSettings.chatFilterEnabled)}
• Rate limiting: ${this._flag(stats.runtimeSettings.rateLimitEnabled)}
• Auto-block: ${this._flag(stats.runtimeSettings.autoBlockEnabled)}
• Mode panik: ${this._flag(stats.runtimeSettings.lockdownEnabled)}

⚙️ *Konfigurasi*
• Filter chat (.env): ${this._flag(config.security.chatFilterEnabled)}
• Owner-only mode: ${this._flag(config.bot.onlyGroupMode)}
• Prefix: ${config.bot.prefix}
• Cooldown: ${config.performance.cooldownMs}ms
• Maks proses: ${config.performance.maxProcesses}
• Owner terdaftar: ${config.bot.ownerIds.length}

🧩 *Perintah Dinonaktifkan*
${disabledCommands.length > 0 ? disabledCommands.map(c => `• ${c}`).join('\n') : '• (tidak ada)'}

`;

        if (stats.recentBlocks.length > 0) {
            response += `⛔ *Blokir Aktif:*\n`;
            for (const block of stats.recentBlocks.slice(0, 5)) {
                const timeLeft = Math.ceil(block.expiresIn / 1000 / 60);
                response += `• ${redact.maskJid(block.userId)} — ${block.reason} (${timeLeft}m)\n`;
            }
            if (stats.recentBlocks.length > 5) {
                response += `• …dan ${stats.recentBlocks.length - 5} lainnya\n`;
            }
        } else {
            response += `✅ *Tidak ada blokir aktif*\n`;
        }

        response += `\n🛡️ *Proteksi Selalu Aktif:*\n` +
            `• Sanitasi input & deteksi pola berbahaya\n` +
            `• Verifikasi owner ganda (handler + perintah)\n` +
            `• Auto-block percobaan akses owner berulang\n` +
            `• Penyensoran rahasia pada semua output`;

        await this._deliver(sock, from, msg, context, response);
    }

    /**
     * Show bot uptime, memory usage, and system information
     */
    async showUptime(sock, from, msg, context) {
        const uptimeStr = this._formatDuration(Date.now() - botStartTime);
        const systemUptime = this._formatDuration(os.uptime() * 1000);

        const memUsage = process.memoryUsage();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const cacheStats = cache.getStats();

        const response =
`⏱️ *UPTIME & SISTEM*

🤖 *Bot*
• Uptime: ${uptimeStr}
• PID: ${process.pid}
• Node.js: ${process.version}
• Platform: ${process.platform} ${process.arch}

💾 *Memori Bot*
• Heap: ${this._formatBytes(memUsage.heapUsed)} / ${this._formatBytes(memUsage.heapTotal)}
• RSS: ${this._formatBytes(memUsage.rss)}
• External: ${this._formatBytes(memUsage.external)}

🖥️ *Sistem*
• OS: ${os.type()} ${os.release()}
• Uptime sistem: ${systemUptime}
• CPU: ${os.cpus()[0]?.model || 'N/A'} (${os.cpus().length} core)
• RAM: ${this._formatBytes(totalMem - freeMem)} / ${this._formatBytes(totalMem)} (${((1 - freeMem / totalMem) * 100).toFixed(1)}%)

📦 *Cache*
• Entri: ${cacheStats.size}
• Hits / Misses: ${cacheStats.hits} / ${cacheStats.misses}
• Hit rate: ${cacheStats.hitRate}`;

        await this._deliver(sock, from, msg, context, response);
    }

    /**
     * Show current runtime configuration.
     *
     * Credentials are NEVER printed. Each API key is reported as a presence
     * flag plus a short SHA-256 fingerprint, which is enough for the owner to
     * confirm *which* key is loaded but reveals nothing usable.
     * Network details (proxy host, full owner IDs) are masked unless the owner
     * explicitly asks for `env full`.
     */
    async showEnv(sock, from, msg, context, args) {
        const full = args[0]?.toLowerCase() === 'full';

        const ownerIdList = config.bot.ownerIds.length > 0
            ? config.bot.ownerIds.map(id => (full ? id : redact.maskJid(id))).join('\n  ')
            : 'Belum dikonfigurasi';

        const proxyHost = config.proxy.host
            ? (full ? config.proxy.host : redact.maskHost(config.proxy.host))
            : 'N/A';

        const apiLines = Object.entries(config.apis)
            .map(([name, cfg]) => `• ${name}: ${redact.describeSecret(cfg.key)}`)
            .join('\n');

        const disabledCommands = registry.getDisabled();

        const response =
`⚙️ *PENGATURAN RUNTIME*

🤖 *Bot*
• Nama: ${config.bot.name}
• Owner: ${config.bot.owner}
• Prefix: ${config.bot.prefix}
• Owner-only mode: ${this._flag(config.bot.onlyGroupMode)}
• Mode panik: ${this._flag(security.isLockdownEnabled())}
• Owner IDs:
  ${ownerIdList}
• Perintah owner-only: ${config.bot.ownerOnlyCommands.join(', ') || '(kosong)'}
• Perintah dinonaktifkan: ${disabledCommands.join(', ') || '(tidak ada)'}

⚡ *Performance*
• Maks proses: ${config.performance.maxProcesses}
• Cooldown: ${config.performance.cooldownMs}ms
• Rate limit: ${config.performance.rateLimitMax} req / ${config.performance.rateLimitWindow}ms
• Cache expiration: ${config.performance.cacheExpiration}ms

🎵 *Media*
• Maks durasi: ${config.media.maxDuration}s
• Maks ukuran file: ${config.media.maxFileSize}

🌐 *Proxy*
• Enabled: ${this._flag(config.proxy.enabled)}
• Type: ${config.proxy.type}
• Host: ${proxyHost}
• Port: ${config.proxy.port || 'N/A'}
• Kredensial proxy: ${config.proxy.user ? '✅ Terpasang (disembunyikan)' : '❌ Tidak dipakai'}
• Force IPv4: ${this._flag(config.network.forceIPv4)}

📊 *Logging*
• Level: ${config.logging.level}
• Silent: ${this._flag(config.logging.silent)}

🔑 *API Keys* _(nilai tidak pernah ditampilkan)_
${apiLines}

${full
    ? '_Mode `full`: ID owner & host proxy ditampilkan utuh. Kunci API tetap tidak pernah ditampilkan._'
    : `_Gunakan \`${config.bot.prefix}security env full\` untuk melihat ID owner & host proxy tanpa mask._`}`;

        this._audit('owner.env.viewed', context, { detail: full ? 'full' : 'masked' });
        await this._deliver(sock, from, msg, context, response);
    }

    /**
     * Report how the bot sees the caller. Useful when setting up BOT_OWNER_ID,
     * where a mismatch between @lid and @s.whatsapp.net is the usual culprit.
     */
    async showWhoami(sock, from, msg, context) {
        const { sender, from: chatId, isGroup } = context;

        const response =
`🪪 *IDENTITAS KAMU*

• JID pengirim: \`${sender}\`
• Tipe: ${sender.endsWith('@lid') ? '@lid (identitas grup)' : '@s.whatsapp.net (chat pribadi)'}
• Chat: ${isGroup ? 'grup' : 'pribadi'}
• Chat JID: \`${chatId}\`
• Status owner: ${config.isOwner(sender) ? '✅ TERVERIFIKASI' : '❌ BUKAN OWNER'}

📋 *Owner terdaftar:*
${config.bot.ownerIds.map(id => `• \`${id}\``).join('\n') || '• (kosong)'}

_Kalau kamu owner tapi tidak terverifikasi di grup, tambahkan ID @lid di atas ke \`BOT_OWNER_ID\` (pisahkan dengan koma)._`;

        await this._deliver(sock, from, msg, context, response);
    }

    /**
     * Lightweight health check of the bot's subsystems.
     */
    async showHealth(sock, from, msg, context) {
        const lag = await this._measureEventLoopLag();
        const mem = process.memoryUsage();
        const totalMem = os.totalmem();
        const memPercent = (mem.rss / totalMem) * 100;
        const cacheStats = cache.getStats();
        const stats = security.getStats();

        const checks = [
            {
                name: 'Koneksi WhatsApp',
                ok: Boolean(sock?.user?.id),
                detail: sock?.user?.id ? 'tersambung' : 'tidak diketahui'
            },
            {
                name: 'Event loop',
                ok: lag < 250,
                detail: `lag ${lag}ms`
            },
            {
                name: 'Memori proses',
                ok: memPercent < 60,
                detail: `${this._formatBytes(mem.rss)} (${memPercent.toFixed(1)}% RAM)`
            },
            {
                name: 'Heap',
                ok: mem.heapUsed / mem.heapTotal < 0.9,
                detail: `${((mem.heapUsed / mem.heapTotal) * 100).toFixed(1)}% terpakai`
            },
            {
                name: 'Cache',
                ok: cacheStats.size < 1000,
                detail: `${cacheStats.size} entri, hit rate ${cacheStats.hitRate}`
            },
            {
                name: 'Filter chat',
                ok: config.security.chatFilterEnabled && stats.runtimeSettings.chatFilterEnabled,
                detail: config.security.chatFilterEnabled && stats.runtimeSettings.chatFilterEnabled ? 'aktif' : 'NONAKTIF'
            },
            {
                name: 'Auto-block',
                ok: stats.runtimeSettings.autoBlockEnabled,
                detail: stats.runtimeSettings.autoBlockEnabled ? 'aktif' : 'NONAKTIF'
            },
            {
                name: 'Owner ID',
                ok: config.bot.ownerIds.length > 0,
                detail: `${config.bot.ownerIds.length} terdaftar`
            }
        ];

        const failing = checks.filter(c => !c.ok).length;
        const verdict = failing === 0
            ? '✅ *SEHAT* — semua pemeriksaan lolos'
            : `⚠️ *PERLU PERHATIAN* — ${failing} pemeriksaan bermasalah`;

        const response =
`🩺 *HEALTH CHECK*

${verdict}

${checks.map(c => `${c.ok ? '✅' : '⚠️'} ${c.name}: ${c.detail}`).join('\n')}

⏱️ Uptime: ${this._formatDuration(Date.now() - botStartTime)}`;

        await this._deliver(sock, from, msg, context, response);
    }

    /**
     * Measure event loop delay with a single timer sample.
     * @returns {Promise<number>} Lag in milliseconds
     * @private
     */
    _measureEventLoopLag() {
        return new Promise(resolve => {
            const start = process.hrtime.bigint();
            setTimeout(() => {
                const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
                resolve(Math.max(0, Math.round(elapsedMs - 20)));
            }, 20);
        });
    }

    /**
     * Show the in-memory audit trail.
     */
    async showAudit(sock, from, msg, context, args) {
        const limit = Math.min(Math.max(parseInt(args[0]) || 15, 1), 50);
        const entries = security.getAuditLog(limit);

        if (entries.length === 0) {
            return await this._deliver(sock, from, msg, context,
                '📜 *JEJAK AUDIT*\n\nBelum ada entri.');
        }

        const lines = entries.map(entry => {
            const time = new Date(entry.timestamp).toISOString().replace('T', ' ').slice(0, 19);
            const outcome = entry.outcome === 'ok' ? '' : ` [${entry.outcome}]`;
            const target = entry.target ? ` → ${entry.target}` : '';
            const detail = entry.detail ? `\n   ${entry.detail}` : '';
            return `• ${time}\n   ${entry.action}${outcome}\n   oleh ${entry.actor}${target}${detail}`;
        });

        const response =
`📜 *JEJAK AUDIT* (${entries.length} terbaru)

${lines.join('\n\n')}

_Audit hanya disimpan di memori dan hilang saat bot restart._`;

        await this._deliver(sock, from, msg, context, response);
    }

    /**
     * Show suspicious activity and owner-command probing.
     */
    async showThreats(sock, from, msg, context) {
        const summary = security.getThreatSummary(10);

        let response = '🚨 *AKTIVITAS MENCURIGAKAN*\n\n';

        if (summary.probes.length > 0) {
            response += '*🔑 Percobaan Akses Owner*\n';
            for (const probe of summary.probes) {
                const ago = probe.lastSeen ? this._formatDuration(Date.now() - probe.lastSeen) : '?';
                response += `• ${probe.userId} — ${probe.attempts}x (terakhir ${ago} lalu)\n`;
            }
            response += '\n';
        } else {
            response += '*🔑 Percobaan Akses Owner*\n• Tidak ada\n\n';
        }

        if (summary.suspicious.length > 0) {
            response += '*⚠️ Pelacakan Perilaku*\n';
            for (const entry of summary.suspicious) {
                const types = Object.entries(entry.types).map(([t, c]) => `${t}×${c}`).join(', ');
                response += `• ${entry.userId} — ${entry.lastHour} dalam 1 jam (total ${entry.total})\n`;
                if (types) response += `   ${types}\n`;
            }
            response += '\n';
        } else {
            response += '*⚠️ Pelacakan Perilaku*\n• Tidak ada\n\n';
        }

        const eventEntries = Object.entries(summary.events);
        response += '*📊 Ringkasan Event*\n';
        response += eventEntries.length > 0
            ? eventEntries.map(([event, count]) => `• ${event}: ${count}`).join('\n')
            : '• Tidak ada';

        await this._deliver(sock, from, msg, context, response);
    }

    // ─────────────────────────────────────────────────────
    //  LOGS
    // ─────────────────────────────────────────────────────

    /**
     * Pull recent logs and send them to the owner.
     *
     * Log files are the richest source of accidental secret disclosure — a
     * single failed yt-dlp call can dump a proxy URL complete with password.
     * Everything read here is redacted before it leaves the process, and only
     * the tail of a file is read so a huge log cannot exhaust memory.
     */
    async handleLogs(sock, from, msg, context, args) {
        const lineCount = Math.min(Math.max(parseInt(args[0]) || 20, 1), MAX_LOG_LINES);

        await this.react(sock, msg, '⏳');

        try {
            let logContent = null;

            // 1. PM2 log files on disk
            const pm2ProcessName = process.env.PM2_PROCESS_NAME || 'hambot';
            const pm2LogPaths = [
                path.join(os.homedir(), `.pm2/logs/${pm2ProcessName}-out.log`),
                path.join(os.homedir(), `.pm2/logs/${pm2ProcessName}-error.log`),
                '/var/log/hambot.log'
            ];

            for (const logPath of pm2LogPaths) {
                const tail = this._readTail(logPath, lineCount);
                if (tail) {
                    logContent = tail;
                    break;
                }
            }

            // 2. Ask PM2 directly
            if (!logContent) {
                try {
                    logContent = await this._getPm2Logs(pm2ProcessName, lineCount);
                } catch (pm2Err) {
                    // PM2 not available — fall through
                }
            }

            // 3. Fall back to the in-memory view
            if (!logContent) {
                logContent = this._getInMemoryLogs(lineCount);
            }

            if (!logContent || logContent.lines.length === 0) {
                return await this.reply(sock, from, msg,
                    '📋 *Log Bot*\n\nTidak ada log yang tersedia.\n\n' +
                    '_Tip: pastikan PM2 dipakai untuk manajemen log._');
            }

            // Redaction happens on the joined text so multi-line secrets are caught too
            const logText = redact.redact(logContent.lines.join('\n'));

            const header =
                `📋 *Log Bot* (${logContent.lines.length} baris terakhir)\n` +
                `📂 Sumber: ${logContent.source}\n` +
                `🧼 Rahasia otomatis disensor\n`;

            this._audit('owner.logs.viewed', context, { detail: `${logContent.source} (${logContent.lines.length} baris)` });

            const target = context.isGroup ? this._ownerDmJid() : from;
            if (!target) {
                return await this.replyError(sock, from, msg, 'Tidak ada tujuan pribadi untuk mengirim log.');
            }

            if (header.length + logText.length <= MAX_MESSAGE_LENGTH) {
                if (context.isGroup) {
                    await sock.sendMessage(target, { text: `${header}\n${logText}` });
                } else {
                    await this.reply(sock, from, msg, `${header}\n${logText}`);
                }
            } else {
                const logBuffer = Buffer.from(
                    `HamBot Log Export\n` +
                    `Source: ${logContent.source}\n` +
                    `Date: ${new Date().toISOString()}\n` +
                    `Lines: ${logContent.lines.length}\n` +
                    `NOTE: credentials have been redacted\n` +
                    `${'='.repeat(60)}\n\n` +
                    logText,
                    'utf8'
                );

                await sock.sendMessage(target, {
                    document: logBuffer,
                    mimetype: 'text/plain',
                    fileName: `hambot-logs-${Date.now()}.txt`,
                    caption: `📋 Log Bot — ${logContent.lines.length} baris dari ${logContent.source} (disensor)`
                }, context.isGroup ? {} : { quoted: msg });
            }

            await this.react(sock, msg, '✅');
        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, '❌ Gagal mengambil log: ' + redact.redact(error.message));
        }
    }

    /**
     * Read the last N lines of a file without loading the whole thing.
     * PM2 logs routinely reach hundreds of megabytes; readFileSync on one of
     * those would take the bot down.
     *
     * @param {string} filePath - Absolute path to the log file
     * @param {number} lineCount - Lines wanted
     * @returns {Object|null} { source, lines, totalLines } or null
     * @private
     */
    _readTail(filePath, lineCount) {
        let fd = null;
        try {
            if (!fs.existsSync(filePath)) return null;

            const stat = fs.statSync(filePath);
            if (!stat.isFile() || stat.size === 0) return null;

            const readSize = Math.min(stat.size, MAX_LOG_BYTES);
            const buffer = Buffer.alloc(readSize);

            fd = fs.openSync(filePath, 'r');
            fs.readSync(fd, buffer, 0, readSize, stat.size - readSize);

            const text = buffer.toString('utf8');
            // Drop the first line when the file was truncated — it is a partial line
            const allLines = text.split('\n');
            if (readSize < stat.size && allLines.length > 1) allLines.shift();

            const lines = allLines.filter(line => line.trim()).slice(-lineCount);
            if (lines.length === 0) return null;

            return {
                source: path.basename(filePath),
                lines,
                totalLines: lines.length
            };
        } catch (err) {
            return null;
        } finally {
            if (fd !== null) {
                try { fs.closeSync(fd); } catch (closeErr) { /* already gone */ }
            }
        }
    }

    /**
     * Get PM2 logs via spawn command
     * @param {string} processName - PM2 process name
     * @param {number} lineCount - Number of lines to retrieve
     * @returns {Promise<Object>} Log content
     * @private
     */
    _getPm2Logs(processName, lineCount) {
        return new Promise((resolve, reject) => {
            const chunks = [];
            let totalBytes = 0;

            // No shell: arguments are passed as an array so a hostile
            // PM2_PROCESS_NAME cannot turn into a command injection.
            const pm2Log = spawn('pm2', ['logs', processName, '--nostream', '--lines', String(lineCount)], {
                timeout: 5000,
                shell: false
            });

            const collect = (data) => {
                if (totalBytes >= MAX_LOG_BYTES) return;
                totalBytes += data.length;
                chunks.push(data.toString());
            };

            pm2Log.stdout.on('data', collect);
            pm2Log.stderr.on('data', collect);

            pm2Log.on('close', () => {
                const output = chunks.join('').trim();
                if (!output) return reject(new Error('No PM2 log output'));

                const lines = output.split('\n').filter(l => l.trim());
                resolve({
                    source: `pm2 logs ${processName}`,
                    lines: lines.slice(-lineCount),
                    totalLines: lines.length
                });
            });

            pm2Log.on('error', reject);
        });
    }

    /**
     * Get in-memory security event logs as fallback
     * @param {number} lineCount - Number of entries to retrieve
     * @returns {Object} Log content from memory
     * @private
     */
    _getInMemoryLogs(lineCount) {
        const stats = security.getStats();
        const lines = [];
        const now = new Date().toISOString();

        lines.push(`[${now}] uptime=${this._formatDuration(Date.now() - botStartTime)}`);
        lines.push(`[${now}] blockedUsers=${stats.blockedUsers} securityEvents=${stats.securityEvents}`);
        lines.push(`[${now}] suspiciousTracked=${stats.suspiciousActivityTracked} ownerProbes=${stats.unauthorizedTracked}`);
        lines.push(`[CONFIG] chatFilter=${stats.runtimeSettings.chatFilterEnabled} rateLimit=${stats.runtimeSettings.rateLimitEnabled}`);
        lines.push(`[CONFIG] autoBlock=${stats.runtimeSettings.autoBlockEnabled} lockdown=${stats.runtimeSettings.lockdownEnabled}`);
        lines.push(`[CONFIG] ownerOnlyMode=${config.bot.onlyGroupMode} prefix=${config.bot.prefix}`);
        lines.push(`[CONFIG] cooldown=${config.performance.cooldownMs}ms maxProcesses=${config.performance.maxProcesses}`);

        for (const block of stats.recentBlocks.slice(0, 10)) {
            const minsLeft = Math.ceil(block.expiresIn / 1000 / 60);
            lines.push(`[BLOCK] ${redact.maskJid(block.userId)} ${block.reason} (${minsLeft}m left)`);
        }

        for (const entry of security.getAuditLog(30)) {
            const time = new Date(entry.timestamp).toISOString();
            lines.push(`[AUDIT] ${time} ${entry.action} actor=${entry.actor} outcome=${entry.outcome}`);
        }

        const mem = process.memoryUsage();
        lines.push(`[MEMORY] heap=${this._formatBytes(mem.heapUsed)}/${this._formatBytes(mem.heapTotal)} rss=${this._formatBytes(mem.rss)}`);

        return {
            source: 'in-memory (tidak ada file log)',
            lines: lines.slice(-lineCount),
            totalLines: lines.length
        };
    }

    // ─────────────────────────────────────────────────────
    //  SECURITY FEATURE TOGGLES
    // ─────────────────────────────────────────────────────

    async handleEnable(sock, from, msg, context, args) {
        const feature = this._resolveFeature(args[0]);

        if (!feature) {
            return await this.reply(sock, from, msg, this._featureUsage('diaktifkan'));
        }

        security.toggleFeature(feature, true);
        this._audit('owner.feature.enabled', context, { detail: feature });

        await this.reply(sock, from, msg,
            `🛡️ *Fitur Keamanan Diperbarui*\n\n` +
            `Fitur: ${feature}\n` +
            `Status: ✅ AKTIF`);
        await this.react(sock, msg, '✅');
    }

    async handleDisable(sock, from, msg, context, args) {
        const feature = this._resolveFeature(args[0]);

        if (!feature) {
            return await this.reply(sock, from, msg, this._featureUsage('dinonaktifkan'));
        }

        // Turning a protection off is exactly what an attacker who got this far
        // would do first, so it takes a confirmation like any destructive action.
        return await this._requestConfirmation(sock, from, msg, context, {
            action: 'disableFeature',
            label: `Nonaktifkan fitur keamanan: ${feature}`,
            warning: '⚠️ Bot akan lebih rentan terhadap penyalahgunaan selama fitur ini mati.',
            payload: { feature }
        });
    }

    /**
     * @private
     */
    async _doDisableFeature(sock, from, msg, context, payload) {
        security.toggleFeature(payload.feature, false);
        this._audit('owner.feature.disabled', context, { outcome: 'warning', detail: payload.feature });

        await this.reply(sock, from, msg,
            `🛡️ *Fitur Keamanan Diperbarui*\n\n` +
            `Fitur: ${payload.feature}\n` +
            `Status: ❌ NONAKTIF\n\n` +
            `⚠️ Aktifkan kembali secepatnya dengan \`${config.bot.prefix}security enable ${payload.feature}\`.`);
        await this.react(sock, msg, '✅');
    }

    /**
     * Case-insensitive lookup of a valid security feature name.
     * @private
     */
    _resolveFeature(input) {
        if (!input) return null;
        const needle = String(input).toLowerCase();
        return SECURITY_FEATURES.find(f => f.toLowerCase() === needle) || null;
    }

    /**
     * @private
     */
    _featureUsage(verb) {
        const stats = security.getStats().runtimeSettings;
        return `❌ Tentukan fitur yang ingin ${verb}.\n\n` +
            '*Fitur tersedia:*\n' +
            `• \`chatFilter\` — filter konten pesan (${this._flag(stats.chatFilterEnabled)})\n` +
            `• \`rateLimit\` — pembatasan request (${this._flag(stats.rateLimitEnabled)})\n` +
            `• \`autoBlock\` — blokir otomatis (${this._flag(stats.autoBlockEnabled)})`;
    }

    // ─────────────────────────────────────────────────────
    //  LOCKDOWN
    // ─────────────────────────────────────────────────────

    async handleLock(sock, from, msg, context, enable) {
        // Enabling lockdown is protective, so it runs immediately — during an
        // incident the owner should not have to type a token first.
        security.setLockdown(enable, context.sender);

        await this.reply(sock, from, msg, enable
            ? '🚨 *MODE PANIK AKTIF*\n\n' +
              'Bot sekarang mengabaikan semua pesan kecuali dari owner.\n' +
              'Tidak ada balasan apa pun untuk pengguna lain — mereka tidak akan tahu bot masih hidup.\n\n' +
              `Matikan dengan \`${config.bot.prefix}security unlock\`.`
            : '✅ *Mode Panik Dimatikan*\n\nBot kembali melayani semua pengguna seperti biasa.');
        await this.react(sock, msg, '✅');
    }

    // ─────────────────────────────────────────────────────
    //  PER-COMMAND CONTROL
    // ─────────────────────────────────────────────────────

    async handleCommandControl(sock, from, msg, context, args) {
        const action = args[0]?.toLowerCase();
        const targetName = args[1];
        const p = config.bot.prefix;

        if (!action || action === 'list') {
            const disabled = registry.getDisabled();
            const all = registry.getAll().map(c => c.name).sort();

            return await this.reply(sock, from, msg,
                `🧩 *KONTROL PERINTAH*\n\n` +
                `*Dinonaktifkan (${disabled.length}):*\n` +
                `${disabled.length > 0 ? disabled.map(c => `• ${c}`).join('\n') : '• (tidak ada)'}\n\n` +
                `*Total terdaftar:* ${all.length}\n\n` +
                `\`${p}security cmd disable <nama>\`\n` +
                `\`${p}security cmd enable <nama>\`\n` +
                `\`${p}security cmd enableall\``);
        }

        if (action === 'enableall') {
            const count = registry.enableAll();
            this._audit('owner.command.enableAll', context, { detail: `${count} perintah` });
            return await this.reply(sock, from, msg,
                `✅ *Semua Perintah Diaktifkan*\n\n${count} perintah dipulihkan.`);
        }

        if (!['enable', 'disable'].includes(action)) {
            return await this.reply(sock, from, msg,
                `❌ Aksi tidak dikenal.\n\nGunakan: \`list\`, \`enable\`, \`disable\`, atau \`enableall\`.`);
        }

        if (!targetName) {
            return await this.reply(sock, from, msg,
                `❌ Tentukan nama perintah.\n\nContoh: \`${p}security cmd ${action} spam\``);
        }

        // Only the registry decides what a valid command name is — user input is
        // never used to build a path or a shell argument.
        const result = action === 'disable'
            ? registry.disable(targetName)
            : registry.enable(targetName);

        if (!result.success) {
            return await this.reply(sock, from, msg, `❌ ${result.reason}`);
        }

        this._audit(`owner.command.${action}d`, context, { detail: result.name });

        await this.reply(sock, from, msg,
            `🧩 *Perintah Diperbarui*\n\n` +
            `Perintah: ${result.name}\n` +
            `Status: ${action === 'disable' ? '❌ NONAKTIF' : '✅ AKTIF'}\n\n` +
            `_Owner tetap bisa memakai perintah yang dinonaktifkan._`);
        await this.react(sock, msg, '✅');
    }

    // ─────────────────────────────────────────────────────
    //  RUNTIME SETTINGS
    // ─────────────────────────────────────────────────────

    async handleOwnerOnly(sock, from, msg, context, args) {
        const mode = args[0]?.toLowerCase();

        if (!mode || !['on', 'off'].includes(mode)) {
            return await this.reply(sock, from, msg,
                '❌ Tentukan mode: on atau off\n\n' +
                '*Cara Pakai:*\n' +
                `• \`${config.bot.prefix}security owneronly on\` — abaikan chat privat\n` +
                `• \`${config.bot.prefix}security owneronly off\` — respon semua chat\n\n` +
                `Status saat ini: ${this._flag(config.bot.onlyGroupMode)}`);
        }

        const newState = mode === 'on';
        config.bot.onlyGroupMode = newState;
        this._audit('owner.setting.owneronly', context, { detail: String(newState) });

        await this.reply(sock, from, msg,
            `⚙️ *Owner-Only Mode Diperbarui*\n\n` +
            `Status: ${this._flag(newState)}\n\n` +
            (newState
                ? '_Bot hanya merespon di grup. Chat privat diabaikan._'
                : '_Bot merespon semua chat (privat & grup)._'));
        await this.react(sock, msg, '✅');
    }

    async handleSetCooldown(sock, from, msg, context, args) {
        const newCooldown = parseInt(args[0], 10);

        if (!args[0] || Number.isNaN(newCooldown)) {
            return await this.reply(sock, from, msg,
                '❌ Tentukan cooldown dalam milidetik.\n\n' +
                `Contoh: \`${config.bot.prefix}security setcooldown 3000\`\n\n` +
                `Cooldown saat ini: ${config.performance.cooldownMs}ms`);
        }

        if (newCooldown < 500 || newCooldown > 30000) {
            return await this.replyError(sock, from, msg, 'Cooldown harus antara 500ms dan 30000ms.');
        }

        const oldCooldown = config.performance.cooldownMs;
        config.performance.cooldownMs = newCooldown;
        this._audit('owner.setting.cooldown', context, { detail: `${oldCooldown} → ${newCooldown}` });

        await this.reply(sock, from, msg,
            `⚙️ *Cooldown Diperbarui*\n\n` +
            `${oldCooldown}ms → ${newCooldown}ms\n\n` +
            `_Berlaku untuk perintah selanjutnya._`);
        await this.react(sock, msg, '✅');
    }

    async handleSetPrefix(sock, from, msg, context, args) {
        const newPrefix = args[0];

        if (!newPrefix) {
            return await this.reply(sock, from, msg,
                '❌ Tentukan prefix baru.\n\n' +
                `Contoh: \`${config.bot.prefix}security setprefix !\`\n\n` +
                `Prefix saat ini: \`${config.bot.prefix}\``);
        }

        // A prefix made of letters, digits or whitespace would make the bot
        // respond to ordinary conversation and could make it unreachable.
        if (!SAFE_PREFIX_PATTERN.test(newPrefix)) {
            return await this.reply(sock, from, msg,
                '❌ Prefix tidak valid.\n\n' +
                'Syarat:\n' +
                '• 1–3 karakter\n' +
                '• Hanya simbol: `! # % * + - . / : = ? @ ^ ~ ,`\n' +
                '• Tidak boleh huruf, angka, atau spasi');
        }

        if (newPrefix === config.bot.prefix) {
            return await this.reply(sock, from, msg, `✅ Prefix sudah \`${newPrefix}\`.`);
        }

        return await this._requestConfirmation(sock, from, msg, context, {
            action: 'setprefix',
            label: `Ubah prefix \`${config.bot.prefix}\` → \`${newPrefix}\``,
            warning: '⚠️ Semua perintah setelah ini harus memakai prefix baru.',
            payload: { newPrefix }
        });
    }

    /**
     * @private
     */
    async _doSetPrefix(sock, from, msg, context, payload) {
        const oldPrefix = config.bot.prefix;
        config.bot.prefix = payload.newPrefix;
        this._audit('owner.setting.prefix', context, { detail: `${oldPrefix} → ${payload.newPrefix}` });

        await this.reply(sock, from, msg,
            `⚙️ *Prefix Diperbarui*\n\n` +
            `\`${oldPrefix}\` → \`${payload.newPrefix}\`\n\n` +
            `_Gunakan \`${payload.newPrefix}security\` untuk perintah selanjutnya._`);
        await this.react(sock, msg, '✅');
    }

    async handleSetMaxProc(sock, from, msg, context, args) {
        const newMax = parseInt(args[0], 10);

        if (!args[0] || Number.isNaN(newMax)) {
            return await this.reply(sock, from, msg,
                '❌ Tentukan jumlah maks proses berat.\n\n' +
                `Contoh: \`${config.bot.prefix}security setmaxproc 3\`\n\n` +
                `Saat ini: ${config.performance.maxProcesses}`);
        }

        if (newMax < 1 || newMax > 20) {
            return await this.replyError(sock, from, msg, 'Jumlah maks proses harus antara 1 dan 20.');
        }

        const oldMax = config.performance.maxProcesses;
        config.performance.maxProcesses = newMax;
        this._audit('owner.setting.maxproc', context, { detail: `${oldMax} → ${newMax}` });

        await this.reply(sock, from, msg,
            `⚙️ *Maks Proses Diperbarui*\n\n${oldMax} → ${newMax}\n\n_Berlaku segera._`);
        await this.react(sock, msg, '✅');
    }

    async handleClearCache(sock, from, msg, context) {
        const statsBefore = cache.getStats();
        cache.clear();
        this._audit('owner.cache.cleared', context, { detail: `${statsBefore.size} entri` });

        await this.reply(sock, from, msg,
            `🗑️ *Cache Dibersihkan*\n\n` +
            `• Entri dihapus: ${statsBefore.size}\n` +
            `• Hits / Misses sebelumnya: ${statsBefore.hits} / ${statsBefore.misses}\n` +
            `• Hit rate: ${statsBefore.hitRate}`);
        await this.react(sock, msg, '✅');
    }

    // ─────────────────────────────────────────────────────
    //  USER MANAGEMENT
    // ─────────────────────────────────────────────────────

    /**
     * Parse target user from various input formats
     * Supports: mentions, phone numbers, @lid format, @s.whatsapp.net format
     * @param {string} input - User input
     * @param {Object} msg - Message object (for extracting mentioned users)
     * @returns {Object|null} { userId, displayName }
     */
    parseBlockTarget(input, msg) {
        if (!input) return null;

        // A mention is unambiguous, so it wins over the typed text
        const mentionedJid = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
        if (mentionedJid && mentionedJid.length > 0) {
            const jid = mentionedJid[0];
            return { userId: jid, displayName: redact.maskJid(jid) };
        }

        const raw = String(input).trim();

        // Explicit JID — accept only the two shapes WhatsApp actually uses, so
        // a crafted string cannot be smuggled into the block map.
        if (raw.includes('@')) {
            if (!PRIVATE_JID_PATTERN.test(raw) && !/^\d{5,25}@lid$/.test(raw)) {
                return null;
            }
            return { userId: raw, displayName: redact.maskJid(raw) };
        }

        let number = raw.replace(/\D/g, '');
        if (!number) return null;

        // Indonesian local format: 08xx → 628xx
        if (number.startsWith('0')) {
            number = '62' + number.substring(1);
        }

        if (number.length < 10 || number.length > 15) {
            return null;
        }

        return {
            userId: `${number}@s.whatsapp.net`,
            displayName: redact.maskJid(`${number}@s.whatsapp.net`)
        };
    }

    async handleBlock(sock, from, msg, context, args) {
        const targetInput = args[0];
        const p = config.bot.prefix;

        if (!targetInput) {
            return await this.reply(sock, from, msg,
                '❌ Tentukan pengguna yang ingin diblokir.\n\n' +
                '*Cara Pakai:*\n' +
                `• \`${p}security block @mention 60\`\n` +
                `• \`${p}security block 62812345678 60\`\n` +
                `• \`${p}security block 081234567890 30\`\n\n` +
                '*Catatan:*\n' +
                '• Owner bot tidak dapat diblokir\n' +
                '• Durasi dalam menit (default 60, maks 10080 / 7 hari)');
        }

        const minutes = Math.min(Math.max(parseInt(args[1], 10) || 60, 1), 10080);
        const target = this.parseBlockTarget(targetInput, msg);

        if (!target) {
            return await this.reply(sock, from, msg,
                '❌ Format target tidak valid.\n\n' +
                'Gunakan @mention, nomor telepon (10–15 digit), atau JID WhatsApp yang sah.');
        }

        const result = security.blockUser(target.userId, minutes * 60 * 1000, 'Diblokir manual oleh owner');

        if (!result.success) {
            this._audit('owner.user.block', context, {
                target: target.userId, outcome: 'denied', detail: result.reason
            });
            return await this.reply(sock, from, msg,
                `❌ *Gagal Memblokir*\n\nAlasan: ${result.reason}\nTarget: ${target.displayName}`);
        }

        this._audit('owner.user.block', context, { target: target.userId, detail: `${minutes} menit` });

        await this.reply(sock, from, msg,
            `⛔ *Pengguna Diblokir*\n\n` +
            `📱 Target: ${target.displayName}\n` +
            `⏱️ Durasi: ${minutes} menit\n` +
            `📝 Alasan: Diblokir manual oleh owner\n\n` +
            `_Bot akan mengabaikan pengguna ini selama durasi blokir._`);
        await this.react(sock, msg, '✅');
    }

    async handleUnblock(sock, from, msg, context, args) {
        const target = args[0]?.toLowerCase();
        const p = config.bot.prefix;

        if (!target) {
            return await this.reply(sock, from, msg,
                '❌ Tentukan pengguna yang ingin dibuka blokirnya.\n\n' +
                '*Cara Pakai:*\n' +
                `• \`${p}security unblock 62812345678\`\n` +
                `• \`${p}security unblock all\``);
        }

        if (target === 'all') {
            const count = security.getBlockedUsers().length;
            if (count === 0) {
                return await this.reply(sock, from, msg, '✅ Tidak ada pengguna yang terblokir.');
            }

            return await this._requestConfirmation(sock, from, msg, context, {
                action: 'unblockAll',
                label: `Buka blokir semua pengguna (${count})`,
                warning: '⚠️ Termasuk pengguna yang diblokir otomatis karena penyalahgunaan.'
            });
        }

        const parsed = this.parseBlockTarget(args[0], msg);
        if (!parsed) {
            return await this.reply(sock, from, msg,
                '❌ Format target tidak valid.\n\nGunakan nomor telepon atau JID WhatsApp yang sah.');
        }

        const success = security.unblockUser(parsed.userId);
        this._audit('owner.user.unblock', context, {
            target: parsed.userId,
            outcome: success ? 'ok' : 'notfound'
        });

        await this.reply(sock, from, msg, success
            ? `✅ *Blokir Dibuka*\n\nTarget: ${parsed.displayName}`
            : `❌ Tidak ditemukan dalam daftar blokir: ${parsed.displayName}`);
        await this.react(sock, msg, '✅');
    }

    /**
     * @private
     */
    async _doUnblockAll(sock, from, msg, context) {
        const count = security.clearAllBlocks();
        this._audit('owner.user.unblockAll', context, { detail: `${count} pengguna` });

        await this.reply(sock, from, msg,
            `✅ *Semua Blokir Dibuka*\n\n${count} pengguna dipulihkan.`);
        await this.react(sock, msg, '✅');
    }

    async listBlockedUsers(sock, from, msg, context) {
        const blockedUsers = security.getBlockedUsers();

        if (blockedUsers.length === 0) {
            return await this._deliver(sock, from, msg, context,
                '✅ *Tidak ada pengguna yang terblokir saat ini.*');
        }

        let response = `⛔ *PENGGUNA TERBLOKIR (${blockedUsers.length})*\n\n`;

        for (const user of blockedUsers.slice(0, 15)) {
            const minsLeft = Math.ceil(user.expiresIn / 1000 / 60);
            response += `• ${redact.maskJid(user.userId)}\n`;
            response += `  ${user.reason}\n`;
            response += `  Berakhir dalam ${minsLeft} menit\n\n`;
        }

        if (blockedUsers.length > 15) {
            response += `…dan ${blockedUsers.length - 15} lainnya`;
        }

        await this._deliver(sock, from, msg, context, response);
    }

    // ─────────────────────────────────────────────────────
    //  BROADCAST
    // ─────────────────────────────────────────────────────

    /**
     * Send a message to one chat.
     *
     * Deliberately single-target: a loop over many JIDs would turn the bot into
     * a spam cannon and is the first thing an attacker with panel access would
     * reach for. The target must match a real WhatsApp JID shape, and the send
     * only happens after confirmation.
     */
    async handleBroadcast(sock, from, msg, context, args) {
        const p = config.bot.prefix;

        if (args.length < 2) {
            return await this.reply(sock, from, msg,
                '❌ Tentukan tujuan dan pesan.\n\n' +
                '*Cara Pakai:*\n' +
                `• \`${p}security broadcast 6281234567890@s.whatsapp.net Halo!\`\n` +
                `• \`${p}security broadcast 120363xxxxx@g.us Pengumuman\`\n\n` +
                '_Satu tujuan per perintah. Butuh konfirmasi sebelum terkirim._');
        }

        const targetJid = args[0].trim();
        const message = args.slice(1).join(' ');

        if (!PRIVATE_JID_PATTERN.test(targetJid) && !GROUP_JID_PATTERN.test(targetJid)) {
            return await this.reply(sock, from, msg,
                '❌ JID tujuan tidak valid.\n\n' +
                'Format yang diterima:\n' +
                '• `<nomor>@s.whatsapp.net` — chat pribadi\n' +
                '• `<id>@g.us` — grup\n\n' +
                '_Tujuan lain (status, newsletter, siaran massal) tidak diizinkan._');
        }

        if (message.length > MAX_BROADCAST_LENGTH) {
            return await this.reply(sock, from, msg,
                `❌ Pesan terlalu panjang (${message.length}/${MAX_BROADCAST_LENGTH} karakter).`);
        }

        const preview = message.length > 200 ? message.slice(0, 200) + '…' : message;

        return await this._requestConfirmation(sock, from, msg, context, {
            action: 'broadcast',
            label: `Kirim pesan ke ${redact.maskJid(targetJid)}`,
            warning: `💬 Isi pesan:\n${preview}`,
            payload: { targetJid, message }
        });
    }

    /**
     * @private
     */
    async _doBroadcast(sock, from, msg, context, payload) {
        try {
            await sock.sendMessage(payload.targetJid, { text: payload.message });
            this._audit('owner.broadcast.sent', context, {
                target: payload.targetJid,
                detail: `${payload.message.length} karakter`
            });

            await this.reply(sock, from, msg,
                `📢 *Pesan Terkirim*\n\n` +
                `📬 Tujuan: ${redact.maskJid(payload.targetJid)}\n` +
                `💬 Panjang: ${payload.message.length} karakter`);
            await this.react(sock, msg, '✅');
        } catch (error) {
            this.logError(error, context);
            this._audit('owner.broadcast.failed', context, {
                target: payload.targetJid, outcome: 'error', detail: error.message
            });
            await this.reply(sock, from, msg,
                `❌ Gagal mengirim ke ${redact.maskJid(payload.targetJid)}\n\n` +
                redact.redact(error.message));
        }
    }

    // ─────────────────────────────────────────────────────
    //  PROCESS CONTROL
    // ─────────────────────────────────────────────────────

    /**
     * @private
     */
    async _doRestart(sock, from, msg, context) {
        const pm2ProcessName = process.env.PM2_PROCESS_NAME || 'hambot';
        this._audit('owner.process.restart', context, { detail: pm2ProcessName });

        await this.reply(sock, from, msg,
            '🔄 *Me-restart proses bot…*\n\n' +
            `Proses PM2: ${pm2ProcessName}\n` +
            'Bot kembali dalam beberapa detik.');

        // Let the outgoing message flush before the process goes away
        await new Promise(resolve => setTimeout(resolve, 1000));

        try {
            const pm2Restart = spawn('pm2', ['restart', pm2ProcessName], {
                detached: true,
                stdio: 'ignore',
                shell: false
            });
            pm2Restart.unref();
        } catch (error) {
            // No PM2: exit and rely on the supervisor to bring the bot back
            this.logError(error, { context: 'pm2-restart-fallback' });
            process.exit(0);
        }
    }

    /**
     * @private
     */
    async _doStop(sock, from, msg, context) {
        const pm2ProcessName = process.env.PM2_PROCESS_NAME || 'hambot';
        this._audit('owner.process.stop', context, { outcome: 'warning', detail: pm2ProcessName });

        await this.reply(sock, from, msg,
            '🛑 *Menghentikan proses bot…*\n\n' +
            `Nyalakan lagi dari server dengan \`pm2 start ${pm2ProcessName}\`.`);

        await new Promise(resolve => setTimeout(resolve, 1000));

        try {
            const pm2Stop = spawn('pm2', ['stop', pm2ProcessName], {
                detached: true,
                stdio: 'ignore',
                shell: false
            });
            pm2Stop.unref();
        } catch (error) {
            process.exit(0);
        }
    }

    // ─────────────────────────────────────────────────────
    //  FORMATTING HELPERS
    // ─────────────────────────────────────────────────────

    /**
     * Render a boolean as a status flag.
     * @private
     */
    _flag(value) {
        return value ? '✅ AKTIF' : '❌ NONAKTIF';
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
        if (!bytes || bytes <= 0) return '0 B';
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
        return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
    }
}

module.exports = SecurityCommand;
