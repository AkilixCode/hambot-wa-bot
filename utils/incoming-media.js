/**
 * Incoming media: the one place a WhatsApp attachment is downloaded
 *
 * Baileys' downloadContentFromMessage() builds the download URL from the
 * message itself. With a directPath it still takes the *host* from the
 * message's `url`, and without one it fetches `url` as is; both come from the
 * sender, who can put anything there with a modified client. Its fetch then
 * follows redirects anywhere and reads the body without a limit. So a crafted
 * `.sticker` or `.toimg` reached any address the bot can (localhost, the LAN,
 * cloud metadata) and could make it buffer an endless response.
 *
 * Here, instead:
 *   - only WhatsApp's media CDN is contacted (https, *.whatsapp.net); a
 *     directPath always goes to mmg.whatsapp.net unless the message names
 *     another WhatsApp media host;
 *   - redirects are followed by hand, at most 3, each hop held to that rule;
 *   - the size the message declares, and then the bytes actually read, are
 *     capped at MAX_MEDIA_SIZE; the download is cancelled the moment it is
 *     over, and has an overall timeout;
 *   - the file's HMAC is checked before anything is decrypted, as WhatsApp
 *     clients do (Baileys skips it), so a tampered or foreign file is
 *     refused rather than handed to an image decoder.
 *
 * Private AI endpoints and the egress proxy never come through here: those
 * are the owner's settings, not message content.
 */

const crypto = require('crypto');
const config = require('../config');

const MEDIA_HOST = 'mmg.whatsapp.net';
const ORIGIN = 'https://web.whatsapp.com';
const MAX_REDIRECTS = 3;
const MAC_LENGTH = 10;
const DEFAULT_TIMEOUT_MS = 60 * 1000;

// sharp's own ceiling is 268 megapixels; a WhatsApp image is a few. A
// decompression bomb (tiny file, huge canvas) is refused before it is
// decoded instead of allocating gigabytes.
const SHARP_INPUT = { limitInputPixels: 40 * 1000 * 1000 };

/** Why a download was refused, for the user's message and the log. */
class IncomingMediaError extends Error {
    /**
     * @param {'host'|'too_large'|'redirects'|'http'|'corrupt'|'timeout'|'no_media'} reason
     * @param {string} [detail]
     */
    constructor(reason, detail) {
        super(`incoming media refused: ${reason}${detail ? ` (${detail})` : ''}`);
        this.reason = reason;
    }
}

/**
 * Is this a WhatsApp media CDN address?
 * @param {URL} url
 * @returns {boolean}
 */
function isWhatsAppMediaUrl(url) {
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    if (url.port && url.port !== '443') return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    return host === 'whatsapp.net' || host.endsWith('.whatsapp.net');
}

/**
 * The URL to download, built from the message but never trusting its host.
 *
 * @param {Object} media - imageMessage, stickerMessage, ...
 * @param {Function} [allowUrl=isWhatsAppMediaUrl] - Test seam
 * @returns {URL}
 * @throws {IncomingMediaError}
 */
function downloadUrl(media, allowUrl = isWhatsAppMediaUrl) {
    let named = null;
    try {
        if (media.url) named = new URL(media.url);
    } catch {
        named = null;
    }

    if (media.directPath) {
        // Keep a host the message names only if it is itself allowed.
        const base = named && allowUrl(named) ? named.origin : `https://${MEDIA_HOST}`;
        const path = String(media.directPath);
        if (!path.startsWith('/')) throw new IncomingMediaError('host', 'directPath');
        const url = new URL(path, base);
        if (url.origin !== base || !allowUrl(url)) throw new IncomingMediaError('host');
        return url;
    }

    if (!named || !allowUrl(named)) throw new IncomingMediaError('host');
    return named;
}

/**
 * Download and decrypt one attachment, within the limits above.
 *
 * @param {Object} media - The media message (imageMessage, stickerMessage, ...)
 * @param {'image'|'sticker'|'video'|'audio'|'document'} type
 * @param {Object} [opts]
 * @param {number} [opts.maxBytes=config.media.maxFileBytes]
 * @param {number} [opts.timeoutMs=60000]
 * @param {Function} [opts.allowUrl] - Test seam: which URLs may be fetched
 * @param {Function} [opts.fetch=globalThis.fetch] - Test seam
 * @returns {Promise<Buffer>} The decrypted file
 * @throws {IncomingMediaError}
 */
