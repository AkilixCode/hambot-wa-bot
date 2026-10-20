/**
 * deploy.sh Tests
 *
 * Runs deploy.sh in a sealed sandbox: PATH holds only recording fakes
 * (docker, pm2, npm, python3, curl, ffmpeg, deno) and a whitelist of basic
 * system tools, so a "missing ffmpeg" really is missing even on a CI runner
 * that has one. Prompts are answered through a pipe (HAMBOT_TTY=stdin), so
 * the same tests run on Linux and macOS.
 *
 * Covers both modes (Docker and Local), the recovery commands, and the
 * mistakes the installer must survive without looping or breaking: input
 * that ends mid-question, endless wrong answers, failing downloads, a full
 * disk, a crashed bot, two copies at once, a stale lock, Ctrl+C.
 *
 *   npm run test:deploy
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
// Tests live in tests/; paths are resolved from the repository root.
const ROOT = path.join(__dirname, '..');
const { spawnSync, spawn } = require('child_process');

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

const SYSTEM_TOOLS = ['sh', 'sed', 'grep', 'cut', 'tr', 'cat', 'cp', 'mv', 'rm', 'mkdir', 'chmod', 'sleep',
    'head', 'tail', 'id', 'uname', 'wc', 'awk', 'cksum', 'tar', 'df', 'dirname', 'basename', 'ls', 'env',
    'touch', 'sort', 'ln'];

const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
const YTDLP_PIN = dockerfile.match(/^ARG YTDLP_VERSION=(\S+)/m)[1];

function which(tool) {
    const r = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : null;
}

function writeExec(file, lines) {
    // Unlink first: the path may be a symlink to a real binary (bin/node ->
    // the running node), and writing through it would overwrite that binary.
    fs.rmSync(file, { force: true });
    fs.writeFileSync(file, lines.join('\n') + '\n');
    fs.chmodSync(file, 0o755);
}

/**
 * A fresh sandbox: deploy.sh and the files it reads, the bot's utils (for
 * the session archive/restore snippets), and the fakes.
 * @param {Object} [opts]
 * @param {string[]} [opts.without] Fakes to leave out (e.g. ['ffmpeg'])
 */
