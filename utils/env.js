/**
 * Environment loading
 *
 * The one place `.env` is read. It is anchored to the app's own folder, not
 * the folder the bot happens to be started from: a bot started from a
 * shortcut, a service manager or another directory used to pick up whatever
 * `.env` sat in that directory (or none) and start a fresh WhatsApp session.
 *
 * Variables already in the environment (Docker `environment:`, pm2 `env`, the
 * shell) win over the file, as before. HAMBOT_ENV_FILE points at another file,
 * relative to the app folder; the tests use it.
 *
 * Flags, for package.json scripts that must work in every shell:
 *   --dev      NODE_ENV=development (unless already set)
 *   --verbose  LOG_LEVEL=debug (unless already set)
 */

const path = require('path');

const APP_DIR = path.join(__dirname, '..');

let loaded = false;

/**
 * @returns {string} Absolute path of the .env file the app reads
 */
function envFile() {
    return path.resolve(APP_DIR, process.env.HAMBOT_ENV_FILE || '.env');
}

function load() {
    if (loaded) return;
    loaded = true;

    const argv = process.argv.slice(2);
    if (argv.includes('--dev') && !process.env.NODE_ENV) process.env.NODE_ENV = 'development';
    if (argv.includes('--verbose') && !process.env.LOG_LEVEL) process.env.LOG_LEVEL = 'debug';

    require('dotenv').config({ path: envFile(), quiet: true });
}

load();

module.exports = { APP_DIR, envFile };
