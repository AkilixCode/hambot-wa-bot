/**
 * Group Metadata Cache
 *
 * Baileys needs a group's participant list to encrypt every message sent to
 * that group. Without a `cachedGroupMetadata` option it asks WhatsApp for the
 * whole roster before each send, and the admin check, `.tagall` and `.info`
 * asked again on top — two or three round trips for a single reply.
 *
 * Entries live for a few minutes and are dropped as soon as WhatsApp reports a
 * change (someone joined, left, was promoted), so a stale roster never decides
 * who receives a message or who counts as an admin.
 */

const TTL_MS = 5 * 60 * 1000;
const MAX_GROUPS = 500;

const entries = new Map();   // jid -> { data, at }
const inFlight = new Map();  // jid -> Promise<metadata>
const counters = { hits: 0, misses: 0 };

/**
 * Cached metadata, or undefined when missing or expired. Never fetches.
 * @param {string} jid
 * @returns {Object|undefined}
 */
function peek(jid) {
    const entry = entries.get(jid);
    if (!entry) return undefined;
    if (Date.now() - entry.at > TTL_MS) {
        entries.delete(jid);
        return undefined;
    }
    return entry.data;
}

/**
 * @param {string} jid
 * @param {Object} data
 */
function store(jid, data) {
    if (!jid || !data) return;
    entries.delete(jid);
    if (entries.size >= MAX_GROUPS) {
        // Maps keep insertion order, so the first key is the oldest.
        entries.delete(entries.keys().next().value);
    }
    entries.set(jid, { data, at: Date.now() });
}

/**
 * Metadata for a group, from cache or from WhatsApp. Concurrent misses for
 * the same group share one request.
 * @param {Object} sock
 * @param {string} jid
 * @returns {Promise<Object>}
 */
async function get(sock, jid) {
    const hit = peek(jid);
    if (hit) {
        counters.hits++;
        return hit;
    }
    counters.misses++;

    if (inFlight.has(jid)) return inFlight.get(jid);

    const promise = Promise.resolve(sock.groupMetadata(jid))
        .then(data => {
            store(jid, data);
            return data;
        })
        .finally(() => inFlight.delete(jid));
    inFlight.set(jid, promise);
    return promise;
}

/**
 * Forget one group.
 * @param {string} jid
 */
function invalidate(jid) {
    entries.delete(jid);
}

/** Forget everything (on reconnect, and in tests). */
function clear() {
    entries.clear();
    inFlight.clear();
    counters.hits = 0;
    counters.misses = 0;
}

/**
 * Keep the cache in step with WhatsApp's group events.
 * @param {Object} ev - sock.ev
 */
function attach(ev) {
    // Subject, settings and the like: patch what is cached.
    ev.on('groups.update', updates => {
        for (const update of updates || []) {
            const cached = update?.id && peek(update.id);
            if (cached) store(update.id, { ...cached, ...update });
        }
    });
    // Joins, leaves, promotions: the roster itself changed, so refetch next time.
    ev.on('group-participants.update', ({ id } = {}) => invalidate(id));
    // Full metadata for a group the bot was just added to.
    ev.on('groups.upsert', groups => {
        for (const group of groups || []) store(group?.id, group);
    });
}

/** Events attach() listens to, so a retired socket can be detached. */
const EVENTS = ['groups.update', 'group-participants.update', 'groups.upsert'];

/**
 * @returns {{groups: number, hits: number, misses: number, hitRate: number}}
 */
function stats() {
    const total = counters.hits + counters.misses;
    return {
        groups: entries.size,
        hits: counters.hits,
        misses: counters.misses,
        hitRate: total ? counters.hits / total : 0
    };
}

module.exports = { get, peek, store, invalidate, clear, attach, stats, EVENTS, TTL_MS };
