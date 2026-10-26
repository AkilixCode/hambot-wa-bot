/**
 * Security Tests
 * Test security features and protections
 */

const security = require('../utils/security');

console.log('🔒 Running Security Tests...\n');

let passed = 0;
let failed = 0;

function assert(condition, testName) {
    if (condition) {
        console.log(`✅ PASS: ${testName}`);
        passed++;
    } else {
        console.log(`❌ FAIL: ${testName}`);
        failed++;
    }
}

// Test 1: Input Sanitization
console.log('🛡️ Testing Input Sanitization...\n');

const maliciousInputs = [
    { input: 'test\x00null', expected: 'testnull' },
    { input: 'test\x1Fcontrol', expected: 'testcontrol' },
    { input: '  trimmed  ', expected: 'trimmed' },
    { input: 'a'.repeat(2000), expectedLength: 1000 }
];

for (const test of maliciousInputs) {
    const sanitized = security.sanitizeInput(test.input, 1000);
    if (test.expectedLength) {
        assert(sanitized.length === test.expectedLength, 
            `Long input truncated to ${test.expectedLength} chars`);
    } else {
        assert(sanitized === test.expected, 
            `Input "${test.input.substring(0, 20)}" sanitized correctly`);
    }
}

// Test 2: Malicious Pattern Detection
console.log('\n🎯 Testing Malicious Pattern Detection...\n');

const maliciousPatterns = [
    // No shell or database sits behind any command, so these are ordinary
    // input and must not be flagged (they used to be, as false positives).
    { input: '.calc (2+3)*4', shouldDetect: false, type: 'Parenthesised maths' },
    { input: '.video https://www.youtube.com/watch?v=abc&t=10', shouldDetect: false, type: 'URL with query string' },
    { input: '.translate en please update my profile', shouldDetect: false, type: 'Word "update"' },
    { input: '.wiki Union Station', shouldDetect: false, type: 'Word "union"' },
    { input: '..\\windows\\system32', shouldDetect: true, type: 'Backslash path traversal' },
    { input: 'hello\0world', shouldDetect: true, type: 'Null byte' },
    { input: '../../../etc/passwd', shouldDetect: true, type: 'Path traversal' },
    { input: '<script>alert("xss")</script>', shouldDetect: true, type: 'XSS' },
    { input: 'normal text', shouldDetect: false, type: 'Normal input' },
    { input: '.menu', shouldDetect: false, type: 'Normal command' }
];

for (const test of maliciousPatterns) {
    const result = security.detectMaliciousPatterns(test.input);
    assert(result.isMalicious === test.shouldDetect, 
        `${test.type}: ${test.shouldDetect ? 'detected' : 'allowed'}`);
}

// Test 3: URL Validation
console.log('\n🌐 Testing URL Validation...\n');

const urlTests = [
    { url: 'https://google.com', valid: true },
    { url: 'http://example.com', valid: true },
    { url: 'https://localhost', valid: false, reason: 'localhost blocked' },
    { url: 'http://127.0.0.1', valid: false, reason: 'localhost IP blocked' },
    { url: 'http://192.168.1.1', valid: false, reason: 'private IP blocked' },
    { url: 'ftp://example.com', valid: false, reason: 'non-HTTP protocol' },
    { url: 'not a url', valid: false, reason: 'invalid URL' }
];

for (const test of urlTests) {
    const isValid = security.isValidURL(test.url);
    assert(isValid === test.valid, 
        `URL "${test.url}" ${test.valid ? 'accepted' : 'rejected'}${test.reason ? ` (${test.reason})` : ''}`);
}

// Test 4: User Blocking
console.log('\n⛔ Testing User Blocking...\n');

const testUser = '1234567890@s.whatsapp.net';

// Block user
security.blockUser(testUser, 5000, 'Test block');
assert(security.isUserBlocked(testUser), 'User blocked successfully');

// Unblock user (simulate expiration)
security.blockedUsers.delete(testUser);
assert(!security.isUserBlocked(testUser), 'User unblocked after expiration');

// Test 5: Command Argument Validation
console.log('\n✅ Testing Command Argument Validation...\n');

const argTests = [
    { 
        command: 'calc', 
        args: ['2 + 2'], 
        valid: true 
    },
    {
        command: 'calc',
        args: ['eval("malicious")'],
        valid: false,
        reason: 'malicious calc'
    },
    {
        command: 'video',
        args: ['https://youtube.com/watch?v=test'],
        valid: true
    },
    {
        command: 'video',
        args: ['http://localhost/evil'],
        valid: false,
        reason: 'localhost URL'
    },
    {
        command: 'menu',
        args: ['a'.repeat(3000)],
        valid: false,
        reason: 'argument too long'
    }
];

