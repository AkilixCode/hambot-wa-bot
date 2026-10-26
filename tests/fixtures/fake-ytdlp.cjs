/**
 * A fake yt-dlp that runs on Linux, macOS and Windows alike.
 *
 * The bot runs yt-dlp as `<python> -m yt_dlp <args>`. This puts a `yt_dlp`
 * package first on PYTHONPATH whose __main__ hands the arguments to a Node
 * script, and points YTDLP_PYTHON at the machine's real Python. So the bot's
 * own spawn path is exercised for real, and the fake's behaviour stays in
 * JavaScript. No shebang files, no chmod: those do not run on Windows.
 *
 * Python itself is required (python3, python, or the `py -3` launcher);
 * without it the tests fail loudly rather than skip.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pythonPath = null;

/** @returns {string} Absolute path of a real Python 3 interpreter */
function findPython() {
    if (pythonPath) return pythonPath;
    const candidates = [['python3'], ['python'], ['py', '-3']];
    for (const [cmd, ...pre] of candidates) {
        const r = spawnSync(cmd, [...pre, '-c', 'import sys; print(sys.executable) if sys.version_info[0] == 3 else sys.exit(1)'], { encoding: 'utf8' });
        const exe = r.status === 0 && r.stdout.trim();
        if (exe && fs.existsSync(exe)) {
            pythonPath = exe;
            return exe;
        }
    }
    throw new Error('the yt-dlp tests need Python 3 (python3, python or py -3) on PATH');
}

/**
 * @param {string} body - JavaScript for the fake; `args` holds yt-dlp's arguments
 * @param {Object} [opts]
 * @param {string} [opts.mainPy] - Python for yt_dlp/__main__.py itself, in
 *   place of the hand-off to Node (for behaviour of the spawned process)
 * @returns {{dir: string, restore: Function}}
 */
function install(body, opts = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hambot-fake-ytdlp-'));
    const script = path.join(dir, 'fake.cjs');
    fs.writeFileSync(script, `const args = process.argv.slice(2);\n${body}`);
    fs.mkdirSync(path.join(dir, 'yt_dlp'));
    fs.writeFileSync(path.join(dir, 'yt_dlp', '__init__.py'), '');
    fs.writeFileSync(path.join(dir, 'yt_dlp', '__main__.py'), opts.mainPy || [
        'import subprocess, sys',
        `sys.exit(subprocess.run([${JSON.stringify(process.execPath)}, ${JSON.stringify(script)}] + sys.argv[1:]).returncode)`,
        ''
    ].join('\n'));

    const saved = { PYTHONPATH: process.env.PYTHONPATH, YTDLP_PYTHON: process.env.YTDLP_PYTHON };
    process.env.YTDLP_PYTHON = findPython();
    process.env.PYTHONPATH = [dir, saved.PYTHONPATH].filter(Boolean).join(path.delimiter);

    return {
        dir,
        restore() {
            for (const [key, value] of Object.entries(saved)) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
            fs.rmSync(dir, { recursive: true, force: true });
        }
    };
}

module.exports = { install, findPython };
