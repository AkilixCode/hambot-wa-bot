/**
 * Cached Fetch
 *
 * Seven commands (crypto, gempa, weather, movie, ipinfo, wiki, pinterest) each
 * hand-wrote the same four steps: look in the cache, fetch on a miss, write
 * back with a TTL, then badge the reply with ui.sourceBadge(fromCache). Same
 * shape every time, with small inconsistencies between copies — some cached
 * failures, some forgot the badge.
 *
 * This collapses it into one call that always returns whether the value came
 * from cache, so the badge can never drift out of sync with reality.
 */

const cache = require('./cache');
const logger = require('./logger');

/**
 * Return a cached value, or produce and cache a fresh one.
 *
 * Failures are never cached — an upstream blip must not be pinned in memory
 * for the whole TTL. In-flight requests for the same key are shared, so a
 * burst of identical commands makes one upstream call rather than N.
 *
 * @param {string} key - Cache key
 * @param {number} ttl - Time to live in milliseconds
 * @param {Function} producer - async () => value, called only on a miss
 * @param {Object} [options]
 * @param {Function} [options.isCacheable] - Predicate; skip caching when false
 * @returns {Promise<{data: *, fromCache: boolean}>}
 */
async function cachedFetch(key, ttl, producer, options = {}) {
    const { isCacheable = (value) => value !== null && value !== undefined } = options;

    const hit = cache.get(key);
    if (hit !== null && hit !== undefined) {
        return { data: hit, fromCache: true };
    }

    // Coalesce concurrent misses for the same key.
    if (inFlight.has(key)) {
        return { data: await inFlight.get(key), fromCache: false };
    }

    const promise = (async () => {
        const value = await producer();
        if (isCacheable(value)) {
            cache.set(key, value, ttl);
        }
        return value;
    })();

    inFlight.set(key, promise);

    try {
        const data = await promise;
        return { data, fromCache: false };
    } catch (error) {
        logger.debug(`cachedFetch miss failed for "${key}" - ${error.message}`);
        throw error;
    } finally {
        inFlight.delete(key);
    }
}

/** @type {Map<string, Promise<*>>} */
const inFlight = new Map();

/**
 * Drop a cached entry, forcing the next call to refetch.
 * @param {string} key
 */
function invalidate(key) {
    cache.delete(key);
}

module.exports = { cachedFetch, invalidate };
