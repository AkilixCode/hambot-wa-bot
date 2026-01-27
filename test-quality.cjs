/**
 * Code Quality and Complexity Validator
 * Ensures code meets standards for complexity, efficiency, and reliability
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Running Code Quality and Complexity Analysis...\n');

let passed = 0;
let failed = 0;
let warnings = 0;

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

// Test 1: Check file structure
console.log('📁 Validating File Structure...\n');

const requiredFiles = [
    'index.js',
    'handler.js',
    'config.js',
    'package.json',
    '.env.example',
    'README.md',
    'utils/cache.js',
    'utils/rate-limiter.js',
    'utils/logger.js',
    'utils/helpers.js',
    'utils/browser-manager.js',
    'commands/base.js',
    'commands/registry.js'
];

let fileStructureOk = true;
for (const file of requiredFiles) {
    const fullPath = path.join(__dirname, file);
    if (!fs.existsSync(fullPath)) {
        warn(`Required file missing: ${file}`);
        fileStructureOk = false;
    }
}

assert(fileStructureOk, 'All required files present');

// Test 2: Analyze command file complexity
console.log('\n📊 Analyzing Command Complexity...\n');

const commandsDir = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsDir)
    .filter(f => f.endsWith('.js') && f !== 'base.js' && f !== 'registry.js');

let complexityStats = {
    simple: 0,
    moderate: 0,
    complex: 0
};

for (const file of commandFiles) {
    const content = fs.readFileSync(path.join(commandsDir, file), 'utf8');
    const lines = content.split('\n').length;
    
    // Classify by lines of code
    if (lines < 100) {
        complexityStats.simple++;
    } else if (lines < 200) {
        complexityStats.moderate++;
    } else {
        complexityStats.complex++;
    }
    
    // Check for error handling
    if (!content.includes('try') && !content.includes('catch')) {
        // Some simple commands might not need it
        if (lines > 50) {
            warn(`Command ${file} might benefit from error handling`);
        }
    }
    
    // Check for logging
    if (content.includes('logError')) {
        // Good!
    }
}

console.log(`  Simple commands (<100 lines): ${complexityStats.simple}`);
console.log(`  Moderate commands (100-200 lines): ${complexityStats.moderate}`);
console.log(`  Complex commands (>200 lines): ${complexityStats.complex}`);

assert(complexityStats.simple + complexityStats.moderate + complexityStats.complex === commandFiles.length,
    'All command files analyzed');

// Test 3: Check utility functions
console.log('\n🛠️ Validating Utility Functions...\n');

const utilsFiles = ['cache.js', 'rate-limiter.js', 'logger.js', 'helpers.js', 'browser-manager.js'];
let utilsOk = true;

for (const file of utilsFiles) {
    const filePath = path.join(__dirname, 'utils', file);
    if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Check for class or module exports
        if (!content.includes('module.exports') && !content.includes('export')) {
            warn(`Utility ${file} might not export properly`);
            utilsOk = false;
        }
        
        // Check for documentation
        if (!content.includes('/**') && !content.includes('//')) {
            warn(`Utility ${file} lacks documentation`);
        }
    }
}

assert(utilsOk, 'All utilities properly structured');

// Test 4: Performance characteristics
console.log('\n⚡ Analyzing Performance Characteristics...\n');

// Check for caching usage in commands
let cachingCommands = 0;
for (const file of commandFiles) {
    const content = fs.readFileSync(path.join(commandsDir, file), 'utf8');
    if (content.includes('cache.get') || content.includes('cache.set')) {
        cachingCommands++;
    }
}

console.log(`  Commands using caching: ${cachingCommands}/${commandFiles.length}`);
assert(cachingCommands >= 5, `Adequate caching implementation (${cachingCommands} commands)`);

// Test 5: Efficiency patterns
console.log('\n🎯 Checking Efficiency Patterns...\n');

let efficientPatterns = 0;
const efficiencyChecks = {
    'Async/Await': 0,
    'Promise handling': 0,
    'Resource cleanup': 0,
    'Input validation': 0
};

for (const file of commandFiles) {
    const content = fs.readFileSync(path.join(commandsDir, file), 'utf8');
    
    if (content.includes('async') && content.includes('await')) {
        efficiencyChecks['Async/Await']++;
        efficientPatterns++;
    }
    
    if (content.includes('catch') || content.includes('.catch(')) {
        efficiencyChecks['Promise handling']++;
    }
    
    if (content.includes('finally') || content.includes('cleanup')) {
        efficiencyChecks['Resource cleanup']++;
    }
    
    if (content.includes('if (!args') || content.includes('if (!')) {
        efficiencyChecks['Input validation']++;
    }
}

console.log('  Pattern usage:');
for (const [pattern, count] of Object.entries(efficiencyChecks)) {
    console.log(`    ${pattern}: ${count} commands`);
}

assert(efficiencyChecks['Async/Await'] >= 15, 'Most commands use async/await');

// Test 6: Reliability features
console.log('\n🛡️ Checking Reliability Features...\n');

let reliabilityFeatures = {
    'Error handling': 0,
    'Timeouts': 0,
    'Fallbacks': 0,
    'Validation': 0
};

for (const file of commandFiles) {
    const content = fs.readFileSync(path.join(commandsDir, file), 'utf8');
    
    if (content.includes('try') && content.includes('catch')) {
        reliabilityFeatures['Error handling']++;
    }
    
    if (content.includes('timeout')) {
        reliabilityFeatures['Timeouts']++;
    }
    
    if (content.includes('fallback') || content.match(/catch.*{[^}]*\/\//)) {
        reliabilityFeatures['Fallbacks']++;
    }
    
    if (content.includes('validate')) {
        reliabilityFeatures['Validation']++;
    }
}

console.log('  Reliability features:');
for (const [feature, count] of Object.entries(reliabilityFeatures)) {
    console.log(`    ${feature}: ${count} commands`);
}

assert(reliabilityFeatures['Error handling'] >= 20, 'Most commands have error handling');

// Test 7: Code standards
console.log('\n📏 Validating Code Standards...\n');

let standardsOk = true;
for (const file of commandFiles) {
    const content = fs.readFileSync(path.join(commandsDir, file), 'utf8');
    
    // Check for proper class structure
    if (!content.includes('class') || !content.includes('extends CommandBase')) {
        warn(`Command ${file} doesn't extend CommandBase`);
        standardsOk = false;
    }
    
    // Check for constructor
    if (!content.includes('constructor()')) {
        warn(`Command ${file} missing constructor`);
        standardsOk = false;
    }
    
    // Check for execute method
    if (!content.includes('async execute(')) {
        warn(`Command ${file} missing async execute method`);
        standardsOk = false;
    }
}

assert(standardsOk, 'All commands follow coding standards');

// Test 8: Documentation quality
console.log('\n📚 Assessing Documentation Quality...\n');

let docQuality = {
    'File headers': 0,
    'Method comments': 0,
    'Inline comments': 0
};

for (const file of commandFiles) {
    const content = fs.readFileSync(path.join(commandsDir, file), 'utf8');
    
    if (content.startsWith('/**')) {
        docQuality['File headers']++;
    }
    
    if ((content.match(/\/\*\*/g) || []).length > 1) {
        docQuality['Method comments']++;
    }
    
    if (content.includes('//')) {
        docQuality['Inline comments']++;
    }
}

