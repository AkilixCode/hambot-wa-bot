/**
 * UI Toolkit
 *
 * Single source of truth for everything HamBot says in chat. Commands should
 * compose their replies from the builders here instead of hand-rolling strings,
 * so that headers, bullets, error shapes and cache badges stay identical across
 * every command.
 *
 * Design notes:
 * - WhatsApp renders messages in a proportional font, so column alignment with
 *   spaces is unreliable. Every frame here is a LEFT RAIL ("│ text") which looks
 *   the same regardless of how wide the content is. Closed boxes are avoided.
 * - WhatsApp markdown is limited to *bold*, _italic_, ~strike~ and `mono`.
 *   `**bold**` is NOT supported and renders with stray asterisks — use bold().
 * - Decorative Unicode fonts are unreadable to screen readers and break text
 *   search, so they are reserved for brand moments (the bot name, menu title)
 *   and can be switched off entirely with UI_FANCY_FONT=false.
 */

const config = require('../config');

// Toggle for the decorative Unicode alphabets. Off => plain ASCII everywhere.
const FANCY_ENABLED = process.env.UI_FANCY_FONT !== 'false';

// Timezone used for greetings and timestamps.
const TIMEZONE = process.env.BOT_TIMEZONE || 'Asia/Jakarta';
const TZ_LABEL = process.env.BOT_TIMEZONE_LABEL || 'WIB';

// WhatsApp accepts far longer messages, but anything past a few thousand
// characters is unreadable on a phone and gets collapsed behind "Read more".
const MAX_MESSAGE_LENGTH = 4000;

/* ------------------------------------------------------------------ *
 * Symbols
 * ------------------------------------------------------------------ */

const SYM = {
    railTop: '╭',
    rail: '│',
    railBottom: '╰',
    railHeavyTop: '╭',
    railHeavy: '┃',
    railHeavyBottom: '╰',
    branchLight: '─',
    branchHeavy: '━',
    bracketOpen: '「',
    bracketClose: '」',
    bullet: '▸',
    dot: '·',
    diamond: '◈',
    arrow: '➜',
    star: '✦'
};

const EMOJI = {
    bot: '🤖',
    ok: '✅',
    fail: '❌',
    warn: '⚠️',
    info: 'ℹ️',
    locked: '🔒',
    blocked: '🚫',
    wait: '⏳',
    clock: '⏱️',
    tip: '💡',
    example: '📌',
    usage: '📝',
    alias: '🔄',
    folder: '📁',
    cached: '📦',
    live: '🛰️',
    search: '🔍',
    sparkle: '✨'
};

/* ------------------------------------------------------------------ *
 * Decorative alphabets
 * ------------------------------------------------------------------ */

const SMALL_CAPS = {
    a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ',
    j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ',
    s: 'ꜱ', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ'
};

/**
 * Remap ASCII letters/digits onto a contiguous Unicode alphabet block.
 * Characters outside the mapped ranges (spaces, punctuation, emoji) pass through
 * untouched.
 *
 * @param {string} text
 * @param {number|null} upperBase Code point of the block's "A"
 * @param {number|null} lowerBase Code point of the block's "a"
 * @param {number|null} digitBase Code point of the block's "0"
 * @returns {string}
 * @private
 */
function _remap(text, upperBase, lowerBase, digitBase) {
    let out = '';
    for (const ch of String(text)) {
        const code = ch.codePointAt(0);
        if (upperBase && code >= 0x41 && code <= 0x5a) {
            out += String.fromCodePoint(upperBase + (code - 0x41));
        } else if (lowerBase && code >= 0x61 && code <= 0x7a) {
            out += String.fromCodePoint(lowerBase + (code - 0x61));
        } else if (digitBase && code >= 0x30 && code <= 0x39) {
            out += String.fromCodePoint(digitBase + (code - 0x30));
        } else {
            out += ch;
        }
    }
    return out;
}

/** Mathematical Sans-Serif Bold — the bot's "display" face. */
function fancy(text) {
    if (!FANCY_ENABLED) return String(text);
    return _remap(text, 0x1d5d4, 0x1d5ee, 0x1d7ec);
}

/** Mathematical Sans-Serif Italic — used for taglines. */
function fancyItalic(text) {
    if (!FANCY_ENABLED) return String(text);
    return _remap(text, 0x1d608, 0x1d622, null);
}

/** Mathematical Monospace — used for version strings and IDs. */
function fancyMono(text) {
    if (!FANCY_ENABLED) return String(text);
    return _remap(text, 0x1d670, 0x1d68a, 0x1d7f6);
}

