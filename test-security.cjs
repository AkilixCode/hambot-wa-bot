/**
 * Security Tests
 * Test security features and protections
 */

const security = require('./utils/security');

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
    { input: 'SELECT * FROM users', shouldDetect: true, type: 'SQL injection' },
    { input: 'DROP TABLE users', shouldDetect: true, type: 'SQL injection' },
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

// Summary
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