function sandbox({ without = [] } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hambot-deploy-'));
    for (const f of ['deploy.sh', '.env.example', 'Dockerfile', 'package.json', 'package-lock.json', 'ecosystem.config.cjs']) {
        fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
    }
    fs.chmodSync(path.join(dir, 'deploy.sh'), 0o755);
    fs.symlinkSync(path.join(ROOT, 'utils'), path.join(dir, 'utils'));
    fs.symlinkSync(path.join(ROOT, 'scripts'), path.join(dir, 'scripts'));
    const bin = path.join(dir, 'bin');
    const fakes = path.join(dir, 'fakes');
    fs.mkdirSync(bin);
    fs.mkdirSync(fakes);
    fs.mkdirSync(path.join(dir, 'home'));

    for (const tool of SYSTEM_TOOLS) {
        const real = which(tool);
        if (real) fs.symlinkSync(real, path.join(bin, tool));
    }
    fs.symlinkSync(process.execPath, path.join(bin, 'node'));

    const q = JSON.stringify(dir);
    // Every fake appends its arguments to <name>.calls. Behaviour is scripted
    // with small files in the sandbox (state.txt, pm2state.txt, ...).
    writeExec(path.join(fakes, 'docker'), [
        '#!/bin/sh',
        `here=${q}`,
        'printf "%s\\n" "$*" >> "$here/docker.calls"',
        '[ "$1" = info ] && [ -f "$here/docker-info-fails" ] && exit 1',
        'case "$*" in',
        '  "compose logs --no-log-prefix hambot") if [ -f "$here/logs.txt" ]; then cat "$here/logs.txt"; else echo "✅ HamBot connected to WhatsApp!"; fi ;;',
        '  "compose logs --no-log-prefix --tail "*) cat "$here/logs.txt" 2>/dev/null ;;',
        '  compose\\ ps*) cat "$here/state.txt" 2>/dev/null ;;',
        '  "compose pull hambot") if [ -f "$here/pull-fails" ]; then echo "pull failed" >&2; exit 1; fi ;;',
        '  "compose up -d --build hambot") if [ -f "$here/build-fails" ]; then exit 1; fi ;;',
        '  *"--entrypoint tar hambot"*) if [ -f "$here/tar-out-fails" ]; then exit 1; fi; if [ -f "$here/session.tar" ]; then cat "$here/session.tar"; else tar -C "$here/fakes" -cf - --exclude="*" .; fi ;;',
        '  *"--entrypoint sh hambot"*) cat > "$here/received.tar" ;;',
        'esac',
        'exit 0'
    ]);
    writeExec(path.join(fakes, 'pm2'), [
        '#!/bin/sh',
        `here=${q}`,
        'printf "%s\\n" "$*" >> "$here/pm2.calls"',
        'st="$here/pm2state.txt"',
        'logs="$PM2_HOME/logs"',
        'case "$1" in',
        '  jlist) if [ -f "$st" ]; then printf \'[{"name":"hambot","pm2_env":{"status":"%s","restart_time":%s}}]\\n\' "$(cat "$st")" "$(cat "$here/pm2restarts.txt" 2>/dev/null || echo 0)"; else echo "[]"; fi ;;',
        '  start) [ -f "$here/pm2-start-fails" ] && exit 1; mkdir -p "$logs"; cat "$here/pm2-next-state.txt" 2>/dev/null > "$st" || true; [ -s "$st" ] || echo online > "$st";',
        '         if [ -f "$here/botlog.txt" ]; then cat "$here/botlog.txt" >> "$logs/hambot-out.log"; else echo "✅ HamBot connected to WhatsApp!" >> "$logs/hambot-out.log"; fi ;;',
        '  delete) rm -f "$st" ;;',
        '  stop) [ -f "$st" ] && echo stopped > "$st" ;;',
        '  startup) echo "[PM2] To setup the Startup Script, copy/paste the following command:"; echo "sudo env PATH=\\$PATH:/usr/bin pm2 startup systemd -u tester --hp /home/tester" ;;',
        'esac',
        'exit 0'
    ]);
    writeExec(path.join(fakes, 'npm'), [
        '#!/bin/sh',
        `here=${q}`,
        'printf "%s\\n" "$*" >> "$here/npm.calls"',
        'case "$1" in',
        '  ci)',
        '    n=$(cat "$here/npm-fails" 2>/dev/null || echo 0)',
        '    if [ "$n" -gt 0 ]; then echo $((n - 1)) > "$here/npm-fails";',
        '      if [ -f "$here/npm-enospc" ]; then echo "npm ERR! code ENOSPC" >&2; else echo "npm ERR! network request failed" >&2; fi; exit 1; fi',
        '    mkdir -p node_modules ;;',
        '  install)',
        '    if [ "$2" = -g ] && [ "$3" = pm2 ] && [ -f "$here/npm-global-eacces" ]; then echo "npm ERR! code EACCES" >&2; exit 243; fi',
        '    if [ "$3" = --prefix ]; then mkdir -p "$4/bin"; cp "$here/fakes/pm2" "$4/bin/pm2"; else cp "$here/fakes/pm2" "$here/bin/pm2"; fi ;;',
        'esac',
        'exit 0'
    ]);
    writeExec(path.join(fakes, 'python3'), [
        '#!/bin/sh',
        `here=${q}`,
        'printf "%s\\n" "$*" >> "$here/python.calls"',
        'if [ "$1" = -m ] && [ "$2" = venv ]; then',
        '  if [ -f "$here/venv-fails" ]; then echo "The virtual environment was not created successfully because ensurepip is not available." >&2; exit 1; fi',
        '  mkdir -p "$3/bin"; cp "$here/fakes/venv-python" "$3/bin/python"; chmod +x "$3/bin/python"; exit 0',
        'fi',
        'exit 0'
    ]);
    writeExec(path.join(fakes, 'venv-python'), [
        '#!/bin/sh',
        `here=${q}`,
        'case "$*" in',
        '  "-m yt_dlp --version") cat "$here/ytdlp-installed" 2>/dev/null || exit 1 ;;',
        '  "-m pip install"*)',
        '    printf "%s\\n" "$*" >> "$here/pip.calls"',
        '    n=$(cat "$here/pip-fails" 2>/dev/null || echo 0)',
        '    if [ "$n" -gt 0 ]; then echo $((n - 1)) > "$here/pip-fails"; echo "ERROR: Could not find a version" >&2; exit 1; fi',
        '    for a; do last=$a; done; echo "${last#yt-dlp==}" | sed "s/\\.\\([0-9]\\)\\./.0\\1./" > "$here/ytdlp-installed" ;;',
        'esac',
        'exit 0'
    ]);
    writeExec(path.join(fakes, 'curl'), [
        '#!/bin/sh',
        `here=${q}`,
        'printf "%s\\n" "$*" >> "$here/curl.calls"',
        '[ -f "$here/curl-fails" ] && exit 22',
        'while [ $# -gt 0 ]; do [ "$1" = -o ] && out=$2; shift; done',
        // A stand-in for deno.land/install.sh that installs a fake deno.
        'printf "%s\\n" "#!/bin/sh" "printf \\"%s\\\\n\\" \\"\\$*\\" >> \\"$here/deno-install.calls\\"" "mkdir -p \\"\\$HOME/.deno/bin\\"" "printf \\"#!/bin/sh\\\\nexit 0\\\\n\\" > \\"\\$HOME/.deno/bin/deno\\"" "chmod +x \\"\\$HOME/.deno/bin/deno\\"" > "$out"'
    ]);
    writeExec(path.join(fakes, 'git'), [
        '#!/bin/sh',
        `here=${q}`,
        'printf "%s\\n" "$*" >> "$here/git.calls"',
        'if [ "$1" = clone ]; then',
        '  dest=$5',
        // A failed clone leaves a partial folder behind, as a real one can.
        '  if [ -f "$here/git-fails" ]; then mkdir -p "$dest"; exit 128; fi',
        '  mkdir -p "$dest/.git"',
        '  for f in deploy.sh .env.example Dockerfile package.json package-lock.json ecosystem.config.cjs; do cp "$here/$f" "$dest/"; done',
        '  ln -s "$here/utils" "$dest/utils"; ln -s "$here/scripts" "$dest/scripts"',
        'fi',
        'exit 0'
    ]);
    for (const simple of ['ffmpeg', 'deno', 'unzip']) {
        writeExec(path.join(fakes, simple), ['#!/bin/sh', 'exit 0']);
    }
    for (const fake of ['docker', 'pm2', 'npm', 'python3', 'curl', 'ffmpeg', 'deno', 'unzip', 'git']) {
        if (!without.includes(fake)) fs.copyFileSync(path.join(fakes, fake), path.join(bin, fake));
        fs.chmodSync(path.join(fakes, fake), 0o755);
        if (!without.includes(fake)) fs.chmodSync(path.join(bin, fake), 0o755);
    }
    return dir;
}

function baseEnv(dir, extra = {}) {
    return {
        PATH: path.join(dir, 'bin'),
        HOME: path.join(dir, 'home'),
        PM2_HOME: path.join(dir, 'home', '.pm2'),
        SHELL: '/bin/sh',
        LANG: 'C.UTF-8',
        HAMBOT_RETRY_DELAY: '0',
        HAMBOT_TEST_UID: '1000',
        HAMBOT_SKIP_NET_CHECK: '1',
        ...extra
    };
}

/**
 * Run deploy.sh.
 * @param {string} dir Sandbox
 * @param {string[]} args
 * @param {string[]|null} lines Answers typed at the prompts; null = no terminal
 * @param {Object} [extraEnv]
 * @param {number} [timeout] A run that takes longer has looped: test fails
 */
function run(dir, args, lines, extraEnv = {}, timeout = 60000) {
    const env = baseEnv(dir, { HAMBOT_TTY: lines === null ? 'none' : 'stdin', ...extraEnv });
    const result = spawnSync('./deploy.sh', args, {
        cwd: dir, env, encoding: 'utf8', timeout,
        input: lines === null ? '' : lines.map(l => l + '\n').join('')
    });
    if (result.error && result.error.code === 'ETIMEDOUT') {
        throw new Error(`deploy.sh ${args.join(' ')} did not finish within ${timeout / 1000}s (a loop?)\n${result.stdout}${result.stderr}`);
    }
    return {
        status: result.status,
        output: (String(result.stdout) + String(result.stderr)).replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '')
    };
}

