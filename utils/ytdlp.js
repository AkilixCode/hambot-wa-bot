/**
 * yt-dlp Runner
 *
 * Single entry point for every yt-dlp invocation. Replaces the `spawnYtDlp` /
 * `spawnYtDlpWithFallback` pair that was copy-pasted verbatim into both
 * commands/music.js and commands/video.js.
 *
 * Why this exists beyond deduplication:
 *
 *   1. TIMEOUTS. Neither copy had one. A yt-dlp process that hung — waiting on
 *      a throttled connection, or on a proxy that stopped answering — held one
 *      of only three heavy-command slots forever. Three of those and the bot
 *      stopped accepting media commands entirely until a restart.
 *
 *   2. PLAYER CLIENTS ARE NOT A CONSTANT. Both files hardcoded
 *      `--extractor-args youtube:player_client=android`. YouTube has since been
 *      phasing the android clients out, and yt-dlp's recommended set has moved
 *      repeatedly. Hardcoding it means a code change every time YouTube shifts.
 *      It is now YTDLP_PLAYER_CLIENTS in .env — retunable without a deploy,
 *      which is the single most useful property this module has.
 *
 *   3. PO TOKENS. YouTube rejects datacenter IPs at the player layer
 *      ("Sign in to confirm you're not a bot"). A PO token provider raises the
 *      success rate; it does not guarantee it. Wired here so both commands get
 *      it, and so it can be pointed elsewhere or switched off from .env.
 *
 * Invocation stays `python3 -m yt_dlp` rather than the `yt-dlp` binary: that is
 * deliberate, so pip-installed plugins (the PO token provider) are on the
 * module path. See CONTRIBUTING.md.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('./logger');
const providers = require('./providers');
const { PROXY_BREAKER_ID } = require('./http-client');

// Wall-clock ceilings. Metadata is a single API round trip; a download moves
// real bytes and legitimately takes longer.
const INFO_TIMEOUT_MS = parseInt(process.env.YTDLP_INFO_TIMEOUT) || 60000;
const DOWNLOAD_TIMEOUT_MS = parseInt(process.env.YTDLP_DOWNLOAD_TIMEOUT) || 300000;

// Grace period between SIGTERM and SIGKILL. yt-dlp cleans up partial files on
// SIGTERM, so it is worth asking politely first.
const KILL_GRACE_MS = 5000;

/**
 * Player clients yt-dlp should try for YouTube, most-preferred first.
 * Empty string disables the flag entirely and lets yt-dlp pick its own default,
 * which is the right move immediately after a yt-dlp upgrade.
 * @returns {string[]} extractor-args pair, or an empty array
 */
function getPlayerClientArgs() {
    const clients = (process.env.YTDLP_PLAYER_CLIENTS ?? 'default,web_safari').trim();
    if (!clients) return [];
    return ['--extractor-args', `youtube:player_client=${clients}`];
}

/**
 * PO token provider args, when one is configured.
 *
 * The GetPOT framework ships inside yt-dlp now, so only the provider plugin
 * needs installing (bgutil-ytdlp-pot-provider, HTTP server mode). If the
 * provider is unreachable yt-dlp logs a warning and carries on unaided, so a
 * dead provider degrades rather than breaks.
 * @returns {string[]}
 */
function getPotArgs() {
    const url = (process.env.POT_PROVIDER_URL || '').trim();
    if (!url) return [];
    return ['--extractor-args', `youtubepot-bgutilhttp:base_url=${url}`];
}

/**
 * Every YouTube-specific arg, assembled.
 * @returns {string[]}
 */
function getYouTubeArgs() {
    return [...getPlayerClientArgs(), ...getPotArgs()];
}

/**
 * The Python that has yt-dlp installed.
 *
 * A local install (deploy.sh --local) keeps yt-dlp in a private .venv and
 * sets YTDLP_PYTHON to it; a relative path is taken from the repository root.
 * If that interpreter is gone (the .venv was deleted, or a .env from a local
 * install is used by the Docker container), fall back to python3 rather than
 * failing every download.
 * @returns {string}
 */
function pythonBin() {
    const configured = (process.env.YTDLP_PYTHON || '').trim();
    if (!configured) return 'python3';
    if (!configured.includes('/')) return configured;
    const resolved = path.resolve(__dirname, '..', configured);
    return fs.existsSync(resolved) ? resolved : 'python3';
}

