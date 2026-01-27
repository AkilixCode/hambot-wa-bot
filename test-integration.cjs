/**
 * Comprehensive Command Integration Tests
 * Tests all commands for proper integration and functionality
 */

const commandRegistry = require('./commands/registry');
const config = require('./config');
const cache = require('./utils/cache');
const path = require('path');

console.log('🧪 Running Comprehensive Command Integration Tests...\n');

let passed = 0;
let failed = 0;
let warnings = 0;

// Main async function
async function runTests() {

function assert(condition, testName) {
    if (condition) {
        console.log(`✅ PASS: ${testName}`);
        passed++;
    } else {
        console.log(`❌ FAIL: ${testName}`);
        failed++;
    }
}

function warn(message) {
    console.log(`⚠️ WARNING: ${message}`);
    warnings++;
}

// Test 1: Load all commands
console.log('📦 Testing Command Loading...\n');
try {
    cache.clear(); // Clear any existing cache
    const commandsPath = path.join(__dirname, 'commands');
    const loaded = commandRegistry.loadFromDirectory(commandsPath);
    
    assert(loaded >= 26, `All commands loaded (found ${loaded})`);
    assert(loaded > 0, 'At least one command loaded');
} catch (error) {
    console.error('Error loading commands:', error.message);
    assert(false, 'Command loading failed');
}

// Test 2: Validate command structure
console.log('\n🔍 Validating Command Structure...\n');

const allCommands = commandRegistry.getAll();
let validStructure = true;

for (const cmd of allCommands) {
    // Check required properties
    if (!cmd.name) {
        warn(`Command missing name property`);
        validStructure = false;
    }
    
    if (!cmd.execute || typeof cmd.execute !== 'function') {
        warn(`Command ${cmd.name} missing execute method`);
        validStructure = false;
    }
    
    if (!cmd.category) {
        warn(`Command ${cmd.name} missing category`);
        validStructure = false;
    }
    
    if (!cmd.description) {
        warn(`Command ${cmd.name} missing description`);
        validStructure = false;
    }
    
    // Check optional but recommended
    if (!cmd.usage) {
        warn(`Command ${cmd.name} missing usage example`);
    }
}

assert(validStructure, 'All commands have valid structure');

// Test 3: Check for duplicate names
console.log('\n🔎 Checking for Duplicates...\n');

const commandNames = new Set();
let hasDuplicates = false;

for (const cmd of allCommands) {
    if (commandNames.has(cmd.name)) {
        warn(`Duplicate command name: ${cmd.name}`);
        hasDuplicates = true;
    }
    commandNames.add(cmd.name);
}

assert(!hasDuplicates, 'No duplicate command names');

// Test 4: Verify aliases work
console.log('\n🔗 Testing Command Aliases...\n');

const aliasTests = [
    { alias: 'p', expected: 'ping' },
    { alias: 'help', expected: 'menu' },
    { alias: 's', expected: 'sticker' },
    { alias: 'calculate', expected: 'calc' },
    { alias: 'coin', expected: 'flip' },
    { alias: 'tr', expected: 'translate' }
];

for (const { alias, expected } of aliasTests) {
    const cmd = commandRegistry.get(alias);
    assert(cmd && cmd.name === expected, `Alias '${alias}' resolves to '${expected}'`);
}

// Test 5: Category distribution
console.log('\n📊 Analyzing Category Distribution...\n');

const categories = commandRegistry.getCategories();
console.log(`Found ${categories.length} categories: ${categories.join(', ')}`);

for (const category of categories) {
    const cmds = commandRegistry.getByCategory(category);
    console.log(`  ${category}: ${cmds.length} commands`);
}

assert(categories.length >= 5, 'Multiple categories exist');

// Test 6: Test command cooldowns
console.log('\n⏱️ Validating Cooldowns...\n');

let cooldownsValid = true;
for (const cmd of allCommands) {
    if (cmd.cooldown < 0 || cmd.cooldown > 60000) {
        warn(`Command ${cmd.name} has unusual cooldown: ${cmd.cooldown}ms`);
        cooldownsValid = false;
    }
}

assert(cooldownsValid, 'All cooldowns are reasonable');

// Test 7: Test heavy command marking
console.log('\n🏋️ Checking Heavy Command Flags...\n');

const heavyCommands = allCommands.filter(cmd => cmd.isHeavy);
console.log(`Heavy commands: ${heavyCommands.map(c => c.name).join(', ')}`);

assert(heavyCommands.length >= 2, `Heavy commands properly marked (${heavyCommands.length})`);

// Test 8: Simulate command execution (dry run)
console.log('\n🎯 Simulating Command Context...\n');

const mockContext = {
    from: '1234567890@s.whatsapp.net',
    sender: '1234567890@s.whatsapp.net',
    isGroup: false,
    commandName: 'test',
    startTime: Date.now()
};

const mockMsg = {
    key: {
        remoteJid: '1234567890@s.whatsapp.net',
        participant: '1234567890@s.whatsapp.net'
    },
    message: {}
};

let executionTestsPassed = 0;

// Test a few commands with mock validation
const testableCommands = ['ping', 'flip', 'dice', 'calc'];

for (const cmdName of testableCommands) {
    const cmd = commandRegistry.get(cmdName);
    if (cmd) {
        try {
            // Test validation method
            if (cmd.validate) {
                const validation = await cmd.validate(mockMsg, mockContext);
                if (validation.valid !== undefined) {
                    executionTestsPassed++;
                }
            } else {
                executionTestsPassed++;
            }
        } catch (error) {
            warn(`Command ${cmdName} validation error: ${error.message}`);
        }
    }
}

assert(executionTestsPassed === testableCommands.length, 
    `Command validation methods work (${executionTestsPassed}/${testableCommands.length})`);

// Test 9: Check command dependencies
console.log('\n📦 Checking External Dependencies...\n');

const dependencyChecks = [
    { name: 'axios', required: true },
    { name: 'sharp', required: true },
    { name: 'puppeteer', required: true }
];

let depsOk = true;
for (const dep of dependencyChecks) {
    try {
        require(dep.name);
        console.log(`  ✓ ${dep.name} available`);
    } catch (error) {
        if (dep.required) {
            warn(`Required dependency ${dep.name} not available`);
            depsOk = false;
        }
    }
}

assert(depsOk, 'All required dependencies available');

// Test 10: Memory efficiency check
console.log('\n💾 Memory Efficiency Check...\n');

const memBefore = process.memoryUsage().heapUsed;
const iterations = 100;

for (let i = 0; i < iterations; i++) {
    // Simulate command lookups
    commandRegistry.get('ping');
    commandRegistry.get('menu');
    commandRegistry.get('calc');
}

const memAfter = process.memoryUsage().heapUsed;
const memIncrease = memAfter - memBefore;
const memIncreaseKB = (memIncrease / 1024).toFixed(2);

console.log(`Memory increase after ${iterations} lookups: ${memIncreaseKB} KB`);
assert(memIncrease < 1024 * 1024, 'Memory usage is efficient'); // Less than 1MB

// Test 11: Cache integration
console.log('\n💾 Testing Cache Integration...\n');

cache.clear();
cache.set('test:weather', { temp: 25 }, 10000);
cache.set('test:crypto', { price: 50000 }, 10000);
cache.set('test:wiki', { title: 'Test' }, 10000);

assert(cache.has('test:weather'), 'Cache stores weather data');
assert(cache.has('test:crypto'), 'Cache stores crypto data');
assert(cache.has('test:wiki'), 'Cache stores wiki data');

cache.clear();

// Test 12: Error handling patterns
console.log('\n🛡️ Validating Error Handling...\n');

let errorHandlingOk = true;
for (const cmd of allCommands) {
    const cmdStr = cmd.execute.toString();
    
    // Check if execute method has try-catch
    if (!cmdStr.includes('try') && !cmdStr.includes('catch')) {
        // Some simple commands might not need try-catch
        if (cmd.isHeavy || cmd.category === 'media') {
            warn(`Heavy/Media command ${cmd.name} should have error handling`);
            errorHandlingOk = false;
        }
    }
}

assert(errorHandlingOk, 'Commands have appropriate error handling');

// Test 13: Response methods
console.log('\n💬 Checking Response Methods...\n');

let responsesOk = true;
for (const cmd of allCommands) {
    if (!cmd.reply || typeof cmd.reply !== 'function') {
        warn(`Command ${cmd.name} missing reply method`);
        responsesOk = false;
    }
    
    if (!cmd.react || typeof cmd.react !== 'function') {
        warn(`Command ${cmd.name} missing react method`);
        responsesOk = false;
    }
}

assert(responsesOk, 'All commands have response methods');

// Test 14: Configuration integration
console.log('\n⚙️ Testing Configuration Integration...\n');

try {
    config.validate();
    assert(config.bot.prefix === '.', 'Config prefix is correct');
    assert(config.performance.maxProcesses >= 1, 'Max processes configured');
    assert(config.performance.cooldownMs > 0, 'Cooldown configured');
} catch (error) {
    assert(false, 'Configuration validation failed');
}

// Test 15: Command documentation completeness
console.log('\n📚 Checking Documentation Completeness...\n');

let docComplete = true;
for (const cmd of allCommands) {
    if (!cmd.description || cmd.description.length < 10) {
        warn(`Command ${cmd.name} has insufficient description`);
        docComplete = false;
    }
    
    if (!cmd.usage) {
        warn(`Command ${cmd.name} missing usage example`);
        docComplete = false;
    }
}

assert(docComplete, 'All commands properly documented');

// Summary
console.log('\n' + '='.repeat(60));
console.log('📊 TEST SUMMARY');
console.log('='.repeat(60));
console.log(`✅ Tests Passed: ${passed}`);
console.log(`❌ Tests Failed: ${failed}`);
console.log(`⚠️ Warnings: ${warnings}`);
console.log(`📦 Commands Loaded: ${allCommands.length}`);
console.log(`📂 Categories: ${categories.length}`);
console.log(`🎯 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
console.log('='.repeat(60));

// Cleanup
cache.destroy();

// Detailed breakdown by category
console.log('\n📋 COMMAND BREAKDOWN BY CATEGORY:\n');
for (const category of categories.sort()) {
    const cmds = commandRegistry.getByCategory(category);
    console.log(`${category.toUpperCase()} (${cmds.length} commands):`);
    cmds.forEach(cmd => {
        const aliases = cmd.aliases.length > 0 ? ` [${cmd.aliases.join(', ')}]` : '';
        console.log(`  • ${cmd.name}${aliases} - ${cmd.description}`);
    });
    console.log('');
}

if (failed === 0 && warnings === 0) {
    console.log('✅ All integration tests passed! System is production-ready.');
    process.exit(0);
} else if (failed === 0 && warnings > 0) {
    console.log(`⚠️ All tests passed with ${warnings} warnings. Review recommended.`);
    process.exit(0);
} else {
    console.log(`❌ ${failed} tests failed, ${warnings} warnings. Please fix issues.`);
    process.exit(1);
}
}

// Run tests
runTests().catch(error => {
    console.error('Fatal error running tests:', error);
    process.exit(1);
});
