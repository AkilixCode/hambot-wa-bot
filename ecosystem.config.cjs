/**
 * pm2 settings for running HamBot without Docker (./deploy.sh --local).
 *
 *   pm2 start ecosystem.config.cjs     (./deploy.sh does this for you)
 *
 * Mirrors the Docker setup: one process (WhatsApp allows one connection per
 * linked session), the same heap ceiling, and graceful shutdown on SIGINT.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const pm2 = require('./utils/pm2');
const { deadlineMs } = require('./utils/shutdown');

// The few settings pm2 itself needs, from the environment or the app's .env
// (pm2 reads this file before the bot has loaded anything).
let fileEnv = {};
try {
    fileEnv = require('dotenv').parse(fs.readFileSync(path.join(__dirname, '.env')));
} catch {
    // no .env yet: defaults
}
const settings = { ...fileEnv, ...process.env };

const home = os.homedir();
const windows = process.platform === 'win32';
const name = pm2.processName(settings);
if (!name) throw new Error('PM2_PROCESS_NAME is not a safe pm2 name (letters, digits, . - _; not starting with -)');
const logDir = pm2.logDir(settings);
const heapMb = Math.max(Number(settings.HAMBOT_MAX_HEAP_MB) || 1536, 128);

module.exports = {
    apps: [{
        name,
        script: 'index.js',
        cwd: __dirname,
        exec_mode: 'fork',

        // Fixed file names (no "-0" suffix): ./deploy.sh reads them to show the
        // pairing code, and `.security logs` looks for exactly these.
        out_file: path.join(logDir, `${name}-out.log`),
        error_file: path.join(logDir, `${name}-error.log`),
        merge_logs: true,
        // HAMBOT_MAX_HEAP_MB lowers both for a small machine (1 GB: 640).
        node_args: `--max-old-space-size=${heapMb}`,
        max_memory_restart: `${heapMb}M`,

        // Restart after a crash, waiting longer each time. A bot that cannot
        // stay up for 30s ten times in a row (bad .env, missing module) is
        // marked "errored" instead of restarting forever; ./deploy.sh status
        // and doctor then say so.
        autorestart: true,
        exp_backoff_restart_delay: 3000,
        min_uptime: '30s',
        max_restarts: 10,

        // index.js finishes its own cleanup within SHUTDOWN_DEADLINE_MS
        // (utils/shutdown); pm2 waits a margin longer before it kills.
        // Windows has no signals to send: pm2 sends a "shutdown" message.
        kill_timeout: deadlineMs(settings) + 4000,
        shutdown_with_message: windows,

        env: {
            NODE_ENV: 'production',
            // yt-dlp's venv, Deno and a per-user pm2 install, so .video/.music
            // and `.security restart` find them without a login shell.
            PATH: [
                path.join(__dirname, '.venv', windows ? 'Scripts' : 'bin'),
                path.join(home, '.deno', 'bin'),
                path.join(home, '.local', 'bin'),
                process.env.PATH
            ].filter(Boolean).join(path.delimiter)
        }
    }]
};
