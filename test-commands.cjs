/**
 * Command & Handler Regression Tests
 *
 * Drives commands with a fake socket, so no WhatsApp session, network or
 * external binary is needed. Each block pins a bug that was fixed, so it
 * cannot quietly come back. Run with:
 *   npm run test:commands
 */

// Must be set before config.js is first required: one request per window
// makes the rate limiter observable within a couple of messages.
process.env.RATE_LIMIT_MAX = '1';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

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

/**
 * Minimal stand-in for a Baileys socket that records what was sent.
 */
function fakeSock() {
    const sent = [];
    return {
        sent,
        async sendMessage(jid, content) {
            sent.push({ jid, content });
            return { key: { id: String(sent.length) } };
        }
    };
}

function fakeMsg(from, sender) {
    return {
        key: { remoteJid: from, participant: sender, id: 'TEST' },
        message: { conversation: '' }
    };
}

function textMsg(from, sender, text) {
    return {
        key: { remoteJid: from, participant: sender, id: `T${Math.random()}` },
        message: { conversation: text }
    };
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** Text of every non-reaction message sent. */
function texts(sock) {
    return sock.sent.filter(s => s.content.text).map(s => s.content.text);
}

async function main() {
    console.log('\n🧪 COMMAND & HANDLER REGRESSION TESTS\n' + '='.repeat(60));

    // ── Security: no API key over plain HTTP ──────────────────────────
    console.log('\n🔐 Transport...\n');

    await test('OMDB is only ever called over https', () => {
        for (const file of ['commands/movie.js', 'utils/helpers.js']) {
            const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
            assert.ok(!src.includes('http://www.omdbapi.com'), `${file} must not use plain http for OMDB`);
        }
    });

    // ── Reminders ─────────────────────────────────────────────────────
    console.log('\n⏰ Reminders...\n');

    const ReminderCommand = require('./commands/reminder');
    const { activeReminders, MAX_PER_USER } = ReminderCommand;
    const reminder = new ReminderCommand();

    const clearReminders = () => {
        for (const r of activeReminders.values()) clearTimeout(r.timeout);
        activeReminders.clear();
    };

    await test(`A user cannot hold more than ${MAX_PER_USER} reminders`, async () => {
        clearReminders();
        const sock = fakeSock();
        const from = '123@g.us';
        const sender = '628111@s.whatsapp.net';
        const context = { from, sender, commandName: 'reminder' };

        for (let i = 0; i <= MAX_PER_USER; i++) {
            await reminder.execute(sock, fakeMsg(from, sender), ['1h', `tugas ${i}`], context);
        }

        assert.strictEqual(activeReminders.size, MAX_PER_USER, 'extra reminder must be rejected');
        assert.ok(texts(sock).some(t => t.includes('Batas Tercapai')), 'user must be told why');
    });

    await test('Another user is not affected by someone else hitting the cap', async () => {
        const sock = fakeSock();
        const from = '123@g.us';
        const other = '628222@s.whatsapp.net';
        await reminder.execute(sock, fakeMsg(from, other), ['1h', 'punyaku'], { from, sender: other, commandName: 'reminder' });
        assert.strictEqual(activeReminders.size, MAX_PER_USER + 1);
        clearReminders();
    });

    await test('A reminder is delivered through the socket that is live when it fires', async () => {
        clearReminders();
        const socketRef = require('./utils/socket-ref');
        const oldSock = fakeSock();
        const newSock = fakeSock();
        const from = '123@g.us';
        const sender = '628555@s.whatsapp.net';

        // Capture the reminder's callback instead of waiting an hour for it.
        let fire = null;
        const realSetTimeout = global.setTimeout;
        global.setTimeout = (fn) => { fire = fn; return realSetTimeout(() => {}, 0); };
        try {
            await reminder.execute(oldSock, fakeMsg(from, sender), ['1h', 'minum air'], { from, sender, commandName: 'reminder' });
        } finally {
            global.setTimeout = realSetTimeout;
        }
        assert.ok(fire, 'reminder must schedule a timer');

        // Simulate a reconnect, then fire.
        socketRef.set(newSock);
        await fire();

        assert.ok(texts(newSock).some(t => t.includes('minum air')), 'reminder must go out on the new socket');
        assert.ok(!texts(oldSock).some(t => t.includes('minum air') && t.includes('Pengingat') && !t.includes('Dipasang')),
            'reminder must not be sent on the stale socket');
        socketRef.set(null);
        clearReminders();
    });

    // ── Process control ──────────────────────────────────────────────
    console.log('\n🔄 Process control...\n');

    const SecurityCommand = require('./commands/security');
    const securityCmd = new SecurityCommand();

    const waitForFallback = (bin) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('fallback was never called')), 3000);
        securityCmd._runPm2(['restart', 'hambot-test'], () => { clearTimeout(timer); resolve(); }, bin);
    });

    await test('restart falls back when pm2 is not installed', () =>
        waitForFallback('hambot-definitely-not-a-binary'));

    await test('restart falls back when pm2 exits with an error', () =>
        waitForFallback('false'));

    // ── Command parsing ──────────────────────────────────────────────
    console.log('\n🔤 Command parsing...\n');

    const { parseCommand } = require('./handler');

    await test('Parses a plain command with arguments', () => {
        assert.deepStrictEqual(parseCommand('.remind 10m masak mie', '.'),
            { commandName: 'remind', args: ['10m', 'masak', 'mie'] });
    });

    await test('Tolerates a space after the prefix', () => {
        assert.deepStrictEqual(parseCommand('. Menu', '.'), { commandName: 'menu', args: [] });
    });

    await test('Works with a multi-character prefix followed by a space', () => {
        // slice(2) used to turn this into command "! menu".
        assert.deepStrictEqual(parseCommand('hb! menu sticker', 'hb!'),
            { commandName: 'menu', args: ['sticker'] });
    });

    await test('A newline ends the command name', () => {
        assert.deepStrictEqual(parseCommand('.menu\nsticker', '.'),
            { commandName: 'menu', args: ['sticker'] });
    });

    await test('Line breaks inside an argument are preserved', () => {
        assert.deepStrictEqual(parseCommand('.say baris satu\nbaris dua', '.'),
            { commandName: 'say', args: ['baris', 'satu\nbaris', 'dua'] });
    });

    await test('handler.js registers no SIGINT listener of its own', () => {
        assert.strictEqual(process.listenerCount('SIGINT'), 0,
            'a SIGINT listener here pre-empts index.js graceful shutdown');
    });

    // ── Hygiene fixes ────────────────────────────────────────────────
    console.log('\n🧹 Hygiene...\n');

    await test('A title with no poster yields null, not a dead placeholder URL', async () => {
        const { getValidPosterUrl } = require('./utils/helpers');
        assert.strictEqual(await getValidPosterUrl('N/A'), null);
        assert.strictEqual(await getValidPosterUrl(''), null);
    });

    await test('Proxy credentials are URL-encoded', () => {
        const saved = { ...process.env };
        try {
            Object.assign(process.env, {
                PROXY_HOST: '100.64.0.1', PROXY_PORT: '8080', PROXY_TYPE: 'http',
                PROXY_USER: 'me@home', PROXY_PASS: 'p@ss:w/rd'
            });
            delete process.env.HB_PROXY_URL;
            const Config = require('./config').constructor;
            const url = new Config().proxy.url;
            const parsed = new URL(url);
            assert.strictEqual(parsed.hostname, '100.64.0.1');
            assert.strictEqual(decodeURIComponent(parsed.username), 'me@home');
            assert.strictEqual(decodeURIComponent(parsed.password), 'p@ss:w/rd');
        } finally {
            for (const k of ['PROXY_HOST', 'PROXY_PORT', 'PROXY_TYPE', 'PROXY_USER', 'PROXY_PASS']) {
                if (k in saved) process.env[k] = saved[k]; else delete process.env[k];
            }
        }
    });

    await test('Stale security event counters are pruned', () => {
        const security = require('./utils/security');
        security.logSecurityEvent('test_event', { userId: '628666@s.whatsapp.net' });
        const [key] = [...security.securityEvents.keys()].filter(k => k.startsWith('test_event_'));
        assert.ok(key, 'event must be counted');

        security.securityEvents.get(key).lastSeen = Date.now() - 25 * 60 * 60 * 1000;
        security.cleanup();
        assert.ok(!security.securityEvents.has(key), 'a day-old counter must be dropped');
    });

    await test('Spam waits at least its advertised 1.5 s between messages', async () => {
        const SpamCommand = require('./commands/spam');
        const spam = new SpamCommand();
        spam.THINKING_PAUSE_CHANCE = 0; // keep the test's runtime bounded
        const sock = { sendPresenceUpdate: async () => {} };

        const started = Date.now();
        await spam.humanBehaviorDelay(sock, '1@g.us', 1, 10);
        assert.ok(Date.now() - started >= 1450, `waited only ${Date.now() - started}ms`);
    });

    // ── Chat output ──────────────────────────────────────────────────
    console.log('\n💬 Chat output...\n');

    await test('.port echoes a search query without WhatsApp markdown', async () => {
        const PortCommand = require('./commands/port');
        const sock = fakeSock();
        await new PortCommand().execute(sock, fakeMsg('1@g.us', 'x'), ['*zzz_nothing*'], { from: '1@g.us' });
        const [reply] = texts(sock);
        assert.ok(reply.includes('zzznothing'), reply);
        assert.ok(!reply.includes('*zzz'), 'user-supplied markdown must be stripped');
    });

    await test('.port renders a known port as a card', async () => {
        const PortCommand = require('./commands/port');
        const sock = fakeSock();
        await new PortCommand().execute(sock, fakeMsg('1@g.us', 'x'), ['22'], { from: '1@g.us' });
        const [reply] = texts(sock);
        assert.ok(reply.startsWith('╭'), 'expected the standard card frame');
        assert.ok(reply.includes('SSH'));
    });

    await test('.dns rejects an invalid domain with the standard error card', async () => {
        const DnsCommand = require('./commands/dns');
        const sock = fakeSock();
        await new DnsCommand().execute(sock, fakeMsg('1@g.us', 'x'), ['not a domain!'], { from: '1@g.us' });
        const [reply] = texts(sock);
        assert.ok(reply.startsWith('╭') && reply.includes('Domain Tidak Valid'), reply);
    });

    await test('Trivia decodes numeric and accented HTML entities', () => {
        const TriviaCommand = require('./commands/trivia');
        const t = new TriviaCommand();
        assert.strictEqual(t.decodeHTML('Pok&eacute;mon &amp; &#039;Z&#x27; &quot;x&quot;'), 'Pokémon & \'Z\' "x"');
        assert.strictEqual(t.decodeHTML('&unknown;'), '&unknown;');
    });

    // ── Runtime security toggles ─────────────────────────────────────
    console.log('\n🎛️ Runtime toggles...\n');

    const handler = require('./handler');
    const security = require('./utils/security');

    await test('`.security disable rateLimit` actually disables the rate limiter', async () => {
        const sock = fakeSock();
        const from = '999@g.us';
        const sender = '628333@s.whatsapp.net';
        const run = () => handler(sock, { messages: [textMsg(from, sender, '.flip')], type: 'notify' });
        const limited = () => texts(sock).some(t => t.includes('Terlalu Banyak Permintaan'));

        try {
            await run();
            await sleep(2100); // let the per-command cooldown lapse
            await run();
            assert.ok(limited(), 'baseline: second request in the window must be rate limited');

            sock.sent.length = 0;
            security.toggleFeature('rateLimit', false);
            await sleep(2100);
            await run();
            assert.ok(!limited(), 'with the toggle off the request must go through');
        } finally {
            security.toggleFeature('rateLimit', true);
        }
    });

    await test('`.security disable autoBlock` stops suspicious-activity blocks', () => {
        const user = '628444@s.whatsapp.net';
        try {
            security.toggleFeature('autoBlock', false);
            for (let i = 0; i < 25; i++) security.trackSuspiciousActivity(user, 'test');
            assert.strictEqual(security.isUserBlocked(user), false, 'must not block while autoBlock is off');

            security.toggleFeature('autoBlock', true);
            security.trackSuspiciousActivity(user, 'test');
            assert.strictEqual(security.isUserBlocked(user), true, 'must block again once re-enabled');
        } finally {
            security.toggleFeature('autoBlock', true);
            security.unblockUser(user);
            security.suspiciousActivity.delete(user);
        }
    });

    // ── Summary ───────────────────────────────────────────────────────
    console.log('\n' + '='.repeat(60));
    console.log('📊 COMMAND TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Tests Passed: ${passed}`);
    console.log(`❌ Tests Failed: ${failed}`);
    console.log('='.repeat(60) + '\n');

    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('Test runner crashed:', err);
    process.exit(1);
});
