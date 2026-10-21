/**
 * AI Chat Client
 *
 * One function, ask(), over four wire formats:
 *
 *   openai     POST {url}/chat/completions (SSE). Local servers (LM Studio,
 *              llama.cpp, vLLM, …), OpenAI-compatible providers, and agents
 *              (Hermes, OpenClaw) with their extras.
 *   ollama     POST {url}/api/chat (NDJSON)
 *   anthropic  the official Anthropic SDK, with this module's transport
 *              plugged in as its fetch()
 *   gemini     POST {url}/models/{model}:streamGenerateContent?alt=sse
 *
 * Every request streams, so the transport's idle timer can tell a backend
 * that is working (any bytes arriving) from one that has died.
 *
 * Every failure becomes a ChatError with a `kind` and a `fix` that names the
 * exact .env variable or platform step to take. Keys never appear in an
 * error: messages from servers pass through redact() and are cut short.
 */

const crypto = require('crypto');
const fs = require('fs');
const transport = require('./transport');
const { redact, fingerprint } = require('../redact');

// Kinds that a retry or a pause will not fix: the backend is set aside until
// its settings change (or `.chat test` shows it works again).
const CONFIG_KINDS = new Set(['auth', 'model', 'endpoint', 'bad_request', 'redirect', 'tls']);
// Kinds that may pass: counted towards CHAT_FAIL_THRESHOLD.
const NETWORK_KINDS = new Set(['refused', 'dns', 'unreachable', 'no_response', 'silent', 'reset', 'server', 'rate', 'empty', 'too_large']);
// Everything else (aborted, max_active, refusal, context) says nothing about
// the backend's health.

const RUNNING_IN_DOCKER = (() => {
    try {
        return fs.existsSync('/.dockerenv');
    } catch {
        return false;
    }
})();

class ChatError extends Error {
    /**
     * @param {string} kind
     * @param {string} summary - Short, for logs: "401 auth", "no response within 90s"
     * @param {Object} [props] - status, serverMessage, fix, partialText, sent, retryAfterMs, models
     */
    constructor(kind, summary, props = {}) {
        super(summary);
        this.name = 'ChatError';
        this.kind = kind;
        this.summary = summary;
        Object.assign(this, props);
    }

    get isConfig() { return CONFIG_KINDS.has(this.kind); }
    get isNetwork() { return NETWORK_KINDS.has(this.kind); }
}

/**
 * Server error text, safe to log: redacted, one line, at most 300 chars.
 * @param {string} text
 * @returns {string}
 */
function cleanServerMessage(text) {
    return redact(String(text || '')).replace(/\s+/g, ' ').trim().slice(0, 300);
}

/**
 * Pull a human message out of an error body in any of the formats we speak.
 * @param {string} body
 * @returns {string}
 */
function extractServerMessage(body) {
    if (!body) return '';
    try {
        const json = JSON.parse(body);
        const err = json.error;
        if (typeof err === 'string') return err;
        if (err && typeof err === 'object') {
            return [err.message, err.status || err.type, err.code].filter(Boolean).join(' · ');
        }
        if (json.message) return json.message;
        if (json.detail) return typeof json.detail === 'string' ? json.detail : JSON.stringify(json.detail);
        return body;
    } catch {
        return body;
    }
}

/**
 * Seconds from a Retry-After header, in ms (or null).
 * @param {Object} headers
 * @returns {number|null}
 */
