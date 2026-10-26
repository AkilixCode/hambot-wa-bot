/**
 * pm2, without a shell
 *
 * On Windows pm2 is installed as `pm2.cmd`, and Node refuses to spawn a .cmd
 * file without a shell. A shell is exactly what must not be used here, so
 * instead of the launcher this finds pm2's own JavaScript entry point and
 * runs it with this Node: one code path on Linux, macOS and Windows, and the
 * arguments never pass through a command interpreter.
 *
 * The process name comes from PM2_PROCESS_NAME and ends up in pm2's
 * arguments and in log file paths, so it is held to a strict pattern: no
 * leading "-" (it would be read as an option), no path separators.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const APP_DIR = path.join(__dirname, '..');
const NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;

/**
 * @param {Object} [env=process.env]
 * @returns {string|null} The pm2 process name, or null if PM2_PROCESS_NAME is unsafe
 */
function processName(env = process.env) {
    const name = String(env.PM2_PROCESS_NAME || 'hambot').trim();
    return NAME_RE.test(name) ? name : null;
}

/**
 * @param {Object} [env=process.env]
 * @returns {string} Folder pm2 writes its log files to
 */
function logDir(env = process.env) {
    return path.join(env.PM2_HOME || path.join(os.homedir(), '.pm2'), 'logs');
}

function isFile(file) {
    try {
        return fs.statSync(file).isFile();
    } catch {
        return false;
    }
}

/** Is this pm2's own entry point (…/node_modules/pm2/bin/pm2) or a JS file? */
function isEntry(file) {
    return /\.[cm]?js$/i.test(file) || /[\\/]node_modules[\\/]pm2[\\/]bin[\\/]pm2$/.test(file);
}

/**
 * Find pm2's JavaScript entry point.
 *
 * PM2_BIN, when set, must name that entry point (or any .js file); a shell
 * launcher there is ignored. Otherwise the pm2 launcher on PATH leads to it:
 *   - Windows: npm puts pm2.cmd next to node_modules\pm2 in its prefix folder;
 *   - Linux/macOS: the `pm2` link resolves into …/node_modules/pm2/bin/pm2,
 *     or, for a wrapper script, the usual ../lib/node_modules layout.
 *
 * @param {Object} [env=process.env]
 * @param {string} [platform=process.platform]
 * @returns {string|null} Absolute path of the entry point, or null when pm2 is not installed
 */
function locate(env = process.env, platform = process.platform) {
    if (env.PM2_BIN) {
        const file = path.resolve(APP_DIR, env.PM2_BIN);
        return isEntry(file) && isFile(file) ? file : null;
    }

    const dirs = String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
    const names = platform === 'win32' ? ['pm2.cmd', 'pm2'] : ['pm2'];

    for (const dir of dirs) {
        for (const name of names) {
            const launcher = path.join(dir, name);
            if (!isFile(launcher)) continue;

            const candidates = [path.join(dir, 'node_modules', 'pm2', 'bin', 'pm2')];
            try {
                candidates.unshift(fs.realpathSync(launcher));
            } catch {
                // a broken link: try the layouts below
            }
            candidates.push(path.join(dir, '..', 'lib', 'node_modules', 'pm2', 'bin', 'pm2'));

            const entry = candidates.find(file => isEntry(file) && isFile(file));
            if (entry) return path.resolve(entry);
        }
    }
    return null;
}

/**
 * Run pm2 with this Node, no shell.
 *
 * @param {string[]} args - pm2 arguments
 * @param {Object} [options] - spawn options (shell is always off)
 * @param {string|null} [entry=locate()] - pm2 entry point
 * @returns {import('child_process').ChildProcess|null} null when pm2 is not installed
 */
function run(args, options = {}, entry = locate()) {
    if (!entry) return null;
    return spawn(process.execPath, [entry, ...args], { ...options, shell: false });
}

module.exports = { processName, logDir, locate, run, NAME_RE };