async function download(media, type, opts = {}) {
    if (!media || !media.mediaKey) throw new IncomingMediaError('no_media');
    const maxBytes = opts.maxBytes || config.media.maxFileBytes;
    const allowUrl = opts.allowUrl || isWhatsAppMediaUrl;
    const doFetch = opts.fetch || globalThis.fetch;

    // fileLength arrives as a number or a protobuf Long.
    const length = media.fileLength;
    const declared = length && typeof length.toNumber === 'function' ? length.toNumber() : Number(length || 0);
    if (declared > maxBytes) throw new IncomingMediaError('too_large', `${declared} declared`);

    let url = downloadUrl(media, allowUrl);
    const { getMediaKeys } = await import('@whiskeysockets/baileys');
    const { iv, cipherKey, macKey } = await getMediaKeys(media.mediaKey, type);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs || DEFAULT_TIMEOUT_MS);
    // AES-CBC adds at most one block of padding; the MAC follows it.
    const maxEncrypted = maxBytes + 16 + MAC_LENGTH;

    try {
        let response;
        for (let hop = 0; ; hop++) {
            response = await doFetch(url.href, {
                method: 'GET',
                headers: { Origin: ORIGIN },
                redirect: 'manual',
                signal: controller.signal
            });
            if (response.status < 300 || response.status >= 400) break;
            if (response.body) await response.body.cancel().catch(() => {});
            if (hop >= MAX_REDIRECTS) throw new IncomingMediaError('redirects');
            const location = response.headers.get('location');
            let next;
            try {
                next = new URL(location, url);
            } catch {
                throw new IncomingMediaError('host', 'bad redirect');
            }
            if (!allowUrl(next)) throw new IncomingMediaError('host', 'redirect');
            url = next;
        }
        if (!response.ok) {
            if (response.body) await response.body.cancel().catch(() => {});
            throw new IncomingMediaError('http', String(response.status));
        }

        const announced = Number(response.headers.get('content-length') || 0);
        if (announced > maxEncrypted) {
            await response.body.cancel().catch(() => {});
            throw new IncomingMediaError('too_large', `${announced} announced`);
        }

        // Read with a running count: stop the transfer as soon as it is over.
        const chunks = [];
        let total = 0;
        const reader = response.body.getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.length;
            if (total > maxEncrypted) {
                await reader.cancel().catch(() => {});
                throw new IncomingMediaError('too_large', `over ${maxBytes}`);
            }
            chunks.push(Buffer.from(value));
        }
        return decrypt(Buffer.concat(chunks), { iv, cipherKey, macKey });
    } catch (error) {
        if (error instanceof IncomingMediaError) throw error;
        if (controller.signal.aborted) throw new IncomingMediaError('timeout');
        throw new IncomingMediaError('http', error.code || error.message);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Check the WhatsApp media MAC, then decrypt (AES-256-CBC).
 * File layout: ciphertext, then the first 10 bytes of
 * HMAC-SHA256(macKey, iv || ciphertext).
 * @returns {Buffer}
 */
function decrypt(file, { iv, cipherKey, macKey }) {
    if (file.length <= MAC_LENGTH || (file.length - MAC_LENGTH) % 16 !== 0) {
        throw new IncomingMediaError('corrupt', 'length');
    }
    const body = file.subarray(0, file.length - MAC_LENGTH);
    const mac = file.subarray(file.length - MAC_LENGTH);
    const expected = crypto.createHmac('sha256', macKey).update(iv).update(body).digest().subarray(0, MAC_LENGTH);
    if (!crypto.timingSafeEqual(mac, expected)) throw new IncomingMediaError('corrupt', 'mac');
    try {
        const decipher = crypto.createDecipheriv('aes-256-cbc', cipherKey, iv);
        return Buffer.concat([decipher.update(body), decipher.final()]);
    } catch {
        throw new IncomingMediaError('corrupt', 'decrypt');
    }
}

/**
 * What to tell the user about a refused attachment.
 * @param {Error} error
 * @returns {{title: string, reason: string}|null} null for anything else
 */
function describe(error) {
    if (!(error instanceof IncomingMediaError)) return null;
    switch (error.reason) {
        case 'too_large':
            return { title: 'File Kegedean', reason: `Filenya lebih dari batas ${Math.round(config.media.maxFileBytes / 1024 / 1024)}MB.` };
        case 'timeout':
            return { title: 'Waktu Habis', reason: 'Mengunduh filenya kelamaan.' };
        default:
            return { title: 'File Tidak Valid', reason: 'File ini tidak bisa diambil dari WhatsApp.' };
    }
}

module.exports = { download, downloadUrl, isWhatsAppMediaUrl, describe, decrypt, IncomingMediaError, SHARP_INPUT, MAX_REDIRECTS };