for (const test of argTests) {
    const result = security.validateCommandArgs(test.command, test.args);
    assert(result.valid === test.valid,
        `Command "${test.command}" with args ${test.valid ? 'validated' : 'rejected'}${test.reason ? ` (${test.reason})` : ''}`);
}

// Test 6: File Validation
console.log('\n📁 Testing File Validation...\n');

const fileTests = [
    { filename: 'image.jpg', valid: true },
    { filename: 'video.mp4', valid: true },
    { filename: 'malicious.exe', valid: false },
    { filename: 'image.jpg.exe', valid: false, reason: 'double extension' },
    { filename: 'document.pdf', valid: false, reason: 'not allowed type' }
];

for (const test of fileTests) {
    const result = security.validateFile(test.filename);
    assert(result.valid === test.valid,
        `File "${test.filename}" ${test.valid ? 'accepted' : 'rejected'}${test.reason ? ` (${test.reason})` : ''}`);
}

// Test 7: Permission System
console.log('\n🔐 Testing Permission System...\n');

const permTests = [
    {
        userId: 'normaluser@s.whatsapp.net',
        command: 'ping',
        isGroup: false,
        allowed: true
    },
    {
        // An owner-only command must stay denied even when BOT_OWNER_ID is
        // unset. Falling open in "dev mode" would hand the control panel to
        // every user of a misconfigured deployment.
        userId: 'normaluser@s.whatsapp.net',
        command: 'security',
        isGroup: false,
        allowed: false,
        reason: 'owner-only, fails closed when unconfigured'
    },
    {
        userId: 'normaluser@s.whatsapp.net',
        command: 'tagall',
        isGroup: true,
        isAdmin: false,
        allowed: false,
        reason: 'admin-only in groups'
    }
];

for (const test of permTests) {
    // Set owner-only commands for test
    process.env.OWNER_ONLY_COMMANDS = 'security';
    
    const result = security.checkPermission(
        test.userId, 
        test.command, 
        test.isGroup, 
        test.isAdmin
    );
    
    assert(result.allowed === test.allowed,
        `Permission for "${test.command}" ${test.allowed ? 'granted' : 'denied'}${test.reason ? ` (${test.reason})` : ''}`);
}

// Test 8: Suspicious Activity Tracking
console.log('\n📊 Testing Suspicious Activity Tracking...\n');

const suspiciousUser = '9999999999@s.whatsapp.net';

// Track normal activity
for (let i = 0; i < 10; i++) {
    security.trackSuspiciousActivity(suspiciousUser, 'normal_command');
}
assert(!security.isUserBlocked(suspiciousUser), 'Normal activity not blocked');

// Track excessive activity
for (let i = 0; i < 25; i++) {
    security.trackSuspiciousActivity(suspiciousUser, 'rapid_commands');
}
assert(security.isUserBlocked(suspiciousUser), 'Excessive activity triggers block');

// Cleanup
security.blockedUsers.delete(suspiciousUser);
security.suspiciousActivity.delete(suspiciousUser);

// Test 9: Security Statistics
console.log('\n📈 Testing Security Statistics...\n');

const stats = security.getStats();
assert(typeof stats.blockedUsers === 'number', 'Blocked users count available');
assert(typeof stats.suspiciousActivityTracked === 'number', 'Suspicious activity count available');
assert(Array.isArray(stats.recentBlocks), 'Recent blocks list available');

// Test 10: Cleanup Function
console.log('\n🧹 Testing Cleanup Function...\n');

// Add expired block
const expiredUser = '1111111111@s.whatsapp.net';
security.blockedUsers.set(expiredUser, {
    until: Date.now() - 1000,
    reason: 'Test'
});

security.cleanup();
assert(!security.blockedUsers.has(expiredUser), 'Expired blocks cleaned up');

// Test 11: Private address classifier (user-supplied URLs)
console.log('\n🧭 Testing the private address classifier...\n');

