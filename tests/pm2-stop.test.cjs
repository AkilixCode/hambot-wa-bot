/**
 * `pm2 stop` reaches the bot's cleanup, with real pm2, on this OS.
 *
 * pm2 stops an app with SIGINT on Linux/macOS; on Windows, where it cannot
 * deliver signals, it sends a "shutdown" message instead (the
 * shutdown_with_message setting ecosystem.config.cjs turns on there). Either
 * way the cleanup must run before pm2's kill_timeout. Uses the same
 * settings ecosystem.config.cjs produces, an isolated PM2_HOME, and
 * utils/pm2 to run pm2 (no shell).
 *
 * Needs pm2 installed (CI: npm i -g pm2). Not part of test:all.
 * HAMBOT_TEST_PM2_MESSAGE=1 makes pm2 use the message path on any OS.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pm2 = require('../utils/pm2');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function pm2Run(args, env) {
    return new Promise((resolve, reject) => {
        const proc = pm2.run(args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
        if (!proc) return reject(new Error('pm2 is not installed (npm i -g pm2)'));
        let out = '';
        proc.stdout.on('data', chunk => { out += chunk; });
        proc.stderr.on('data', chunk => { out += chunk; });
        proc.on('error', reject);
        proc.on('exit', code => resolve({ code, out }));
    });
}

async function main() {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hambot-pm2-home-'));
    const marker = path.join(home, 'marker');
    const name = `hambot-ci-${process.pid}`;
    const env = { ...process.env, PM2_HOME: home };

    // The settings that matter, exactly as ecosystem.config.cjs computes them.
    const real = require('../ecosystem.config.cjs').apps[0];
    const ecosystem = path.join(home, 'ecosystem.json');
    fs.writeFileSync(ecosystem, JSON.stringify({
        apps: [{
            name,
            script: path.join(__dirname, 'fixtures', 'shutdown-app.cjs'),
            exec_mode: 'fork',
            autorestart: false,
            kill_timeout: real.kill_timeout,
            // HAMBOT_TEST_PM2_MESSAGE=1 takes Windows' path on any OS.
            shutdown_with_message: real.shutdown_with_message || process.env.HAMBOT_TEST_PM2_MESSAGE === '1',
            env: { SHUTDOWN_MARKER: marker }
        }]
    }));

    console.log(`pm2: ${pm2.locate()}`);
    console.log(`platform ${process.platform}: kill_timeout=${real.kill_timeout} shutdown_with_message=${real.shutdown_with_message}`);

    try {
        const started = await pm2Run(['start', ecosystem], env);
        assert.strictEqual(started.code, 0, started.out);

        // Wait until the app says it is ready (its out log).
        const outLog = path.join(home, 'logs', `${name}-out.log`);
        const deadline = Date.now() + 30000;
        while (!(fs.existsSync(outLog) && /ready/.test(fs.readFileSync(outLog, 'utf8'))) && Date.now() < deadline) {
            await sleep(200);
        }
        assert.ok(fs.existsSync(outLog) && /ready/.test(fs.readFileSync(outLog, 'utf8')), 'the app never started under pm2');

        const stopped = await pm2Run(['stop', name], env);
        assert.strictEqual(stopped.code, 0, stopped.out);

        assert.ok(fs.existsSync(marker), `cleanup did not run before pm2 stopped the app\n${fs.readFileSync(outLog, 'utf8')}`);
        assert.strictEqual(fs.readFileSync(marker, 'utf8'), 'shutdown complete\n');
        const log = fs.readFileSync(outLog, 'utf8');
        assert.match(log, /Shutdown complete/);
        console.log(`✅ PASS: pm2 stop ran the cleanup (${(/Shutting down gracefully \(([^)]+)\)/.exec(log) || [])[1]})`);
    } finally {
        await pm2Run(['kill'], env).catch(() => {});
        fs.rmSync(home, { recursive: true, force: true });
    }
}

main().then(() => process.exit(0), (error) => {
    console.log(`❌ FAIL: ${error.message}`);
    process.exit(1);
});