/** Small capitals — used for category labels. */
function smallCaps(text) {
    if (!FANCY_ENABLED) return String(text).toUpperCase();
    return String(text)
        .split('')
        .map(ch => SMALL_CAPS[ch.toLowerCase()] || ch)
        .join('');
}

/* ------------------------------------------------------------------ *
 * WhatsApp markdown
 * ------------------------------------------------------------------ */

/** Wrap in WhatsApp bold. Never emit `**text**` — WhatsApp does not parse it. */
const bold = text => `*${text}*`;
const italic = text => `_${text}_`;
const strike = text => `~${text}~`;
const mono = text => `\`${text}\``;
const block = text => `\`\`\`${text}\`\`\``;

/* ------------------------------------------------------------------ *
 * Structure
 * ------------------------------------------------------------------ */

/**
 * Drop empty entries and flatten nested arrays so builders can pass
 * conditionals straight through (`cond && line`).
 * @private
 */
function _lines(input) {
    const flat = Array.isArray(input) ? input.flat(Infinity) : [input];
    return flat.filter(line => line !== null && line !== undefined && line !== false);
}

/**
 * A titled block with a left rail.
 *
 *   ╭──「 🌤️ *CUACA* 」
 *   │ 📍 Jakarta
 *   │ 🌡️ 31°C
 *   ╰─◈ _footer_
 *
 * @param {Object} opts
 * @param {string} [opts.icon] Leading emoji for the title
 * @param {string} opts.title Title text (bolded automatically)
 * @param {Array<string>} [opts.lines] Body lines, each gets the rail prefix
 * @param {string} [opts.footer] Italic footer on the closing rail
 * @param {boolean} [opts.heavy] Use the heavy rail (for top-level headers)
 * @returns {string}
 */
function card({ icon, title, lines = [], footer, heavy = false } = {}) {
    const rail = heavy ? SYM.railHeavy : SYM.rail;
    const branch = heavy ? SYM.branchHeavy : SYM.branchLight;
    const head = [icon, title ? bold(title) : null].filter(Boolean).join(' ');

    const out = [`${SYM.railTop}${branch.repeat(2)}${SYM.bracketOpen} ${head} ${SYM.bracketClose}`];
    for (const line of _lines(lines)) {
        out.push(line === '' ? rail : `${rail} ${line}`);
    }
    out.push(footer
        ? `${SYM.railBottom}${branch}${SYM.diamond} ${italic(footer)}`
        : `${SYM.railBottom}${branch.repeat(4)}`);

    return out.join('\n');
}

/**
 * A banner for the top of large messages (the menu, status panels).
 * @param {Object} opts
 * @param {string} [opts.icon]
 * @param {string} opts.title Rendered in the decorative bold face
 * @param {string} [opts.subtitle] Italic line under the title
 * @returns {string}
 */
function banner({ icon = EMOJI.bot, title, subtitle } = {}) {
    const bar = SYM.branchHeavy.repeat(18);
    const out = [
        `${SYM.railHeavyTop}${bar}`,
        `${SYM.railHeavy}  ${icon}  ${fancy(String(title).toUpperCase())}`
    ];
    if (subtitle) out.push(`${SYM.railHeavy}  ${italic(subtitle)}`);
    out.push(`${SYM.railHeavyBottom}${bar}`);
    return out.join('\n');
}

/** A label/value line: `▸ *Label:* value` */
function kv(label, value, icon) {
    const lead = icon || SYM.bullet;
    return `${lead} ${bold(label + ':')} ${value}`;
}

/** Bullet a list of strings. */
function bullets(items, symbol = SYM.bullet) {
    return _lines(items).map(item => `${symbol} ${item}`);
}

/** A horizontal rule. */
function divider(length = 16, heavy = false) {
    return (heavy ? SYM.branchHeavy : SYM.branchLight).repeat(length);
}

/* ------------------------------------------------------------------ *
 * Semantic message builders
 * ------------------------------------------------------------------ */

/**
 * A successful result.
 * @param {string} title
 * @param {Array<string>|string} [lines]
 * @param {Object} [opts] { icon, footer }
 */
function success(title, lines = [], opts = {}) {
    return card({
        icon: opts.icon || EMOJI.ok,
        title,
        lines: _lines(lines),
        footer: opts.footer
    });
}

/**
 * A failure the user can usually act on.
 *
 * Keeping `hint` separate from `reason` matters: the reason says what went
 * wrong, the hint says what to type next. Commands that skip the hint leave the
 * user guessing.
 *
 * @param {string} reason What went wrong, one sentence
 * @param {Object} [opts]
 * @param {string} [opts.title] Defaults to "Gagal"
 * @param {Array<string>} [opts.hint] Suggested next steps
 * @param {string} [opts.icon]
 */
