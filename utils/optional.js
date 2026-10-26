/**
 * Optional modules
 *
 * canvas is a native module, and it is the one most likely to be missing:
 * there is no prebuilt binary for every platform (Windows on ARM, musl
 * Linux, some boards), and npm skips an optional dependency that fails to
 * install instead of failing the whole install. The few features that draw
 * with it ask here and degrade when it is absent; the bot itself never
 * depends on it.
 *
 * A failure is remembered, so a missing module costs one attempt per
 * process, not one per message.
 */

const failures = new Map();

/**
 * @param {string} name
 * @returns {*|null} The module, or null if it is not installed or does not load
 */
function optional(name) {
    if (failures.has(name)) return null;
    try {
        return require(name);
    } catch (error) {
        // Not installed, or installed but its native part does not load
        // (wrong platform, missing system library): unavailable either way.
        failures.set(name, error.code === 'MODULE_NOT_FOUND' ? 'not installed' : String(error.message).split('\n')[0]);
        return null;
    }
}

/**
 * @param {string} name
 * @returns {string|null} Why the module is unavailable, null if it loaded or was never asked for
 */
function reason(name) {
    return failures.get(name) || null;
}

module.exports = { optional, reason };
