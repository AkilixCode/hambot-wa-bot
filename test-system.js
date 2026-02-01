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
    assert(testConfig4.isOwner('12345678901234@lid') === true, 
           'Config: isOwner matches @lid format (direct match)');
    assert(testConfig4.isOwner('6281234567890@s.whatsapp.net') === false, 
           'Config: isOwner rejects different format when owner uses @lid');
    
    // Test isOwner with @s.whatsapp.net format
    const testConfig5 = new Config.constructor();
    testConfig5.bot.ownerId = '6281234567890@s.whatsapp.net';
    assert(testConfig5.isOwner('6281234567890@s.whatsapp.net') === true, 
           'Config: isOwner matches @s.whatsapp.net format (direct match)');
    assert(testConfig5.isOwner('12345678901234@lid') === false, 
           'Config: isOwner rejects @lid when owner uses @s.whatsapp.net');
    
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
    logger.info('Test message');
    logger.warn('Test warning');
    logger.error(new Error('Test error'));
    
    const formatted = logger.formatCommand('test', '1234567890@s.whatsapp.net', '1234567890@g.us', true);
    assert(formatted.command === 'test', 'Logger: Format command');
    assert(formatted.chat === 'grup', 'Logger: Group detection (Indonesian)');
    assert(formatted.sender === '1234567890@s.whatsapp.net', 'Logger: Full sender ID');
} catch (error) {
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
