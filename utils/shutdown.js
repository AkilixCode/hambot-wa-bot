/**
 * Graceful shutdown
 *
 * One routine, however the stop arrives:
 *   - SIGINT   Ctrl+C; pm2 stop on Linux/macOS
 *   - SIGTERM  docker stop; systemd
 *   - SIGHUP   terminal closed; on Windows, the console window closed
 *   - SIGBREAK Ctrl+Break (Windows)
 *   - the "shutdown" message pm2 sends on Windows, where it cannot deliver
 *     signals (ecosystem.config.cjs sets shutdown_with_message there)
 *
 * It runs once: a second signal while it runs changes nothing. Steps run in
 * order, a failing step does not stop the ones after it, and session writes
 * still in flight (track()) are awaited before exit, so a half-written
 * creds.json never costs the linked session.
 *
 * A hard deadline (SHUTDOWN_DEADLINE_MS, default 4s) ends a step that hangs:
 * the process exits 1 and says which step it was. It sits below pm2's
 * kill_timeout and Docker's 10s stop timeout, so the bot finishes its own
 * cleanup before either kills it. Windows ends a process ~10s after its
 * console is closed, whatever it is doing.
 */

const DEFAULT_DEADLINE_MS = 4000;

/**
 * @param {Object} [env=process.env]
 * @returns {number} Milliseconds, 1000-60000
 */
function deadlineMs(env = process.env) {
    const value = Number(env.SHUTDOWN_DEADLINE_MS);
    if (!Number.isFinite(value) || value <= 0) return DEFAULT_DEADLINE_MS;
    return Math.min(Math.max(Math.round(value), 1000), 60000);
}

/**
 * @param {Object} options
 * @param {Array<{name: string, run: Function}>} options.steps - In order
 * @param {number} [options.deadline] - Milliseconds before a forced exit
 * @param {Function} [options.exit=process.exit]
 * @param {Function} [options.log] - (message) => void
 */
function create({ steps, deadline = deadlineMs(), exit = (code) => process.exit(code), log = () => {} }) {
    const pending = new Set();
    let running = null;
    let current = 'starting';

    /**
     * Keep a write the shutdown must wait for.
     * @template T
     * @param {Promise<T>} promise
     * @returns {Promise<T>}
     */
    function track(promise) {
        if (!promise || typeof promise.then !== 'function') return promise;
        pending.add(promise);
        const done = () => pending.delete(promise);
        promise.then(done, done);
        return promise;
    }

    /** Wait until nothing tracked is in flight (a write can start another). */
    async function flush() {
        while (pending.size) await Promise.allSettled([...pending]);
    }

    /**
     * @param {string} [reason]
     * @returns {Promise<void>} Resolves just before exit is called
     */
    function run(reason = 'signal') {
        if (running) return running;
        running = (async () => {
            log(`Shutting down gracefully (${reason})...`);
            const timer = setTimeout(() => {
                log(`Shutdown did not finish within ${Math.round(deadline / 1000)}s (stuck at: ${current}) — exiting now`);
                exit(1);
            }, deadline);

            let failed = false;
            for (const step of steps) {
                current = step.name;
                try {
                    await step.run({ flush });
                } catch (error) {
                    failed = true;
                    log(`Shutdown step "${step.name}" failed: ${error.message}`);
                }
            }
            current = 'pending writes';
            await flush();

            clearTimeout(timer);
            log('Shutdown complete');
            exit(failed ? 1 : 0);
        })();
        return running;
    }

    /**
     * Listen for every stop this platform can deliver.
     * @param {NodeJS.Process} [proc=process]
     */
    function install(proc = process) {
        const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
        if (proc.platform === 'win32') signals.push('SIGBREAK');
        for (const signal of signals) proc.on(signal, () => run(signal));
        proc.on('message', (message) => {
            if (message === 'shutdown') run('pm2 shutdown message');
        });
    }

    return { run, track, flush, install, isShuttingDown: () => running !== null };
}

module.exports = { create, deadlineMs, DEFAULT_DEADLINE_MS };
