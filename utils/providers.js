/**
 * Provider Cascade with Circuit Breaker
 *
 * Every external media source this bot depends on will eventually break —
 * Pinterest changes an internal endpoint, YouTube tightens bot detection, an
 * API goes down. The previous design had each command bound to exactly one
 * method, so any upstream change took the whole command offline until someone
 * shipped a fix.
 *
 * This module inverts that: a command declares an ordered list of ways to get
 * what it needs, and the cascade walks them until one succeeds. Adding or
 * reordering a source becomes a few lines instead of a rewrite.
 *
 * The circuit breaker matters as much as the ordering. Without it, a dead
 * primary provider costs every single invocation its full timeout before the
 * fallback is even attempted — users would wait 30s for something the bot
 * already knew was broken. After N consecutive failures a provider is skipped
 * outright, with an exponential cool-down and a single trial request to detect
 * recovery.
 *
 * Health state is in-memory and per-process, matching the existing cache and
 * rate-limiter (utils/cache.js, utils/rate-limiter.js).
 */

const logger = require('./logger');

// Consecutive failures before a provider is taken out of rotation.
const FAILURE_THRESHOLD = 3;

// Cool-down doubles per consecutive trip, capped so a provider always gets
// retried eventually rather than being written off for the process lifetime.
const BASE_COOLDOWN_MS = 60 * 1000;      // 1 minute
const MAX_COOLDOWN_MS = 30 * 60 * 1000;  // 30 minutes

/**
 * Health record per provider id.
 * @type {Map<string, {failures: number, trips: number, openUntil: number,
 *                     successes: number, totalFailures: number,
 *                     lastError: string|null, lastSuccess: number|null}>}
 */
const health = new Map();

function _record(id) {
    if (!health.has(id)) {
        health.set(id, {
            failures: 0,
            trips: 0,
            openUntil: 0,
            successes: 0,
            totalFailures: 0,
            lastError: null,
            lastSuccess: null
        });
    }
    return health.get(id);
}

/**
 * Whether a provider is currently short-circuited.
 * @param {string} id - Provider id
 * @returns {boolean}
 */
function isOpen(id) {
    const rec = health.get(id);
    return Boolean(rec && rec.openUntil > Date.now());
}

/**
 * Record a success and fully close the breaker.
 * @param {string} id - Provider id
 */
function recordSuccess(id) {
    const rec = _record(id);
    rec.failures = 0;
    rec.trips = 0;
    rec.openUntil = 0;
    rec.successes++;
    rec.lastSuccess = Date.now();
}

/**
 * Record a failure, tripping the breaker once the threshold is crossed.
 * @param {string} id - Provider id
 * @param {Error} error - The failure
 */
function recordFailure(id, error) {
    const rec = _record(id);
    rec.failures++;
    rec.totalFailures++;
    rec.lastError = error && error.message ? error.message : String(error);

    if (rec.failures >= FAILURE_THRESHOLD) {
        rec.trips++;
        const cooldown = Math.min(BASE_COOLDOWN_MS * (2 ** (rec.trips - 1)), MAX_COOLDOWN_MS);
        rec.openUntil = Date.now() + cooldown;
        rec.failures = 0; // Reset so recovery needs a fresh run of failures to re-trip.
        logger.warn(
            `Provider "${id}" circuit opened for ${Math.round(cooldown / 1000)}s - ${rec.lastError}`
        );
    }
}

/**
 * Run providers in order until one produces a usable result.
 *
 * A provider "succeeds" when it returns a value that passes `isSuccess`. The
 * default treats null/undefined and empty arrays as failure, because an empty
 * result from a scraper almost always means "blocked", not "nothing matched" —
 * and should fall through to the next source rather than be reported as an
 * empty success.
 *
 * @param {string} group - Label for logging (e.g. 'pinterest', 'music')
 * @param {Array<{id: string, label?: string, run: Function}>} providers - Ordered candidates
 * @param {Object} [options]
 * @param {Function} [options.isSuccess] - Predicate deciding whether a result counts
 * @param {boolean} [options.respectBreaker=true] - Honour open circuits
 * @returns {Promise<{result: *, providerId: string, providerLabel: string,
 *                   degraded: boolean, attempts: Array}>}
 * @throws {Error} When every provider fails; `.attempts` carries the per-provider detail
 */
async function runProviders(group, providers, options = {}) {
    const {
        isSuccess = (value) => value !== null && value !== undefined &&
                               !(Array.isArray(value) && value.length === 0),
        respectBreaker = true
    } = options;

    const attempts = [];
    let skippedAll = true;

    for (let i = 0; i < providers.length; i++) {
        const provider = providers[i];
        const { id, run } = provider;
        const label = provider.label || id;

        // The last provider is always attempted even if its breaker is open —
        // a stale breaker must never be the reason the user gets nothing at all.
        const isLast = i === providers.length - 1;
        if (respectBreaker && isOpen(id) && !isLast) {
            attempts.push({ id, status: 'skipped', reason: 'circuit open' });
            logger.debug(`[${group}] skipping "${id}" (circuit open)`);
            continue;
        }

        skippedAll = false;
        const started = Date.now();

        try {
            const result = await run();

            if (!isSuccess(result)) {
                const empty = new Error('Provider returned no usable result');
                recordFailure(id, empty);
                attempts.push({ id, status: 'empty', ms: Date.now() - started });
                logger.debug(`[${group}] "${id}" returned nothing usable`);
                continue;
            }

            recordSuccess(id);
            attempts.push({ id, status: 'ok', ms: Date.now() - started });

            // degraded = we fell past the preferred source, so the caller can
            // badge the output.
            const degraded = i > 0;
            if (degraded) {
                logger.info(`[${group}] served by fallback "${id}" (tier ${i + 1})`);
            }

            return { result, providerId: id, providerLabel: label, degraded, attempts };
        } catch (error) {
            recordFailure(id, error);
            attempts.push({
                id,
                status: 'error',
                error: error.message,
                ms: Date.now() - started
            });
            logger.debug(`[${group}] "${id}" failed - ${error.message}`);
        }
    }

    const failure = new Error(
        skippedAll
            ? `All ${group} providers are circuit-open`
            : `All ${group} providers failed`
    );
    failure.attempts = attempts;
    throw failure;
}

/**
 * Snapshot of provider health for the media doctor command.
 * @returns {Array<Object>} One entry per provider seen this process
 */
function getHealth() {
    const now = Date.now();
    return Array.from(health.entries()).map(([id, rec]) => ({
        id,
        open: rec.openUntil > now,
        opensInMs: rec.openUntil > now ? rec.openUntil - now : 0,
        consecutiveFailures: rec.failures,
        successes: rec.successes,
        totalFailures: rec.totalFailures,
        lastError: rec.lastError,
        lastSuccess: rec.lastSuccess
    }));
}

/**
 * Clear all breakers. Exposed for the owner's `.security clearcache` path and
 * for tests.
 */
function resetHealth() {
    health.clear();
}

module.exports = {
    runProviders,
    getHealth,
    resetHealth,
    isOpen,
    recordSuccess,
    recordFailure,
    FAILURE_THRESHOLD
};