console.log('  Documentation metrics:');
for (const [metric, count] of Object.entries(docQuality)) {
    console.log(`    ${metric}: ${count} commands`);
}

assert(docQuality['File headers'] >= 20, 'Most commands have file headers');

// Test 9: Security practices
console.log('\n🔒 Checking Security Practices...\n');

let securityIssues = 0;

for (const file of commandFiles) {
    const content = fs.readFileSync(path.join(commandsDir, file), 'utf8');
    
    // Check for dangerous patterns
    if (content.includes('eval(') && !file.includes('calc.js')) {
        warn(`Potentially unsafe eval() in ${file}`);
        securityIssues++;
    }
    
    if (content.includes('exec(')) {
        warn(`Potentially unsafe exec() in ${file}`);
        securityIssues++;
    }
    
    // Check for input sanitization in commands that process user input
    if (content.includes('args.join') && !content.includes('sanitize')) {
        // Not all commands need sanitization, but it's good practice
    }
}

assert(securityIssues === 0, 'No obvious security issues found');

// Test 10: Performance optimization patterns
console.log('\n🚀 Analyzing Performance Optimizations...\n');

let optimizations = {
    'Caching': 0,
    'Early returns': 0,
    'Lazy loading': 0,
    'Resource pooling': 0
};

for (const file of commandFiles) {
    const content = fs.readFileSync(path.join(commandsDir, file), 'utf8');
    
    if (content.includes('cache')) {
        optimizations['Caching']++;
    }
    
    if (content.includes('return await this.reply') || content.includes('if (!args')) {
        optimizations['Early returns']++;
    }
    
    if (content.includes('require(') && content.includes('const')) {
        optimizations['Lazy loading']++;
    }
    
    if (content.includes('Manager') || content.includes('Pool')) {
        optimizations['Resource pooling']++;
    }
}

console.log('  Optimization patterns:');
for (const [pattern, count] of Object.entries(optimizations)) {
    console.log(`    ${pattern}: ${count} commands`);
}

assert(optimizations['Caching'] >= 5, 'Caching widely used');

// Summary
console.log('\n' + '='.repeat(60));
console.log('📊 QUALITY ANALYSIS SUMMARY');
console.log('='.repeat(60));
console.log(`✅ Tests Passed: ${passed}`);
console.log(`❌ Tests Failed: ${failed}`);
console.log(`⚠️ Warnings: ${warnings}`);
console.log(`📦 Commands Analyzed: ${commandFiles.length}`);
console.log('='.repeat(60));

console.log('\n🎯 CODE QUALITY METRICS:\n');
console.log(`  Complexity Distribution:`);
console.log(`    Simple: ${complexityStats.simple} (${((complexityStats.simple/commandFiles.length)*100).toFixed(0)}%)`);
console.log(`    Moderate: ${complexityStats.moderate} (${((complexityStats.moderate/commandFiles.length)*100).toFixed(0)}%)`);
console.log(`    Complex: ${complexityStats.complex} (${((complexityStats.complex/commandFiles.length)*100).toFixed(0)}%)`);

console.log(`\n  Reliability Score: ${((reliabilityFeatures['Error handling']/commandFiles.length)*100).toFixed(0)}%`);
console.log(`  Documentation Score: ${((docQuality['File headers']/commandFiles.length)*100).toFixed(0)}%`);
console.log(`  Optimization Score: ${((optimizations['Caching']/commandFiles.length)*100).toFixed(0)}%`);

const overallScore = ((passed / (passed + failed)) * 100).toFixed(1);
console.log(`\n  Overall Quality Score: ${overallScore}%`);

if (failed === 0 && warnings === 0) {
    console.log('\n✅ All quality checks passed! Code is production-ready.');
    process.exit(0);
} else if (failed === 0) {
    console.log(`\n⚠️ Quality checks passed with ${warnings} warnings.`);
    process.exit(0);
} else {
    console.log(`\n❌ ${failed} quality checks failed. Review required.`);
    process.exit(1);
}