/**
 * Spawn yt-dlp with a hard timeout.
 *
 * @param {string[]} args - Arguments after `-m yt_dlp`
 * @param {Object} [options]
 * @param {number} [options.timeout] - Milliseconds before the process is killed
 * @param {string} [options.cwd] - Working directory
 * @returns {Promise<string>} stdout
 * @throws {Error} On non-zero exit, spawn failure, or timeout (`.timedOut` set)
 */
function run(args, options = {}) {
    const timeout = options.timeout || INFO_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
        const proc = spawn(pythonBin(), ['-m', 'yt_dlp', ...args], {
            cwd: options.cwd || process.cwd(),
            shell: false
        });

        let stdout = '';
        let stderr = '';
        let settled = false;
        let killTimer = null;

        // Cap buffered output. A pathological --dump-json on a huge playlist
        // could otherwise grow unbounded in memory.
        const MAX_BUFFER = 16 * 1024 * 1024;

        const finish = (fn, arg) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (killTimer) clearTimeout(killTimer);
            fn(arg);
        };

        const timer = setTimeout(() => {
            if (settled) return;
            logger.warn(`yt-dlp timed out after ${timeout}ms, terminating`);

            proc.kill('SIGTERM');
            // Escalate if it ignores SIGTERM — this is the part that was
            // missing and that leaked heavy slots.
            killTimer = setTimeout(() => {
                try { proc.kill('SIGKILL'); } catch { /* already gone */ }
            }, KILL_GRACE_MS);

            const error = new Error(`yt-dlp timeout after ${Math.round(timeout / 1000)}s`);
            error.timedOut = true;
            finish(reject, error);
        }, timeout);

        proc.stdout.on('data', (chunk) => {
            if (stdout.length < MAX_BUFFER) stdout += chunk;
        });
        proc.stderr.on('data', (chunk) => {
            if (stderr.length < MAX_BUFFER) stderr += chunk;
        });

        proc.on('close', (code) => {
            if (code === 0) finish(resolve, stdout);
            else finish(reject, new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
        });

        proc.on('error', (err) => {
            // ENOENT here means python3 or the yt_dlp module is missing.
            if (err.code === 'ENOENT') {
                finish(reject, new Error('python3 tidak ditemukan. Install python3 dan yt-dlp.'));
            } else {
                finish(reject, err);
            }
        });
    });
}

/**
 * Short label for what yt-dlp was asked to fetch, for log lines: the host of
 * a URL, or the search kind ("ytsearch") — never the user's search terms.
 * @param {string} target
 * @returns {string}
 */
function describeTarget(target) {
    const value = String(target || '');
    const search = /^([a-z]+search)\d*:/i.exec(value);
    if (search) return search[1].toLowerCase();
    try {
        return new URL(value).host;
    } catch {
        return 'yt-dlp';
    }
}

/**
 * One-word reason for a yt-dlp failure, for logs and the provider cascade.
 * Order matters, as in media.describeError: most specific first.
 * @param {Error} error
 * @returns {string}
 */
function failureReason(error) {
    const msg = (error && error.message ? error.message : '').toLowerCase();
    if (error && error.timedOut) return 'timeout';
    if (msg.includes('no module named') || msg.includes('python3 tidak ditemukan')) return 'not-installed';
    if (isProxyFailure(error)) return 'proxy';
    if (isBotCheck(error)) return 'bot-check';
    if (msg.includes('geo') || msg.includes('not available in your country')) return 'geo-blocked';
    if (msg.includes('private') || msg.includes('members-only') || msg.includes('login required')) return 'private';
    if (msg.includes('unavailable') || msg.includes('removed') || msg.includes('has been terminated')) return 'unavailable';
    if (msg.includes('unsupported url') || msg.includes('no suitable extractor')) return 'unsupported';
    if (msg.includes('max-filesize') || msg.includes('file is larger')) return 'too-large';
    if (msg.includes('timed out') || msg.includes('transporterror') || msg.includes('unable to download') ||
        msg.includes('connection reset') || msg.includes('connection refused')) return 'network';
    return 'error';
}

/**
 * The most useful line of yt-dlp's stderr: its last "ERROR:" line, or the
 * last line at all. The logger redacts it before printing.
 * @param {Error} error
 * @returns {string|null}
 */
function lastErrorLine(error) {
    const lines = String((error && error.message) || '').split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return null;
    const line = [...lines].reverse().find(l => l.startsWith('ERROR:')) || lines[lines.length - 1];
    return line.length > 160 ? `${line.slice(0, 157)}...` : line;
}

