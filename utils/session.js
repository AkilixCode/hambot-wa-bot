/**
 * WhatsApp Session Lifecycle
 *
 * What to do when the connection closes, and how to set a dead session aside.
 *
 * Before this, every close either reconnected after a flat 3 seconds or — on
 * "logged out" — called process.exit(). Under Docker's restart policy that
 * exit restarted the bot with the same dead session, which was logged out
 * again, forever: no QR, no pairing code, no way back without deleting the
 * volume by hand. Now each close reason gets its own response, and a dead
 * session is archived (never deleted) so the bot can start linking afresh
 * inside the same process.
 */

const fs = require('fs');
const path = require('path');

// Baileys DisconnectReason codes, duplicated here so the decision logic stays
// a pure, synchronously testable function (Baileys itself is ESM-only).
const REASON = {
    loggedOut: 401,
    forbidden: 403,
    timedOut: 408,
    multideviceMismatch: 411,
    connectionClosed: 428,
    connectionReplaced: 440,
    badSession: 500,
    unavailableService: 503,
    restartRequired: 515
};

const BACKOFF_BASE_MS = 3000;
const BACKOFF_MAX_MS = 60 * 1000;
const REPLACED_DELAYS_MS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000];
const BAD_SESSION_LIMIT = 3;
const ARCHIVE_DIR = '.archive';
const ARCHIVES_KEPT = 3;

/** @returns {{reconnects: number, badSessions: number, replaced: number}} */
function freshCounters() {
    return { reconnects: 0, badSessions: 0, replaced: 0 };
}

/**
 * Decide what to do after the connection closed.
 *
 * @param {number|undefined} statusCode lastDisconnect.error.output.statusCode
 * @param {Object} counters From freshCounters() or a previous decision's `next`
 * @returns {{action: 'reconnect'|'relink'|'pause'|'stop', delayMs: number, message: string, next: Object}}
 */
function decideOnClose(statusCode, counters = freshCounters()) {
    const next = { ...freshCounters(), ...counters };

    if (statusCode === REASON.loggedOut || statusCode === REASON.multideviceMismatch) {
        return {
            action: 'relink',
            delayMs: 1000,
            message: 'WhatsApp ended this session (the device was removed or logged out). Archiving it and starting a fresh link.',
            next: freshCounters()
        };
    }

    if (statusCode === REASON.badSession) {
        next.badSessions += 1;
        if (next.badSessions >= BAD_SESSION_LIMIT) {
            return {
                action: 'relink',
                delayMs: 1000,
                message: `The saved session failed ${next.badSessions} times in a row and looks corrupted. Archiving it and starting a fresh link.`,
                next: freshCounters()
            };
        }
    } else {
        next.badSessions = 0;
    }

    if (statusCode === REASON.connectionReplaced) {
        const delayMs = REPLACED_DELAYS_MS[Math.min(next.replaced, REPLACED_DELAYS_MS.length - 1)];
        next.replaced += 1;
        return {
            action: 'pause',
            delayMs,
            message: `Another copy of the bot is using this session (a second container, or npm start while Docker runs?). Stop the other copy; retrying in ${Math.round(delayMs / 60000)} min.`,
            next
        };
    }

    if (statusCode === REASON.forbidden) {
        return {
            action: 'stop',
            delayMs: 0,
            message: 'WhatsApp refused this account (403): the number may be banned or restricted. Not reconnecting; check the phone, then restart the bot.',
            next
        };
    }

    if (statusCode === REASON.restartRequired) {
        return { action: 'reconnect', delayMs: 500, message: 'Restart requested by WhatsApp (normal right after linking).', next };
    }

    const delayMs = Math.min(BACKOFF_BASE_MS * 2 ** next.reconnects, BACKOFF_MAX_MS);
    next.reconnects += 1;
    return { action: 'reconnect', delayMs, message: `Connection closed; reconnecting in ${Math.round(delayMs / 1000)}s.`, next };
}

/**
 * Move every session file into <authDir>/.archive/<timestamp>/.
 * Nothing is deleted except archives beyond the newest ARCHIVES_KEPT.
 *
 * Files are moved inside the directory rather than renaming the directory
 * itself, because under Docker it is a volume mount point.
 *
 * @param {string} authDir
 * @returns {string|null} Archive path, or null if there was nothing to archive
 */
function archiveSession(authDir) {
    if (!fs.existsSync(authDir)) return null;
    const entries = fs.readdirSync(authDir).filter(name => name !== ARCHIVE_DIR);
    if (entries.length === 0) return null;

    // Timestamp names sort chronologically. A suffix keeps two archives made
    // in the same millisecond apart — merging them would overwrite files.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.mkdirSync(path.join(authDir, ARCHIVE_DIR), { recursive: true });
    let target = path.join(authDir, ARCHIVE_DIR, stamp);
    for (let n = 1; fs.existsSync(target); n++) {
        target = path.join(authDir, ARCHIVE_DIR, `${stamp}_${String(n).padStart(3, '0')}`);
    }
    fs.mkdirSync(target);
    for (const name of entries) {
        fs.renameSync(path.join(authDir, name), path.join(target, name));
    }

    const archives = listArchives(authDir);
    for (const old of archives.slice(ARCHIVES_KEPT)) {
        fs.rmSync(path.join(authDir, ARCHIVE_DIR, old), { recursive: true, force: true });
    }
    return target;
}

/**
 * @param {string} authDir
 * @returns {string[]} Archive names, newest first
 */
function listArchives(authDir) {
    const dir = path.join(authDir, ARCHIVE_DIR);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).sort().reverse();
}

/**
 * Put the newest archived session back. Whatever session is current is
 * archived first, so a restore can itself be undone.
 *
 * @param {string} authDir
 * @returns {string|null} Name of the restored archive, or null if none exist
 */
function restoreSession(authDir) {
    const [newest] = listArchives(authDir);
    if (!newest) return null;

    const source = path.join(authDir, ARCHIVE_DIR, newest);
    archiveSession(authDir);
    for (const name of fs.readdirSync(source)) {
        fs.renameSync(path.join(source, name), path.join(authDir, name));
    }
    fs.rmdirSync(source);
    return newest;
}

module.exports = {
    REASON,
    freshCounters,
    decideOnClose,
    archiveSession,
    restoreSession,
    listArchives,
    BACKOFF_MAX_MS
};
