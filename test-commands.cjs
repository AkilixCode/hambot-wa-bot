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
const ui = require('./utils/ui');

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
    // Plain lowercase text: card titles are set in decorative small capitals,
    // which only map back to lowercase.
    return sock.sent.filter(s => s.content.text).map(s => ui.plain(s.content.text).toLowerCase());
}

async function main() {
    console.log('\n🧪 COMMAND & HANDLER REGRESSION TESTS\n' + '='.repeat(60));

    // ── Dependency contract ──────────────────────────────────────────
    // Every third-party API the bot calls, exercised offline, so a package
    // upgrade that changes one fails here instead of in a chat.
    console.log('\n📦 Dependency contract...\n');

    const os = require('os');

    await test('Baileys: the exports index.js and helpers.js use still exist', async () => {
        const baileys = await import('@whiskeysockets/baileys');
        assert.strictEqual(typeof baileys.default, 'function', 'makeWASocket (default export)');
        assert.strictEqual(typeof baileys.useMultiFileAuthState, 'function');
        assert.strictEqual(typeof baileys.downloadContentFromMessage, 'function');
        assert.strictEqual(typeof baileys.DisconnectReason?.loggedOut, 'number');
    });

    await test('Baileys: a socket exposes the methods the bot calls', async () => {
        const baileys = await import('@whiskeysockets/baileys');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hambot-auth-'));
        const { state, saveCreds } = await baileys.useMultiFileAuthState(dir);
        assert.strictEqual(typeof saveCreds, 'function');
        assert.strictEqual(state.creds.registered, false, 'fresh auth state is unregistered');

        // Pointed at a closed local port: the socket is built but never
        // reaches WhatsApp.
        const sock = baileys.default({
            auth: state,
            logger: require('pino')({ level: 'silent' }),
            waWebSocketUrl: 'ws://127.0.0.1:9/ws'
        });
        try {
            for (const method of ['sendMessage', 'groupMetadata', 'sendPresenceUpdate', 'requestPairingCode', 'end']) {
                assert.strictEqual(typeof sock[method], 'function', `sock.${method}`);
            }
            assert.strictEqual(typeof sock.ev?.on, 'function', 'sock.ev.on');
        } finally {
            try { sock.end(undefined); } catch { /* already closed */ }
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    await test('dotenv: config({ quiet: true }) loads a file without printing', () => {
        const file = path.join(os.tmpdir(), `hambot-env-${process.pid}`);
        fs.writeFileSync(file, 'HAMBOT_CONTRACT_CHECK=ok\n');
        const realWrite = process.stdout.write;
        let printed = '';
        process.stdout.write = (chunk, ...rest) => { printed += chunk; return true; };
        try {
            require('dotenv').config({ path: file, quiet: true });
        } finally {
            process.stdout.write = realWrite;
            fs.unlinkSync(file);
        }
        assert.strictEqual(process.env.HAMBOT_CONTRACT_CHECK, 'ok');
        assert.strictEqual(printed, '', `dotenv printed: ${printed}`);
        delete process.env.HAMBOT_CONTRACT_CHECK;
    });

    await test('axios (via http-client): JSON, arraybuffer and maxContentLength behave', async () => {
        const http = require('http');
        const server = http.createServer((req, res) => {
            if (req.url === '/json') return res.end(JSON.stringify({ ok: true }));
            if (req.url === '/bin') return res.end(Buffer.from([1, 2, 3]));
            res.end(Buffer.alloc(2 * 1024 * 1024));
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const base = `http://127.0.0.1:${server.address().port}`;
        const httpClient = require('./utils/http-client');
        try {
            const json = await httpClient.get(`${base}/json`);
            assert.deepStrictEqual(json.data, { ok: true });

            const bin = await httpClient.get(`${base}/bin`, { responseType: 'arraybuffer' });
            assert.deepStrictEqual([...Buffer.from(bin.data)], [1, 2, 3]);

            await assert.rejects(
                () => httpClient.get(`${base}/big`, { responseType: 'arraybuffer', maxContentLength: 1024 * 1024 }),
                /maxContentLength/i
            );
        } finally {
            server.close();
        }
    });

    await test('canvas: the calls the menu banner makes still work', () => {
        const { renderBanner } = require('./utils/menu-image');
        const jpeg = renderBanner();
        assert.ok(jpeg.length > 1000 && jpeg[0] === 0xff && jpeg[1] === 0xd8, 'banner must be a JPEG');
    });

    await test('sharp: rotate + resize + jpeg, as the menu image and .sticker use', async () => {
        const sharp = require('sharp');
        const png = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#123456' } }).png().toBuffer();
        const out = await sharp(png).rotate().resize({ width: 1280, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
        const meta = await sharp(out).metadata();
        assert.strictEqual(meta.format, 'jpeg');
        assert.strictEqual(meta.width, 1280);
        const webp = await sharp(png).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp().toBuffer();
        assert.strictEqual((await sharp(webp).metadata()).format, 'webp');
    });

    await test('pino and socks-proxy-agent construct as index.js and http-client do', () => {
        const logger = require('pino')({ level: 'silent' });
        assert.strictEqual(typeof logger.info, 'function');
        const { SocksProxyAgent } = require('socks-proxy-agent');
        assert.ok(new SocksProxyAgent('socks5://127.0.0.1:1080'));
    });

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
        assert.ok(texts(sock).some(t => t.includes('batas tercapai')), 'user must be told why');
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
        assert.ok(!texts(oldSock).some(t => t.includes('minum air') && t.includes('pengingat') && !t.includes('dipasang')),
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

    // ── Theme ────────────────────────────────────────────────────────
    console.log('\n🎨 Theme...\n');

    await test('The ASCII frame never exceeds 23 columns, whatever the name', () => {
        for (const name of ['HamBot', 'Bot', 'A Really Very Long Bot Name Indeed', 'Émile Ω 🤖', '']) {
            const body = ui.frame(name).replace(/```/g, '').split('\n');
            assert.strictEqual(body.length, 3, 'frame is three lines');
            for (const line of body) {
                assert.strictEqual(line.length, 23, `"${name}": line "${line}" is ${line.length} columns`);
                assert.ok(/^[\x20-\x7e]+$/.test(line), 'frame must be pure ASCII to stay aligned');
            }
        }
    });

    await test('Cards use the heavy rail and small-caps titles', () => {
        const out = ui.card({ icon: '🎵', title: 'Musik', lines: ['a', '', 'b'], footer: 'f' }).split('\n');
        assert.strictEqual(out[0], `┏━━ 🎵 *${ui.smallCaps('Musik')}*`);
        assert.deepStrictEqual(out.slice(1, 4), ['┃ a', '┃', '┃ b']);
        assert.strictEqual(out[4], '┗━━ ✧ _f_');
    });

    await test('rawTitle keeps command names typeable', () => {
        assert.ok(ui.card({ title: '.menu', rawTitle: true }).startsWith('┏━━ *.menu*'));
    });

    await test('restyle() turns a hand-written titled message into a card', () => {
        const out = ui.restyle('🩺 *HEALTH CHECK*\n\n📌 *Detail:*\n• satu\n\n\n• dua\n\n_catatan kaki_').split('\n');
        assert.deepStrictEqual(out, [
            `┏━━ 🩺 *${ui.smallCaps('HEALTH CHECK')}*`,
            `┃ ❖ 📌 *${ui.smallCaps('Detail')}*`,
            '┃ ▸ satu',
            '┃',
            '┃ ▸ dua',
            '┗━━ ✧ _catatan kaki_'
        ]);
    });

    await test('restyle() gives a bare status notice a title', () => {
        const out = ui.plain(ui.restyle('❌ Prefix tidak valid.\n\nContoh: .security prefix !'));
        assert.ok(out.startsWith('┏━━ ❌ *gagal*'), out);
        assert.ok(out.includes('┃ Prefix tidak valid.'));
    });

    await test('restyle() leaves prose, cards and code blocks alone', () => {
        for (const text of ['halo semua', '😂 lucu banget', ui.card({ title: 'x' }), '```a\nb```', '']) {
            assert.strictEqual(ui.restyle(text), text);
        }
    });

    await test('Every netinfo topic comes out as a card under the message limit', () => {
        const NetInfo = require('./commands/netinfo');
        const netinfo = new NetInfo();
        for (const [topic, render] of Object.entries(netinfo.topics)) {
            const out = ui.restyle(render());
            assert.ok(out.startsWith('┏━━'), `${topic} was not converted`);
            assert.ok(out.length <= ui.MAX_MESSAGE_LENGTH, `${topic} is ${out.length} chars`);
        }
    });

    await test('plain() maps every decorative alphabet back to ASCII', () => {
        const fancy = [ui.smallCaps('Hello'), ui.fancy('World 42'), ui.fancyItalic('ok'), ui.fancyMono('v1.0')].join(' ');
        assert.strictEqual(ui.plain(fancy), 'hello World 42 ok v1.0');
    });

    // ── Menu ─────────────────────────────────────────────────────────
    console.log('\n📋 Menu...\n');

    const MenuCommand = require('./commands/menu');
    const menuImage = require('./utils/menu-image');
    const menu = new MenuCommand();
    const sharp = require('sharp');

    const runMenu = async (isOwner = false) => {
        const sock = fakeSock();
        await menu.execute(sock, fakeMsg('1@g.us', 'x'), [], { from: '1@g.us', isOwner });
        return sock.sent.filter(s => !s.content.react);
    };

    await test('.menu is one message: the image with the menu as its caption', async () => {
        menuImage.clearCache();
        const sent = await runMenu();
        assert.strictEqual(sent.length, 1, `expected 1 message, got ${sent.length}`);
        const { image, caption } = sent[0].content;
        assert.ok(Buffer.isBuffer(image) && image.length > 1000, 'image must be attached');
        assert.ok(caption.length <= 1024, `caption is ${caption.length} chars`);
        assert.ok(ui.plain(caption).includes('.music'), 'caption lists the commands');
    });

    await test('.menu command rows never exceed the narrow-phone width', () => {
        const { body } = menu.buildOverview('Ilham', true);
        for (const line of body.split('\n').filter(l => l.startsWith('   .'))) {
            assert.ok(line.length <= 30, `"${line}" is ${line.length} chars`);
        }
    });

    await test('.menu hides owner-only commands from everyone else', () => {
        const { body } = menu.buildOverview('x', false);
        assert.ok(!/\.(security|spam)\b/.test(body), 'owner-only commands leaked into the menu');
    });

    await test('MENU_IMAGE overrides the generated banner', async () => {
        const file = path.join(os.tmpdir(), `menu-test-${process.pid}.png`);
        await sharp({ create: { width: 64, height: 32, channels: 3, background: '#ff0000' } }).png().toFile(file);
        process.env.MENU_IMAGE = file;
        menuImage.clearCache();
        try {
            const meta = await sharp(await menuImage.getMenuImage()).metadata();
            assert.strictEqual(meta.width, 64, 'the override image must be used');
        } finally {
            delete process.env.MENU_IMAGE;
            menuImage.clearCache();
            fs.unlinkSync(file);
        }
    });

    await test('A broken MENU_IMAGE falls back to the generated banner', async () => {
        process.env.MENU_IMAGE = '/definitely/not/here.jpg';
        menuImage.clearCache();
        try {
            const meta = await sharp(await menuImage.getMenuImage()).metadata();
            assert.strictEqual(meta.width, 1280);
        } finally {
            delete process.env.MENU_IMAGE;
            menuImage.clearCache();
        }
    });

    await test('.menu still answers in text when the image cannot be sent', async () => {
        const sock = fakeSock();
        const realSend = sock.sendMessage;
        sock.sendMessage = async (jid, content, opts) => {
            if (content.image) throw new Error('upload failed');
            return realSend.call(sock, jid, content, opts);
        };
        await menu.execute(sock, fakeMsg('1@g.us', 'x'), [], { from: '1@g.us', isOwner: false });
        assert.ok(texts(sock).some(t => t.includes('.music')), 'the menu text must still be delivered');
    });

    // ── Typo tolerance ───────────────────────────────────────────────
    console.log('\n✏️ Typo tolerance...\n');

    const handler = require('./handler');
    const registry = require('./commands/registry');
    const config = require('./config');
    let typoSender = 0;
    // A fresh sender per call: this file runs with RATE_LIMIT_MAX=1.
    const say = async (text) => {
        const sock = fakeSock();
        const sender = `62890${++typoSender}@s.whatsapp.net`;
        await handler(sock, { messages: [textMsg('777@g.us', sender, text)], type: 'notify' });
        return sock.sent
            .filter(s => !s.content.react)
            .map(s => ui.plain(s.content.text ?? s.content.caption ?? '').toLowerCase());
    };

    await test('Common typos resolve to the intended command', () => {
        const visible = n => !config.isOwnerOnlyCommand(n);
        for (const [typo, meant] of [['mneu', 'menu'], ['stikcer', 'sticker'], ['wether', 'weather'],
            ['vidoe', 'video'], ['muisc', 'music'], ['trnaslate', 'translate'], ['pnig', 'ping']]) {
            const m = registry.match(typo, { filter: visible });
            assert.ok(m.confident && m.name === meant, `${typo} -> ${JSON.stringify(m)}`);
        }
    });

    await test('A typo runs the command, with a correction note in the same reply', async () => {
        const replies = await say('.mneu');
        assert.strictEqual(replies.length, 1, `expected one message, got ${replies.length}`);
        assert.ok(replies[0].startsWith('✏️ _.mneu'), replies[0].slice(0, 60));
        assert.ok(replies[0].includes('.music'), 'the menu itself must follow the note');
    });

    await test('Ordinary chat that happens to start with a dot gets no reply', async () => {
        for (const text of ['.ok', '.wkwk', '...', '. ', '.mantap', '.haha lucu', '.5 juta']) {
            const replies = await say(text);
            assert.strictEqual(replies.length, 0, `"${text}" got a reply: ${replies[0]}`);
        }
    });

    await test('Messages without the dot prefix are never treated as commands', async () => {
        for (const text of ['menu', 'mneu', 'sticker pls', 'halo .menu']) {
            assert.strictEqual((await say(text)).length, 0, `"${text}" got a reply`);
        }
    });

    await test('Owner-only commands are never guessed from a typo', async () => {
        assert.strictEqual(registry.match('secrity', { filter: n => !config.isOwnerOnlyCommand(n) }).name, null);
        const replies = await say('.secrity');
        assert.ok(!replies.some(r => r.includes('security')), 'must not run or reveal .security');
    });

    await test('An ambiguous typo asks instead of guessing', async () => {
        const m = registry.match('dic', { filter: n => !config.isOwnerOnlyCommand(n) });
        assert.ok(!m.confident && m.candidates.includes('dice') && m.candidates.includes('dns'), JSON.stringify(m));
        const replies = await say('.dic');
        assert.strictEqual(replies.length, 1);
        assert.ok(replies[0].includes('.dice') && replies[0].includes('.dns'), replies[0]);
    });

    await test('.menu <typo> shows the page it meant, with a note', async () => {
        const sock = fakeSock();
        await menu.execute(sock, fakeMsg('1@g.us', 'x'), ['vidoe'], { from: '1@g.us', isOwner: false });
        const [reply] = texts(sock);
        assert.ok(reply.startsWith('✏️ _vidoe'), reply.slice(0, 40));
        assert.ok(reply.includes('*.video*'), 'the .video help page must follow');
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
        assert.ok(reply.startsWith('┏'), 'expected the standard card frame');
        assert.ok(reply.includes('ssh'));
    });

    await test('.dns rejects an invalid domain with the standard error card', async () => {
        const DnsCommand = require('./commands/dns');
        const sock = fakeSock();
        await new DnsCommand().execute(sock, fakeMsg('1@g.us', 'x'), ['not a domain!'], { from: '1@g.us' });
        const [reply] = texts(sock);
        assert.ok(reply.startsWith('┏') && reply.includes('domain tidak valid'), reply);
    });

    await test('Trivia decodes numeric and accented HTML entities', () => {
        const TriviaCommand = require('./commands/trivia');
        const t = new TriviaCommand();
        assert.strictEqual(t.decodeHTML('Pok&eacute;mon &amp; &#039;Z&#x27; &quot;x&quot;'), 'Pokémon & \'Z\' "x"');
        assert.strictEqual(t.decodeHTML('&unknown;'), '&unknown;');
    });

    // ── Runtime security toggles ─────────────────────────────────────
    console.log('\n🎛️ Runtime toggles...\n');

    const security = require('./utils/security');

    await test('`.security disable rateLimit` actually disables the rate limiter', async () => {
        const sock = fakeSock();
        const from = '999@g.us';
        const sender = '628333@s.whatsapp.net';
        const run = () => handler(sock, { messages: [textMsg(from, sender, '.flip')], type: 'notify' });
        const limited = () => texts(sock).some(t => t.includes('terlalu banyak permintaan'));

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
