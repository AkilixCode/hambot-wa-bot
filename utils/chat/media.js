/**
 * Files from the agent
 *
 * An agent marks a file it made for the user with a line `MEDIA:<path>` in
 * its answer (Hermes Agent uses this convention in its own gateways; any
 * agent can be told to). When CHAT_AGENT_MEDIA_DIR is set, HamBot takes those
 * lines out of the text and sends the files as WhatsApp media. HamBot must be
 * able to read that folder itself: a shared volume, a shared folder, or files
 * synced from the agent's machine.
 *
 * The path comes from the agent, so it is treated as hostile: only a regular
 * file strictly inside the configured folder is ever opened. `MEDIA:/app/.env`,
 * `MEDIA:../../etc/passwd` and a symlink planted in the folder that points
 * out of it are all refused. Contents and full paths are never logged.
 *
 * What the checks cover, exactly:
 *   - Anything a MEDIA: line can name. The path is checked as written, then
 *     with every symlink resolved (both folder and file, by the OS's own
 *     realpath), and must stay strictly inside the folder. The comparison is
 *     case-exact on every OS: a mismatch can only refuse, never admit.
 *   - Linux: also a file or folder swapped for a link between that check and
 *     the open. The open refuses a link as the last part (O_NOFOLLOW), and
 *     /proc/self/fd says what was really opened.
 * What they do not cover: on macOS and Windows, a process that changes the
 * folder's contents *while HamBot reads it* (swapping a subfolder for a link
 * at the right moment) can race the check. Only let agents you already
 * trust with those files write into the folder.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { promisify } = require('util');

// The OS's own realpath (canonical spelling on Windows and macOS); there is
// no fs.promises.realpath.native.
const realpath = promisify(fs.realpath.native);

// What each refusal means, for the note the user gets.
const REASONS = {
    outside: 'di luar folder outbox',
    missing: 'tidak ditemukan',
    not_file: 'bukan file',
    empty: 'file kosong',
    too_large: 'terlalu besar',
    unreadable: 'tidak bisa dibaca'
};

const TYPES = {
    png: ['image', 'image/png'],
    jpg: ['image', 'image/jpeg'],
    jpeg: ['image', 'image/jpeg'],
    mp4: ['video', 'video/mp4'],
    mp3: ['audio', 'audio/mpeg'],
    m4a: ['audio', 'audio/mp4'],
    ogg: ['audio', 'audio/ogg; codecs=opus'],
    opus: ['audio', 'audio/ogg; codecs=opus'],
    wav: ['audio', 'audio/wav'],
    // Everything below goes as a document: the user gets the file as is.
    gif: ['document', 'image/gif'],
    webp: ['document', 'image/webp'],
    svg: ['document', 'image/svg+xml'],
    pdf: ['document', 'application/pdf'],
    txt: ['document', 'text/plain'],
    md: ['document', 'text/markdown'],
    csv: ['document', 'text/csv'],
    json: ['document', 'application/json'],
    html: ['document', 'text/html'],
    py: ['document', 'text/x-python'],
    js: ['document', 'text/javascript'],
    sh: ['document', 'application/x-sh'],
    zip: ['document', 'application/zip'],
    gz: ['document', 'application/gzip'],
    tgz: ['document', 'application/gzip'],
    docx: ['document', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    xlsx: ['document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    pptx: ['document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation']
};

/**
 * Take the `MEDIA:` lines out of an answer.
 *
 * Lines inside ``` code fences are left alone, so an answer that explains
 * the convention is not mistaken for one that uses it.
 *
 * @param {string} text
 * @param {number} max - Files per answer; the rest are counted, not sent
 * @returns {{text: string, refs: string[], dropped: number}}
 */