// Every way of writing the same private target must be caught.
const privateForms = {
    'loopback, plain': '127.0.0.1',
    'loopback, IPv4-mapped dotted': '::ffff:127.0.0.1',
    'loopback, IPv4-mapped hex': '::ffff:7f00:1',
    'loopback, mapped, fully expanded': '0000:0000:0000:0000:0000:ffff:7f00:0001',
    'metadata, IPv4-mapped dotted (a crafted AAAA record)': '::ffff:169.254.169.254',
    'metadata, NAT64': '64:ff9b::a9fe:a9fe',
    'metadata, local-use NAT64': '64:ff9b:1::a9fe:a9fe',
    'loopback, 6to4': '2002:7f00:1::',
    'IPv6 loopback, compressed': '::1',
    'IPv6 loopback, expanded': '0:0:0:0:0:0:0:1',
    'IPv6 unspecified': '::',
    'unique local': 'fd12:3456::1',
    'link-local with zone id': 'fe80::1%eth0',
    'IPv6 multicast': 'ff02::1',
    'documentation': '2001:db8::1',
    'Teredo': '2001:0:4136:e378::1',
    'private, mapped': '::ffff:10.1.2.3',
    'private, mapped hex': '::ffff:a01:203',
    'Docker bridge, mapped': '::ffff:172.17.0.1',
    'unparseable': 'not-an-address'
};
for (const [name, address] of Object.entries(privateForms)) {
    assert(security.isPrivateAddress(address) === true, `Blocked: ${name} (${address})`);
}

// The edges of each IPv4 range, from both sides.
const ipv4Edges = [
    ['0.255.255.255', true], ['1.0.0.0', false],
    ['9.255.255.255', false], ['10.0.0.0', true], ['10.255.255.255', true], ['11.0.0.0', false],
    ['100.63.255.255', false], ['100.64.0.0', true], ['100.127.255.255', true], ['100.128.0.0', false],
    ['126.255.255.255', false], ['127.0.0.0', true], ['127.255.255.255', true], ['128.0.0.0', false],
    ['169.253.255.255', false], ['169.254.0.0', true], ['169.254.255.255', true], ['169.255.0.0', false],
    ['172.15.255.255', false], ['172.16.0.0', true], ['172.31.255.255', true], ['172.32.0.0', false],
    ['191.255.255.255', false], ['192.0.0.0', true], ['192.0.0.255', true], ['192.0.1.0', false],
    ['192.0.2.0', true], ['192.0.2.255', true], ['192.0.3.0', false],
    ['192.88.98.255', false], ['192.88.99.0', true], ['192.88.99.255', true], ['192.88.100.0', false],
    ['192.167.255.255', false], ['192.168.0.0', true], ['192.168.255.255', true], ['192.169.0.0', false],
    ['198.17.255.255', false], ['198.18.0.0', true], ['198.19.255.255', true], ['198.20.0.0', false],
    ['198.51.99.255', false], ['198.51.100.0', true], ['198.51.100.255', true], ['198.51.101.0', false],
    ['203.0.112.255', false], ['203.0.113.0', true], ['203.0.113.255', true], ['203.0.114.0', false],
    ['223.255.255.255', false], ['224.0.0.0', true], ['239.255.255.255', true],
    ['240.0.0.0', true], ['255.255.255.255', true]
];
for (const [address, blocked] of ipv4Edges) {
    assert(security.isPrivateAddress(address) === blocked, `${address} ${blocked ? 'blocked' : 'allowed'}`);
    // The mapped form always gets the same answer as the plain one.
    assert(security.isPrivateAddress(`::ffff:${address}`) === blocked, `::ffff:${address} ${blocked ? 'blocked' : 'allowed'}`);
}

// Public addresses stay reachable — including IPv4-mapped ones: a blanket
// ::ffff:0:0/96 rule would block every IPv4 address in net.BlockList.
for (const address of ['8.8.8.8', '1.1.1.1', '::ffff:8.8.8.8', '::ffff:808:808', '2606:4700::1111',
    '2001:4860:4860::8888', '2001:200::1', '2a00:1450:4001::1']) {
    assert(security.isPrivateAddress(address) === false, `Allowed: public ${address}`);
}

// Edges of the IPv6 ranges
const ipv6Edges = [
    ['64:ff9b::', true], ['64:ff9b::ffff:ffff', true], ['64:ff9b:0:0:0:1::', false],
    ['2001:1ff:ffff::', true], ['2001:200::', false],
    ['2001:db7:ffff::', false], ['2001:db8::', true], ['2001:db8:ffff::', true], ['2001:db9::', false],
    ['2001:ffff::', false], ['2002::', true], ['2002:ffff::', true], ['2003::', false],
    ['fbff:ffff::', false], ['fc00::', true], ['fdff:ffff::', true],
    ['fe7f:ffff::', false], ['fe80::', true], ['febf:ffff::', true], ['fec0::', false],
    ['feff:ffff::', false], ['ff00::', true]
];
for (const [address, blocked] of ipv6Edges) {
    assert(security.isPrivateAddress(address) === blocked, `${address} ${blocked ? 'blocked' : 'allowed'}`);
}