function retryAfterMs(headers) {
    const value = headers && (headers['retry-after'] || (typeof headers.get === 'function' && headers.get('retry-after')));
    if (!value) return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

/** Platform-specific "is it running?" hint. */
function serviceHint(backend) {
    const host = backend.url ? backend.url.hostname : '';
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(host);
    const hints = [];
    if (RUNNING_IN_DOCKER && loopback) {
        hints.push('inside Docker, localhost is the container itself — use http://host.docker.internal:PORT or the machine\'s Tailscale IP');
    }
    if (RUNNING_IN_DOCKER && host === 'host.docker.internal') {
        hints.push('from the container, this machine is its Docker bridge address: the server must listen there (ip -4 addr show docker0, usually 172.17.0.1), not only on 127.0.0.1 — see docs/ai-chat.md');
    }
    switch (backend.platform) {
        case 'ollama':
            hints.push('is Ollama running (ollama serve)?');
            if (!loopback) hints.push('on that machine Ollama listens only on 127.0.0.1 unless OLLAMA_HOST is set (the Docker bridge address or the Tailscale IP)');
            break;
        case 'hermes':
            hints.push('is `hermes gateway` running with API_SERVER_ENABLED=true?');
            if (!loopback) hints.push('Hermes listens on 127.0.0.1 unless API_SERVER_HOST is set — or expose it with `tailscale serve --bg --tcp 8642 tcp://localhost:8642`');
            break;
        case 'openclaw':
            hints.push('is the OpenClaw gateway running with gateway.http.endpoints.chatCompletions.enabled = true?');
            if (!loopback) hints.push('expose it to the tailnet with `tailscale serve --bg --tcp 18789 tcp://localhost:18789`');
            break;
        default:
            hints.push('is the server running on that address and port?');
    }
    if (host.startsWith('100.') || host.endsWith('.ts.net')) hints.push('is Tailscale up on both machines (tailscale status)?');
    return hints.join('; ');
}

function timeoutVar(backend, which) {
    return `CHAT_${backend.id.toUpperCase()}_${which}_TIMEOUT_SEC`;
}

/**
 * Turn any failure into a ChatError with a fix.
 * @param {Error} error
 * @param {Object} backend
 * @param {Object} [extra] - partialText, status, body, headers
 * @returns {ChatError}
 */
function toChatError(error, backend, extra = {}) {
    if (error instanceof ChatError) {
        if (extra.partialText && !error.partialText) error.partialText = extra.partialText;
        return error;
    }
    const code = error && (error.code || (error.cause && error.cause.code));
    const props = { partialText: extra.partialText || '', sent: Boolean(error && error.sent) };

    switch (code) {
        case 'EABORTED':
            return new ChatError('aborted', error.message || 'cancelled', props);
        case 'EMAXACTIVE':
            return new ChatError('max_active', error.message, { ...props, fix: 'raise CHAT_MAX_ACTIVE_MIN, or set it to 0 for no limit' });
        case 'ENORESPONSE':
            return new ChatError('no_response', error.message, {
                ...props,
                fix: `the server accepted the connection but sent nothing — overloaded, or still loading the model? Raise ${timeoutVar(backend, 'RESPONSE')} if it is only slow to start`
            });
        case 'EIDLE':
            return new ChatError('silent', `went silent (${error.message})`, {
                ...props,
                fix: `the answer stopped arriving mid-way. If the model or agent pauses longer than that on purpose, raise ${timeoutVar(backend, 'IDLE')}`
            });
        case 'ETOOLARGE':
            return new ChatError('too_large', error.message, props);
        case 'ECONNREFUSED':
            return new ChatError('refused', 'connection refused', { ...props, fix: serviceHint(backend) });
        case 'ENOTFOUND':
        case 'EAI_AGAIN':
        case 'EAI_FAIL':
        case 'EAI_NODATA':
            return new ChatError('dns', `host name does not resolve (${code})`, {
                ...props,
                fix: `check ${backend.urlVar}. Inside Docker, MagicDNS names often do not resolve — use the 100.x Tailscale IP (tailscale ip -4 on that machine)`
            });
        case 'ENETUNREACH':
        case 'EHOSTUNREACH':
        case 'EHOSTDOWN':
        case 'ENETDOWN':
            return new ChatError('unreachable', `no route to host (${code})`, {
                ...props,
                fix: 'is that machine on and connected? For a Tailscale address, check `tailscale status` on both machines'
            });
        case 'ECONNRESET':
        case 'EPIPE':
        case 'ERR_STREAM_PREMATURE_CLOSE':
            return new ChatError('reset', `connection closed${props.partialText ? ' mid-answer' : ''}`, {
                ...props,
                fix: 'the server or something in between dropped the connection — check the server\'s own log'
            });
        case 'ETIMEDOUT':
            return new ChatError('no_response', 'connecting timed out', { ...props, fix: serviceHint(backend) });
        default:
            break;
    }

    if (code && /^(ERR_TLS_|ERR_SSL_|CERT_|UNABLE_TO_|DEPTH_ZERO_|SELF_SIGNED_)/.test(code)) {
        return new ChatError('tls', `TLS error (${code})`, {
            ...props,
            fix: `${backend.urlVar} must use the name on the server's certificate; over Tailscale, http:// to the 100.x address is encrypted already`
        });
    }

    return new ChatError('server', cleanServerMessage(error && error.message) || 'unknown error', props);
}

/**
 * Turn a non-2xx HTTP answer into a ChatError.
 * @param {Object} backend
 * @param {number} status
 * @param {string} body
 * @param {Object} headers
 * @returns {ChatError}
 */
function httpError(backend, status, body, headers = {}) {
    const serverMessage = cleanServerMessage(extractServerMessage(body));
    const base = { status, serverMessage };
    const keyNote = backend.key
        ? `loaded key: ${backend.key.length} chars, fingerprint ${fingerprint(backend.key)}`
        : `${backend.keyVar} is empty`;

    if (status >= 300 && status < 400) {
        const location = headers.location || headers.Location || '?';
        return new ChatError('redirect', `HTTP ${status} redirect`, {
            ...base,
            fix: `${backend.urlVar} redirects to ${cleanServerMessage(location)} — put that address in ${backend.urlVar} (redirects are not followed, so the key cannot leak elsewhere)`
        });
    }

    // Gemini answers a bad key with 400 API_KEY_INVALID.
    if (status === 401 || status === 403 || /API_KEY_INVALID|API key not valid|invalid.{0,10}(api.?key|token)|unauthori[sz]ed/i.test(serverMessage)) {
        return new ChatError('auth', `HTTP ${status} auth`, {
            ...base,
            fix: `${backend.keyVar} is wrong, expired or lacks access (${keyNote})`
        });
    }

    if (status === 404 || /model.{0,40}(not found|does not exist|not exist|unknown|invalid)|unknown model|no such model|model_not_found/i.test(serverMessage)) {
        if (/model/i.test(serverMessage) || status !== 404) {
            const pull = backend.api === 'ollama' ? `ollama pull ${backend.model}, or ` : '';
            return new ChatError('model', `model ${backend.model} not found`, {
                ...base,
                fix: `${pull}set ${backend.modelVar} to a model the server has (.chat models lists them)`
            });
        }
        const example = {
            openai: 'https://host/v1',
            ollama: 'http://host:11434',
            anthropic: 'https://api.anthropic.com',
            gemini: 'https://generativelanguage.googleapis.com/v1beta'
        }[backend.api];
        return new ChatError('endpoint', 'HTTP 404 (no such path)', {
            ...base,
            fix: `${backend.urlVar} points at the wrong path — for ${backend.api} it looks like ${example}`
        });
    }

    if (status === 429) {
        return new ChatError('rate', 'HTTP 429 rate limited', {
            ...base,
            retryAfterMs: retryAfterMs(headers),
            fix: 'the provider is rate-limiting this key — wait, lower usage (CHAT_DAILY_LIMIT), or raise the plan\'s limit'
        });
    }

    if (status === 400 || status === 413 || status === 422) {
        if (/context|too long|too many tokens|maximum.{0,20}tokens|prompt is too long|input.{0,20}length/i.test(serverMessage)) {
            return new ChatError('context', `HTTP ${status} input too long`, {
                ...base,
                fix: '.chat reset, or lower CHAT_MEMORY_MAX_CHARS / CHAT_MAX_INPUT'
            });
        }
        return new ChatError('bad_request', `HTTP ${status} bad request`, {
            ...base,
            fix: `the server rejected the request — check ${backend.modelVar} and the model's supported settings (CHAT_TEMPERATURE, CHAT_TOP_P, CHAT_MAX_TOKENS)`
        });
    }

    if (status >= 500) {
        return new ChatError('server', `HTTP ${status} server error`, {
            ...base,
            retryAfterMs: retryAfterMs(headers),
            fix: 'the server failed — check its own log'
        });
    }

    return new ChatError('bad_request', `HTTP ${status}`, { ...base, fix: 'unexpected answer — check the server\'s log' });
}

/** Is this a "this parameter is not supported" 400 from an OpenAI-style server? */
function isUnsupportedParam(error) {
    return error.kind === 'bad_request' &&
        /(max_tokens|temperature|top_p).{0,80}(not supported|unsupported|does not support|only the default)|unsupported (parameter|value)/i.test(error.serverMessage || '');
}

// ─────────────────────────────────────────────────────
//  REQUEST HELPERS
// ─────────────────────────────────────────────────────

function openOptions(backend, ctx, state) {
    return {
        agents: ctx.agents,
        signal: ctx.signal,
        responseTimeoutMs: ctx.responseTimeoutMs || backend.responseTimeoutMs,
        idleTimeoutMs: ctx.idleTimeoutMs || backend.idleTimeoutMs,
        maxActiveMs: ctx.maxActiveMs || null,
        onActivity: () => {
            if (ctx.onActivity) ctx.onActivity({ type: 'bytes' });
        },
        onFail: (error) => { if (state) state.transportError = error; }
    };
}

/**
 * Send a JSON request; on a non-2xx answer throw the mapped ChatError.
 */
async function postJson(backend, ctx, state, url, headers, payload) {
    const res = await transport.open({
        ...openOptions(backend, ctx, state),
        url,
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream, application/x-ndjson, application/json', ...headers },
        body: JSON.stringify(payload)
    });
    if (res.status < 200 || res.status >= 300) {
        const body = await transport.readText(res.body).catch(() => '');
        throw httpError(backend, res.status, body, res.headers);
    }
    return res;
}

function emit(ctx, event) {
    if (!ctx.onActivity) return;
    try {
        ctx.onActivity(event);
    } catch {
        // progress reporting must never break an answer
    }
}

/** System prompt + history in OpenAI chat format. */
function openaiMessages(req) {
    const out = [];
    if (req.system) out.push({ role: 'system', content: req.system });
    for (const m of req.messages) out.push({ role: m.role, content: m.content });
    return out;
}

// ─────────────────────────────────────────────────────
//  OPENAI-STYLE (local servers, providers, agents)
// ─────────────────────────────────────────────────────

async function askOpenAI(backend, req, ctx, state) {
    const url = new URL(`${backend.url.href.replace(/\/$/, '')}/chat/completions`);
    const headers = { ...backend.headers };
    if (backend.key) headers.authorization = `Bearer ${backend.key}`;

    const payload = {
        model: backend.model,
        messages: openaiMessages(req),
        stream: backend.stream
    };

    if (backend.isAgent) {
        // An agent manages its own model, token budget and sampling; capping
        // them here could cut a tool-using run short.
        if (backend.memory === 'agent' && req.sessionKey) {
            if (backend.platform === 'hermes') headers['x-hermes-session-id'] = req.sessionKey;
            if (backend.platform === 'openclaw') payload.user = req.sessionKey;
        }
    } else {
        const tokenField = req.useCompletionTokens || /(^|\.)openai\.com$/i.test(backend.url.hostname)
            ? 'max_completion_tokens'
            : 'max_tokens';
        payload[tokenField] = req.maxTokens;
        if (req.temperature !== null && req.temperature !== undefined && !req.dropSampling) payload.temperature = req.temperature;
        if (req.topP !== null && req.topP !== undefined && !req.dropSampling) payload.top_p = req.topP;
    }

    const res = await postJson(backend, ctx, state, url, headers, payload);
    const type = String(res.headers['content-type'] || '');

    if (!/event-stream/i.test(type)) {
        // A server that ignored stream:true (or CHAT_*_STREAM=false).
        const body = await transport.readText(res.body, transport.MAX_RESPONSE_BYTES);
        let json;
        try {
            json = JSON.parse(body);
        } catch {
            throw new ChatError('empty', 'answer was not JSON', { serverMessage: cleanServerMessage(body) });
        }
        if (json.error) throw httpError(backend, 500, body, res.headers);
        const choice = json.choices && json.choices[0];
        state.text = (choice && choice.message && (choice.message.content || '')) || '';
        state.finish = choice && choice.finish_reason;
        state.model = json.model || backend.model;
        return;
    }

    for await (const evt of transport.sse(res.body)) {
        if (evt.comment !== undefined) {
            emit(ctx, { type: 'keepalive' });
            continue;
        }
        if (evt.event === 'hermes.tool.progress') {
            try {
                const progress = JSON.parse(evt.data);
                if (progress.status !== 'completed') {
                    emit(ctx, { type: 'tool', tool: progress.label || progress.tool, emoji: progress.emoji });
                }
            } catch {
                emit(ctx, { type: 'tool' });
            }
            continue;
        }
        if (evt.data === '[DONE]') break;

        let chunk;
        try {
            chunk = JSON.parse(evt.data);
        } catch {
            continue;
        }
        if (chunk.error) {
            // OpenClaw reports a failed run as an error object in the stream.
            const message = typeof chunk.error === 'string' ? chunk.error : (chunk.error.message || JSON.stringify(chunk.error));
            throw new ChatError('server', 'error in stream', {
                serverMessage: cleanServerMessage(message),
                fix: 'the backend reported a failure mid-answer — see its own log',
                partialText: state.text
            });
        }
        if (chunk.model) state.model = chunk.model;
        const choice = chunk.choices && chunk.choices[0];
        if (!choice) continue;
        const delta = choice.delta || {};
        if (delta.content) {
            state.text += delta.content;
            emit(ctx, { type: 'text' });
        }
        if (delta.reasoning_content || delta.reasoning) emit(ctx, { type: 'reasoning' });
        if (delta.tool_calls) emit(ctx, { type: 'tool' });
        if (choice.finish_reason) state.finish = choice.finish_reason;
    }
}

// ─────────────────────────────────────────────────────
//  OLLAMA
// ─────────────────────────────────────────────────────

async function askOllama(backend, req, ctx, state) {
    const url = new URL(`${backend.url.href.replace(/\/$/, '')}/api/chat`);
    const headers = { ...backend.headers };
    if (backend.key) headers.authorization = `Bearer ${backend.key}`;

    const options = { num_ctx: backend.ollama.numCtx, num_predict: req.maxTokens };
    if (req.temperature !== null && req.temperature !== undefined) options.temperature = req.temperature;
    if (req.topP !== null && req.topP !== undefined) options.top_p = req.topP;

    const res = await postJson(backend, ctx, state, url, headers, {
        model: backend.model,
        messages: openaiMessages(req),
        stream: backend.stream,
        keep_alive: backend.ollama.keepAlive,
        options
    });

    for await (const line of transport.lines(res.body)) {
        if (!line.trim()) continue;
        let chunk;
        try {
            chunk = JSON.parse(line);
        } catch {
            continue;
        }
        if (chunk.error) {
            throw httpError(backend, /not found/i.test(chunk.error) ? 404 : 500, JSON.stringify({ error: chunk.error }), {});
        }
        const message = chunk.message || {};
        if (message.content) {
            state.text += message.content;
            emit(ctx, { type: 'text' });
        }
        if (message.thinking) emit(ctx, { type: 'reasoning' });
        if (chunk.done) {
            state.finish = chunk.done_reason || 'stop';
            break;
        }
    }
    state.model = backend.model;
}

// ─────────────────────────────────────────────────────
//  GEMINI
// ─────────────────────────────────────────────────────

async function askGemini(backend, req, ctx, state) {
    const base = backend.url.href.replace(/\/$/, '');
    const model = encodeURIComponent(backend.model.replace(/^models\//, ''));
    const url = new URL(backend.stream
        ? `${base}/models/${model}:streamGenerateContent?alt=sse`
        : `${base}/models/${model}:generateContent`);
    // The key goes in a header, never in the URL: URLs end up in logs.
    const headers = { ...backend.headers, 'x-goog-api-key': backend.key || '' };

    const generationConfig = { maxOutputTokens: req.maxTokens };
    if (req.temperature !== null && req.temperature !== undefined) generationConfig.temperature = req.temperature;
    if (req.topP !== null && req.topP !== undefined) generationConfig.topP = req.topP;

    const payload = {
        contents: req.messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig
    };
    if (req.system) payload.systemInstruction = { parts: [{ text: req.system }] };

    const res = await postJson(backend, ctx, state, url, headers, payload);

    const handle = (json) => {
        if (json.error) throw httpError(backend, json.error.code || 500, JSON.stringify(json), {});
        if (json.promptFeedback && json.promptFeedback.blockReason) {
            throw new ChatError('refusal', `blocked (${json.promptFeedback.blockReason})`, { partialText: state.text });
        }
        const candidate = json.candidates && json.candidates[0];
        if (!candidate) return;
        for (const part of (candidate.content && candidate.content.parts) || []) {
            if (part.thought) {
                emit(ctx, { type: 'reasoning' });
            } else if (part.text) {
                state.text += part.text;
                emit(ctx, { type: 'text' });
            }
        }
        if (candidate.finishReason) {
            state.finish = candidate.finishReason;
            if (['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII'].includes(candidate.finishReason) && !state.text) {
                throw new ChatError('refusal', `blocked (${candidate.finishReason})`);
            }
        }
        if (json.modelVersion) state.model = json.modelVersion;
    };

    if (!/event-stream/i.test(String(res.headers['content-type'] || ''))) {
        const body = await transport.readText(res.body, transport.MAX_RESPONSE_BYTES);
        try {
            handle(JSON.parse(body));
        } catch (error) {
            if (error instanceof ChatError) throw error;
            throw new ChatError('empty', 'answer was not JSON', { serverMessage: cleanServerMessage(body) });
        }
        return;
    }

    for await (const evt of transport.sse(res.body)) {
        if (evt.comment !== undefined) continue;
        let json;
        try {
            json = JSON.parse(evt.data);
        } catch {
            continue;
        }
        handle(json);
    }
    if (!state.model) state.model = backend.model;
}

// ─────────────────────────────────────────────────────
//  ANTHROPIC (official SDK)
// ─────────────────────────────────────────────────────

let AnthropicSDK = null;

async function askAnthropic(backend, req, ctx, state) {
    // Loaded on first use only; the SDK is large and most installs never need it.
    if (!AnthropicSDK) AnthropicSDK = require('@anthropic-ai/sdk');
    const Anthropic = AnthropicSDK.default || AnthropicSDK.Anthropic;

    const client = new Anthropic({
        apiKey: backend.key || 'missing',
        baseURL: backend.url.href.replace(/\/$/, ''),
        maxRetries: 0,
        // The transport's own response and idle timers apply; the SDK's
        // whole-request timeout would cut long, active answers short.
        timeout: 24 * 60 * 60 * 1000,
        defaultHeaders: backend.headers,
        fetch: transport.makeFetch(openOptions(backend, ctx, state))
    });

    const params = {
        model: backend.model,
        max_tokens: req.maxTokens,
        messages: req.messages.map(m => ({ role: m.role, content: m.content })),
        stream: true
    };
    if (req.system) params.system = req.system;
    // Sampling settings are only sent when set in .env: current models reject them.
    if (!req.dropSampling) {
        if (req.temperature !== null && req.temperature !== undefined) params.temperature = req.temperature;
        if (req.topP !== null && req.topP !== undefined) params.top_p = req.topP;
    }

    let stream;
    try {
        stream = await client.messages.create(params, { signal: ctx.signal });
        for await (const event of stream) {
            if (event.type === 'message_start' && event.message) {
                state.model = event.message.model || backend.model;
            } else if (event.type === 'content_block_delta') {
                if (event.delta.type === 'text_delta') {
                    state.text += event.delta.text;
                    emit(ctx, { type: 'text' });
                } else {
                    emit(ctx, { type: 'reasoning' });
                }
            } else if (event.type === 'message_delta' && event.delta) {
                if (event.delta.stop_reason) state.finish = event.delta.stop_reason;
            }
        }
    } catch (error) {
        if (error instanceof AnthropicSDK.APIError && error.status) {
            const body = JSON.stringify(error.error || { error: { message: error.message } });
            const headers = {};
            if (error.headers && typeof error.headers.forEach === 'function') {
                error.headers.forEach((value, name) => { headers[name] = value; });
            }
            throw httpError(backend, error.status, body, headers);
        }
        // Connection-level: the transport saw what really happened.
        throw state.transportError || error;
    }

    if (state.finish === 'refusal' && !state.text) {
        throw new ChatError('refusal', 'declined by the model');
    }
}

// ─────────────────────────────────────────────────────
//  PUBLIC API
// ─────────────────────────────────────────────────────

const RUNNERS = {
    openai: askOpenAI,
    ollama: askOllama,
    gemini: askGemini,
    anthropic: askAnthropic
};

/**
 * Ask one backend once (plus the safe retries described below).
 *
 * Retries, at most one each, never a loop:
 *   - an OpenAI-style 400 about max_tokens/temperature → max_completion_tokens,
 *     no sampling settings
 *   - a Hermes session the agent no longer knows (404/409) → fresh session
 *   - the connection was refused / reset before the request was sent (it
 *     never arrived, so even an agent cannot have started)
 *   - a 429/503 with Retry-After ≤ 10s, for non-agents only
 *
 * @param {Object} backend - From settings
 * @param {Object} req - { system, messages, maxTokens, temperature, topP, sessionKey }
 * @param {Object} ctx - { signal, onActivity, agents, maxActiveMs, onSessionReset }
 * @returns {Promise<{text: string, model: string, finish: string|null, ms: number}>}
 */
async function ask(backend, req, ctx = {}) {
    const startedAt = Date.now();
    const run = RUNNERS[backend.api];
    if (!run) throw new ChatError('bad_request', `unknown API ${backend.api}`);
    if (!backend.usable) {
        throw new ChatError('bad_request', 'settings incomplete', { fix: backend.unusable.join('; ') });
    }

    const tried = new Set();
    let current = { ...req };

    for (;;) {
        const state = { text: '', model: '', finish: null, transportError: null };
        try {
            await run(backend, current, ctx, state);
            const text = state.text;
            if (!text.trim()) {
                const length = /length|max_tokens|MAX_TOKENS/i.test(state.finish || '');
                throw new ChatError('empty', length ? 'answer cut off before any text (token limit)' : 'empty answer', {
                    fix: length ? 'raise CHAT_MAX_TOKENS (reasoning models spend tokens on thinking first)' : 'try again; if it repeats, check the model on the server'
                });
            }
            return {
                text,
                model: state.model || backend.model,
                finish: state.finish,
                truncated: /length|max_tokens|MAX_TOKENS/i.test(state.finish || ''),
                ms: Date.now() - startedAt
            };
        } catch (raw) {
            const error = toChatError(raw, backend, { partialText: state.text });

            if (!tried.has('params') && backend.api === 'openai' && !backend.isAgent && isUnsupportedParam(error)) {
                tried.add('params');
                current = { ...current, useCompletionTokens: true, dropSampling: true };
                continue;
            }
            if (!tried.has('params') && backend.api === 'anthropic' && error.kind === 'bad_request' &&
                /temperature|top_p/i.test(error.serverMessage || '')) {
                tried.add('params');
                current = { ...current, dropSampling: true };
                continue;
            }
            if (!tried.has('session') && backend.platform === 'hermes' && current.sessionKey &&
                (error.status === 404 || error.status === 409) && /session/i.test(error.serverMessage || '')) {
                tried.add('session');
                const fresh = ctx.onSessionReset ? ctx.onSessionReset() : null;
                current = { ...current, sessionKey: fresh || `${current.sessionKey}-${crypto.randomBytes(2).toString('hex')}` };
                continue;
            }
            const neverArrived = (error.kind === 'refused') || (error.kind === 'reset' && !error.sent && !state.text);
            if (!tried.has('transport') && neverArrived && !(ctx.signal && ctx.signal.aborted)) {
                tried.add('transport');
                await new Promise(resolve => setTimeout(resolve, 400));
                continue;
            }
            const shortWait = error.retryAfterMs !== null && error.retryAfterMs !== undefined && error.retryAfterMs <= 10000;
            if (!tried.has('rate') && !backend.isAgent && (error.status === 429 || error.status === 503) && shortWait && !state.text) {
                tried.add('rate');
                await new Promise(resolve => setTimeout(resolve, error.retryAfterMs));
                continue;
            }

            error.ms = Date.now() - startedAt;
            throw error;
        }
    }
}

/**
 * Model names the backend offers, for `.chat models` and the checks.
 * @param {Object} backend
 * @param {Object} ctx
 * @returns {Promise<string[]>}
 */
async function listModels(backend, ctx = {}) {
    const base = backend.url.href.replace(/\/$/, '');
    let url;
    const headers = { accept: 'application/json', ...backend.headers };
    if (backend.api === 'ollama') {
        url = `${base}/api/tags`;
        if (backend.key) headers.authorization = `Bearer ${backend.key}`;
    } else if (backend.api === 'anthropic') {
        url = `${base}/v1/models?limit=100`;
        headers['x-api-key'] = backend.key || '';
        headers['anthropic-version'] = '2023-06-01';
    } else if (backend.api === 'gemini') {
        url = `${base}/models?pageSize=200`;
        headers['x-goog-api-key'] = backend.key || '';
    } else {
        url = `${base}/models`;
        if (backend.key) headers.authorization = `Bearer ${backend.key}`;
    }

    let res;
    try {
        res = await transport.open({
            ...openOptions(backend, { ...ctx, idleTimeoutMs: ctx.idleTimeoutMs || 20000 }, null),
            url,
            method: 'GET',
            headers
        });
    } catch (error) {
        throw toChatError(error, backend);
    }
    const body = await transport.readText(res.body, 4 * 1024 * 1024).catch(() => '');
    if (res.status < 200 || res.status >= 300) throw httpError(backend, res.status, body, res.headers);

    let json;
    try {
        json = JSON.parse(body);
    } catch {
        throw new ChatError('endpoint', 'model list was not JSON', {
            fix: `${backend.urlVar} may point at the wrong service`
        });
    }
    let names = [];
    if (Array.isArray(json.models)) {
        names = json.models
            .filter(m => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
            .map(m => String(m.name || m.model || '').replace(/^models\//, ''));
    } else if (Array.isArray(json.data)) {
        names = json.data.map(m => String(m.id || m.name || ''));
    }
    return names.filter(Boolean).sort();
}

module.exports = {
    ask,
    listModels,
    ChatError,
    toChatError,
    httpError,
    serviceHint,
    CONFIG_KINDS,
    NETWORK_KINDS
};
