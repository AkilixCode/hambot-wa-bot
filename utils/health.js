/**
 * Health Reporting
 *
 * The bot records its WhatsApp connection state in data/health.json, and
 * scripts/healthcheck.js (the Docker HEALTHCHECK) reads it. The old check
 * ran `node -e "process.exit(0)"`, which passed even while the bot sat
 * disconnected for hours.
 *
 * Healthy means:
 *   - connected ("open"), or
 *   - waiting to be linked ("linking": a QR or pairing code is on screen,
 *     which can legitimately take a while on first setup), or
 *   - briefly between connections — a reconnect is normal, so "connecting"
 *     and "close" only count as unhealthy after DISCONNECTED_GRACE_MS;
 * and in every case the file must have been refreshed recently. A heartbeat
 * rewrites it every minute, so a hung or dead process goes stale.
 */

const fs = require('fs');
const path = require('path');
const { dataDir } = require('./paths');

const HEALTH_FILE_NAME = 'health.json';
const DISCONNECTED_GRACE_MS = 5 * 60 * 1000;
const STALE_AFTER_MS = 3 * 60 * 1000;
const HEARTBEAT_MS = 60 * 1000;

let current = { state: 'starting', since: Date.now() };
let heartbeat = null;

/** @returns {string} Absolute path of the health file */
function healthFilePath() {
    return path.join(dataDir(), HEALTH_FILE_NAME);
}

/** Write the current state. Never throws: health must not crash the bot. */
function write() {
    try {
        const file = healthFilePath();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ ...current, updatedAt: Date.now() }));
    } catch {
        // A read-only or full disk shows up as a stale file instead.
    }
}

/**
 * Record a connection state change.
 * @param {'starting'|'linking'|'connecting'|'open'|'close'} state
 */
function report(state) {
    if (state !== current.state) {
        current = { state, since: Date.now() };
    }
    write();

    if (!heartbeat) {
        heartbeat = setInterval(write, HEARTBEAT_MS);
        heartbeat.unref();
    }
}

/**
 * Judge a health record.
 * @param {Object|null} record Parsed health.json, or null if missing
 * @param {number} [now]
 * @returns {{healthy: boolean, reason: string}}
 */
function evaluate(record, now = Date.now()) {
    if (!record || typeof record !== 'object') {
        return { healthy: false, reason: 'no health file yet' };
    }
    const age = now - Number(record.updatedAt || 0);
    if (!(age >= 0) || age > STALE_AFTER_MS) {
        return { healthy: false, reason: `health file is stale (${Math.round(age / 1000)}s old)` };
    }
    if (record.state === 'open') return { healthy: true, reason: 'connected' };
    if (record.state === 'linking') return { healthy: true, reason: 'waiting to be linked (QR / pairing code)' };

    const down = now - Number(record.since || 0);
    if (down > DISCONNECTED_GRACE_MS) {
        return { healthy: false, reason: `not connected for ${Math.round(down / 60000)} min (${record.state})` };
    }
    return { healthy: true, reason: `${record.state}, within grace period` };
}

/**
 * Read and judge the health file.
 * @returns {{healthy: boolean, reason: string}}
 */
function check() {
    let record = null;
    try {
        record = JSON.parse(fs.readFileSync(healthFilePath(), 'utf8'));
    } catch {
        record = null;
    }
    return evaluate(record);
}

module.exports = {
    report,
    evaluate,
    check,
    healthFilePath,
    DISCONNECTED_GRACE_MS,
    STALE_AFTER_MS
};