for (const [url, blocked] of [
    ['http://[::ffff:7f00:1]/', true],
    ['http://[::ffff:127.0.0.1]/', true],
    ['http://[64:ff9b::7f00:1]/', true],
    ['http://2130706433/', true],
    ['http://0x7f.1/', true],
    ['http://localhost./', true],
    ['http://[2606:4700::1111]/', false]
]) {
    assert(security.isValidURL(url) === !blocked, `URL ${url} ${blocked ? 'rejected' : 'accepted'}`);
}

assert(Array.isArray(security.BLOCKED_RANGES) &&
    !security.BLOCKED_RANGES.some(([address, prefix]) => address === '::ffff:0:0' && prefix === 96),
    'No blanket IPv4-mapped rule (it would block all of IPv4)');

async function asyncTests() {
    // A hostname whose DNS answer is a mapped private address (an attacker's
    // AAAA record) is refused; a public answer is fine. The resolver is
    // stubbed: no network.
    const dnsPromises = require('dns').promises;
    const realLookup = dnsPromises.lookup;
    try {
        dnsPromises.lookup = async () => [{ address: '::ffff:169.254.169.254', family: 6 }];
        let r = await security.resolvesToPublicHost('https://rebind.example/');
        assert(r.safe === false, 'DNS: a mapped-private AAAA answer is refused');

        dnsPromises.lookup = async () => [{ address: '93.184.216.34', family: 4 }, { address: '64:ff9b::a00:1', family: 6 }];
        r = await security.resolvesToPublicHost('https://mixed.example/');
        assert(r.safe === false, 'DNS: one NAT64-private answer among public ones is refused');

        dnsPromises.lookup = async () => [{ address: '93.184.216.34', family: 4 }, { address: '2606:2800:220:1::1', family: 6 }];
        r = await security.resolvesToPublicHost('https://public.example/');
        assert(r.safe === true, 'DNS: public answers are allowed');
    } finally {
        dnsPromises.lookup = realLookup;
    }

    // The classifier is for user URLs only. Owner-configured private
    // endpoints (AI backends, the egress proxy) never go through it and keep
    // working: checked against their real loaders.
    const settings = require('../utils/chat/settings');
    for (const url of ['http://127.0.0.1:11434', 'http://host.docker.internal:1234/v1', 'http://100.101.102.103:8642/v1',
        'http://ollama:11434', 'http://[::1]:8080/v1', 'http://192.168.1.20:1234/v1']) {
        const s = settings.load({ CHAT_ENABLED: 'true', CHAT_BACKEND: 'local', CHAT_LOCAL_API: 'openai', CHAT_LOCAL_URL: url, CHAT_LOCAL_MODEL: 'm' });
        assert(s.backends.local && s.backends.local.url.host === new URL(url).host && s.problems.length === 0,
            `Owner-configured chat backend stays usable: ${url}`);
    }
    const agent = settings.load({ CHAT_ENABLED: 'true', CHAT_BACKEND: 'agent', CHAT_AGENT_URL: 'http://100.101.102.103:8642/v1', CHAT_AGENT_TOKEN: 'secret-token-123456' });
    assert(agent.backends.agent && agent.problems.every(p => !/CHAT_AGENT_URL/.test(p)),
        'Owner-configured agent on a Tailscale address stays usable');

    // A residential/phone proxy on a private or Tailscale address is the
    // owner's choice too: it must still be handed to yt-dlp as configured.
    const { spawnSync } = require('child_process');
    for (const [type, host] of [['http', '100.101.102.103'], ['socks5', '192.168.1.50'], ['http', 'proxy.internal']]) {
        const r = spawnSync(process.execPath, ['-e', "process.stdout.write(JSON.stringify(require('./config').getYtDlpProxyArgs()))"], {
            cwd: require('path').join(__dirname, '..'),
            env: { ...process.env, HAMBOT_ENV_FILE: 'tests/no-such.env', PROXY_ENABLED: 'true', PROXY_TYPE: type, PROXY_HOST: host, PROXY_PORT: '8080' },
            encoding: 'utf8'
        });
        const args = JSON.parse(r.stdout || '[]');
        assert(args[0] === '--proxy' && args[1] === `${type}://${host}:8080`,
            `Owner-configured ${type} proxy on ${host} is used as is`);
    }
}

function summary() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 SECURITY TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Tests Passed: ${passed}`);
    console.log(`❌ Tests Failed: ${failed}`);
    console.log(`🎯 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
    console.log('='.repeat(60));

    if (failed === 0) {
        console.log('\n🔒 All security tests passed! Bot is secure.');
        process.exit(0);
    } else {
        console.log(`\n❌ ${failed} security tests failed. Review required.`);
        process.exit(1);
    }
}

asyncTests().then(summary, (error) => {
    console.log(`❌ FAIL: async tests crashed: ${error.message}`);
    failed++;
    summary();
});
