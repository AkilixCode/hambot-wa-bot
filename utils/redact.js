/**
 * Secret Redaction Utility
 *
 * Anything the bot sends back into a WhatsApp chat (logs, env dumps, error
 * messages, audit entries) MUST pass through `redact()` first. WhatsApp chats
 * are backed up, forwarded and screenshotted — a single leaked API key or
 * proxy credential is unrecoverable.
 *
 * Two layers of defence:
 *   1. Value-based  — every env var that looks like a credential has its exact
 *                     value replaced wherever it appears in the text.
 *   2. Pattern-based — well-known secret shapes (Bearer tokens, JWTs, AIza…,
 *                     sk-…, `?api_key=`, `user:pass@host`) are scrubbed even
 *                     if the bot never had them in its own env.
 *
 * This module intentionally has no project imports so it can never be part of
 * a require cycle and can be used from anywhere, including config loading.
 */

const crypto = require('crypto');

const REDACTED = '[REDACTED]';

// Env var names whose *values* must never reach a chat message.
const SECRET_NAME_PATTERN = /(KEY|TOKEN|SECRET|PASS|PASSWD|PWD|AUTH|CREDENTIAL|COOKIE|SESSION|PRIVATE|SIGNATURE)/i;

// Env vars that match the pattern above but are not actually secret.
const SECRET_NAME_ALLOWLIST = new Set([
    'OWNER_ONLY_COMMANDS',
    'ELEVENLABS_VOICE_ID'
]);

// Values shorter than this are too generic to blind-replace (e.g. "true", "8080")
// and would mangle unrelated text.
const MIN_SECRET_LENGTH = 6;

// Pattern-based scrubbers, applied in order. Credentials embedded in URLs are
// handled first so the query-string rule does not partially match them.
const PATTERN_RULES = [
    // scheme://user:pass@host  →  scheme://[REDACTED]:[REDACTED]@host
    { re: /([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi, to: `$1${REDACTED}:${REDACTED}@` },
    // Authorization headers (before the generic key:value rule, which would
    // otherwise consume the "Bearer" word and leave the token behind)
    { re: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, to: `$1 ${REDACTED}` },
    // JSON Web Tokens
    { re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, to: REDACTED },
    // ?api_key=... &token=... etc.
    { re: /([?&](?:api[_-]?key|apikey|key|access[_-]?token|token|auth|password|passwd|pwd|secret|sig|signature|session)=)([^&\s"'<>]+)/gi, to: `$1${REDACTED}` },
    // "api_key": "...", API_KEY=..., token: '...'
    { re: /((?:api[_-]?key|apikey|access[_-]?token|token|secret|password|passwd|pwd|authorization|auth|credential)["']?\s*[:=]\s*["']?)([^\s"',;}&]{6,})/gi, to: `$1${REDACTED}` },
    // Google / Firebase
    { re: /\bAIza[A-Za-z0-9_-]{10,}/g, to: REDACTED },
    // OpenAI-style, Stripe-style
    { re: /\bsk[-_][A-Za-z0-9_-]{16,}/g, to: REDACTED },
    // GitHub
    { re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g, to: REDACTED },
    // Slack
    { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, to: REDACTED }
];

/**
 * Collect every credential-looking value from the current environment.
 * Sorted longest-first so overlapping values are replaced completely.
 * @returns {string[]}
 */
function collectSecretValues() {
    const values = new Set();

    for (const [name, value] of Object.entries(process.env)) {
        if (!value || typeof value !== 'string') continue;
        if (value.length < MIN_SECRET_LENGTH) continue;
        if (SECRET_NAME_ALLOWLIST.has(name)) continue;
        if (!SECRET_NAME_PATTERN.test(name)) continue;
        values.add(value);
    }

    // Proxy URLs may carry inline credentials even when the var name looks benign.
    for (const name of ['HB_PROXY_URL', 'PROXY_URL']) {
        const value = process.env[name];
        if (value && value.includes('@') && value.length >= MIN_SECRET_LENGTH) {
            values.add(value);
        }
    }

    return Array.from(values).sort((a, b) => b.length - a.length);
}

/**
 * Escape a string for safe use inside a RegExp.
 * @param {string} str
 * @returns {string}
 */
function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Remove secrets from arbitrary text before it is sent to a chat.
 * @param {string} text - Raw text (log lines, error message, command output)
 * @returns {string} Text with credentials replaced by [REDACTED]
 */
function redact(text) {
    if (text === null || text === undefined) return '';
    let output = String(text);

    // Layer 1: exact values we know are secret.
    for (const secret of collectSecretValues()) {
        output = output.replace(new RegExp(escapeRegExp(secret), 'g'), REDACTED);
    }

    // Layer 2: generic secret shapes.
    for (const rule of PATTERN_RULES) {
        rule.re.lastIndex = 0;
        output = output.replace(rule.re, rule.to);
    }

    return output;
}

/**
 * Short, non-reversible fingerprint of a secret.
 * Lets the owner confirm *which* key is loaded without exposing any of it.
 * @param {string} value
 * @returns {string} 8 hex characters
 */
function fingerprint(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8);
}

/**
 * Describe a credential without revealing a single character of it.
 * @param {string} value - The secret value (may be undefined)
 * @param {Object} [labels] - Optional custom labels
 * @returns {string} Human-readable status line
 */
function describeSecret(value, labels = {}) {
    const missing = labels.missing || '❌ Belum diatur';
    const present = labels.present || '✅ Terpasang';

    if (!value) return missing;
    return `${present} (${String(value).length} karakter · sidik jari ${fingerprint(value)})`;
}

/**
 * Mask a WhatsApp JID so it is recognisable but not fully disclosed.
 * 6281234567890@s.whatsapp.net → 6281•••••7890@s.whatsapp.net
 * @param {string} jid
 * @returns {string}
 */
function maskJid(jid) {
    if (!jid) return 'N/A';
    const raw = String(jid);
    const [local, domain] = raw.includes('@') ? [raw.split('@')[0], raw.split('@').slice(1).join('@')] : [raw, null];

    let masked;
    if (local.length <= 6) {
        masked = `${local.slice(0, 2)}${'•'.repeat(Math.max(1, local.length - 2))}`;
    } else {
        masked = `${local.slice(0, 4)}${'•'.repeat(Math.max(3, local.length - 8))}${local.slice(-4)}`;
    }

    return domain ? `${masked}@${domain}` : masked;
}

/**
 * Mask a hostname or IP address so internal network topology is not disclosed.
 * 192.168.1.50 → 192.168.•.•   |   proxy.internal.example.com → •••.example.com
 * @param {string} host
 * @returns {string}
 */
function maskHost(host) {
    if (!host) return 'N/A';
    const value = String(host).trim();

    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
        const octets = value.split('.');
        return `${octets[0]}.${octets[1]}.•.•`;
    }

    if (value.includes(':')) return '•••(IPv6)';

    const labels = value.split('.');
    if (labels.length <= 2) return `${value.slice(0, 2)}•••`;
    return `•••.${labels.slice(-2).join('.')}`;
}

module.exports = {
    REDACTED,
    redact,
    fingerprint,
    describeSecret,
    maskJid,
    maskHost,
    collectSecretValues
};