function error(reason, opts = {}) {
    const lines = [reason];
    const hint = _lines(opts.hint || []);
    if (hint.length) {
        lines.push('');
        lines.push(`${EMOJI.tip} ${bold('Coba ini:')}`);
        lines.push(...bullets(hint));
    }
    return card({
        icon: opts.icon || EMOJI.fail,
        title: opts.title || 'Gagal',
        lines
    });
}

/** A warning: the request was understood but refused or capped. */
function warn(reason, opts = {}) {
    return error(reason, { ...opts, icon: opts.icon || EMOJI.warn, title: opts.title || 'Perhatian' });
}

/** Neutral information. */
function info(title, lines = [], opts = {}) {
    return card({ icon: opts.icon || EMOJI.info, title, lines: _lines(lines), footer: opts.footer });
}

/**
 * The standard "how do I use this?" panel. Every command shows the same shape,
 * so users only have to learn to read it once.
 *
 * @param {Object} opts
 * @param {string} [opts.icon]
 * @param {string} opts.title
 * @param {string} [opts.description]
 * @param {Array<string>|string} [opts.usage] Command forms, rendered monospace
 * @param {Array<string>|string} [opts.examples] Concrete invocations
 * @param {Array<string>} [opts.notes]
 * @param {string} [opts.footer]
 */
function usage({ icon, title, description, usage: forms, examples, notes, footer } = {}) {
    const lines = [];

    if (description) {
        lines.push(description, '');
    }

    const formList = _lines(forms || []);
    if (formList.length) {
        lines.push(`${EMOJI.usage} ${bold('Cara pakai')}`);
        lines.push(...bullets(formList.map(f => mono(f))));
    }

    const exampleList = _lines(examples || []);
    if (exampleList.length) {
        if (formList.length) lines.push('');
        lines.push(`${EMOJI.example} ${bold('Contoh')}`);
        lines.push(...bullets(exampleList.map(e => mono(e))));
    }

    const noteList = _lines(notes || []);
    if (noteList.length) {
        lines.push('');
        lines.push(`${EMOJI.info} ${bold('Catatan')}`);
        lines.push(...bullets(noteList, SYM.dot));
    }

    return card({ icon: icon || EMOJI.tip, title, lines, footer });
}

/* ------------------------------------------------------------------ *
 * Formatting helpers
 * ------------------------------------------------------------------ */

/** Truncate on a word boundary where possible, with an ellipsis. */
function truncate(text, max = 200) {
    const str = String(text ?? '');
    if (str.length <= max) return str;

    const cut = str.slice(0, max - 1);
    const lastSpace = cut.lastIndexOf(' ');
    // Only snap back to a word boundary if it does not throw away most of the
    // budget — otherwise a single long token would collapse the whole string.
    const body = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
    return `${body.trimEnd()}…`;
}

/**
 * Neutralise WhatsApp markdown before echoing untrusted text back to chat.
 *
 * Anything the user typed — a city name, a domain, a mistyped command — can
 * contain `*`, `_`, `~` or a backtick. Echoed raw, those characters bleed into
 * the surrounding message and corrupt the layout, or close a monospace span
 * early. Every command that quotes user input back should route it through
 * here.
 *
 * @param {string} text
 * @param {number} [max] Length budget
 * @returns {string}
 */
