/**
 * Typo Correction Notes
 *
 * When the bot acts on a guess — `.mneu` run as `.menu` — it says so, so the
 * user learns the right name. The note rides on the command's own first reply
 * instead of arriving as an extra message.
 */

const ui = require('./ui');

/**
 * The note line, e.g. "✏️ _.mneu ➜ .menu_".
 * @param {string} typed What the user typed (untrusted, sanitised here)
 * @param {string} meant What the bot ran instead
 * @returns {string}
 */
function correctionNote(typed, meant) {
    return `✏️ ${ui.italic(`${ui.safe(typed, 24)} ${ui.SYM.arrow} ${ui.safe(meant, 32)}`)}`;
}

/**
 * Wrap the socket so the first text or caption a command sends carries the
 * note above it.
 *
 * Reactions carry no text and pass through untouched, as does everything
 * else on the socket (group metadata, presence).
 *
 * @param {Object} sock
 * @param {string} note Line to put above the first reply
 * @returns {Object} Socket stand-in for this one command execution
 */
function withCorrectionNote(sock, note) {
    let pending = true;
    const wrapped = Object.create(sock);
    wrapped.sendMessage = (jid, content, options) => {
        if (pending && content && (typeof content.text === 'string' || typeof content.caption === 'string')) {
            pending = false;
            const key = typeof content.text === 'string' ? 'text' : 'caption';
            content = { ...content, [key]: `${note}\n${content[key]}` };
        }
        return sock.sendMessage(jid, content, options);
    };
    return wrapped;
}

module.exports = { correctionNote, withCorrectionNote };