/**
 * run(), plus one log event for the outcome and a `.net` annotation on
 * failure so the provider cascade can say "youtube=bot-check".
 *
 * The args are never logged: they carry `--proxy user:pass@host`.
 *
 * @param {string[]} args
 * @param {'proxy'|'direct'} route
 * @param {Object} options - Passed to run()
 * @param {boolean} fallbackAllowed - Whether a proxy failure will be retried direct
 * @returns {Promise<string>} stdout
 */
async function runLogged(args, route, options, fallbackAllowed = false) {
    const target = describeTarget(args[0]);
    const started = Date.now();
    try {
        const stdout = await run(args, options);
        logger.net({ type: 'ytdlp', ok: true, target, route, ms: Date.now() - started, problem: false });
        return stdout;
    } catch (error) {
        const reason = failureReason(error);
        error.net = { summary: reason, kind: reason, host: target, route };
        logger.net({
            type: 'ytdlp',
            ok: false,
            target,
            route,
            reason,
            detail: lastErrorLine(error),
            fallback: fallbackAllowed && route === 'proxy' && isProxyFailure(error),
            ms: Date.now() - started,
            problem: true
        });
        throw error;
    }
}

/**
 * Run yt-dlp with proxy args, retrying directly if the proxy fails.
 *
 * Only connection-level proxy failures trigger the retry. A YouTube bot-check
 * is not a proxy failure, and retrying it without the proxy would just hand
 * YouTube the datacenter IP we were trying to avoid — strictly worse.
 *
 * Proxy health is shared with utils/http-client: if HTTP requests have
 * already found the proxy dead (its breaker is open), yt-dlp goes direct
 * straight away instead of waiting on the dead proxy first.
 *
 * @param {string[]} baseArgs - Arguments excluding proxy/network flags
 * @param {Object} [options] - Passed through to run()
 * @returns {Promise<string>} stdout
 */
async function runWithFallback(baseArgs, options = {}) {
    const proxyArgs = config.getYtDlpProxyArgs();
    const networkArgs = config.getYtDlpNetworkArgs();
    const fallbackAllowed = proxyArgs.length > 0 && config.network.fallbackToLocal;

    if (fallbackAllowed && providers.isOpen(PROXY_BREAKER_ID)) {
        return runLogged([...baseArgs, ...networkArgs], 'direct', options);
    }

    const route = proxyArgs.length > 0 ? 'proxy' : 'direct';
    try {
        const stdout = await runLogged([...baseArgs, ...networkArgs, ...proxyArgs], route, options, fallbackAllowed);
        if (route === 'proxy') providers.recordSuccess(PROXY_BREAKER_ID);
        return stdout;
    } catch (error) {
        const proxyFailed = route === 'proxy' && isProxyFailure(error);
        if (proxyFailed) providers.recordFailure(PROXY_BREAKER_ID, error);

        if (proxyFailed && fallbackAllowed) {
            return runLogged([...baseArgs, ...networkArgs], 'direct', options);
        }
        throw error;
    }
}

/**
 * Whether an error indicates the proxy itself is unreachable, as opposed to
 * the remote site rejecting us.
 * @param {Error} error
 * @returns {boolean}
 */
function isProxyFailure(error) {
    const msg = (error.message || '').toLowerCase();
    return (
        msg.includes('proxy') ||
        msg.includes('econnrefused') ||
        msg.includes('connection refused') ||
        msg.includes('unable to connect to proxy') ||
        msg.includes('socks') ||
        msg.includes('tunnel connection failed')
    );
}

/**
 * Whether an error is YouTube's bot check.
 *
 * This is the signal that a fallback source (SoundCloud) should be tried:
 * retrying YouTube from the same IP will keep failing.
 * @param {Error} error
 * @returns {boolean}
 */
function isBotCheck(error) {
    const msg = (error.message || '').toLowerCase();
    return (
        msg.includes('sign in to confirm') ||
        msg.includes("confirm you're not a bot") ||
        msg.includes('confirm youre not a bot') ||
        msg.includes('bot detection') ||
        msg.includes('failed to extract any player response') ||
        msg.includes('the page needs to be reloaded') ||
        msg.includes('requested format is not available') ||
        msg.includes('unable to extract') ||
        msg.includes('http error 403')
    );
}

/**
 * Fetch metadata as parsed JSON.
 *
 * @param {string} target - URL, or a search expression like `ytsearch5:query`
 * @param {Object} [options]
 * @param {string[]} [options.extraArgs] - Platform-specific args
 * @param {boolean} [options.flat] - Add --flat-playlist (search listings)
 * @returns {Promise<Object[]>} One object per output line
 */
