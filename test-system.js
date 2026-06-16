/**
 * System Component Test
 * Tests core utilities and systems
 */

const cache = require('./utils/cache');
const RateLimiter = require('./utils/rate-limiter');
const logger = require('./utils/logger');
const config = require('./config');
const commandRegistry = require('./commands/registry');
const path = require('path');

console.log('🧪 Running System Component Tests...\n');

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

// Test 1: Configuration
try {
    config.validate();
    assert(config.bot.name === 'HamBot', 'Config: Bot name loaded');
    assert(config.performance.maxProcesses >= 1, 'Config: Max processes valid');
    assert(config.bot.prefix === '.', 'Config: Prefix loaded');
} catch (error) {
    assert(false, 'Config: Validation failed');
}

// Test 1.1: Owner ID normalization
try {
    // Save original owner ID
    const originalOwnerId = process.env.BOT_OWNER_ID;
    
    // Test @s.whatsapp.net format
    process.env.BOT_OWNER_ID = '6281234567890@s.whatsapp.net';
    const Config = require('./config');
    const testConfig1 = new Config.constructor();
    assert(testConfig1.bot.ownerId === '6281234567890@s.whatsapp.net', 
           'Config: Owner ID accepts @s.whatsapp.net format');
    
    // Test @lid format
    process.env.BOT_OWNER_ID = '12345678901234@lid';
    const testConfig2 = new Config.constructor();
    assert(testConfig2.bot.ownerId === '12345678901234@lid', 
           'Config: Owner ID accepts @lid format');
    
    // Test plain number (should normalize to @s.whatsapp.net)
    process.env.BOT_OWNER_ID = '6281234567890';
    const testConfig3 = new Config.constructor();
    assert(testConfig3.bot.ownerId === '6281234567890@s.whatsapp.net', 
           'Config: Owner ID normalizes plain number to @s.whatsapp.net');
    
    // Test isOwner with @lid format (direct match)
    const testConfig4 = new Config.constructor();
    testConfig4.bot.ownerId = '12345678901234@lid';
    testConfig4.bot.ownerIds = ['12345678901234@lid']; // Also set ownerIds array
    assert(testConfig4.isOwner('12345678901234@lid') === true, 
           'Config: isOwner matches @lid format (direct match)');
    assert(testConfig4.isOwner('6281234567890@s.whatsapp.net') === false, 
           'Config: isOwner rejects different format when owner uses @lid');
    
    // Test isOwner with @s.whatsapp.net format
    const testConfig5 = new Config.constructor();
    testConfig5.bot.ownerId = '6281234567890@s.whatsapp.net';
    testConfig5.bot.ownerIds = ['6281234567890@s.whatsapp.net']; // Also set ownerIds array
    assert(testConfig5.isOwner('6281234567890@s.whatsapp.net') === true, 
           'Config: isOwner matches @s.whatsapp.net format (direct match)');
    assert(testConfig5.isOwner('12345678901234@lid') === false, 
           'Config: isOwner rejects @lid when owner uses @s.whatsapp.net');
    
    // Test dual owner ID support
    const testConfig6 = new Config.constructor();
    testConfig6.bot.ownerIds = ['6281234567890@s.whatsapp.net', '12345678901234@lid'];
    assert(testConfig6.isOwner('6281234567890@s.whatsapp.net') === true, 
           'Config: isOwner matches first owner ID in dual setup');
    assert(testConfig6.isOwner('12345678901234@lid') === true, 
           'Config: isOwner matches second owner ID in dual setup');
    assert(testConfig6.isOwner('999999999@s.whatsapp.net') === false, 
           'Config: isOwner rejects non-owner in dual setup');
    
    // Restore original owner ID
    if (originalOwnerId) {
        process.env.BOT_OWNER_ID = originalOwnerId;
    } else {
        delete process.env.BOT_OWNER_ID;
    }
} catch (error) {
    console.error(error);
    assert(false, 'Config: Owner ID normalization tests failed');
}

