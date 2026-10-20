/**
 * pm2 settings for running HamBot without Docker (./deploy.sh --local).
 *
 *   pm2 start ecosystem.config.cjs     (./deploy.sh does this for you)
 *
 * Mirrors the Docker setup: one process (WhatsApp allows one connection per
 * linked session), the same heap ceiling, and graceful shutdown on SIGINT.
 */

const os = require('os');
const path = require('path');

const home = os.homedir();
const name = process.env.PM2_PROCESS_NAME || 'hambot';
const logDir = path.join(process.env.PM2_HOME || path.join(home, '.pm2'), 'logs');

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
        node_args: '--max-old-space-size=1536',
        max_memory_restart: '1536M',

        // Restart after a crash, waiting longer each time. A bot that cannot
        // stay up for 30s ten times in a row (bad .env, missing module) is
        // marked "errored" instead of restarting forever; ./deploy.sh status
        // and doctor then say so.
        autorestart: true,
        exp_backoff_restart_delay: 3000,
        min_uptime: '30s',
        max_restarts: 10,

        // index.js closes the WhatsApp socket on SIGINT before exiting.
        kill_timeout: 10000,

        env: {
            NODE_ENV: 'production',
            // yt-dlp's venv, Deno and a per-user pm2 install, so .video/.music
            // and `.security restart` find them without a login shell.
            PATH: [
                path.join(__dirname, '.venv', 'bin'),
                path.join(home, '.deno', 'bin'),
                path.join(home, '.local', 'bin'),
                process.env.PATH
            ].filter(Boolean).join(path.delimiter)
        }
    }]
};