async function getInfo(target, options = {}) {
    const args = [target, '--dump-json', '--no-playlist', '--no-warnings'];
    if (options.flat) args.push('--flat-playlist');
    if (options.extraArgs) args.push(...options.extraArgs);

    const stdout = await runWithFallback(args, { timeout: INFO_TIMEOUT_MS });
    return parseJsonLines(stdout);
}

/**
 * @param {string} stdout - yt-dlp --dump-json output, one object per line
 * @returns {Object[]}
 */
function parseJsonLines(stdout) {
    return String(stdout || '')
        .trim()
        .split('\n')
        .map(line => {
            try { return JSON.parse(line); } catch { return null; }
        })
        .filter(Boolean);
}

/**
 * Download to disk.
 *
 * @param {string} target - URL to download
 * @param {string} outputTemplate - yt-dlp -o template (absolute path)
 * @param {string[]} formatArgs - Format/extraction flags
 * @param {Object} [options]
 * @param {string} [options.maxFilesize] - yt-dlp --max-filesize value, e.g. '64M'
 * @param {string[]} [options.extraArgs]
 * @returns {Promise<string>} stdout
 */
async function download(target, outputTemplate, formatArgs, options = {}) {
    const args = [
        target,
        ...formatArgs,
        '-o', outputTemplate,
        '--no-warnings',
        '--no-playlist'
    ];

    if (options.maxFilesize) args.push('--max-filesize', options.maxFilesize);
    if (options.extraArgs) args.push(...options.extraArgs);

    return runWithFallback(args, { timeout: DOWNLOAD_TIMEOUT_MS });
}

/**
 * Download and read the metadata in one yt-dlp run.
 *
 * Asking for metadata first (getInfo) and then downloading started Python and
 * extracted the page twice — seconds per request. `--dump-json --no-simulate`
 * prints the metadata and still downloads, and `--match-filter` lets yt-dlp
 * itself refuse over-long media before fetching a byte. A filtered entry
 * exits 0 with no output and no file, which is reported as `tooLong`.
 * Media without a known duration is let through (`<=?`), as before.
 *
 * @param {string} target - URL to download
 * @param {string} outputTemplate - yt-dlp -o template (absolute path)
 * @param {string[]} formatArgs - Format/extraction flags
 * @param {Object} [options] - As download(), plus:
 * @param {number} [options.maxDuration] - Seconds; longer media is skipped
 * @returns {Promise<{info: Object|null, tooLong: boolean}>} info is null when
 *   yt-dlp printed none (the caption just gets thinner)
 */
async function downloadWithInfo(target, outputTemplate, formatArgs, options = {}) {
    const extra = ['--dump-json', '--no-simulate'];
    if (options.maxDuration) extra.push('--match-filter', `duration <=? ${options.maxDuration}`);

    const started = Date.now();
    const stdout = await download(target, outputTemplate, [...formatArgs, ...extra], options);
    logger.debug(`yt-dlp: download finished in ${((Date.now() - started) / 1000).toFixed(1)}s`);

    const info = parseJsonLines(stdout)[0] || null;
    return { info, tooLong: Boolean(options.maxDuration) && !info };
}

/**
 * Installed yt-dlp version.
 *
 * yt-dlp versions are date-stamped (YYYY.MM.DD). A stale install is one of the
 * most common causes of sudden YouTube failure, since fixes ship continuously —
 * so the age is reported alongside, for the media doctor.
 *
 * @returns {Promise<{installed: boolean, version?: string, ageDays?: number, error?: string}>}
 */
async function getVersion() {
    try {
        const out = await run(['--version'], { timeout: 15000 });
        const version = out.trim().split('\n')[0];

        const match = version.match(/^(\d{4})\.(\d{2})\.(\d{2})/);
        let ageDays;
        if (match) {
            const released = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
            ageDays = Math.floor((Date.now() - released) / 86400000);
        }

        return { installed: true, version, ageDays };
    } catch (error) {
        return { installed: false, error: error.message };
    }
}

module.exports = {
    pythonBin,
    run,
    runWithFallback,
    getInfo,
    download,
    downloadWithInfo,
    getVersion,
    getYouTubeArgs,
    getPlayerClientArgs,
    getPotArgs,
    isProxyFailure,
    isBotCheck,
    failureReason,
    describeTarget,
    INFO_TIMEOUT_MS,
    DOWNLOAD_TIMEOUT_MS
};