// Test 1.2: Network configuration
try {
    const Config = require('./config');
    
    // Save original env vars
    const origForceIPv4 = process.env.FORCE_IPV4;
    const origFallback = process.env.NETWORK_FALLBACK_TO_LOCAL;
    const origProxyEnabled = process.env.PROXY_ENABLED;
    
    // Test default values (forceIPv4 defaults to true, fallbackToLocal defaults to true)
    delete process.env.FORCE_IPV4;
    delete process.env.NETWORK_FALLBACK_TO_LOCAL;
    const testNetConfig1 = new Config.constructor();
    assert(testNetConfig1.network.forceIPv4 === true, 
           'Config: Network forceIPv4 defaults to true');
    assert(testNetConfig1.network.fallbackToLocal === true, 
           'Config: Network fallbackToLocal defaults to true');
    
    // Test forceIPv4 can be disabled
    process.env.FORCE_IPV4 = 'false';
    const testNetConfig2 = new Config.constructor();
    assert(testNetConfig2.network.forceIPv4 === false, 
           'Config: Network forceIPv4 can be set to false');
    
    // Test fallbackToLocal can be disabled
    process.env.NETWORK_FALLBACK_TO_LOCAL = 'false';
    const testNetConfig3 = new Config.constructor();
    assert(testNetConfig3.network.fallbackToLocal === false, 
           'Config: Network fallbackToLocal can be set to false');
    
    // Test getYtDlpNetworkArgs returns --force-ipv4 when enabled
    process.env.FORCE_IPV4 = 'true';
    const testNetConfig4 = new Config.constructor();
    const networkArgs = testNetConfig4.getYtDlpNetworkArgs();
    assert(Array.isArray(networkArgs) && networkArgs.includes('--force-ipv4'), 
           'Config: getYtDlpNetworkArgs returns --force-ipv4 when enabled');
    
    // Test getYtDlpNetworkArgs returns empty when disabled
    process.env.FORCE_IPV4 = 'false';
    const testNetConfig5 = new Config.constructor();
    const emptyArgs = testNetConfig5.getYtDlpNetworkArgs();
    assert(Array.isArray(emptyArgs) && emptyArgs.length === 0, 
           'Config: getYtDlpNetworkArgs returns empty when forceIPv4 disabled');
    
    // Test getYtDlpProxyArgs returns empty when proxy disabled
    delete process.env.PROXY_ENABLED;
    const testNetConfig6 = new Config.constructor();
    const noProxyArgs = testNetConfig6.getYtDlpProxyArgs();
    assert(Array.isArray(noProxyArgs) && noProxyArgs.length === 0, 
           'Config: getYtDlpProxyArgs returns empty when proxy disabled');
    
    // Restore original env vars
    if (origForceIPv4 !== undefined) process.env.FORCE_IPV4 = origForceIPv4;
    else delete process.env.FORCE_IPV4;
    if (origFallback !== undefined) process.env.NETWORK_FALLBACK_TO_LOCAL = origFallback;
    else delete process.env.NETWORK_FALLBACK_TO_LOCAL;
    if (origProxyEnabled !== undefined) process.env.PROXY_ENABLED = origProxyEnabled;
    else delete process.env.PROXY_ENABLED;
} catch (error) {
    console.error(error);
    assert(false, 'Config: Network configuration tests failed');
}

// Test 1.3: HTTP Client proxy connection error detection
try {
    const { isProxyConnectionError } = require('./utils/http-client');
    
    // Connection errors should be detected
    assert(isProxyConnectionError({ code: 'ECONNREFUSED' }) === true,
           'HTTP Client: Detects ECONNREFUSED as proxy error');
    assert(isProxyConnectionError({ code: 'ETIMEDOUT' }) === true,
           'HTTP Client: Detects ETIMEDOUT as proxy error');
    assert(isProxyConnectionError({ code: 'ECONNRESET' }) === true,
           'HTTP Client: Detects ECONNRESET as proxy error');
    assert(isProxyConnectionError({ message: 'SOCKS connection failed' }) === true,
           'HTTP Client: Detects SOCKS errors');
    
    // Non-connection errors should not be detected
    assert(isProxyConnectionError({ response: { status: 404 } }) === false,
           'HTTP Client: Does not detect HTTP 404 as proxy error');
    assert(isProxyConnectionError({ message: 'Request failed with status code 500' }) === false,
           'HTTP Client: Does not detect HTTP 500 as proxy error');
    assert(isProxyConnectionError({}) === false,
           'HTTP Client: Does not detect empty error as proxy error');
} catch (error) {
    console.error(error);
    assert(false, 'HTTP Client: Proxy connection error detection tests failed');
}

// Test 2: Cache System
try {
    cache.clear();
    cache.set('test-key', 'test-value', 5000);
    assert(cache.get('test-key') === 'test-value', 'Cache: Set and get');
    assert(cache.has('test-key'), 'Cache: Key exists');
    
    cache.delete('test-key');
    assert(!cache.has('test-key'), 'Cache: Delete key');
    
    const stats = cache.getStats();
    assert(stats.hitRate !== undefined, 'Cache: Stats available');
} catch (error) {
    assert(false, 'Cache: System failed');
}

