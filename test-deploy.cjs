/**
 * deploy.sh Tests
 *
 * Runs deploy.sh in a sandbox against a fake `docker` that records every
 * call, under a pseudo-terminal (`script`) so the interactive prompts behave
 * as they do for a person. Covers the recovery paths: a mistyped number,
 * fixing numbers afterwards, relinking, and undoing a relink.
 *
 *   npm run test:deploy
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let passed = 0;
let failed = 0;
let skipped = false;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`✅ PASS: ${name}`);
    } catch (err) {
        failed++;
        console.log(`❌ FAIL: ${name}\n   ${err.message}`);
    }
}

const REPO = __dirname;
const hasScript = spawnSync('script', ['--version']).status === 0;

/** Fresh sandbox with deploy.sh, .env.example and a recording fake docker. */
function sandbox() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hambot-deploy-'));
    fs.copyFileSync(path.join(REPO, 'deploy.sh'), path.join(dir, 'deploy.sh'));
    fs.chmodSync(path.join(dir, 'deploy.sh'), 0o755);
    fs.copyFileSync(path.join(REPO, '.env.example'), path.join(dir, '.env.example'));
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.writeFileSync(path.join(dir, 'bin', 'docker'), [
        '#!/bin/sh',
        'printf "%s\\n" "$*" >> "$(dirname "$0")/../docker.calls"',
        'here="$(dirname "$0")/.."',
        'case "$*" in',
        // Tests can script the bot's log and container state with files.
        '  "compose logs --no-log-prefix hambot") if [ -f "$here/logs.txt" ]; then cat "$here/logs.txt"; else echo "✅ HamBot connected to WhatsApp!"; fi ;;',
        '  "compose logs --no-log-prefix --tail 25 hambot") cat "$here/logs.txt" 2>/dev/null ;;',
        '  compose\\ ps*) cat "$here/state.txt" 2>/dev/null ;;',
        'esac',
        'exit 0',
        ''
    ].join('\n'));
    fs.chmodSync(path.join(dir, 'bin', 'docker'), 0o755);
    return dir;
}

/**
 * Run deploy.sh with typed input.
 * @param {string} dir Sandbox
 * @param {string[]} args
 * @param {string[]|null} lines Lines typed at the prompts; null = no terminal
 */
