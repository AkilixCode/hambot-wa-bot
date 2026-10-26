/**
 * Platform tests: what must behave the same on Linux, macOS and Windows.
 *
 *   - .env comes from the app folder, whatever folder the bot starts in
 *   - the shutdown routine: once, waits for session writes, never reconnects,
 *     ends at its deadline, listens for every stop the platform delivers
 *   - Python discovery for yt-dlp, for each platform's rules
 *   - canvas is optional: without it the bot still works
 *
 * Offline; no WhatsApp session is touched.
 */

process.env.LOG_LEVEL = 'simple';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { EventEmitter } = require('events');

const ROOT = path.join(__dirname, '..');

let passed = 0;
let failed = 0;

async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`✅ PASS: ${name}`);
    } catch (err) {
        failed++;
        console.log(`❌ FAIL: ${name}\n   ${err.message}`);
    }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** Run a snippet in a child Node with the given working folder and env. */
function nodeIn(cwd, code, env = {}) {
    const base = { ...process.env };
    delete base.BOT_NAME;
    delete base.HAMBOT_ENV_FILE;
    const r = spawnSync(process.execPath, ['-e', code], { cwd, env: { ...base, ...env }, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`child failed: ${r.stderr}`);
    // The value is the last line: loading the bot may log before it.
    return r.stdout.trim().split('\n').pop();
}

async function main() {
    console.log('\n🧪 PLATFORM TESTS\n' + '='.repeat(60));

    // ── .env loading ─────────────────────────────────────────────
    console.log('\n📄 .env loading...\n');

    const env = require('../utils/env');
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hambot-platform-'));
    // The app's .env for these tests: relative to the app folder, like the
    // real one, but never the real one.
    fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
    const appEnvRel = path.join('tmp', `platform-test-${process.pid}.env`);
    fs.writeFileSync(path.join(ROOT, appEnvRel), 'BOT_NAME=FromApp\n');
    const conflicting = path.join(scratch, 'conflicting');
    const empty = path.join(scratch, 'empty');
    fs.mkdirSync(conflicting);
    fs.mkdirSync(empty);
    fs.writeFileSync(path.join(conflicting, '.env'), 'BOT_NAME=FromWorkingFolder\n');

    const configName = `process.stdout.write(require(${JSON.stringify(path.join(ROOT, 'config.js'))}).bot.name)`;

    await test('.env: the app folder\'s, not the working folder\'s (bot started elsewhere)', () => {
        assert.strictEqual(nodeIn(conflicting, configName, { HAMBOT_ENV_FILE: appEnvRel }), 'FromApp');
    });

    await test('.env: found from a working folder that has none', () => {
        assert.strictEqual(nodeIn(empty, configName, { HAMBOT_ENV_FILE: appEnvRel }), 'FromApp');
    });

    await test('.env: a real environment variable still wins over the file', () => {
        assert.strictEqual(nodeIn(conflicting, configName, { HAMBOT_ENV_FILE: appEnvRel, BOT_NAME: 'FromShell' }), 'FromShell');
    });

    await test('.env: index.js loads it before anything else (handler.js first, as the old bug did)', () => {
        // handler.js used to call dotenv itself, relative to the working folder.
        const code = `require(${JSON.stringify(path.join(ROOT, 'handler.js'))}); process.stdout.write(process.env.BOT_NAME || '<unset>')`;
        assert.strictEqual(nodeIn(conflicting, code, { HAMBOT_ENV_FILE: appEnvRel }), 'FromApp');
    });

    await test('.env: default location is the app folder, and no entry point loads dotenv on its own', () => {
        const saved = process.env.HAMBOT_ENV_FILE;
        delete process.env.HAMBOT_ENV_FILE;
        try {
            assert.strictEqual(env.envFile(), path.join(ROOT, '.env'));
        } finally {
            if (saved !== undefined) process.env.HAMBOT_ENV_FILE = saved;
        }
        for (const file of ['index.js', 'handler.js', 'config.js', 'utils/chat/check.js']) {
            const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
            assert.ok(!/require\(['"]dotenv['"]\)\.config/.test(source), `${file} must load .env through utils/env`);
        }
    });

    await test('session folder: anchored to the app folder, wherever the bot starts', () => {
        const code = `process.stdout.write(require(${JSON.stringify(path.join(ROOT, 'index.js'))}).authDir())`;
        const out = nodeIn(empty, code, { HAMBOT_ENV_FILE: appEnvRel, HAMBOT_AUTH_DIR: '' });
        assert.strictEqual(out, path.join(ROOT, 'auth_info_baileys'));
    });

    await test('--dev / --verbose flags work in every shell (no VAR=value prefix)', () => {
        const pkg = require('../package.json');
        for (const [name, script] of Object.entries(pkg.scripts)) {
            assert.ok(!/(^|&&\s*)[A-Z_]+=\S+\s/.test(script), `npm script "${name}" uses POSIX-only VAR=value syntax`);
        }
        // A script file, as `node index.js --dev` is: argv[2] onwards are the flags.
        const script = path.join(scratch, 'flags.js');
        fs.writeFileSync(script, `require(${JSON.stringify(path.join(ROOT, 'utils', 'env'))}); process.stdout.write(process.env.NODE_ENV + ' ' + process.env.LOG_LEVEL);`);
        const r = spawnSync(process.execPath, [script, '--dev', '--verbose'], {
            cwd: scratch, env: { ...process.env, NODE_ENV: '', LOG_LEVEL: '', HAMBOT_ENV_FILE: 'tests/no-such.env' }, encoding: 'utf8'
        });
        assert.strictEqual(r.stdout, 'development debug', r.stderr);
    });

    fs.rmSync(path.join(ROOT, appEnvRel), { force: true });

    // ── Shutdown ─────────────────────────────────────────────────
    console.log('\n🛑 Shutdown...\n');

    const shutdownLib = require('../utils/shutdown');

    /** A shutdown whose exit is recorded instead of ending this process. */
    function harness(steps, deadline = 2000) {
        const events = [];
        let exited;
        const done = new Promise(resolve => { exited = resolve; });
        const s = shutdownLib.create({
            steps,
            deadline,
            exit: (code) => { events.push(`exit ${code}`); exited(code); },
            log: (message) => events.push(message)
        });
        return { s, events, done };
    }

    await test('shutdown: a second signal while it runs changes nothing', async () => {
        let ran = 0;
        const { s, events, done } = harness([{ name: 'count', run: async () => { ran++; await sleep(50); } }]);
        s.run('SIGINT');
        s.run('SIGTERM');
        s.run('SIGHUP');
        assert.strictEqual(await done, 0);
        await sleep(20);
        assert.strictEqual(ran, 1);
        assert.strictEqual(events.filter(e => e.startsWith('exit')).length, 1);
    });

    await test('shutdown: session writes still in flight finish before exit', async () => {
        const order = [];
        const { s, done } = harness([{ name: 'close', run: () => order.push('closed') }]);
        // A creds write that started just before the stop...
        s.track(sleep(150).then(() => order.push('creds written')));
        // ...and one that a write itself starts (a key file after creds).
        s.track(sleep(50).then(() => s.track(sleep(100).then(() => order.push('keys written')))));
        s.run('SIGTERM');
        await done;
        order.push('exit');
        assert.deepStrictEqual(order, ['closed', 'creds written', 'keys written', 'exit']);
    });

    await test('shutdown: a failing step does not stop the others; the exit code says so', async () => {
        const ran = [];
        const { s, events, done } = harness([
            { name: 'a', run: () => { throw new Error('boom'); } },
            { name: 'b', run: () => ran.push('b') }
        ]);
        s.run('SIGINT');
        assert.strictEqual(await done, 1);
        assert.deepStrictEqual(ran, ['b']);
        assert.ok(events.some(e => /"a" failed: boom/.test(e)));
    });

    await test('shutdown: a hung step ends at the deadline, naming the step', async () => {
        const started = Date.now();
        const { s, events, done } = harness([{ name: 'close WhatsApp', run: () => new Promise(() => {}) }], 1000);
        s.run('SIGTERM');
        assert.strictEqual(await done, 1);
        const took = Date.now() - started;
        assert.ok(took >= 900 && took < 3000, `took ${took}ms`);
        assert.ok(events.some(e => /stuck at: close WhatsApp/.test(e)), events.join(' | '));
    });

    await test('shutdown: SHUTDOWN_DEADLINE_MS is bounded; pm2 waits longer than the deadline', () => {
        assert.strictEqual(shutdownLib.deadlineMs({}), 4000);
        assert.strictEqual(shutdownLib.deadlineMs({ SHUTDOWN_DEADLINE_MS: '6500' }), 6500);
        assert.strictEqual(shutdownLib.deadlineMs({ SHUTDOWN_DEADLINE_MS: '5' }), 1000);
        assert.strictEqual(shutdownLib.deadlineMs({ SHUTDOWN_DEADLINE_MS: 'x' }), 4000);
        assert.strictEqual(shutdownLib.deadlineMs({ SHUTDOWN_DEADLINE_MS: '999999' }), 60000);
        const app = require('../ecosystem.config.cjs').apps[0];
        assert.ok(app.kill_timeout >= shutdownLib.deadlineMs() + 2000, `kill_timeout ${app.kill_timeout}`);
        assert.strictEqual(app.shutdown_with_message, process.platform === 'win32', 'pm2 sends a message only where it cannot signal');
    });

    await test('shutdown: listens for every stop the platform delivers, pm2\'s message included', async () => {
        for (const platform of ['linux', 'darwin', 'win32']) {
            const proc = new EventEmitter();
            proc.platform = platform;
            const { s, done } = harness([]);
            s.install(proc);
            const expected = ['SIGINT', 'SIGTERM', 'SIGHUP', ...(platform === 'win32' ? ['SIGBREAK'] : []), 'message'];
            for (const event of expected) assert.strictEqual(proc.listenerCount(event), 1, `${platform}: ${event}`);
            assert.strictEqual(proc.listenerCount('SIGBREAK'), platform === 'win32' ? 1 : 0);
            proc.emit('message', 'something else');
            assert.strictEqual(s.isShuttingDown(), false, 'other IPC messages are ignored');
            proc.emit('message', 'shutdown');
            assert.strictEqual(await done, 0);
        }
    });

    await test('shutdown: index.js schedules no reconnect once a stop has begun', async () => {
        const realExit = process.exit;
        const realLog = console.log;
        const auth = fs.mkdtempSync(path.join(os.tmpdir(), 'hambot-auth-'));
        const data = fs.mkdtempSync(path.join(os.tmpdir(), 'hambot-data-'));
        process.env.HAMBOT_AUTH_DIR = auth;
        process.env.HAMBOT_DATA_DIR = data;
        let exitCode = null;
        process.exit = (code) => { exitCode = code; };
        console.log = () => {};
        try {
            const bot = require('../index');
            // Before: a dropped connection schedules a reconnect.
            bot.handleClose({ error: { output: { statusCode: 428 }, message: 'closed' } });
            assert.strictEqual(bot.reconnectScheduled(), true);
            await bot.shutdown.run('test');
            assert.strictEqual(exitCode, 0);
            assert.strictEqual(bot.reconnectScheduled(), false, 'the pending reconnect was cancelled');
            // After: the same drop schedules nothing.
            bot.handleClose({ error: { output: { statusCode: 428 }, message: 'closed' } });
            assert.strictEqual(bot.reconnectScheduled(), false, 'no reconnect during shutdown');
        } finally {
            process.exit = realExit;
            console.log = realLog;
            fs.rmSync(auth, { recursive: true, force: true });
            fs.rmSync(data, { recursive: true, force: true });
            delete process.env.HAMBOT_AUTH_DIR;
            delete process.env.HAMBOT_DATA_DIR;
        }
    });

    if (process.platform !== 'win32') {
        await test('shutdown (POSIX): a real SIGTERM runs the cleanup and exits 0', async () => {
            const marker = path.join(scratch, 'marker-sigterm');
            const child = spawn(process.execPath, [path.join(__dirname, 'fixtures', 'shutdown-app.cjs')], {
                env: { ...process.env, SHUTDOWN_MARKER: marker }
            });
            let out = '';
            child.stdout.on('data', chunk => { out += chunk; });
            const deadline = Date.now() + 10000;
            while (!/ready/.test(out) && Date.now() < deadline) await sleep(50);
            child.kill('SIGTERM');
            const code = await new Promise(resolve => child.on('exit', resolve));
            assert.strictEqual(code, 0, out);
            assert.strictEqual(fs.readFileSync(marker, 'utf8'), 'shutdown complete\n');
            assert.match(out, /Shutting down gracefully \(SIGTERM\)/);
        });

        await test('shutdown (POSIX): the real bot stops cleanly on SIGTERM (docker stop)', async () => {
            // A WhatsApp stand-in that accepts and never answers.
            const net = require('net');
            const sockets = [];
            const server = net.createServer(s => sockets.push(s));
            await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
            const auth = fs.mkdtempSync(path.join(os.tmpdir(), 'hambot-auth-'));
            const data = fs.mkdtempSync(path.join(os.tmpdir(), 'hambot-data-'));
            const child = spawn(process.execPath, [path.join(ROOT, 'index.js')], {
                cwd: scratch,
                env: {
                    ...process.env,
                    HAMBOT_WA_URL: `ws://127.0.0.1:${server.address().port}/ws`,
                    HAMBOT_AUTH_DIR: auth,
                    HAMBOT_DATA_DIR: data,
                    HAMBOT_ENV_FILE: 'tests/no-such.env',
                    BOT_OWNER_ID: '6281234567890',
                    LOG_LEVEL: 'simple'
                }
            });
            let out = '';
            child.stdout.on('data', chunk => { out += chunk; });
            child.stderr.on('data', chunk => { out += chunk; });
            try {
                const deadline = Date.now() + 15000;
                while (sockets.length === 0 && Date.now() < deadline) await sleep(100);
                assert.ok(sockets.length > 0, `the bot never connected: ${out}`);
                child.kill('SIGTERM');
                const code = await new Promise(resolve => child.on('exit', resolve));
                assert.strictEqual(code, 0, out);
                assert.match(out, /Shutting down gracefully \(SIGTERM\)/);
                assert.match(out, /Shutdown complete/);
            } finally {
                if (child.exitCode === null) child.kill('SIGKILL');
                sockets.forEach(s => s.destroy());
                server.close();
                fs.rmSync(auth, { recursive: true, force: true });
                fs.rmSync(data, { recursive: true, force: true });
            }
        });
    }

    // ── Python for yt-dlp ────────────────────────────────────────
    console.log('\n🐍 Python discovery...\n');

    const ytdlp = require('../utils/ytdlp');

    await test('python: the system default per platform (Windows has no python3)', () => {
        const saved = process.env.YTDLP_PYTHON;
        delete process.env.YTDLP_PYTHON;
        try {
            assert.strictEqual(ytdlp.pythonBin('win32'), 'python');
            assert.strictEqual(ytdlp.pythonBin('linux'), 'python3');
            assert.strictEqual(ytdlp.pythonBin('darwin'), 'python3');
            process.env.YTDLP_PYTHON = 'py';
            assert.strictEqual(ytdlp.pythonBin('win32'), 'py', 'a bare command is used as is');
        } finally {
            if (saved === undefined) delete process.env.YTDLP_PYTHON; else process.env.YTDLP_PYTHON = saved;
        }
    });

    await test('python: a venv path works with either slash, and is translated for the OS it runs on', () => {
        const venv = path.join(scratch, 'venv');
        const winPython = path.join(venv, 'Scripts', 'python.exe');
        const unixPython = path.join(venv, 'bin', 'python');
        fs.mkdirSync(path.dirname(winPython), { recursive: true });
        fs.mkdirSync(path.dirname(unixPython), { recursive: true });
        const saved = process.env.YTDLP_PYTHON;
        try {
            // A .env written on Linux, read on Windows: only Scripts\python.exe exists there.
            fs.writeFileSync(winPython, '');
            process.env.YTDLP_PYTHON = `${venv}/bin/python`;
            assert.strictEqual(ytdlp.pythonBin('win32'), winPython);
            assert.strictEqual(ytdlp.pythonBin('linux'), 'python3', 'nothing usable on Linux: system Python');

            // Backslashes, as typed on Windows.
            process.env.YTDLP_PYTHON = winPython.split(path.sep).join('\\');
            assert.strictEqual(ytdlp.pythonBin('win32'), winPython);

            // And the other way round.
            fs.writeFileSync(unixPython, '');
            process.env.YTDLP_PYTHON = winPython;
            assert.strictEqual(ytdlp.pythonBin('linux'), winPython, 'the configured file wins when it exists');
            fs.rmSync(winPython);
            assert.strictEqual(ytdlp.pythonBin('linux'), unixPython);
        } finally {
            if (saved === undefined) delete process.env.YTDLP_PYTHON; else process.env.YTDLP_PYTHON = saved;
        }
    });

    // ── canvas is optional ───────────────────────────────────────
    console.log('\n🖼️  Optional canvas...\n');

    await test('canvas: listed as optional, so an install never fails on it', () => {
        const pkg = require('../package.json');
        assert.ok(pkg.optionalDependencies && pkg.optionalDependencies.canvas);
        assert.ok(!pkg.dependencies.canvas);
    });

    await test('canvas: without it, .menu is text and .brat explains — nothing crashes', () => {
        // A child where require('canvas') fails the way a missing prebuild does.
        const code = `
            const Module = require('module');
            const realLoad = Module._load;
            Module._load = function (request, ...rest) {
                if (request === 'canvas') { const e = new Error("Cannot find module 'canvas'"); e.code = 'MODULE_NOT_FOUND'; throw e; }
                return realLoad.call(this, request, ...rest);
            };
            (async () => {
                const menuImage = require('./utils/menu-image');
                const image = await menuImage.getMenuImage();
                const Brat = require('./commands/brat');
                const sent = [];
                const sock = { sendMessage: async (jid, content) => { sent.push(content); return { key: {} }; } };
                await new Brat().execute(sock, { key: { remoteJid: 'x@s.whatsapp.net', id: '1' } }, ['halo'], { from: 'x@s.whatsapp.net', isOwner: true });
                const text = sent.filter(c => c.text).map(c => c.text).join(' ');
                process.stdout.write(JSON.stringify({ image, brat: text, reason: require('./utils/optional').reason('canvas') }));
            })().catch(e => { console.error(e); process.exit(1); });`;
        const r = spawnSync(process.execPath, ['-e', code], {
            cwd: ROOT, env: { ...process.env, HAMBOT_ENV_FILE: 'tests/no-such.env', HAMBOT_DATA_DIR: scratch }, encoding: 'utf8'
        });
        assert.strictEqual(r.status, 0, r.stderr);
        const out = JSON.parse(r.stdout);
        const hasAsset = ['menu.jpg', 'menu.jpeg', 'menu.png', 'menu.webp'].some(n => fs.existsSync(path.join(ROOT, 'assets', n)));
        if (!hasAsset) assert.strictEqual(out.image, null, 'no picture: .menu falls back to text');
        assert.match(out.brat, /belum tersedia/i);
        assert.match(out.brat, /npm install canvas/);
        assert.strictEqual(out.reason, 'not installed');
    });

    fs.rmSync(scratch, { recursive: true, force: true });

    console.log('\n' + '='.repeat(60));
    console.log(`✅ Tests Passed: ${passed}`);
    console.log(`❌ Tests Failed: ${failed}`);
    console.log('='.repeat(60) + '\n');
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('Test runner crashed:', err);
    process.exit(1);
});