const envValue = (dir, key) => {
    const line = fs.readFileSync(path.join(dir, '.env'), 'utf8').split('\n').filter(l => l.startsWith(`${key}=`)).pop();
    return line === undefined ? undefined : line.slice(key.length + 1);
};
const calls = (dir, tool = 'docker') => {
    const file = path.join(dir, `${tool}.calls`);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n') : [];
};
const resetCalls = (dir) => {
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.calls')) fs.rmSync(path.join(dir, f));
};
const put = (dir, file, content = '') => fs.writeFileSync(path.join(dir, file), content);
const del = (dir, file) => fs.rmSync(path.join(dir, file), { force: true, recursive: true });
const has = (dir, file) => fs.existsSync(path.join(dir, file));
const leftovers = (dir) => fs.readdirSync(dir).filter(f => f.startsWith('.deploy-tmp') || f === '.deploy.lock');

/** A sandbox already set up in local mode with an owner number. */
function localSandbox(opts) {
    const dir = sandbox(opts);
    const r = run(dir, ['--local', '--owner', '6281200000001'], null);
    assert.strictEqual(r.status, 0, r.output);
    resetCalls(dir);
    return dir;
}

async function main() {
    console.log('\n🧪 DEPLOY.SH TESTS\n' + '='.repeat(60));

    // ── Docker mode: the flows that existed before Local ───────────────
    console.log('\n🐳 Docker mode...\n');
    const dir = sandbox();
    try {
        await test('Setup (Enter = Docker) rejects a leading 0 and lets you take back a misclicked number', () => {
            const r = run(dir, [], [
                '',                  // Docker or Local? Enter = Docker
                '081234567890',      // rejected: needs the country code
                '6281111111111',     // misclick…
                'n',                 // …caught at the read-back
                '6282222222222',
                'y',
                ''                   // no pairing number -> QR code
            ]);
            assert.strictEqual(r.status, 0, r.output);
            assert.match(r.output, /country code instead of the leading 0/);
            assert.strictEqual(envValue(dir, 'BOT_OWNER_ID'), '6282222222222', 'the corrected number is saved');
            assert.strictEqual(envValue(dir, 'PAIRING_NUMBER'), '', 'empty pairing number means QR');
            assert.strictEqual(envValue(dir, 'DEPLOY_MODE'), 'docker');
            assert.strictEqual((fs.statSync(path.join(dir, '.env')).mode & 0o777).toString(8), '600');
            assert.ok(calls(dir).includes('compose up -d --no-build hambot'));
            assert.deepStrictEqual(leftovers(dir), [], 'no lock or temp files left behind');
        });

        await test('Running setup again keeps .env and points at `config`', () => {
            const r = run(dir, [], []);
            assert.match(r.output, /already exists.*deploy\.sh config/);
            assert.strictEqual(envValue(dir, 'BOT_OWNER_ID'), '6282222222222');
        });

        await test('`config` keeps a number on Enter and changes another, then recreates the bot', () => {
            resetCalls(dir);
            const r = run(dir, ['config'], ['', '6289999999999', 'y']);
            assert.strictEqual(r.status, 0, r.output);
            assert.strictEqual(envValue(dir, 'BOT_OWNER_ID'), '6282222222222');
            assert.strictEqual(envValue(dir, 'PAIRING_NUMBER'), '6289999999999');
            assert.ok(calls(dir).includes('compose up -d --no-build --force-recreate hambot'), calls(dir).join(' | '));
            assert.ok(!calls(dir).some(c => c.startsWith('compose run')), 'config must not touch the session');
        });

        await test('`config` clears the pairing number with "-" (back to QR)', () => {
            run(dir, ['config'], ['', '-']);
            assert.strictEqual(envValue(dir, 'PAIRING_NUMBER'), '');
        });

        await test('`relink --qr -y` archives the session and forces the QR code', () => {
            resetCalls(dir);
            const r = run(dir, ['relink', '--qr', '-y'], null);
            assert.strictEqual(r.status, 0, r.output);
            const c = calls(dir);
            const stop = c.indexOf('compose stop hambot');
            const archive = c.findIndex(x => x.startsWith('compose run --rm --no-deps --entrypoint node hambot -e') && x.includes('archiveSession'));
            const up = c.indexOf('compose up -d --no-build --force-recreate hambot');
            assert.ok(stop >= 0 && archive > stop && up > archive, `order was: ${c.join(' | ')}`);
            assert.strictEqual(envValue(dir, 'LOGIN_METHOD'), 'qr');
        });

        await test('`relink --code <number>` sets the pairing number and code mode', () => {
            const r = run(dir, ['relink', '--code', '6287700000000', '-y'], null);
            assert.strictEqual(r.status, 0, r.output);
            assert.strictEqual(envValue(dir, 'PAIRING_NUMBER'), '6287700000000');
            assert.strictEqual(envValue(dir, 'LOGIN_METHOD'), 'code');
        });

        await test('`relink --code` accepts a number typed with spaces and no quotes', () => {
            // Three arguments, as the shell splits it for a person.
            const r = run(dir, ['relink', '--code', '+62', '877-1234-5678', '-y'], null);
            assert.strictEqual(r.status, 0, r.output);
            assert.strictEqual(envValue(dir, 'PAIRING_NUMBER'), '6287712345678');
        });

        await test('`relink --code` with a bad number fails before touching anything', () => {
            resetCalls(dir);
            const r = run(dir, ['relink', '--code', '0812345', '-y'], null);
            assert.notStrictEqual(r.status, 0);
            assert.ok(!calls(dir).some(c => c.includes('stop') || c.includes('compose run')), calls(dir).join(' | '));
        });

        await test('`relink` without a terminal refuses unless -y is given', () => {
            resetCalls(dir);
            const r = run(dir, ['relink'], null);
            assert.notStrictEqual(r.status, 0);
            assert.match(r.output, /-y/);
            assert.ok(!calls(dir).some(c => c.includes('compose run')));
        });

        await test('`relink` answered "no" changes nothing', () => {
            resetCalls(dir);
            run(dir, ['relink'], ['n']);
            assert.ok(!calls(dir).some(c => c.includes('stop') || c.includes('compose run')));
        });

        await test('`restore-session` puts the archived session back', () => {
            resetCalls(dir);
            const r = run(dir, ['restore-session'], ['y']);
            assert.strictEqual(r.status, 0, r.output);
            assert.ok(calls(dir).some(c => c.includes('restoreSession')), calls(dir).join(' | '));
        });

        await test('`status` shows the mode and numbers so a typo is visible', () => {
            const r = run(dir, ['status'], null);
            assert.match(r.output, /Mode:\s+docker/);
            assert.match(r.output, /Owner number:\s+6282222222222/);
            assert.match(r.output, /Pairing number:\s+6287712345678/);
            assert.match(r.output, /Login method:\s+code/);
        });

        await test('Waiting for the bot relays "no answer from WhatsApp" and gives up with a hint', () => {
            put(dir, 'logs.txt', [
                '⚙️ Command system initialized',
                '⚙️ No answer from WhatsApp after 45s. Check that this server can reach the internet.',
                '⚙️ Disconnected (408: no answer from WhatsApp) — Reconnecting in 3s.'
            ].join('\n') + '\n');
            put(dir, 'state.txt', 'running\n');
            const r = run(dir, ['relink', '-y'], null, { HAMBOT_WAIT_TRIES: '2' });
            assert.strictEqual(r.status, 0, r.output);
            assert.strictEqual((r.output.match(/No answer from WhatsApp after/g) || []).length, 2, 'relayed once, then shown again in the final log tail');
            assert.match(r.output, /can't reach WhatsApp.*firewall/);
            assert.match(r.output, /deploy\.sh logs/);
            del(dir, 'state.txt');
        });

        await test('Waiting for the bot stops early when the container crashed', () => {
            put(dir, 'logs.txt', '❌ [bot-startup] BOT_OWNER_ID is not set\n');
            put(dir, 'state.txt', 'restarting\n');
            const started = Date.now();
            const r = run(dir, ['relink', '-y'], null);
            assert.notStrictEqual(r.status, 0, 'a crashed bot is a failed setup');
            assert.ok(Date.now() - started < 20000, 'does not sit out the full 2 minutes');
            assert.match(r.output, /container is restarting/);
            assert.match(r.output, /BOT_OWNER_ID is not set/);
            assert.match(r.output, /deploy\.sh doctor/);
            del(dir, 'logs.txt');
            del(dir, 'state.txt');
        });

        await test('Unknown commands fail with a hint, and a typo gets a suggestion', () => {
            let r = run(dir, ['bogus'], null);
            assert.notStrictEqual(r.status, 0);
            assert.match(r.output, /deploy\.sh help/);
            r = run(dir, ['statsu'], null);
            assert.notStrictEqual(r.status, 0);
            assert.match(r.output, /Did you mean: \.\/deploy\.sh status/);
        });

        await test('An older .env without DEPLOY_MODE still means Docker', () => {
            const env = fs.readFileSync(path.join(dir, '.env'), 'utf8').split('\n').filter(l => !l.startsWith('DEPLOY_MODE=')).join('\n');
            put(dir, '.env', env);
            const r = run(dir, ['status'], null);
            assert.match(r.output, /Mode:\s+docker/);
            resetCalls(dir);
            assert.strictEqual(run(dir, ['update'], null).status, 0);
            assert.ok(calls(dir).includes('compose pull hambot'), calls(dir).join(' | '));
            assert.ok(!calls(dir, 'pm2').some(c => /^(start|stop|delete)/.test(c)), 'Local is only looked at, never started or stopped');
        });

        await test('Setup while the bot already runs says so and starts no second copy', () => {
            put(dir, 'state.txt', 'running\n');
            resetCalls(dir);
            const r = run(dir, [], null);
            assert.strictEqual(r.status, 0, r.output);
            assert.match(r.output, /already running/);
            assert.ok(!calls(dir).some(c => c.startsWith('compose up')), calls(dir).join(' | '));
            del(dir, 'state.txt');
        });

        await test('A failing image pull is tried 3 times, then built locally', () => {
            put(dir, 'pull-fails');
            resetCalls(dir);
            const r = run(dir, ['update'], null);
            assert.strictEqual(r.status, 0, r.output);
            assert.strictEqual(calls(dir).filter(c => c === 'compose pull hambot').length, 3);
            assert.ok(calls(dir).includes('compose up -d --build hambot'));
        });

        await test('Pull and build both failing ends with one clear message, not a loop', () => {
            put(dir, 'build-fails');
            const r = run(dir, ['update'], null);
            assert.notStrictEqual(r.status, 0);
            assert.match(r.output, /neither be downloaded nor built/);
            assert.match(r.output, /deploy\.sh doctor/);
            del(dir, 'pull-fails');
            del(dir, 'build-fails');
        });

        await test('An invalid DEPLOY_MODE is reported instead of guessed', () => {
            fs.appendFileSync(path.join(dir, '.env'), 'DEPLOY_MODE=dockr\n');
            const r = run(dir, ['update'], null);
            assert.notStrictEqual(r.status, 0);
            assert.match(r.output, /DEPLOY_MODE=dockr/);
            put(dir, '.env', fs.readFileSync(path.join(dir, '.env'), 'utf8').replace('DEPLOY_MODE=dockr\n', 'DEPLOY_MODE=docker\n'));
        });

        await test('A second deploy.sh refuses while one runs; a stale lock is taken over', () => {
            fs.mkdirSync(path.join(dir, '.deploy.lock'));
            put(dir, '.deploy.lock/pid', `${process.pid}\n`); // alive: this test runner
            let r = run(dir, ['update'], null);
            assert.notStrictEqual(r.status, 0);
            assert.match(r.output, /already running \(pid/);
            assert.ok(has(dir, '.deploy.lock'), "another run's lock is left alone");
            put(dir, '.deploy.lock/pid', '999999\n'); // dead
            r = run(dir, ['update'], null);
            assert.strictEqual(r.status, 0, r.output);
            assert.deepStrictEqual(leftovers(dir), []);
        });

        if (process.getuid && process.getuid() !== 0) {
            await test('A .env you cannot write (made with sudo) gets the chown fix', () => {
                fs.chmodSync(path.join(dir, '.env'), 0o400);
                const r = run(dir, ['config'], ['']);
                assert.notStrictEqual(r.status, 0);
                assert.match(r.output, /sudo chown .* \.env/);
                fs.chmodSync(path.join(dir, '.env'), 0o600);
            });
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }

    // ── Questions never loop ──────────────────────────────────────────
    console.log('\n🔁 Questions never loop...\n');

    await test('Input that ends mid-question stops at once (dropped SSH, closed terminal)', () => {
        const d = sandbox();
        try {
            // Mode answered, then input ends before the owner number.
            const r = run(d, [], [''], {}, 10000);
            assert.strictEqual(r.status, 1, r.output);
            assert.match(r.output, /Input ended before an answer/);
            assert.ok(!(r.output.match(/This one is required/g) || []).length, 'no repeated prompt');
            assert.deepStrictEqual(leftovers(d), []);
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await test('Endless wrong answers give up after 5 tries', () => {
        const d = sandbox();
        try {
            const r = run(d, [], ['', ...Array(50).fill('0812')], {}, 10000);
            assert.strictEqual(r.status, 1, r.output);
            assert.strictEqual((r.output.match(/leading 0/g) || []).length, 5);
            assert.match(r.output, /No valid number after 5 tries/);
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await test('A wrong answer to "Docker or Local?" is asked again, at most 5 times', () => {
        const d = sandbox();
        try {
            const r = run(d, [], Array(9).fill('x'), {}, 10000);
            assert.strictEqual(r.status, 1, r.output);
            assert.strictEqual((r.output.match(/Type D for Docker or L for Local/g) || []).length, 5);
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await test('No terminal at all: setup takes --owner instead of asking', () => {
        const d = sandbox();
        try {
            let r = run(d, ['--docker'], null);
            assert.strictEqual(r.status, 0, r.output);
            assert.match(r.output, /--owner/);
            del(d, '.env');
            r = run(d, ['--docker', '--owner', '+62 812-0000-0003', '--pairing', '6281200000004'], null);
            assert.strictEqual(r.status, 0, r.output);
            assert.strictEqual(envValue(d, 'BOT_OWNER_ID'), '6281200000003');
            assert.strictEqual(envValue(d, 'PAIRING_NUMBER'), '6281200000004');
            del(d, '.env');
            r = run(d, ['--docker'], null, { BOT_OWNER_ID: '6281200000005' });
            assert.strictEqual(r.status, 0, r.output);
            assert.strictEqual(envValue(d, 'BOT_OWNER_ID'), '6281200000005', 'an exported BOT_OWNER_ID works too');
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await test('Ctrl+C at a prompt exits cleanly, leaving no lock or temp files', async () => {
        const d = sandbox();
        try {
            // Its own process group, so the signal reaches the whole group the
            // way Ctrl+C in a terminal does (the prompt runs in a subshell).
            const child = spawn('./deploy.sh', [], { cwd: d, env: baseEnv(d, { HAMBOT_TTY: 'stdin' }), detached: true });
            let out = '';
            child.stdout.on('data', c => { out += c; });
            child.stderr.on('data', c => { out += c; });
            const deadline = Date.now() + 10000;
            while (!/Docker or Local\?/.test(out) && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
            assert.ok(has(d, '.deploy.lock'), 'holds the lock while it runs');
            process.kill(-child.pid, 'SIGINT');
            const code = await new Promise(resolve => child.on('exit', (c, s) => resolve(c ?? s)));
            assert.strictEqual(code, 130, out);
            assert.match(out, /run \.\/deploy\.sh again to continue/);
            assert.deepStrictEqual(leftovers(d), []);
            assert.ok(!has(d, '.env'), 'nothing half-written');
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await test('Docker not usable: the reason is named and Local is offered', () => {
        const d = sandbox();
        try {
            put(d, 'docker-info-fails');
            let r = run(d, [], null);
            assert.notStrictEqual(r.status, 0);
            assert.match(r.output, /daemon is not running|may not use Docker|Docker Desktop is not running/);
            assert.match(r.output, /--local/);
            r = run(d, [], ['n']);
            assert.match(r.output, /Install HamBot locally instead/);
            assert.notStrictEqual(r.status, 0);
            assert.deepStrictEqual(calls(d, 'pm2'), [], 'declining Local installs nothing');
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await test('No Docker at all: answering yes installs locally', () => {
        const d = sandbox({ without: ['docker'] });
        try {
            const r = run(d, [], ['', '6281200000006', 'y', '']);
            assert.strictEqual(r.status, 0, r.output);
            assert.match(r.output, /Docker is not installed/);
            assert.strictEqual(envValue(d, 'DEPLOY_MODE'), 'local');
            assert.ok(calls(d, 'pm2').some(c => c.startsWith('start ecosystem.config.cjs')), calls(d, 'pm2').join(' | '));
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    // ── Local mode ───────────────────────────────────────────────────
    console.log('\n💻 Local mode...\n');

    await test('Local setup: packages, yt-dlp in a venv (pinned), pm2, reboot hint, connected', () => {
        const d = sandbox();
        try {
            const r = run(d, [], ['l', '6281200000007', 'y', '']);
            assert.strictEqual(r.status, 0, r.output);
            assert.strictEqual(envValue(d, 'DEPLOY_MODE'), 'local');
            assert.ok(calls(d, 'npm').some(c => c.startsWith('ci --omit=dev')), calls(d, 'npm').join(' | '));
            assert.ok(calls(d, 'python').includes('-m venv .venv'));
            assert.ok(calls(d, 'pip').some(c => c.endsWith(`yt-dlp==${YTDLP_PIN}`)), calls(d, 'pip').join(' | '));
            assert.strictEqual(envValue(d, 'YTDLP_PYTHON'), '.venv/bin/python');
            const pm2 = calls(d, 'pm2');
            assert.ok(pm2.includes('start ecosystem.config.cjs') && pm2.includes('save'), pm2.join(' | '));
            assert.match(r.output, /sudo env PATH=.*pm2 startup systemd/, 'the one sudo line for reboots is shown');
            assert.match(r.output, /Connected to WhatsApp/);
            assert.ok(!calls(d).some(c => /^compose (up|stop|down|pull|run)/.test(c)), 'Docker is only looked at in Local mode: ' + calls(d).join(' | '));
            assert.deepStrictEqual(leftovers(d), []);
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await test('Local re-run while online starts no second copy; update skips what is current', () => {
        const d = localSandbox();
        try {
            let r = run(d, ['--local'], null);
            assert.match(r.output, /already running \(local\)/);
            assert.ok(!calls(d, 'pm2').some(c => c.startsWith('start')), calls(d, 'pm2').join(' | '));
            resetCalls(d);
            r = run(d, ['update'], null);
            assert.strictEqual(r.status, 0, r.output);
            assert.ok(!calls(d, 'npm').some(c => c.startsWith('ci')), 'lockfile unchanged: no reinstall');
            assert.deepStrictEqual(calls(d, 'pip'), [], 'yt-dlp already at the pin');
            assert.ok(calls(d, 'pm2').some(c => c.startsWith('start')), 'restarted with the new files');
            fs.appendFileSync(path.join(d, 'package-lock.json'), '\n');
            resetCalls(d);
            run(d, ['update'], null);
            assert.ok(calls(d, 'npm').some(c => c.startsWith('ci')), 'a changed lockfile reinstalls');
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await test('Node too old: stops with the nvm fix, before installing anything', () => {
        const d = sandbox();
        try {
            writeExec(path.join(d, 'bin', 'node'), ['#!/bin/sh', '[ "$1" = -v ] && { echo v18.19.0; exit 0; }', `exec ${process.execPath} "$@"`]);
            const r = run(d, ['--local', '--owner', '6281200000008'], null);
            assert.notStrictEqual(r.status, 0);
            assert.match(r.output, /Node\.js 22\.12 or newer is needed \(found: v18\.19\.0\)/);
            assert.match(r.output, /nvm install 24/);
            assert.deepStrictEqual(calls(d, 'npm'), []);
            assert.deepStrictEqual(calls(d, 'pm2'), []);
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await test('nvm installed but not loaded: it is loaded automatically', () => {
        const d = sandbox();
        try {
            const good = path.join(d, 'goodnode');
            fs.mkdirSync(good);
            fs.symlinkSync(process.execPath, path.join(good, 'node'));
            writeExec(path.join(d, 'bin', 'node'), ['#!/bin/sh', '[ "$1" = -v ] && { echo v18.19.0; exit 0; }', `exec ${process.execPath} "$@"`]);
            fs.mkdirSync(path.join(d, 'home', '.nvm'));
            put(d, 'home/.nvm/nvm.sh', `PATH="${good}:$PATH"; export PATH\n`);
            const r = run(d, ['--local', '--owner', '6281200000009'], null);
            assert.strictEqual(r.status, 0, r.output);
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await test('ffmpeg missing: a warning naming the affected commands, setup continues', () => {
        const d = sandbox({ without: ['ffmpeg'] });
        try {
            const r = run(d, ['--local', '--owner', '6281200000010'], null);
            assert.strictEqual(r.status, 0, r.output);
            assert.match(r.output, /ffmpeg is missing, so \.say and \.toimg will not work/);
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await test('Deno missing: installed for the user from the pinned version', () => {
        const d = sandbox({ without: ['deno'] });
        try {
            const r = run(d, ['--local', '--owner', '6281200000011'], null);
            assert.strictEqual(r.status, 0, r.output);
            const pin = dockerfile.match(/^FROM denoland\/deno:bin-([0-9.]+)/m)[1];
            assert.ok(calls(d, 'deno-install').some(c => c.includes(`v${pin}`) && c.includes('--no-modify-path')), calls(d, 'deno-install').join(' | '));
            assert.ok(has(d, 'home/.deno/bin/deno'));
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await test('Deno download failing: retried 3 times, then a warning; setup continues', () => {
        const d = sandbox({ without: ['deno'] });
        try {
            put(d, 'curl-fails');
            const r = run(d, ['--local', '--owner', '6281200000012'], null);
            assert.strictEqual(r.status, 0, r.output);
            assert.strictEqual(calls(d, 'curl').length, 3);
            assert.match(r.output, /Deno did not install/);
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await test('python3-venv missing: the apt package is named; media off, bot still starts', () => {
        const d = sandbox();
        try {
            put(d, 'venv-fails');
            const r = run(d, ['--local', '--owner', '6281200000013'], null);
            assert.strictEqual(r.status, 0, r.output);
            assert.match(r.output, /venv module is missing/);
            assert.match(r.output, /\.video and \.music will not work/);
            assert.strictEqual(envValue(d, 'YTDLP_PYTHON'), undefined, 'not pointed at a venv that does not exist');
            assert.ok(!has(d, '.venv'), 'no half-made venv left behind');
            assert.ok(calls(d, 'pm2').some(c => c.startsWith('start')));
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await test('pip failing twice then working: 3 attempts, yt-dlp installed', () => {
        const d = sandbox();
        try {
            put(d, 'pip-fails', '2');
            const r = run(d, ['--local', '--owner', '6281200000014'], null);
            assert.strictEqual(r.status, 0, r.output);
            assert.strictEqual(calls(d, 'pip').length, 3);
            assert.strictEqual(envValue(d, 'YTDLP_PYTHON'), '.venv/bin/python');
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await test('pip failing for good: 3 attempts, a warning, the bot still starts', () => {
        const d = sandbox();
        try {
            put(d, 'pip-fails', '99');
            const r = run(d, ['--local', '--owner', '6281200000015'], null);
            assert.strictEqual(r.status, 0, r.output);
            assert.strictEqual(calls(d, 'pip').length, 3);
            assert.match(r.output, /will not work until yt-dlp installs/);
            assert.ok(calls(d, 'pm2').some(c => c.startsWith('start')));
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await test('npm ci failing twice then working: setup completes', () => {
        const d = sandbox();
        try {
            put(d, 'npm-fails', '2');
            const r = run(d, ['--local', '--owner', '6281200000016'], null);
            assert.strictEqual(r.status, 0, r.output);
            assert.strictEqual(calls(d, 'npm').filter(c => c.startsWith('ci')).length, 3);
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await test('npm ci failing for good: stops after 3 tries without starting a broken bot', () => {
        const d = sandbox();
        try {
            put(d, 'npm-fails', '99');
            const r = run(d, ['--local', '--owner', '6281200000017'], null);
            assert.notStrictEqual(r.status, 0);
            assert.strictEqual(calls(d, 'npm').filter(c => c.startsWith('ci')).length, 3);
            assert.match(r.output, /failed 3 times/);
            assert.match(r.output, /deploy\.sh doctor/);
            assert.deepStrictEqual(calls(d, 'pm2'), []);
            // Run again once the network is back: it continues.
            del(d, 'npm-fails');
            assert.strictEqual(run(d, ['--local'], null).status, 0);
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await test('Disk full: said plainly, not retried', () => {
        const d = sandbox();
        try {
            put(d, 'npm-fails', '99');
            put(d, 'npm-enospc');
            const r = run(d, ['--local', '--owner', '6281200000018'], null);
            assert.notStrictEqual(r.status, 0);
            assert.strictEqual(calls(d, 'npm').filter(c => c.startsWith('ci')).length, 1);
            assert.match(r.output, /the disk is full/);
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await test('pm2 missing and no permission for a global install: installed for the user', () => {
        const d = sandbox({ without: ['pm2'] });
        try {
            put(d, 'npm-global-eacces');
            const r = run(d, ['--local', '--owner', '6281200000019'], null);
            assert.strictEqual(r.status, 0, r.output);
            assert.ok(calls(d, 'npm').some(c => c.includes('--prefix') && c.endsWith('pm2')), calls(d, 'npm').join(' | '));
            assert.ok(has(d, 'home/.local/bin/pm2'));
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await test('Running as root: warned; answering no changes nothing', () => {
        const d = sandbox();
        try {
            let r = run(d, ['--local', '--owner', '6281200000020'], ['n'], { HAMBOT_TEST_UID: '0' });
            assert.notStrictEqual(r.status, 0);
            assert.match(r.output, /Running as root/);
            assert.deepStrictEqual(calls(d, 'npm'), []);
            r = run(d, ['--local', '--owner', '6281200000020'], null, { HAMBOT_TEST_UID: '0' });
            assert.strictEqual(r.status, 0, 'without a terminal it warns and continues');
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await test('A bot that errors under pm2 stops the wait early, with its log lines', () => {
        const d = sandbox();
        try {
            put(d, 'pm2-next-state.txt', 'errored\n');
            put(d, 'botlog.txt', '❌ [bot-startup] BOT_OWNER_ID is not set\n');
            const started = Date.now();
            const r = run(d, ['--local', '--owner', '6281200000021'], null);
            assert.notStrictEqual(r.status, 0);
            assert.ok(Date.now() - started < 20000);
            assert.match(r.output, /The bot is exited \(pm2\)/);
            assert.match(r.output, /BOT_OWNER_ID is not set/);
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await test('A crash loop (pm2 "waiting restart") is reported, not waited out', () => {
        const d = sandbox();
        try {
            put(d, 'pm2-next-state.txt', 'waiting restart\n');
            put(d, 'botlog.txt', '❌ Cannot find module "sharp"\n');
            const r = run(d, ['--local', '--owner', '6281200000022'], null);
            assert.notStrictEqual(r.status, 0);
            assert.match(r.output, /The bot is restarting \(pm2\)/);
            assert.match(r.output, /Cannot find module/);
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await test('Old log lines never count as a fresh "connected"', () => {
        const d = sandbox();
        try {
            fs.mkdirSync(path.join(d, 'home', '.pm2', 'logs'), { recursive: true });
            put(d, 'home/.pm2/logs/hambot-out.log', '✅ HamBot connected to WhatsApp!\n');
            put(d, 'botlog.txt', '⚙️ Command system initialized\n');
            const r = run(d, ['--local', '--owner', '6281200000023'], null, { HAMBOT_WAIT_TRIES: '1' });
            assert.doesNotMatch(r.output, /Connected to WhatsApp/);
            assert.match(r.output, /No pairing code, QR or connection/);
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await test('Local relink archives the session, restore puts it back, stop stops pm2', () => {
        const d = localSandbox();
        try {
            fs.mkdirSync(path.join(d, 'auth_info_baileys'), { recursive: true });
            put(d, 'auth_info_baileys/creds.json', '{"me":1}');
            let r = run(d, ['relink', '--qr', '-y'], null);
            assert.strictEqual(r.status, 0, r.output);
            assert.ok(!has(d, 'auth_info_baileys/creds.json'), 'moved aside');
            assert.ok(fs.readdirSync(path.join(d, 'auth_info_baileys', '.archive')).length === 1);
            assert.strictEqual(envValue(d, 'LOGIN_METHOD'), 'qr');
            const pm2 = calls(d, 'pm2');
            assert.ok(pm2.indexOf(`stop hambot`) < pm2.lastIndexOf('start ecosystem.config.cjs'), pm2.join(' | '));
            r = run(d, ['restore-session', '-y'], null);
            assert.strictEqual(r.status, 0, r.output);
            assert.ok(has(d, 'auth_info_baileys/creds.json'), 'restored');
            resetCalls(d);
            r = run(d, ['stop'], null);
            assert.strictEqual(r.status, 0, r.output);
            assert.ok(calls(d, 'pm2').includes('stop hambot'));
            assert.ok(!calls(d).some(c => /^compose (up|stop|down|pull|run)/.test(c)), calls(d).join(' | '));
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await test('Local status and doctor: pm2 state, reboot warning, fixes listed', () => {
        const d = localSandbox();
        try {
            let r = run(d, ['status'], null);
            assert.match(r.output, /Mode:\s+local/);
            assert.match(r.output, /pm2:\s+online \(restarts: 0\)/);
            assert.match(r.output, /won't start by itself/);
            r = run(d, ['doctor'], null);
            assert.strictEqual(r.status, 1, 'something to fix: the reboot step');
            assert.match(r.output, /ok\s+owner number: 6281200000001/);
            assert.match(r.output, /ok\s+pm2: the bot is online/);
            assert.match(r.output, new RegExp(`ok\\s+yt-dlp ${YTDLP_PIN.replace(/\./g, '\\.')}`));
            assert.match(r.output, /FIX\s+won't start after a reboot/);
            r = run(d, ['doctor'], null, { HAMBOT_ASSUME_STARTUP: '1' });
            assert.strictEqual(r.status, 0, r.output);
            assert.match(r.output, /All good/);
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await test('Two copies (Docker and Local) are spotted and the fix is named', () => {
        const d = localSandbox();
        try {
            put(d, 'state.txt', 'running\n'); // the Docker container is up too
            let r = run(d, ['status'], null);
            assert.match(r.output, /Two copies of the bot are running/);
            assert.match(r.output, /docker compose stop hambot/);
            r = run(d, ['doctor'], null, { HAMBOT_ASSUME_STARTUP: '1' });
            assert.match(r.output, /FIX\s+two copies are running/);
            run(d, ['stop'], null);
            r = run(d, ['--local'], null);
            assert.notStrictEqual(r.status, 0);
            assert.match(r.output, /switch local/);
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    // ── Switching modes ───────────────────────────────────────────────
    console.log('\n🔀 Switching modes...\n');

    await test('switch local: the session comes out of Docker; no relinking', () => {
        const d = sandbox();
        try {
            assert.strictEqual(run(d, ['--docker', '--owner', '6281200000024'], null).status, 0);
            const src = path.join(d, 'src-session');
            fs.mkdirSync(src);
            fs.writeFileSync(path.join(src, 'creds.json'), '{"me":"docker"}');
            spawnSync('tar', ['-C', src, '-cf', path.join(d, 'session.tar'), '.']);
            resetCalls(d);
            const r = run(d, ['switch', 'local', '-y'], null);
            assert.strictEqual(r.status, 0, r.output);
            assert.strictEqual(fs.readFileSync(path.join(d, 'auth_info_baileys', 'creds.json'), 'utf8'), '{"me":"docker"}');
            assert.match(r.output, /Session moved; no need to link again/);
            assert.strictEqual(envValue(d, 'DEPLOY_MODE'), 'local');
            const docker = calls(d);
            assert.ok(docker.includes('compose stop hambot'), docker.join(' | '));
            assert.ok(calls(d, 'pm2').some(c => c.startsWith('start')));
            assert.deepStrictEqual(leftovers(d), []);
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await test('switch docker: the session goes into Docker and is archived locally', () => {
        const d = localSandbox();
        try {
            fs.mkdirSync(path.join(d, 'auth_info_baileys'), { recursive: true });
            put(d, 'auth_info_baileys/creds.json', '{"me":"local"}');
            const r = run(d, ['switch', 'docker', '-y'], null);
            assert.strictEqual(r.status, 0, r.output);
            const listing = spawnSync('tar', ['-tf', path.join(d, 'received.tar')], { encoding: 'utf8' }).stdout;
            assert.match(listing, /creds\.json/);
            assert.ok(!has(d, 'auth_info_baileys/creds.json'), 'active in one place only');
            assert.strictEqual(envValue(d, 'DEPLOY_MODE'), 'docker');
            assert.ok(calls(d, 'pm2').includes('stop hambot'));
            assert.ok(calls(d).includes('compose up -d --no-build hambot'));
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await test('A switch that fails halfway restarts the old bot and changes nothing', () => {
        const d = sandbox();
        try {
            assert.strictEqual(run(d, ['--docker', '--owner', '6281200000025'], null).status, 0);
            put(d, 'tar-out-fails');
            resetCalls(d);
            const r = run(d, ['switch', 'local', '-y'], null);
            assert.notStrictEqual(r.status, 0);
            assert.match(r.output, /nothing changed/i);
            assert.strictEqual(envValue(d, 'DEPLOY_MODE'), 'docker');
            assert.ok(calls(d).includes('compose up -d --no-build --force-recreate hambot'), 'the Docker bot runs again');
            assert.ok(!has(d, 'auth_info_baileys'));
            assert.deepStrictEqual(leftovers(d), []);
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    // ── One-line installer ───────────────────────────────────────────
    console.log('\n📥 One-line installer...\n');

    const INSTALLER = path.join(ROOT, 'scripts', 'install.sh');
    /** `cat install.sh | sh -s -- args`, run in <sandbox>/work. */
    function install(d, args, extraEnv = {}) {
        const work = path.join(d, 'work');
        fs.mkdirSync(work, { recursive: true });
        const r = spawnSync('sh', ['-c', `cat ${JSON.stringify(INSTALLER)} | sh -s -- ${args.join(' ')}`], {
            cwd: work, env: baseEnv(d, { HAMBOT_TTY: 'none', ...extraEnv }), encoding: 'utf8', timeout: 60000
        });
        return { status: r.status, output: (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, ''), work };
    }

    await test('curl | sh: downloads HamBot and hands over to deploy.sh with the flags', () => {
        const d = sandbox();
        try {
            const r = install(d, ['--docker', '--owner', '6281200000026']);
            assert.strictEqual(r.status, 0, r.output);
            assert.ok(calls(d, 'git').some(c => c.startsWith('clone --depth 1 https://github.com/AkilixCode/hambot-wa-bot.git hambot-wa-bot')));
            assert.strictEqual(envValue(path.join(r.work, 'hambot-wa-bot'), 'BOT_OWNER_ID'), '6281200000026');
            assert.ok(calls(d).includes('compose up -d --no-build hambot'));
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await test('Run again over an existing download: updates it instead of failing', () => {
        const d = sandbox();
        try {
            assert.strictEqual(install(d, ['--docker', '--owner', '6281200000027']).status, 0);
            resetCalls(d);
            const r = install(d, ['--docker']);
            assert.strictEqual(r.status, 0, r.output);
            assert.ok(calls(d, 'git').includes('-C hambot-wa-bot pull --ff-only'), calls(d, 'git').join(' | '));
            assert.ok(!calls(d, 'git').some(c => c.startsWith('clone')));
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await test('A folder in the way is never overwritten', () => {
        const d = sandbox();
        try {
            fs.mkdirSync(path.join(d, 'work', 'hambot-wa-bot'), { recursive: true });
            fs.writeFileSync(path.join(d, 'work', 'hambot-wa-bot', 'mine.txt'), 'keep');
            const r = install(d, ['--docker']);
            assert.notStrictEqual(r.status, 0);
            assert.match(r.output, /not a HamBot download.*HAMBOT_DIR/);
            assert.ok(fs.existsSync(path.join(d, 'work', 'hambot-wa-bot', 'mine.txt')));
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await test('A failing download: 3 tries, a clear message, no half-made folder', () => {
        const d = sandbox();
        try {
            put(d, 'git-fails');
            const r = install(d, ['--docker']);
            assert.notStrictEqual(r.status, 0);
            assert.strictEqual(calls(d, 'git').filter(c => c.startsWith('clone')).length, 3);
            assert.match(r.output, /Download failed 3 times/);
            assert.ok(!fs.existsSync(path.join(d, 'work', 'hambot-wa-bot')));
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    // A real pseudo-terminal needs util-linux `script` (Linux); macOS's BSD
    // `script` cannot be driven reliably without a terminal of its own.
    const scriptCmd = which('script');
    if (scriptCmd && process.platform === 'linux' && spawnSync(scriptCmd, ['--version']).status === 0) {
        await test('curl | sh in a real terminal: questions are read from the terminal, not the pipe', () => {
            const d = sandbox();
            try {
                const work = path.join(d, 'work');
                fs.mkdirSync(work);
                const env = baseEnv(d);
                const r = spawnSync(scriptCmd, ['-qec', `cat ${JSON.stringify(INSTALLER)} | sh -s -- --docker`, '/dev/null'], {
                    cwd: work, env, encoding: 'utf8', timeout: 60000,
                    input: ['6281200000028', 'y', ''].map(l => l + '\n').join('')
                });
                const out = String(r.stdout) + String(r.stderr);
                assert.strictEqual(r.status, 0, out);
                assert.strictEqual(envValue(path.join(work, 'hambot-wa-bot'), 'BOT_OWNER_ID'), '6281200000028', out);
            } finally { fs.rmSync(d, { recursive: true, force: true }); }
        });
    }

    console.log('\n' + '='.repeat(60));
    console.log(`✅ Tests Passed: ${passed}`);
    console.log(`❌ Tests Failed: ${failed}`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('Test runner crashed:', err);
    process.exit(1);
});