function run(dir, args, lines, extraEnv = {}) {
    const env = { ...process.env, PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`, ...extraEnv };
    const command = ['./deploy.sh', ...args].join(' ');
    const result = lines === null
        ? spawnSync('sh', ['-c', `${command} </dev/null`], { cwd: dir, env, encoding: 'utf8' })
        : spawnSync('script', ['-qec', command, '/dev/null'], { cwd: dir, env, encoding: 'utf8', input: lines.join('\n') + '\n' });
    return {
        status: result.status,
        output: (result.stdout + result.stderr).replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '')
    };
}

const envValue = (dir, key) => {
    const line = fs.readFileSync(path.join(dir, '.env'), 'utf8').split('\n').filter(l => l.startsWith(`${key}=`)).pop();
    return line === undefined ? undefined : line.slice(key.length + 1);
};
const calls = (dir) => {
    const file = path.join(dir, 'docker.calls');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n') : [];
};
const resetCalls = (dir) => fs.rmSync(path.join(dir, 'docker.calls'), { force: true });

console.log('\n🧪 DEPLOY.SH TESTS\n' + '='.repeat(60) + '\n');

if (!hasScript) {
    skipped = true;
    console.log('⏭️  `script` (util-linux) not available — skipping interactive deploy tests.');
} else {
    const dir = sandbox();
    try {
        test('Setup rejects a leading 0 and lets you take back a misclicked number', () => {
            const r = run(dir, [], [
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
            assert.strictEqual((fs.statSync(path.join(dir, '.env')).mode & 0o777).toString(8), '600');
            assert.ok(calls(dir).includes('compose up -d --no-build hambot'));
        });

        test('Running setup again keeps .env and points at `config`', () => {
            const r = run(dir, [], []);
            assert.match(r.output, /already exists.*deploy\.sh config/);
            assert.strictEqual(envValue(dir, 'BOT_OWNER_ID'), '6282222222222');
        });

        test('`config` keeps a number on Enter and changes another, then recreates the bot', () => {
            resetCalls(dir);
            const r = run(dir, ['config'], ['', '6289999999999', 'y']);
            assert.strictEqual(r.status, 0, r.output);
            assert.strictEqual(envValue(dir, 'BOT_OWNER_ID'), '6282222222222');
            assert.strictEqual(envValue(dir, 'PAIRING_NUMBER'), '6289999999999');
            assert.ok(calls(dir).includes('compose up -d --no-build --force-recreate hambot'), calls(dir).join(' | '));
            assert.ok(!calls(dir).some(c => c.startsWith('compose run')), 'config must not touch the session');
        });

        test('`config` clears the pairing number with "-" (back to QR)', () => {
            run(dir, ['config'], ['', '-']);
            assert.strictEqual(envValue(dir, 'PAIRING_NUMBER'), '');
        });

        test('`relink --qr -y` archives the session and forces the QR code', () => {
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

        test('`relink --code <number>` sets the pairing number and code mode', () => {
            const r = run(dir, ['relink', '--code', '"6287700000000"', '-y'], null);
            assert.strictEqual(r.status, 0, r.output);
            assert.strictEqual(envValue(dir, 'PAIRING_NUMBER'), '6287700000000');
            assert.strictEqual(envValue(dir, 'LOGIN_METHOD'), 'code');
        });

        test('`relink --code` accepts a number typed with spaces and no quotes', () => {
            // The shell splits this into three arguments, as it would for a person.
            const r = run(dir, ['relink', '--code', '+62', '877-1234-5678', '-y'], null);
            assert.strictEqual(r.status, 0, r.output);
            assert.strictEqual(envValue(dir, 'PAIRING_NUMBER'), '6287712345678');
        });

        test('`relink --code` with a bad number fails before touching anything', () => {
            resetCalls(dir);
            const r = run(dir, ['relink', '--code', '0812345', '-y'], null);
            assert.notStrictEqual(r.status, 0);
            assert.ok(!calls(dir).some(c => c.includes('stop') || c.includes('compose run')), calls(dir).join(' | '));
        });

        test('`relink` without a terminal refuses unless -y is given', () => {
            resetCalls(dir);
            const r = run(dir, ['relink'], null);
            assert.notStrictEqual(r.status, 0);
            assert.match(r.output, /-y/);
            assert.ok(!calls(dir).some(c => c.includes('compose run')));
        });

        test('`relink` answered "no" changes nothing', () => {
            resetCalls(dir);
            run(dir, ['relink'], ['n']);
            assert.ok(!calls(dir).some(c => c.includes('stop') || c.includes('compose run')));
        });

        test('`restore-session` puts the archived session back', () => {
            resetCalls(dir);
            const r = run(dir, ['restore-session'], ['y']);
            assert.strictEqual(r.status, 0, r.output);
            assert.ok(calls(dir).some(c => c.includes('restoreSession')), calls(dir).join(' | '));
        });

        test('`status` shows the numbers so a typo is visible', () => {
            const r = run(dir, ['status'], null);
            assert.match(r.output, /Owner number:\s+6282222222222/);
            assert.match(r.output, /Pairing number:\s+6287712345678/);
            assert.match(r.output, /Login method:\s+code/);
        });

        test('Waiting for the bot relays "no answer from WhatsApp" and gives up with a hint', () => {
            fs.writeFileSync(path.join(dir, 'logs.txt'), [
                '⚙️ Command system initialized',
                '⚙️ No answer from WhatsApp after 45s. Check that this server can reach the internet.',
                '⚙️ Disconnected (408: no answer from WhatsApp) — Reconnecting in 3s.'
            ].join('\n') + '\n');
            fs.writeFileSync(path.join(dir, 'state.txt'), 'running\n');
            const r = run(dir, ['relink', '-y'], null, { HAMBOT_WAIT_TRIES: '2' });
            assert.strictEqual(r.status, 0, r.output);
            assert.strictEqual((r.output.match(/No answer from WhatsApp after/g) || []).length, 2, 'relayed once, then shown again in the final log tail');
            assert.match(r.output, /can't reach WhatsApp.*firewall/);
            assert.match(r.output, /deploy\.sh logs/);
        });

        test('Waiting for the bot stops early when the container crashed', () => {
            fs.writeFileSync(path.join(dir, 'logs.txt'), '❌ [bot-startup] BOT_OWNER_ID is not set\n');
            fs.writeFileSync(path.join(dir, 'state.txt'), 'restarting\n');
            const started = Date.now();
            const r = run(dir, ['relink', '-y'], null);
            assert.notStrictEqual(r.status, 0, 'a crashed bot is a failed setup');
            assert.ok(Date.now() - started < 20000, 'does not sit out the full 2 minutes');
            assert.match(r.output, /container is restarting/);
            assert.match(r.output, /BOT_OWNER_ID is not set/);
            fs.rmSync(path.join(dir, 'logs.txt'));
            fs.rmSync(path.join(dir, 'state.txt'));
        });

        test('Unknown commands fail with a hint', () => {
            const r = run(dir, ['bogus'], null);
            assert.notStrictEqual(r.status, 0);
            assert.match(r.output, /deploy\.sh help/);
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

console.log('\n' + '='.repeat(60));
console.log(`✅ Tests Passed: ${passed}`);
console.log(`❌ Tests Failed: ${failed}${skipped ? ' (interactive tests skipped)' : ''}`);
console.log('='.repeat(60) + '\n');
process.exit(failed > 0 ? 1 : 0);
