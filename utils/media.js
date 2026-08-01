/**
 * Media Download Helpers
 *
 * Shared between commands/music.js and commands/video.js, which previously
 * carried near-identical copies of all of this — including two separate
 * hand-maintained lists of yt-dlp error strings that had already drifted apart.
 */

const fsPromises = require('fs').promises;
const path = require('path');
const config = require('../config');
const tempdir = require('./tempdir');
const { formatSize } = require('./helpers');

/**
 * Locate the file yt-dlp just wrote.
 *
 * yt-dlp picks the container itself, so the extension is not known ahead of
 * time — the output template ends in `.%(ext)s` and we match on the prefix.
 *
 * @param {string} prefix - Filename prefix used in the output template
 * @param {string[]} extensions - Acceptable extensions, preferred order first
 * @returns {Promise<{path: string, name: string, size: number}|null>}
 */
async function findDownload(prefix, extensions) {
    let files;
    try {
        files = await fsPromises.readdir(tempdir.TEMP_DIR);
    } catch {
        return null;
    }

    const candidates = files.filter(f => f.startsWith(prefix));
    if (candidates.length === 0) return null;

    // Prefer the requested container. A leftover .part or .webm from a failed
    // merge should not be sent to the user as if it were the finished file.
    for (const ext of extensions) {
        const match = candidates.find(f => f.toLowerCase().endsWith(`.${ext}`));
        if (match) {
            const full = path.join(tempdir.TEMP_DIR, match);
            try {
                const stats = await fsPromises.stat(full);
                return { path: full, name: match, size: stats.size };
            } catch {
                return null;
            }
        }
    }

    return null;
}

/**
 * Whether a completed download is within the configured size ceiling.
 * @param {number} bytes - Actual file size
 * @returns {boolean}
 */
function isWithinSizeLimit(bytes) {
    return bytes <= config.media.maxFileBytes;
}

/**
 * Human-readable size ceiling, for user-facing messages.
 * @returns {string}
 */
function sizeLimitLabel() {
    return formatSize(config.media.maxFileBytes);
}

/**
 * Turn a yt-dlp failure into an Indonesian message for the user.
 *
 * Order matters: the checks run most-specific first, because several yt-dlp
 * messages contain more than one of these substrings.
 *
 * @param {Error} error - The failure from utils/ytdlp
 * @param {'musik'|'video'} kind - Noun used in the message
 * @returns {{reason: string, title: string, hint: string[]}} Ready for replyError
 */
function describeError(error, kind = 'media') {
    const msg = (error && error.message ? error.message : '').toLowerCase();

    if (error && error.timedOut) {
        return {
            title: 'Waktu Habis',
            reason: `Proses unduh ${kind} kelamaan dan dihentikan.`,
            hint: ['Coba lagi sebentar lagi', 'Pilih yang durasinya lebih pendek']
        };
    }

    if (msg.includes('no module named') || msg.includes('python3 tidak ditemukan')) {
        return {
            title: 'Tidak Tersedia',
            reason: 'Komponen pengunduh belum terpasang di server.',
            hint: ['Hubungi admin bot']
        };
    }

    if (msg.includes('sign in to confirm') || msg.includes('not a bot') ||
        msg.includes('the page needs to be reloaded')) {
        return {
            title: 'Diblokir Sumber',
            reason: 'YouTube menolak permintaan dari server ini.',
            hint: ['Coba lagi beberapa saat lagi', 'Hubungi admin untuk mengaktifkan proxy']
        };
    }

    if (msg.includes('max-filesize') || msg.includes('too large') || msg.includes('file is larger')) {
        return {
            title: 'File Kegedean',
            reason: `Ukurannya lewat dari batas ${sizeLimitLabel()}.`,
            hint: [`Pilih ${kind} yang lebih pendek`]
        };
    }

    if (msg.includes('private') || msg.includes('members-only') || msg.includes('login required')) {
        return {
            title: 'Tidak Bisa Diakses',
            reason: `${kind === 'video' ? 'Video' : 'Lagu'} ini private atau dibatasi.`,
            hint: ['Pakai tautan yang publik']
        };
    }

    if (msg.includes('unavailable') || msg.includes('removed') || msg.includes('has been terminated')) {
        return {
            title: 'Tidak Tersedia',
            reason: `${kind === 'video' ? 'Video' : 'Lagu'} ini sudah dihapus atau tidak tersedia.`,
            hint: ['Coba tautan yang lain']
        };
    }

    if (msg.includes('unsupported url') || msg.includes('no suitable extractor')) {
        return {
            title: 'Tidak Didukung',
            reason: 'Situs itu belum didukung.',
            hint: ['Coba tautan dari platform lain']
        };
    }

    if (msg.includes('geo') || msg.includes('not available in your country')) {
        return {
            title: 'Dibatasi Wilayah',
            reason: 'Konten ini diblokir untuk wilayah server.',
            hint: ['Hubungi admin untuk mengaktifkan proxy']
        };
    }

    if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('transporterror') ||
        msg.includes('connection refused') || msg.includes('unable to download')) {
        return {
            title: 'Koneksi Bermasalah',
            reason: 'Koneksi ke server sumber gagal.',
            hint: ['Coba lagi sebentar lagi']
        };
    }

    return {
        title: 'Gagal',
        reason: `Gagal mengunduh ${kind}.`,
        hint: ['Coba lagi sebentar lagi', 'Pastikan tautannya benar']
    };
}

module.exports = {
    findDownload,
    isWithinSizeLimit,
    sizeLimitLabel,
    describeError
};
