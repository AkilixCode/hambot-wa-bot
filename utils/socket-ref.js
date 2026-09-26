/**
 * Current WhatsApp Socket
 *
 * index.js builds a brand-new socket on every reconnect. Anything that sends
 * long after the command that scheduled it — a reminder can be days out —
 * must not hold on to the socket it was created with, because that one is
 * closed by then. It asks here instead, at the moment it actually sends.
 */

let current = null;

/**
 * Record the socket that is live now. Called by index.js on every (re)connect.
 * @param {Object} sock
 */
function set(sock) {
    current = sock;
}

/**
 * @returns {Object|null} The live socket, or null before the first connect
 */
function get() {
    return current;
}

module.exports = { set, get };
