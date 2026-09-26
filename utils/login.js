/**
 * Linking the WhatsApp Number
 *
 * Two ways to link the bot as a device on the owner's phone:
 *
 *   - Pairing code (PAIRING_NUMBER set): the bot prints an 8-character code,
 *     and the owner types it in WhatsApp → Linked devices → Link with phone
 *     number. Nothing to scan, which is what makes a headless server painless.
 *   - QR code (default): printed to the terminal as before, and also saved
 *     as data/qr.png for anyone who cannot scan a QR out of server logs.
 */

const fs = require('fs');
const path = require('path');
const { dataDir } = require('./paths');

const QR_FILE_NAME = 'qr.png';

/**
 * Validate PAIRING_NUMBER into the digits-only form Baileys expects.
 *
 * WhatsApp needs the full international number without "+", so a local
 * number starting with 0 is rejected rather than guessed at — guessing the
 * country code wrong would pair the wrong account.
 *
 * @param {string} raw Value from the environment
 * @returns {{number: string|null, error: string|null}}
 */
function parsePairingNumber(raw) {
    const input = String(raw ?? '').trim();
    if (!input) return { number: null, error: null };

    const digits = input.replace(/[\s\-().+]/g, '');
    if (!/^\d+$/.test(digits)) {
        return { number: null, error: 'PAIRING_NUMBER may only contain digits (e.g. 6281234567890)' };
    }
    if (digits.startsWith('0')) {
        return { number: null, error: 'PAIRING_NUMBER needs the country code instead of the leading 0 (e.g. 62812… not 0812…)' };
    }
    if (digits.length < 8 || digits.length > 15) {
        return { number: null, error: 'PAIRING_NUMBER must be 8-15 digits including the country code' };
    }
    return { number: digits, error: null };
}

// Pairing codes requested per process before falling back to the QR code.
// A code nobody types in (wrong number, expired, rejected on the phone) would
// otherwise be re-requested on every QR timeout cycle — forever, and into
// WhatsApp's pairing rate limit. LOGIN_METHOD=code allows a few more.
const MAX_PAIRING_CODES = { auto: 2, code: 5 };

/**
 * Decide how this connection should be linked, and explain any fallback.
 *
 * @param {Object} opts
 * @param {boolean} opts.registered Whether saved credentials already exist
 * @param {string|null} opts.pairingNumber Validated number, or null
 * @param {string} [opts.preference] LOGIN_METHOD: 'auto' (default), 'code' or 'qr'
 * @param {number} [opts.codesIssued] Pairing codes already requested this process
 * @returns {{method: 'none'|'pairing'|'qr', notice: string|null}}
 */
function chooseLoginMethod({ registered, pairingNumber, preference, codesIssued = 0 }) {
    if (registered) return { method: 'none', notice: null };

    const pref = String(preference || 'auto').trim().toLowerCase();
    if (pref === 'qr') return { method: 'qr', notice: null };

    const mode = pref === 'code' ? 'code' : 'auto';
    if (!pairingNumber) {
        return {
            method: 'qr',
            notice: mode === 'code' ? 'LOGIN_METHOD=code needs a valid PAIRING_NUMBER — using the QR code' : null
        };
    }
    if (codesIssued >= MAX_PAIRING_CODES[mode]) {
        return {
            method: 'qr',
            notice: `Pairing did not complete after ${codesIssued} codes — switching to the QR code. ` +
                'Check PAIRING_NUMBER (./deploy.sh config) or relink with ./deploy.sh relink.'
        };
    }
    return { method: 'pairing', notice: null };
}

/**
 * Shorthand for the method alone.
 * @returns {'none'|'pairing'|'qr'}
 */
function loginMethod(opts) {
    return chooseLoginMethod(opts).method;
}

/**
 * "ABCDEFGH" -> "ABCD-EFGH", the way WhatsApp shows it on the phone.
 * @param {string} code
 * @returns {string}
 */
function formatPairingCode(code) {
    const clean = String(code || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

/**
 * The block printed to the console when a pairing code arrives.
 * @param {string} code
 * @param {string} number
 * @returns {string}
 */
function pairingInstructions(code, number) {
    return [
        '',
        '╔══════════════════════════════════════╗',
        `║   PAIRING CODE:  ${formatPairingCode(code).padEnd(20)}║`,
        '╚══════════════════════════════════════╝',
        `  For number +${number}. On that phone:`,
        '  WhatsApp → Linked devices → Link a device',
        '  → "Link with phone number instead" → type the code.',
        '  The code expires in about a minute; a new one follows once, then the QR code.',
        '  Wrong number? ./deploy.sh config, or ./deploy.sh relink --qr',
        ''
    ].join('\n');
}

/** @returns {string} Absolute path of the saved QR image */
function qrFilePath() {
    return path.join(dataDir(), QR_FILE_NAME);
}

/**
 * Save the login QR as a PNG, so it can be opened from the data volume or
 * copied off the server when the terminal QR is unreadable.
 *
 * @param {string} qr The QR payload from Baileys
 * @param {Object} [opts]
 * @param {number} [opts.scale] Pixels per QR module
 * @returns {Promise<string>} Path written
 */
async function writeQrPng(qr, { scale = 10 } = {}) {
    const sharp = require('sharp');
    const QRCode = require('qrcode-terminal/vendor/QRCode');
    const QRErrorCorrectLevel = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');

    const code = new QRCode(-1, QRErrorCorrectLevel.L);
    code.addData(qr);
    code.make();

    const modules = code.getModuleCount();
    const quiet = 4; // standard quiet zone, in modules
    const size = (modules + quiet * 2) * scale;
    const pixels = Buffer.alloc(size * size, 255); // white, 1 channel

    for (let row = 0; row < modules; row++) {
        for (let col = 0; col < modules; col++) {
            if (!code.isDark(row, col)) continue;
            for (let y = 0; y < scale; y++) {
                const offset = ((row + quiet) * scale + y) * size + (col + quiet) * scale;
                pixels.fill(0, offset, offset + scale);
            }
        }
    }

    const file = qrFilePath();
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await sharp(pixels, { raw: { width: size, height: size, channels: 1 } }).png().toFile(file);
    return file;
}

/** Delete the saved QR once the bot is linked; it is useless afterwards. */
async function removeQrPng() {
    await fs.promises.unlink(qrFilePath()).catch(() => {});
}

module.exports = {
    parsePairingNumber,
    loginMethod,
    chooseLoginMethod,
    MAX_PAIRING_CODES,
    formatPairingCode,
    pairingInstructions,
    writeQrPng,
    removeQrPng,
    qrFilePath
};
