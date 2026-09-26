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
