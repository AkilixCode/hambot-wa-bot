/**
 * Network Context — per-command correlation
 *
 * A single `.pinterest` run makes one search call and five image downloads;
 * `.music` runs yt-dlp twice. When several users run commands at once, their
 * network log lines interleave and nobody can tell which failure belonged to
 * whom.
 *
 * handler.js runs each command inside a context (AsyncLocalStorage), and every
 * network event logged while it runs is tagged `[.pinterest #a3f9]` and counted
 * into that command's totals — with no change to any command's code.
 *
 * No project imports, so logger.js can depend on it.
 */

const { AsyncLocalStorage } = require('node:async_hooks');
const crypto = require('crypto');

const storage = new AsyncLocalStorage();

/**
 * Fresh, zeroed counters for one command run.
 * @returns {Object}
 */
function emptyStats() {
    return {
        requests: 0,   // HTTP requests that reached a final outcome
        ok: 0,
        failed: 0,
        retries: 0,
        fallbacks: 0,  // proxy -> direct switches
        bytes: 0,
        ytdlp: 0,      // yt-dlp runs
        routes: new Set()
    };
}

/**
 * Create a context for a command run.
 * @param {string} command - Canonical command name
 * @returns {{command: string, id: string, stats: Object}}
 */
function create(command) {
    return {
        command,
        id: crypto.randomBytes(2).toString('hex'),
        stats: emptyStats()
    };
}

/**
 * Run `fn` with `ctx` as the active network context.
 * @param {Object} ctx - From create()
 * @param {Function} fn
 * @returns {*} Whatever fn returns
 */
function run(ctx, fn) {
    return storage.run(ctx, fn);
}

/**
 * The active context, or null outside a command.
 * @returns {Object|null}
 */
function current() {
    return storage.getStore() || null;
}

/**
 * The tag printed in front of a network log line, e.g. `.pinterest #a3f9`.
 * @returns {string|null}
 */
function tag() {
    const ctx = current();
    return ctx ? `.${ctx.command} #${ctx.id}` : null;
}

module.exports = { create, run, current, tag, emptyStats };
