/**
 * Per-Sender Ordering
 *
 * WhatsApp delivers messages in batches (several at once after a reconnect or
 * a busy moment). index.js used to await each message of a batch in turn, so
 * one 40-second `.video` held up a `.ping` from someone else entirely.
 *
 * Now each sender gets their own chain: one person's messages still run in
 * the order they were sent, and everyone else runs alongside. Chains are
 * dropped as soon as they drain, so the map only holds senders with work
 * in progress.
 */

const tails = new Map(); // sender -> Promise that settles when their queue drains

/**
 * Run `task` after every earlier task for the same key has settled.
 * @param {string} key - Sender JID
 * @param {Function} task - async () => *
 * @returns {Promise<*>} The task's own result (or rejection)
 */
function run(key, task) {
    const previous = tails.get(key) || Promise.resolve();
    const result = previous.then(() => task());
    const tail = result.catch(() => {});
    tails.set(key, tail);
    tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key);
    });
    return result;
}

/** @returns {number} Senders with work queued or running */
function size() {
    return tails.size;
}

module.exports = { run, size };
