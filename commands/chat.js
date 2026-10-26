/**
 * Chat Command — talk to an AI from WhatsApp
 *
 * The bot relays the question to one of three backends set up in .env:
 * a local model (Ollama, LM Studio, …), an API provider (OpenAI-compatible,
 * Anthropic, Gemini), or an agent platform (Hermes Agent, OpenClaw) on this
 * machine or another one on the tailnet. Everything else — access, limits,
 * memory, fallback, health — lives in utils/chat, which is only loaded the
 * first time someone uses `.chat`.
 *
 *   .chat <pertanyaan>          ask (reply to a message to include it)
 *   .chat reset                 forget my conversation here
 *   .chat stop [all]            cancel my request (owner: everyone's)
 *   .chat status                what is set up, and how it is doing
 *   .chat test | models | use   owner tools
 */

const CommandBase = require('./base');
const config = require('../config');
const ui = require('../utils/ui');
const logger = require('../utils/logger');
const { formatSize } = require('../utils/helpers');

const OWNER_SUBCOMMANDS = new Set(['test', 'models', 'use']);
const PROGRESS_NOTE_AFTER_MS = 30 * 1000;
const TYPING_REFRESH_MS = 10 * 1000;

/** CHAT_COOLDOWN_SEC, read without loading utils/chat. */
function cooldownFromEnv() {
    const value = Number.parseInt(process.env.CHAT_COOLDOWN_SEC, 10);
    const seconds = Number.isFinite(value) ? Math.min(Math.max(value, 0), 3600) : 5;
    // The handler treats 0 as "use the default", so "no cooldown" is 1ms.
    return Math.max(1, seconds * 1000);
}

/**
 * A fix or problem line for the chat: like ui.safe, but .env names keep
 * their underscores (as inline code, so WhatsApp does not italicise them).
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function fixText(text, max = 300) {
    return ui.truncate(String(text ?? '').replace(/[*~`]/g, ''), max)
        .replace(/\b([A-Z][A-Z0-9]*_[A-Z0-9_]*[A-Z0-9])\b/g, '`$1`');
}

/** Text of a message, whatever kind it is. */
function messageText(message) {
    if (!message) return '';
    return message.conversation ||
        message.extendedTextMessage?.text ||
        message.imageMessage?.caption ||
        message.videoMessage?.caption ||
        message.documentMessage?.caption ||
        message.documentWithCaptionMessage?.message?.documentMessage?.caption ||
        '';
}

/**
 * The question exactly as typed: the handler's `args` split on spaces, which
 * loses code indentation, so it is taken from the raw text instead.
 * @param {Object} msg
 * @returns {string}
 */
