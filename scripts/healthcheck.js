#!/usr/bin/env node
/**
 * Docker HEALTHCHECK entry point. Exit 0 = healthy, 1 = unhealthy.
 *
 *   node scripts/healthcheck.js              check the running bot
 *   node scripts/healthcheck.js --self-test  verify the rules (image smoke test)
 *
 * Deliberately loads nothing but utils/health (no config, no .env, no
 * Baileys), so it is fast and cannot fail for unrelated reasons.
 */

const health = require('../utils/health');

function selfTest() {
    const now = Date.now();
    const cases = [
        [null, false],
        [{ state: 'open', since: now - 10 * 3600e3, updatedAt: now }, true],
        [{ state: 'linking', since: now - 3600e3, updatedAt: now }, true],
        [{ state: 'close', since: now - 60e3, updatedAt: now }, true],
        [{ state: 'close', since: now - health.DISCONNECTED_GRACE_MS - 1, updatedAt: now }, false],
        [{ state: 'open', since: now, updatedAt: now - health.STALE_AFTER_MS - 1 }, false]
    ];
    for (const [record, expected] of cases) {
        const { healthy, reason } = health.evaluate(record, now);
        if (healthy !== expected) {
            console.error(`self-test failed: ${JSON.stringify(record)} -> ${healthy} (${reason})`);
            process.exit(1);
        }
    }
    console.log('healthcheck self-test ok');
    process.exit(0);
}

if (process.argv.includes('--self-test')) selfTest();

const { healthy, reason } = health.check();
console.log(`${healthy ? 'healthy' : 'unhealthy'}: ${reason}`);
process.exit(healthy ? 0 : 1);