function safe(text, max = 120) {
    return truncate(String(text ?? '').replace(/[*_~`]/g, ''), max);
}

/** Hard cap an outgoing message so WhatsApp never silently swallows the tail. */
function clamp(text, max = MAX_MESSAGE_LENGTH) {
    const str = String(text ?? '');
    if (str.length <= max) return str;
    const notice = `\n\n${EMOJI.warn} ${italic('Pesan dipotong karena terlalu panjang.')}`;
    return str.slice(0, max - notice.length).trimEnd() + notice;
}

/**
 * Human-readable duration in Indonesian. Replaces the three separate duration
 * formatters that previously lived in ping.js, reminder.js and security.js.
 *
 * @param {number} ms Milliseconds
 * @param {Object} [opts]
 * @param {number} [opts.maxUnits] How many units to show (default 2)
 * @returns {string} e.g. "2 hari 4 jam"
 */
function duration(ms, { maxUnits = 2 } = {}) {
    const total = Math.max(0, Math.floor(Number(ms) || 0) / 1000);
    if (total < 1) return '0 detik';

    const units = [
        { label: 'hari', seconds: 86400 },
        { label: 'jam', seconds: 3600 },
        { label: 'menit', seconds: 60 },
        { label: 'detik', seconds: 1 }
    ];

    const parts = [];
    let remaining = Math.floor(total);
    for (const unit of units) {
        const value = Math.floor(remaining / unit.seconds);
        if (value > 0) {
            parts.push(`${value} ${unit.label}`);
            remaining -= value * unit.seconds;
        }
        if (parts.length >= maxUnits) break;
    }

    return parts.join(' ') || '0 detik';
}

/** Duration from a seconds count (process.uptime() and friends). */
function uptime(seconds) {
    return duration((Number(seconds) || 0) * 1000);
}

/** Thousands separators, Indonesian style (1.234.567). */
function number(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value ?? '-');
    return n.toLocaleString('id-ID');
}

/** Compact large numbers: 1.2 jt, 3.4 M, 5.6 T. */
function compactNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value ?? '-');

    const abs = Math.abs(n);
    if (abs >= 1e12) return `${(n / 1e12).toFixed(2)} T`;
    if (abs >= 1e9) return `${(n / 1e9).toFixed(2)} M`;
    if (abs >= 1e6) return `${(n / 1e6).toFixed(2)} jt`;
    if (abs >= 1e3) return `${(n / 1e3).toFixed(1)} rb`;
    return number(n);
}

/** A text meter: ▰▰▰▰▱▱▱▱ 48% */
function meter(percent, width = 10) {
    const pct = Math.min(100, Math.max(0, Number(percent) || 0));
    const filled = Math.round((pct / 100) * width);
    return `${'▰'.repeat(filled)}${'▱'.repeat(width - filled)} ${pct.toFixed(0)}%`;
}

/**
 * One consistent badge for "where did this data come from?". Previously each
 * command invented its own wording (four different renderings existed).
 * @param {boolean} fromCache
 */
function sourceBadge(fromCache) {
    return fromCache
        ? `${EMOJI.cached} Dari cache`
        : `${EMOJI.live} Data langsung`;
}

/** Current wall clock in the configured timezone, e.g. "14:32 WIB". */
function clock(date = new Date()) {
    // en-GB rather than id-ID: the Indonesian locale separates hours and minutes
    // with a dot ("18.19"), which reads as a decimal number at a glance.
    const time = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: TIMEZONE
    }).format(date);
    return `${time} ${TZ_LABEL}`;
}

/** Hour of day (0-23) in the configured timezone. */
function _localHour(date = new Date()) {
    const hour = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        hour12: false,
        timeZone: TIMEZONE
    }).format(date);
    return parseInt(hour, 10) || 0;
}

/**
 * Time-of-day greeting.
 * @param {string} [name] The user's WhatsApp display name (msg.pushName)
 * @param {Date} [date]
 * @returns {string} e.g. "☀️ Selamat siang, *Ilham*!"
 */
function greeting(name, date = new Date()) {
    const hour = _localHour(date);

    let text = 'Selamat malam';
    let icon = '🌙';
    if (hour >= 4 && hour < 11) {
        text = 'Selamat pagi';
        icon = '🌅';
    } else if (hour >= 11 && hour < 15) {
        text = 'Selamat siang';
        icon = '☀️';
    } else if (hour >= 15 && hour < 18) {
        text = 'Selamat sore';
        icon = '🌇';
    }

    const who = _displayName(name);
    return `${icon} ${text}${who ? `, ${bold(who)}` : ''}!`;
}

/**
 * WhatsApp push names are user-controlled, so they can contain markdown
 * characters that would corrupt the surrounding message, or be long enough to
 * push the greeting onto three lines.
 * @private
 */
function _displayName(name) {
    if (!name || typeof name !== 'string') return '';
    const cleaned = name
        .replace(/[*_~`]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned ? truncate(cleaned, 24) : '';
}

/** The bot's identity line, e.g. "HamBot v2.10.0". */
function signature() {
    return `${config.bot.name} ${fancyMono('v' + config.bot.version)}`;
}

module.exports = {
    SYM,
    EMOJI,
    MAX_MESSAGE_LENGTH,

    // Decorative faces
    fancy,
    fancyItalic,
    fancyMono,
    smallCaps,

    // WhatsApp markdown
    bold,
    italic,
    strike,
    mono,
    block,

    // Structure
    card,
    banner,
    kv,
    bullets,
    divider,

    // Semantic builders
    success,
    error,
    warn,
    info,
    usage,

    // Formatting
    truncate,
    safe,
    clamp,
    duration,
    uptime,
    number,
    compactNumber,
    meter,
    sourceBadge,
    clock,
    greeting,
    signature
};