function extract(text, max) {
    const kept = [];
    const refs = [];
    let dropped = 0;
    let inFence = false;

    for (const line of String(text || '').split('\n')) {
        if (/^\s*```/.test(line)) inFence = !inFence;
        const match = inFence ? null : /^\s*`?MEDIA:\s*(.+?)\s*$/.exec(line);
        const ref = match ? match[1].replace(/^[`'"<]+|[`'">]+$/g, '').trim() : '';
        if (!ref) {
            kept.push(line);
            continue;
        }
        if (refs.includes(ref)) continue;
        if (refs.length < max) refs.push(ref);
        else dropped++;
    }

    return { text: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(), refs, dropped };
}

/** Whether `p` is strictly inside `dir`. Case-exact on every OS. */
function inside(p, dir) {
    return p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
}

/**
 * How a file is sent, from its extension.
 * @param {string} name
 * @returns {{kind: 'image'|'video'|'audio'|'document', mimetype: string}}
 */
function kindOf(name) {
    const ext = path.extname(String(name)).slice(1).toLowerCase();
    const [kind, mimetype] = TYPES[ext] || ['document', 'application/octet-stream'];
    return { kind, mimetype };
}

/**
 * Open one file the agent named, if and only if it is a regular file inside
 * the outbox folder.
 *
 * @param {string} ref - Path from the MEDIA: line (absolute, or relative to dir)
 * @param {string} dir - CHAT_AGENT_MEDIA_DIR
 * @param {number} maxBytes - Size cap (MAX_MEDIA_SIZE)
 * @returns {Promise<{buffer: Buffer, name: string, kind: string, mimetype: string}|{error: string}>}
 */
async function open(ref, dir, maxBytes) {
    // Lexically first: `..` and absolute paths elsewhere never reach the disk.
    const base = path.resolve(dir);
    if (!inside(path.resolve(base, ref), base)) return { error: 'outside' };

    let realDir;
    let real;
    try {
        realDir = await realpath(base);
    } catch {
        return { error: 'unreadable' };
    }
    try {
        // Symlinks resolved: a link in the folder pointing out of it is refused.
        real = await realpath(path.resolve(realDir, path.relative(base, path.resolve(base, ref))));
    } catch (error) {
        return { error: error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 'missing' : 'unreadable' };
    }
    if (!inside(real, realDir)) return { error: 'outside' };

    let handle;
    try {
        // O_NOFOLLOW: the last part cannot have become a symlink since the
        // check. O_NONBLOCK: a FIFO cannot hang the open.
        const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
        handle = await fsp.open(real, flags);
    } catch (error) {
        if (error.code === 'ENOENT') return { error: 'missing' };
        if (error.code === 'ELOOP') return { error: 'outside' };
        // Windows will not open a folder as a file at all.
        if (error.code === 'EISDIR') return { error: 'not_file' };
        return { error: 'unreadable' };
    }

    try {
        const stats = await handle.stat();
        if (!stats.isFile()) return { error: 'not_file' };
        if (stats.size === 0) return { error: 'empty' };
        if (stats.size > maxBytes) return { error: 'too_large' };

        // Linux can say what was actually opened: catches a folder above the
        // file swapped for a symlink between the check and the open.
        if (process.platform === 'linux') {
            try {
                const opened = await fsp.readlink(`/proc/self/fd/${handle.fd}`);
                if (!inside(opened, realDir)) return { error: 'outside' };
            } catch {
                // /proc not mounted: the checks above still hold.
            }
        }

        const buffer = await handle.readFile();
        if (buffer.length === 0) return { error: 'empty' };
        if (buffer.length > maxBytes) return { error: 'too_large' };

        const name = path.basename(real).replace(/[\u0000-\u001f]/g, '').slice(-120) || 'file';
        return { buffer, name, ...kindOf(name) };
    } catch {
        return { error: 'unreadable' };
    } finally {
        await handle.close().catch(() => {});
    }
}

/**
 * The Baileys message for an opened file.
 * @param {{buffer: Buffer, name: string, kind: string, mimetype: string}} file
 * @returns {Object}
 */
function toMessage(file) {
    switch (file.kind) {
        case 'image': return { image: file.buffer, mimetype: file.mimetype };
        case 'video': return { video: file.buffer, mimetype: file.mimetype };
        case 'audio': return { audio: file.buffer, mimetype: file.mimetype };
        default: return { document: file.buffer, mimetype: file.mimetype, fileName: file.name };
    }
}

module.exports = { extract, open, kindOf, toMessage, REASONS };