// Test 3: Rate Limiter
try {
    const limiter = new RateLimiter(60000, 5);
    
    const result1 = limiter.check('user123');
    assert(result1.allowed === true, 'RateLimiter: First request allowed');
    assert(result1.remaining === 4, 'RateLimiter: Remaining count correct');
    
    // Make 4 more requests
    for (let i = 0; i < 4; i++) {
        limiter.check('user123');
    }
    
    const result2 = limiter.check('user123');
    assert(result2.allowed === false, 'RateLimiter: Limit enforced');
    assert(result2.retryAfter > 0, 'RateLimiter: Retry time provided');
    
    limiter.reset('user123');
    const result3 = limiter.check('user123');
    assert(result3.allowed === true, 'RateLimiter: Reset works');
    
    limiter.destroy();
} catch (error) {
    assert(false, 'RateLimiter: System failed');
}

// Test 4: Logger
try {
    // Legacy methods (backward compat)
    logger.info('Test message');
    logger.warn('Test warning');
    logger.error(new Error('Test error'));
    logger.system('Test system event');
    
    const formatted = logger.formatCommand('test', '1234567890@s.whatsapp.net', '1234567890@g.us', true);
    assert(formatted.command === 'test', 'Logger: Format command');
    assert(formatted.chat === 'grup', 'Logger: Group detection (Indonesian)');
    assert(formatted.sender === '1234567890@s.whatsapp.net', 'Logger: Full sender ID');
    
    // New tracker pattern
    const tracker = logger.commandStart('pinterest', '1234567890@s.whatsapp.net', '1234567890@g.us', true);
    assert(tracker.commandName === 'pinterest', 'Logger: Tracker command name');
    assert(tracker.senderNumber === '1234567890', 'Logger: Tracker sender number');
    assert(tracker.isGroup === true, 'Logger: Tracker group flag');
    assert(typeof tracker.startTime === 'number', 'Logger: Tracker start time');
    
    // commandEnd should not throw
    logger.commandEnd(tracker, 'done');
    logger.commandEnd(tracker, 'failed', new Error('test'));
    logger.commandEnd(tracker, 'blocked', 'rate limited');
    logger.commandEnd(null, 'done'); // null tracker should be safe
    
    assert(typeof logger.mode === 'string', 'Logger: Mode property exists');
    assert(['simple', 'full'].includes(logger.mode), 'Logger: Mode is simple or full');
} catch (error) {
    console.error(error);
    assert(false, 'Logger: System failed');
}

// Test 5: Command Registry
try {
    const commandsPath = path.join(__dirname, 'commands');
    const loaded = commandRegistry.loadFromDirectory(commandsPath);
    
    assert(loaded > 0, `Command Registry: Loaded ${loaded} commands`);
    assert(commandRegistry.has('ping'), 'Command Registry: Ping command exists');
    assert(commandRegistry.has('menu'), 'Command Registry: Menu command exists');
    assert(commandRegistry.has('sticker'), 'Command Registry: Sticker command exists');
    
    const pingCmd = commandRegistry.get('ping');
    assert(pingCmd !== null, 'Command Registry: Get command');
    assert(pingCmd.name === 'ping', 'Command Registry: Command name correct');
    
    // Test alias
    const pingByAlias = commandRegistry.get('p');
    assert(pingByAlias !== null, 'Command Registry: Alias works');
    assert(pingByAlias.name === 'ping', 'Command Registry: Alias resolves correctly');
    
    const categories = commandRegistry.getCategories();
    assert(categories.length > 0, `Command Registry: ${categories.length} categories`);
} catch (error) {
    console.error(error);
    assert(false, 'Command Registry: System failed');
}

// Test 6: Helper Functions
try {
    const { formatSize, sanitizeInput, generateFilename } = require('./utils/helpers');
    
    assert(formatSize(1024) === '1.00 KB', 'Helpers: Format size KB');
    assert(formatSize(1048576) === '1.00 MB', 'Helpers: Format size MB');
    assert(formatSize(1073741824) === '1.00 GB', 'Helpers: Format size GB');
    
    const sanitized = sanitizeInput('  test\x00input\x1F  ');
    assert(sanitized === 'testinput', 'Helpers: Sanitize input');
    
    const filename = generateFilename('test', 'txt');
    assert(filename.startsWith('test_'), 'Helpers: Generate filename');
    assert(filename.endsWith('.txt'), 'Helpers: Filename extension');
} catch (error) {
    console.error(error);
    assert(false, 'Helpers: System failed');
}

// Summary
console.log('\n' + '='.repeat(50));
console.log(`Tests Passed: ${passed}`);
console.log(`Tests Failed: ${failed}`);
console.log(`Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
console.log('='.repeat(50));

// Cleanup
cache.destroy();

if (failed === 0) {
    console.log('\n✅ All tests passed! System is ready.');
    process.exit(0);
} else {
    console.log('\n❌ Some tests failed. Please review.');
    process.exit(1);
}
