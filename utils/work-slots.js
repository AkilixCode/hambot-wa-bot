/**
 * Heavy-Command Slots
 *
 * Downloads and conversions are capped at MAX_PROCESSES at a time. The handler
 * used to answer "Sedang Sibuk" the moment the cap was reached, so the user had
 * to notice, wait and resend. Now a few requests wait in line instead and run
 * as soon as a slot frees up; only when the line itself is full, or a wait
 * runs too long, is the user turned away.
 */

class WorkSlots {
    /**
     * @param {number|Function} limit - Commands allowed to run at once, or a
     *   function returning it (`.security` can change MAX_PROCESSES live)
     * @param {number|Function} queueMax - Commands allowed to wait for a slot
     */
    constructor(limit, queueMax) {
        this.getLimit = typeof limit === 'function' ? limit : () => limit;
        this.getQueueMax = typeof queueMax === 'function' ? queueMax : () => queueMax;
        this.active = 0;
        this.waiters = [];
    }

    /** @returns {number} Commands waiting for a slot */
    get waiting() {
        return this.waiters.length;
    }

    /** @returns {boolean} Whether a new request would be turned away */
    get queueFull() {
        return this.waiters.length >= this.getQueueMax();
    }

    /**
     * Take a free slot without waiting.
     * @returns {boolean}
     */
    tryAcquire() {
        if (this.active >= this.getLimit()) return false;
        this.active++;
        return true;
    }

    /**
     * Wait in line for a slot.
     * @param {number} timeoutMs - Give up after this long
     * @returns {Promise<boolean>} true once a slot is held, false on timeout
     *   or when the line is already full
     */
    wait(timeoutMs) {
        if (this.tryAcquire()) return Promise.resolve(true);
        if (this.queueFull) return Promise.resolve(false);

        return new Promise(resolve => {
            const waiter = { resolve: null, timer: null };
            waiter.timer = setTimeout(() => {
                this.waiters = this.waiters.filter(w => w !== waiter);
                resolve(false);
            }, timeoutMs);
            waiter.resolve = () => {
                clearTimeout(waiter.timer);
                resolve(true);
            };
            this.waiters.push(waiter);
        });
    }

    /** Give a slot back and let the next in line run. */
    release() {
        if (this.active > 0) this.active--;
        while (this.waiters.length && this.active < this.getLimit()) {
            this.active++;
            this.waiters.shift().resolve();
        }
    }
}

// The bot's one set of heavy-command slots, shared by the handler (which
// takes them) and `.ping` (which reports them). Limits are read live, so
// `.security` changes to MAX_PROCESSES apply at once.
const config = require('../config');
const heavy = new WorkSlots(
    () => config.performance.maxProcesses,
    () => config.performance.heavyQueueMax
);

module.exports = WorkSlots;
module.exports.heavy = heavy;