function rawQuestion(msg) {
    const text = messageText(msg.message);
    const prefix = config.bot.prefix;
    let body = text.trimStart();
    if (body.startsWith(prefix)) body = body.slice(prefix.length);
    body = body.replace(/^\s*\S+/, ''); // the command word (or alias, or typo)
    return body.replace(/^[ \t]*\n?/, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trimEnd();
}

class ChatCommand extends CommandBase {
    constructor() {
        super({
            name: 'chat',
            aliases: ['ai', 'ask', 'tanya'],
            description: 'Ngobrol dengan AI langsung dari WhatsApp',
            usage: '.chat <pertanyaan>',
            category: 'ai',
            cooldown: cooldownFromEnv()
        });
    }

    /** utils/chat, loaded on first use. */
    chat() {
        return require('../utils/chat');
    }

    async execute(sock, msg, args, context) {
        const { from } = context;
        const isOwner = Boolean(context.isOwner);
        const enabled = /^(true|yes|on|1)$/i.test(String(process.env.CHAT_ENABLED || '').trim());

        if (!enabled) {
            return this.replyError(sock, from, msg, isOwner
                ? 'AI chat belum dinyalakan.'
                : 'Fitur AI belum aktif.', {
                title: 'AI Nonaktif',
                icon: '🤖',
                hint: isOwner ? ['./deploy.sh chat — atur dan nyalakan', 'atau CHAT_ENABLED=true di .env, lalu restart'] : []
            });
        }

        const { service, ChatUserError } = this.chat();
        const svc = service();
        const who = { sender: context.sender, chat: from, isGroup: context.isGroup, isOwner };

        const sub = (args[0] || '').toLowerCase();
        const exact = args.length === 1 || (args.length === 2 && ['use', 'stop', 'models'].includes(sub));
        if (exact && ['reset', 'status', 'test', 'models', 'use', 'stop', 'help'].includes(sub)) {
            // Housekeeping, not a question: the next question may follow at once.
            context.releaseCooldown = true;
            if (OWNER_SUBCOMMANDS.has(sub) && !isOwner) {
                return this.replyError(sock, from, msg, `${ui.mono('.chat ' + sub)} khusus owner.`, { title: 'Akses Ditolak', icon: ui.EMOJI.locked });
            }
            return this.subcommand(sub, args.slice(1), sock, msg, context, svc, who);
        }

        const access = svc.access(who);
        if (!access.ok) return this.replyAccess(sock, from, msg, access.reason, isOwner);

        const question = rawQuestion(msg);
        if (!question.trim()) return this.showUsage(sock, from, msg);

        const quotedMessage = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const quoted = messageText(quotedMessage);

        await this.react(sock, msg, '⏳');

        let typingTimer = null;
        let noteSent = false;
        const typing = () => {
            if (!svc.settings.typing || typeof sock.sendPresenceUpdate !== 'function') return;
            sock.sendPresenceUpdate('composing', from).catch(() => {});
        };

        try {
            const result = await svc.ask(who, question, {
                quoted,
                onQueued: async (position) => {
                    await sock.sendMessage(from, {
                        text: ui.info('Antre', [
                            `Semua slot AI sedang dipakai. Kamu antrean ke-${position}.`,
                            'Pertanyaanmu jalan otomatis begitu ada slot kosong.',
                            `${ui.mono('.chat stop')} untuk membatalkan.`
                        ], { icon: ui.EMOJI.wait })
                    }, { quoted: msg });
                },
                onStart: (session) => {
                    typing();
                    typingTimer = setInterval(() => {
                        typing();
                        const running = Date.now() - session.startedAt;
                        if (!noteSent && running >= PROGRESS_NOTE_AFTER_MS) {
                            noteSent = true;
                            const tool = session.tool ? ` · ${ui.safe(session.tool, 60)}` : '';
                            sock.sendMessage(from, {
                                text: `⏳ _Masih diproses (aktif ${Math.round(running / 1000)} dtk${tool})…_`
                            }, { quoted: msg }).catch(() => {});
                        }
                    }, TYPING_REFRESH_MS);
                    if (typingTimer.unref) typingTimer.unref();
                }
            });

            await this.sendAnswer(sock, msg, from, result, svc);
            await this.react(sock, msg, result.partial ? '⚠️' : '✅');
            if (result.partial) this.setFailed(context, `chat · ${result.backend} ${result.partial} — partial answer sent`);
        } catch (error) {
            if (error instanceof ChatUserError) {
                await this.replyUserError(sock, msg, from, error, isOwner, context, svc);
                await this.react(sock, msg, error.code === 'stopped' ? '⏹️' : '❌');
                return;
            }
            throw error;
        } finally {
            clearInterval(typingTimer);
            if (typeof sock.sendPresenceUpdate === 'function') sock.sendPresenceUpdate('paused', from).catch(() => {});
        }
    }

    /**
     * Send the answer in as many parts as it needs. Sent as plain text: the
     * card theme (ui.restyle) would rewrite an answer that happens to start
     * with an emoji.
     */
    async sendAnswer(sock, msg, from, result, svc) {
        const notes = [];
        if (result.partial === 'max_active') notes.push('⚠️ _Dihentikan: batas waktu sesi (CHAT_MAX_ACTIVE_MIN) tercapai._');
        else if (result.partial) notes.push('⚠️ _Jawaban terputus — AI berhenti merespons._');
        if (result.truncated) notes.push('✂️ _Jawaban mencapai batas panjang._');
        if (result.cut) notes.push('✂️ _Jawaban dipotong karena terlalu panjang._');
        if (svc.settings.showModel) {
            notes.push(`_🤖 ${ui.safe(result.model, 60)}${result.viaFallback ? ' · via cadangan' : ''}_`);
        }
        if (result.remaining !== null && result.remaining !== undefined && result.remaining <= 3) {
            notes.push(`_Sisa ${result.remaining} pertanyaan hari ini._`);
        }

        const parts = [...result.parts];
        const files = result.files || [];
        // A files-only answer has no text to carry the notes.
        if (notes.length && parts.length) parts[parts.length - 1] = `${parts[parts.length - 1]}\n\n${notes.join('\n')}`;
        let sent = 0;
        for (let i = 0; i < parts.length; i++) {
            const options = sent === 0 ? { quoted: msg } : {};
            await sock.sendMessage(from, { text: ui.clamp(parts[i]) }, options);
            sent++;
        }

        if (!files.length && !result.filesDropped) return;
        const agentMedia = require('../utils/chat/media');
        const refused = {};
        let delivered = 0;
        for (const ref of files) {
            const file = await svc.openFile(ref);
            if (file.error) {
                refused[file.error] = (refused[file.error] || 0) + 1;
                continue;
            }
            try {
                await sock.sendMessage(from, agentMedia.toMessage(file), sent === 0 ? { quoted: msg } : {});
                sent++;
                delivered++;
            } catch (error) {
                refused.send_failed = (refused.send_failed || 0) + 1;
            }
        }

        // One line in the log, one note in the chat; never paths or contents.
        const failedCount = Object.values(refused).reduce((a, b) => a + b, 0);
        const why = Object.entries(refused).map(([k, n]) => `${n} ${k}`).join(', ');
        logger.chat(`files: ${delivered} sent${failedCount ? `, refused ${why}` : ''}${result.filesDropped ? `, ${result.filesDropped} over CHAT_AGENT_MEDIA_MAX_FILES` : ''}`,
            { problem: failedCount > 0 });

        const tail = [];
        if (failedCount) {
            const reasons = Object.keys(refused).map(k => agentMedia.REASONS[k] || 'gagal dikirim');
            tail.push(`⚠️ _${failedCount} file tidak terkirim (${[...new Set(reasons)].join(', ')})._`);
        }
        if (result.filesDropped) tail.push(`⚠️ _${result.filesDropped} file lain tidak dikirim (batas ${svc.settings.agentMedia.maxFiles} file per jawaban)._`);
        if (!parts.length) tail.push(...notes);
        if (tail.length) await sock.sendMessage(from, { text: ui.clamp(tail.join('\n')) }, sent === 0 ? { quoted: msg } : {});
    }

    async showUsage(sock, from, msg) {
        return this.replyUsage(sock, from, msg, {
            icon: '🤖',
            title: 'AI Chat',
            description: 'Tanya apa saja, AI menjawab di sini.',
            usage: ['.chat <pertanyaan>', '.chat reset', '.chat stop', '.chat status'],
            examples: ['.chat jelaskan apa itu DNS', '.chat buatkan caption untuk foto pantai'],
            notes: ['Reply sebuah pesan dengan .chat agar isinya ikut dikirim', 'AI mengingat obrolan terakhirmu — .chat reset untuk mulai baru']
        });
    }

    async replyAccess(sock, from, msg, reason, isOwner) {
        const messages = {
            groups: 'AI chat tidak tersedia di grup.',
            private: 'AI chat hanya tersedia di grup.',
            owner: 'AI chat khusus owner bot.',
            allowlist: 'AI chat hanya untuk pengguna yang diizinkan owner.',
            agent_owner: 'Agen AI di bot ini khusus owner.',
            not_configured: isOwner ? 'Belum ada backend AI yang diatur.' : 'Fitur AI belum aktif.'
        };
        const hint = reason === 'not_configured' && isOwner ? ['./deploy.sh chat — atur backend AI', '.chat status'] : [];
        return this.replyError(sock, from, msg, messages[reason] || 'AI chat tidak tersedia.', {
            title: reason === 'not_configured' ? 'AI Belum Siap' : 'Akses Ditolak',
            icon: reason === 'not_configured' ? '🤖' : ui.EMOJI.locked,
            hint
        });
    }

    /** Explain why there is no answer. Owners get the details, others a plain sentence. */
    async replyUserError(sock, msg, from, error, isOwner, context, svc) {
        const s = svc.settings;
        const send = (reason, opts) => this.replyError(sock, from, msg, reason, opts);

        switch (error.code) {
            case 'stopped':
                return send('Permintaan dibatalkan.', { title: 'Dibatalkan', icon: '⏹️' });
            case 'busy_user':
                // One request per person across all chats, so it may be elsewhere.
                return send('Pertanyaanmu sebelumnya masih diproses (di chat ini atau chat lain).', {
                    title: 'Masih Diproses', icon: ui.EMOJI.wait, hint: ['Tunggu jawabannya dulu', '.chat stop — batalkan']
                });
            case 'busy':
                return send(`AI sedang melayani ${s.maxConcurrent} percakapan dan antreannya penuh.`, {
                    title: 'Sedang Sibuk', icon: ui.EMOJI.wait, hint: ['Coba lagi sebentar lagi']
                });
            case 'queue_timeout':
                return send('Antrean terlalu lama, permintaanmu dilepas.', { title: 'Sedang Sibuk', icon: ui.EMOJI.wait, hint: ['Coba lagi sebentar lagi'] });
            case 'daily_limit':
                return send(`Batas harian ${error.limit} pertanyaan sudah tercapai.`, { title: 'Batas Harian', icon: ui.EMOJI.clock, hint: ['Coba lagi besok'] });
            case 'agent_owner':
                return this.replyAccess(sock, from, msg, 'agent_owner', isOwner);
            case 'refusal':
                return send('AI menolak menjawab pertanyaan ini.', { title: 'Ditolak AI', icon: '🙅' });
            case 'context':
                return send('Percakapan ini terlalu panjang untuk model AI-nya.', { title: 'Terlalu Panjang', hint: ['.chat reset — mulai obrolan baru', 'Kirim pertanyaan yang lebih pendek'] });
            case 'max_active':
                return send('AI dihentikan karena melewati batas waktu sesi.', { title: 'Dihentikan', hint: isOwner ? ['Naikkan CHAT_MAX_ACTIVE_MIN, atau 0 untuk tanpa batas'] : [] });
            case 'empty':
                return send('AI tidak memberi jawaban.', { title: 'Jawaban Kosong', hint: ['Coba lagi atau ubah pertanyaannya'] });
            case 'offline': {
                const tried = error.tried || [];
                const last = tried.filter(t => t.error).pop();
                this.setFailed(context, last
                    ? `chat · ${last.id} ${last.error.status || ''} ${last.error.kind} — ${last.error.fix ? 'fix: ' + last.error.fix : last.error.summary}`.replace(/\s+/g, ' ')
                    : 'chat · every backend is set aside');
                if (!isOwner) {
                    return send('AI sedang tidak bisa dihubungi. Coba lagi nanti ya.', { title: 'AI Offline', icon: '📡' });
                }
                const hint = [];
                for (const t of tried) {
                    const label = s.backends[t.id]?.label || t.id;
                    if (t.skipped) {
                        const when = t.retryInMs ? ` (coba lagi ${Math.ceil(t.retryInMs / 1000)} dtk)` : '';
                        hint.push(`${label}: disisihkan — ${t.state === 'down:config' ? 'pengaturan salah' : 'gagal berulang'}${when}`);
                    } else if (t.error) {
                        hint.push(`${label}: ${t.error.summary}`);
                        if (t.error.fix && !context.isGroup) hint.push(`↳ ${fixText(t.error.fix)}`);
                    }
                }
                hint.push('.chat status · .chat test');
                return send('Tidak ada backend AI yang bisa menjawab.', { title: 'AI Offline', icon: '📡', hint });
            }
            default:
                return send('AI chat gagal memproses permintaan.', { title: 'Gagal' });
        }
    }

    async subcommand(sub, rest, sock, msg, context, svc, who) {
        const { from } = context;
        switch (sub) {
            case 'help':
                return this.showUsage(sock, from, msg);

            case 'reset': {
                const had = svc.reset(who);
                return this.reply(sock, from, msg, ui.success('Obrolan Direset', [
                    had ? 'AI sudah melupakan obrolanmu di chat ini.' : 'Belum ada obrolan yang diingat di chat ini.',
                    'Pertanyaan berikutnya dimulai dari awal.'
                ], { icon: '🧹' }));
            }

            case 'stop': {
                const all = (rest[0] || '').toLowerCase() === 'all';
                if (all && !who.isOwner) {
                    return this.replyError(sock, from, msg, `${ui.mono('.chat stop all')} khusus owner.`, { title: 'Akses Ditolak', icon: ui.EMOJI.locked });
                }
                const count = svc.stop(who, all);
                return this.reply(sock, from, msg, count
                    ? ui.success('Dihentikan', [`${count} permintaan AI dibatalkan.`], { icon: '⏹️' })
                    : ui.info('Tidak Ada', ['Tidak ada permintaan AI yang sedang berjalan.'], { icon: '⏹️' }));
            }

            case 'use': {
                const id = (rest[0] || '').toLowerCase();
                if (!['local', 'provider', 'agent'].includes(id)) {
                    return this.replyUsage(sock, from, msg, {
                        icon: '🔀', title: 'Ganti Backend',
                        usage: ['.chat use local', '.chat use provider', '.chat use agent'],
                        notes: ['Hanya backend yang sudah diatur di .env', 'Pilihan disimpan dan tetap berlaku setelah restart']
                    });
                }
                const result = svc.use(id);
                if (!result.ok) {
                    return this.replyError(sock, from, msg, result.reason === 'not_configured'
                        ? `Backend ${ui.mono(id)} belum diatur di .env.`
                        : `Pengaturan backend ${ui.mono(id)} belum lengkap.`, {
                        hint: result.detail && !context.isGroup ? [fixText(result.detail)] : ['./deploy.sh chat']
                    });
                }
                return this.reply(sock, from, msg, ui.success('Backend Diganti', [
                    `Sekarang memakai ${ui.bold(svc.settings.backends[id].label)}.`,
                    'Pilihan ini disimpan.'
                ], { icon: '🔀' }));
            }

            case 'models': {
                await this.react(sock, msg, '⏳');
                const id = (rest[0] || svc.settings.backend).toLowerCase();
                try {
                    const models = await svc.models(id);
                    const current = svc.settings.backends[id]?.model;
                    const lines = models.length
                        ? models.slice(0, 40).map(m => `${m === current ? '✅' : ui.SYM.dot} ${ui.mono(ui.safe(m, 80))}`)
                        : ['Server tidak mengirim daftar model.'];
                    if (models.length > 40) lines.push(`… dan ${models.length - 40} lagi`);
                    return this.reply(sock, from, msg, ui.info(`Model ${id}`, lines, { icon: '🧠', footer: current ? `Dipakai: ${current}` : undefined }));
                } catch (error) {
                    const reason = error.summary || error.code || 'gagal mengambil daftar model';
                    return this.replyError(sock, from, msg, `Daftar model tidak bisa diambil: ${ui.safe(reason, 120)}`, {
                        hint: error.fix && !context.isGroup ? [fixText(error.fix)] : ['.chat status']
                    });
                }
            }

            case 'test': {
                await this.react(sock, msg, '⏳');
                const results = await svc.test();
                if (!results.length) {
                    return this.replyError(sock, from, msg, 'Belum ada backend yang diatur.', { hint: ['./deploy.sh chat'] });
                }
                const icon = { ok: '✅', FIX: '❌', note: 'ℹ️' };
                const lines = [];
                for (const r of results) {
                    for (const line of r.lines) {
                        const text = context.isGroup ? line.text.split(' — ')[0] : line.text;
                        lines.push(`${icon[line.level] || ui.SYM.dot} ${fixText(text, 400)}`);
                    }
                }
                const allOk = results.every(r => r.ok);
                await this.react(sock, msg, allOk ? '✅' : '❌');
                return this.reply(sock, from, msg, ui.card({
                    icon: allOk ? '✅' : '🩺',
                    title: 'Tes AI Chat',
                    lines,
                    footer: allOk ? 'Semua backend siap' : 'Perbaiki yang bertanda ❌, lalu .chat test lagi'
                }));
            }

            case 'status':
            default:
                return this.reply(sock, from, msg, this.renderStatus(svc.status(who), who, svc, context));
        }
    }

    renderStatus(st, who, svc, context) {
        const s = svc.settings;
        const stateText = (h) => {
            if (!h) return '—';
            if (h.state === 'ready') return '✅ siap';
            if (h.state === 'down:config') return '❌ pengaturan salah';
            if (h.state === 'probing') return '🔄 dicoba lagi';
            return `⚠️ disisihkan${h.retryInMs ? ` (${Math.ceil(h.retryInMs / 1000)} dtk lagi)` : ''}`;
        };
        const backendLine = (id) => {
            const b = st.backends[id];
            if (!b) return `${id} — belum diatur`;
            return `${b.label} · ${ui.safe(b.model || '?', 50)} · ${stateText(b.health)}`;
        };

        const lines = [
            ui.kv('Utama', backendLine(st.backend), '🤖'),
            st.fallback !== 'none' && ui.kv('Cadangan', backendLine(st.fallback), '🛟'),
            ui.kv('Memori', st.memory.enabled ? `${st.memory.turns} giliran, lupa setelah ${st.memory.idleMin} mnt (kamu: ${st.memory.mine})` : 'mati', '🧠'),
            st.daily.enabled && st.daily.remaining !== null && ui.kv('Kuota', `sisa ${st.daily.remaining}/${st.daily.limit} hari ini`, '🎫'),
            ui.kv('Slot', `${st.slots.active}/${st.slots.max} aktif · ${st.slots.waiting} antre`, '⚙️')
        ];

        const mine = st.sessions.filter(x => x.mine);
        for (const x of mine) {
            lines.push(ui.kv('Sesimu', x.queued ? 'menunggu antrean' : `aktif ${ui.duration(x.runningMs)} · aktivitas terakhir ${Math.round(x.idleMs / 1000)} dtk lalu`, '⏳'));
        }

        if (who.isOwner) {
            lines.push('', ui.section('Detail owner', '👑'));
            lines.push(ui.kv('Akses', `${st.access}${st.backends.agent ? ` · agen: ${st.agentAccess}` : ''}`));
            if (st.backends.agent) {
                lines.push(ui.kv('File agen', st.agentMedia.dir
                    ? `${ui.safe(st.agentMedia.dir, 60)} · maks ${st.agentMedia.maxFiles} file, ${formatSize(st.agentMedia.maxBytes)} per file`
                    : 'mati (CHAT_AGENT_MEDIA_DIR)'));
            }
            for (const [id, b] of Object.entries(st.backends)) {
                lines.push(ui.kv(id, `${b.label} @ ${b.host}${b.key ? ` · kunci ${b.key}` : ''}${b.memory === 'agent' ? ' · sesi di agen' : ''}`));
                const err = b.health.lastError;
                if (err) {
                    lines.push(`   ↳ terakhir: ${fixText(err.summary, 120)}`);
                    if (err.fix && !context.isGroup) lines.push(`   ↳ fix: ${fixText(err.fix)}`);
                }
            }
            const others = st.sessions.filter(x => !x.mine);
            for (const x of others) {
                lines.push(`${ui.SYM.dot} sesi ${x.backend || '-'} · ${x.queued ? 'antre' : `${ui.duration(x.runningMs)}, aktivitas ${Math.round(x.idleMs / 1000)} dtk lalu`}${x.tool ? ` · ${ui.safe(x.tool, 40)}` : ''}`);
            }
            if (st.problems.length) {
                lines.push('', ui.section('Masalah pengaturan', '⚠️'));
                for (const p of st.problems.slice(0, 6)) lines.push(`${ui.SYM.dot} ${fixText(p, context.isGroup ? 90 : 300)}`);
                if (st.problems.length > 6) lines.push(`… dan ${st.problems.length - 6} lagi (lihat log bot)`);
            }
        }

        return ui.card({
            icon: '🤖',
            title: 'AI Chat',
            lines,
            footer: who.isOwner ? `.chat test · .chat models · .chat use · ${config.bot.name}` : config.bot.name
        });
    }
}

module.exports = ChatCommand;
module.exports.rawQuestion = rawQuestion;
module.exports.messageText = messageText;
