/**
 * AI Chat Formatting
 *
 * Models answer in Markdown; WhatsApp has its own, smaller syntax. This
 * converts the common parts, removes reasoning blocks that some local models
 * print inline, and splits long answers into messages WhatsApp accepts —
 * at paragraph boundaries, never inside a code block if it can be helped.
 */

const PART_LIMIT = 3800;

/**
 * Remove <think>…</think> style reasoning that models such as DeepSeek-R1
 * and Qwen3 print inline. An opening tag that never closes means the whole
 * rest is reasoning (the model ran out of tokens while thinking).
 * @param {string} text
 * @returns {string}
 */
function stripThinking(text) {
    let out = String(text || '');
    out = out.replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '');
    out = out.replace(/^\s*<(think|thinking|reasoning)>[\s\S]*$/i, '');
    // Some servers send only the closing tag (the opening one is part of the prompt template).
    const close = out.search(/<\/(think|thinking|reasoning)>/i);
    if (close !== -1) out = out.slice(out.indexOf('>', close) + 1);
    return out.trim();
}

/**
 * Convert Markdown outside code blocks.
 * @param {string} text
 * @returns {string}
 */
function convertInline(text) {
    const BOLD_OPEN = '\u0001';
    const BOLD_CLOSE = '\u0002';
    let out = text;

    // Inline code is left alone: protect it from the rules below.
    const codes = [];
    out = out.replace(/`[^`\n]+`/g, m => {
        codes.push(m);
        return `\u0003${codes.length - 1}\u0004`;
    });

    out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (m, alt, url) => url);
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (m, label, url) => (label === url ? url : `${label} (${url})`));

    out = out.replace(/^#{1,6}\s+(.+?)\s*#*\s*$/gm, (m, title) => `${BOLD_OPEN}${title.replace(/\*\*/g, '')}${BOLD_CLOSE}`);
    out = out.replace(/\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*/g, `${BOLD_OPEN}$1${BOLD_CLOSE}`);
    out = out.replace(/__(?=\S)([^_\n]+?)(?<=\S)__/g, `${BOLD_OPEN}$1${BOLD_CLOSE}`);
    // Single *italic* (Markdown) → _italic_ (WhatsApp). Not list bullets.
    out = out.replace(/(^|[^*\w])\*(?=\S)([^*\n]+?)(?<=\S)\*(?!\*)/g, '$1_$2_');
    out = out.replace(/~~(?=\S)([^~\n]+?)(?<=\S)~~/g, '~$1~');
    out = out.replace(/^(\s*)[-*+]\s+/gm, '$1• ');
    out = out.replace(/^\s*([-*_])\1{2,}\s*$/gm, '──────────');
    out = out.replace(/^>\s?/gm, '▎');

    out = out.split(BOLD_OPEN).join('*').split(BOLD_CLOSE).join('*');
    out = out.replace(/\u0003(\d+)\u0004/g, (m, i) => codes[Number(i)]);
    return out;
}

/**
 * Markdown tables read badly in WhatsApp; wrap them in a monospace block
 * and drop the |---| separator row.
 * @param {string} text
 * @returns {string}
 */
function convertTables(text) {
    const lines = text.split('\n');
    const out = [];
    let table = [];
    const flush = () => {
        if (table.length >= 2) {
            out.push('```', ...table.filter(l => !/^\s*\|?\s*:?-{2,}/.test(l)), '```');
        } else {
            out.push(...table);
        }
        table = [];
    };
    for (const line of lines) {
        if (/^\s*\|.*\|\s*$/.test(line)) {
            table.push(line.trim());
        } else {
            flush();
            out.push(line);
        }
    }
    flush();
    return out.join('\n');
}

/**
 * Markdown → WhatsApp formatting, code blocks untouched.
 * @param {string} text
 * @returns {string}
 */
function toWhatsApp(text) {
    const segments = String(text || '').split(/(```[\s\S]*?(?:```|$))/);
    return segments.map((segment, i) => {
        if (i % 2 === 1) {
            // ```python\n → ```\n (WhatsApp would print the language name)
            return segment.replace(/^```[^\n]*\n/, '```\n');
        }
        return convertInline(convertTables(segment));
    }).join('').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Split into WhatsApp-sized parts.
 * @param {string} text
 * @param {Object} [opts]
 * @param {number} [opts.limit] - Characters per part
 * @param {number} [opts.maxParts]
 * @returns {{parts: string[], cut: boolean}}
 */
function split(text, { limit = PART_LIMIT, maxParts = 4 } = {}) {
    // Blocks: code fences stay whole where possible, prose splits at blank lines.
    const blocks = [];
    for (const segment of String(text).split(/(```[\s\S]*?(?:```|$))/)) {
        if (!segment) continue;
        if (segment.startsWith('```')) blocks.push(segment);
        else blocks.push(...segment.split(/\n{2,}/).filter(b => b.trim()));
    }

    // Anything still too long is cut at line ends (or hard, for one huge line).
    const pieces = [];
    for (const block of blocks) {
        if (block.length <= limit) {
            pieces.push(block);
            continue;
        }
        const fenced = block.startsWith('```');
        const inner = fenced ? block.replace(/^```\n?/, '').replace(/\n?```$/, '') : block;
        const room = fenced ? limit - 8 : limit;
        let chunk = '';
        for (const line of inner.split('\n')) {
            let rest = line;
            while (rest.length > room) {
                if (chunk) {
                    pieces.push(fenced ? `\`\`\`\n${chunk}\n\`\`\`` : chunk);
                    chunk = '';
                }
                pieces.push(fenced ? `\`\`\`\n${rest.slice(0, room)}\n\`\`\`` : rest.slice(0, room));
                rest = rest.slice(room);
            }
            if (chunk && chunk.length + 1 + rest.length > room) {
                pieces.push(fenced ? `\`\`\`\n${chunk}\n\`\`\`` : chunk);
                chunk = '';
            }
            chunk = chunk ? `${chunk}\n${rest}` : rest;
        }
        if (chunk) pieces.push(fenced ? `\`\`\`\n${chunk}\n\`\`\`` : chunk);
    }

    const parts = [];
    let current = '';
    for (const piece of pieces) {
        if (current && current.length + 2 + piece.length > limit) {
            parts.push(current);
            current = '';
        }
        current = current ? `${current}\n\n${piece}` : piece;
    }
    if (current) parts.push(current);

    if (parts.length <= maxParts) return { parts, cut: false };
    return { parts: parts.slice(0, maxParts), cut: true };
}

module.exports = { stripThinking, toWhatsApp, split, PART_LIMIT };
