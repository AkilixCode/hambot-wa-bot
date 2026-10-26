/**
 * AI Chat Check
 *
 * Tests each configured backend the way the bot will use it, and says what
 * to fix. Used by `.chat test`, `./deploy.sh chat` and `./deploy.sh doctor`:
 *
 *   1. settings usable (URL, model, key, http-vs-https)
 *   2. reachable and the key accepted (model list)
 *   3. the model exists on the server
 *   4. a one-word answer (not for agents: that would start a real agent run)
 *
 * From the shell:  node -e "require('./utils/chat/check').main()"
 * prints `ok` / `FIX` / `note` lines and exits 0 (all fine), 1 (something
 * to fix) or 3 (AI chat is off). It finishes on its own: every request runs
 * under the same response and silence timers as a real question, and an
 * overall deadline ends the process even if something unexpected hangs.
 */

const settingsLib = require('./settings');

const PROBE_PROMPT = 'Reply with the single word: OK';

/**
 * Probe one backend.
 * @param {Object} backend - From settings
 * @param {Object} [opts]
 * @param {Object} [opts.agents]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ok: boolean, lines: Array<{level: string, text: string}>, error: Object|null, models: string[]}>}
 */
async function probe(backend, opts = {}) {
    const client = require('./client');
    const { maskHost } = require('../redact');
    const lines = [];
    const add = (level, text) => lines.push({ level, text });
    const where = backend.url ? `${backend.url.protocol}//${maskHost(backend.url.hostname)}${backend.url.port ? `:${backend.url.port}` : ''}` : '?';

    if (!backend.usable) {
        for (const reason of backend.unusable) add('FIX', `${backend.label}: ${reason}`);
        return { ok: false, lines, error: { kind: 'bad_config', summary: backend.unusable[0], fix: backend.unusable.join('; ') }, models: [] };
    }

    const ctx = {
        agents: opts.agents,
        signal: opts.signal,
        // A probe should not wait as long as a real answer may.
        responseTimeoutMs: Math.min(backend.responseTimeoutMs, 30000),
        idleTimeoutMs: Math.min(backend.idleTimeoutMs, 30000)
    };

    let models = [];
    try {
        models = await client.listModels(backend, ctx);
        add('ok', `${backend.label} reachable at ${where} — key accepted, ${models.length} model${models.length === 1 ? '' : 's'} listed`);
    } catch (error) {
        if (error.kind === 'endpoint' || error.kind === 'bad_request') {
            add('note', `${backend.label}: no model list at ${where} (${error.summary}) — trying a question instead`);
        } else {
            add('FIX', `${backend.label}: ${error.summary} — ${error.fix || error.serverMessage || 'see the bot log'}`);
            return { ok: false, lines, error, models };
        }
    }

    if (models.length) {
        const want = backend.model.replace(/^models\//, '');
        const found = models.some(m => m === want || m === `${want}:latest` || m.replace(/:latest$/, '') === want);
        if (found) {
            add('ok', `${backend.label}: model ${backend.model} is available`);
        } else {
            const list = models.slice(0, 8).join(', ') + (models.length > 8 ? ', …' : '');
            const fix = backend.api === 'ollama' ? `ollama pull ${backend.model}, or set ${backend.modelVar} to one of: ${list}` : `set ${backend.modelVar} to one of: ${list}`;
            if (backend.isAgent) {
                add('note', `${backend.label}: ${backend.model} is not in the agent's list (${list}) — it may still answer with its default`);
            } else {
                add('FIX', `${backend.label}: model ${backend.model} not found — ${fix}`);
                return { ok: false, lines, error: { kind: 'model', summary: `model ${backend.model} not found`, fix }, models };
            }
        }
    }

    if (backend.isAgent) {
        add('note', `${backend.label}: not asked a test question (that would start a real agent run) — your first .chat is the real test`);
        return { ok: true, lines, error: null, models };
    }

    try {
        const answer = await client.ask(backend, {
            system: '',
            messages: [{ role: 'user', content: PROBE_PROMPT }],
            maxTokens: 512,
            temperature: null,
            topP: null
        }, ctx);
        add('ok', `${backend.label}: answered in ${(answer.ms / 1000).toFixed(1)}s (${answer.model})`);
        return { ok: true, lines, error: null, models };
    } catch (error) {
        if (error.kind === 'empty' && /token limit/.test(error.summary)) {
            add('note', `${backend.label}: reachable, but the test answer hit the token limit while thinking — raise CHAT_MAX_TOKENS if real answers come back empty`);
            return { ok: true, lines, error: null, models };
        }
        add('FIX', `${backend.label}: ${error.summary} — ${error.fix || error.serverMessage || 'see the bot log'}`);
        return { ok: false, lines, error, models };
    }
}

/**
 * Shell entry point for deploy.sh.
 */
async function main() {
    require('../env');
    const settings = settingsLib.load(process.env);
    const print = (level, text) => console.log(`${level.padEnd(4)} ${text}`);

    // Belt and braces: every request has its own timers, but nothing may hang the installer.
    const deadline = setTimeout(() => {
        print('FIX', 'the check did not finish within 3 minutes — see ./deploy.sh logs');
        process.exit(1);
    }, 3 * 60 * 1000);

    if (!settings.enabled) {
        print('note', 'AI chat is off (CHAT_ENABLED=false)');
        clearTimeout(deadline);
        process.exit(3);
    }

    let fixes = 0;
    for (const problem of settings.problems) {
        const fatal = /this backend is off until fixed|has no settings/.test(problem);
        print(fatal ? 'FIX' : 'note', problem);
        if (fatal) fixes++;
    }

    const ids = [settings.backend, settings.fallback].filter(id => id && id !== 'none' && settings.backends[id]);
    if (!ids.length) {
        print('FIX', `CHAT_BACKEND=${settings.backend} has no settings — run ./deploy.sh chat`);
        fixes++;
    }
    const seen = new Set();
    for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        const backend = settings.backends[id];
        if (!backend.usable) continue; // already reported above
        const result = await probe(backend);
        for (const line of result.lines) {
            print(line.level, line.text);
            if (line.level === 'FIX') fixes++;
        }
    }

    try {
        require('./transport').destroyAgents();
    } catch {
        // nothing to close
    }
    clearTimeout(deadline);
    process.exit(fixes ? 1 : 0);
}

module.exports = { probe, main, PROBE_PROMPT };
