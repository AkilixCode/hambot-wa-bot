/**
 * Temporary File Directory
 *
 * Media commands used to write yt-dlp downloads and ffmpeg scratch files into
 * the process working directory — i.e. the repo root. Cleanup then had to
 * prefix-scan every file in the repo, and a crash left stray .mp3/.mp4 files
 * sitting next to the source code.
 *
 * Everything now lands in a single `tmp/` directory that is created at boot,
 * gitignored, and swept on startup so a hard restart does not leak disk.
 */

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const logger = require('./logger');

// Anchored to the repo root (this file lives in utils/), NOT to process.cwd(),
// so the location is stable no matter where the bot is launched from.
const TEMP_DIR = path.join(__dirname, '..', 'tmp');

// Files older than this are considered orphaned by a previous crash.
const STALE_AGE_MS = 60 * 60 * 1000; // 1 hour

let ensured = false;

/**
 * Create the temp directory if it does not exist. Cheap and idempotent — safe
 * to call on every media command.
 * @returns {string} Absolute path to the temp directory
 */
function ensureTempDir() {
    if (!ensured) {
        fs.mkdirSync(TEMP_DIR, { recursive: true });
        ensured = true;
    }
    return TEMP_DIR;
}

/**
 * Absolute path for a file inside the temp directory.
 *
 * Guards against path traversal: a crafted name must never be able to escape
 * tmp/ and write elsewhere on disk. Names here are bot-generated today, but
 * this function is the kind of thing a future command will reach for with
 * user input in hand.
 *
 * @param {string} name - Bare filename (no directory separators)
 * @returns {string} Absolute path inside the temp directory
 */
function tempPath(name) {
    ensureTempDir();
    const resolved = path.resolve(TEMP_DIR, name);
    if (resolved !== TEMP_DIR && !resolved.startsWith(TEMP_DIR + path.sep)) {
        throw new Error('Invalid temp filename');
    }
    return resolved;
}

/**
 * Delete every file in the temp directory whose name starts with `prefix`.
 *
 * Replaces helpers.cleanupFiles(), which scanned the repo root. Scoped to
 * tmp/, so a bad prefix can no longer touch project files.
 *
 * @param {string} prefix - Filename prefix to match
 * @returns {Promise<number>} Number of files removed
 */
async function cleanupTemp(prefix) {
    if (!prefix) return 0;
    try {
        const files = await fsPromises.readdir(TEMP_DIR);
        const junk = files.filter(f => f.startsWith(prefix));
        await Promise.all(
            junk.map(f => fsPromises.unlink(path.join(TEMP_DIR, f)).catch(() => {}))
        );
        return junk.length;
    } catch {
        // Directory missing means nothing to clean.
        return 0;
    }
}

/**
 * Remove temp files left behind by a previous run. Called once at startup.
 * @returns {Promise<number>} Number of files removed
 */
async function sweepStale() {
    ensureTempDir();
    let removed = 0;
    try {
        const files = await fsPromises.readdir(TEMP_DIR);
        const cutoff = Date.now() - STALE_AGE_MS;

        for (const file of files) {
            const full = path.join(TEMP_DIR, file);
            try {
                const stats = await fsPromises.stat(full);
                if (stats.isFile() && stats.mtimeMs < cutoff) {
                    await fsPromises.unlink(full);
                    removed++;
                }
            } catch {
                // File vanished mid-sweep, or is not readable — skip it.
            }
        }

        if (removed > 0) {
            logger.info(`Temp sweep: removed ${removed} stale file(s)`);
        }
    } catch {
        // Non-fatal: a failed sweep must never stop the bot from booting.
    }
    return removed;
}

/**
 * Total bytes currently held in the temp directory. Used by the media doctor.
 * @returns {Promise<{files: number, bytes: number}>}
 */
async function usage() {
    try {
        const files = await fsPromises.readdir(TEMP_DIR);
        let bytes = 0;
        let count = 0;
        for (const file of files) {
            try {
                const stats = await fsPromises.stat(path.join(TEMP_DIR, file));
                if (stats.isFile()) {
                    bytes += stats.size;
                    count++;
                }
            } catch {
                // Skip unreadable entries.
            }
        }
        return { files: count, bytes };
    } catch {
        return { files: 0, bytes: 0 };
    }
}

module.exports = {
    TEMP_DIR,
    ensureTempDir,
    tempPath,
    cleanupTemp,
    sweepStale,
    usage
};
