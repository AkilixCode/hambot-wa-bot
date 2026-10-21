/**
 * Network Error Classification
 *
 * Every network decision the bot makes — retry or not, fall back to the
 * server's own IP or not, what to print in the log — hinges on one question:
 * what actually went wrong, and whose fault was it?
 *
 * The previous answer was a substring check (`isProxyConnectionError`) that
 * treated any timeout or DNS failure as "the proxy is dead". A slow target
 * then cost the full timeout twice — once through the proxy, once direct —
 * and leaked the request to the datacenter IP the proxy existed to hide.
 *
 * Proxy faults are now flagged at the source: utils/http-client wraps the
 * proxy agents so anything that fails while talking to the proxy itself
 * carries `proxyFault: true`. This module only reads that flag; it never
 * guesses a proxy fault from a message.
 *
 * No project imports, so it can be required from anywhere without a cycle.
 */

// HTTP statuses worth a second try. 429 and 503 usually come with
// Retry-After, which the caller honours.
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL', 'EAI_NODATA', 'EAI_NONAME']);
const RESET_CODES = new Set(['ECONNRESET', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE', 'UND_ERR_SOCKET']);
const UNREACHABLE_CODES = new Set(['ENETUNREACH', 'EHOSTUNREACH', 'EHOSTDOWN', 'ENETDOWN']);
const TLS_CODE_PATTERN = /^(ERR_TLS_|ERR_SSL_|CERT_|UNABLE_TO_|DEPTH_ZERO_|SELF_SIGNED_)/;

/**
 * Walk `error` and its `.cause` chain, returning the first defined value of
 * `key`. axios wraps the low-level socket error, and the useful fields
 * (code, proxyFault) can sit on either layer. Node's dual-stack connect
 * (Happy Eyeballs) throws an AggregateError whose detail is in `errors[]`.
 * @param {Error} error
 * @param {string} key
 * @returns {*}
 */
function pick(error, key) {
    let current = error;
    for (let depth = 0; current && depth < 6; depth++) {
        if (current[key] !== undefined && current[key] !== null) return current[key];
        current = current.cause || (Array.isArray(current.errors) ? current.errors[0] : undefined);
    }
    return undefined;
}

/**
 * Format milliseconds as a short human duration for log lines.
 * @param {number} ms
 * @returns {string}
 */
function shortDuration(ms) {
    if (!Number.isFinite(ms)) return '?';
    return ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s` : `${Math.round(ms)}ms`;
}

/**
 * Classify a network failure.
 *
 * @param {Error} error - Usually an AxiosError; any Error works
 * @param {Object} [options]
 * @param {string} [options.route] - 'proxy' or 'direct' — what the request used
 * @param {number} [options.timeout] - The timeout that applied, for the summary
 * @returns {{kind: string, code: string|null, status: number|null,
 *            retryable: boolean, proxyFault: boolean, summary: string}}
 *   kind: proxy | dns | refused | unreachable | timeout | reset | tls | http |
 *         aborted | too-large | unknown
 */
function classify(error, options = {}) {
    const { route = 'direct', timeout } = options;

    if (!error) {
        return { kind: 'unknown', code: null, status: null, retryable: false, proxyFault: false, summary: 'unknown error' };
    }

    const code = pick(error, 'code') || null;
    const status = error.response && error.response.status ? error.response.status : null;
    const message = String(error.message || '');
    const proxyFault = route === 'proxy' && pick(error, 'proxyFault') === true;

    const result = (kind, retryable, summary) => ({ kind, code, status, retryable, proxyFault, summary });

    // A proxy fault wins over everything else: whatever the low-level code,
    // the proxy is the thing that broke, and the request never reached the
    // target. Retrying through the same dead proxy is pointless, so it is not
    // "retryable" here — the caller falls back to direct instead.
    if (proxyFault) {
        const proxyStatus = pick(error, 'proxyStatus');
        const detail = proxyStatus ? `HTTP ${proxyStatus}` : (code || message.slice(0, 60) || 'error');
        return result('proxy', false, `proxy ${detail}`);
    }

    // The proxy answered the CONNECT but could not reach the target (502/504
    // from the proxy). The proxy itself works; the target may be down.
    const proxyStatus = pick(error, 'proxyStatus');
    if (route === 'proxy' && proxyStatus) {
        return result('proxy', proxyStatus >= 500, `proxy could not reach target (HTTP ${proxyStatus})`);
    }

    if (code === 'ERR_CANCELED' || error.name === 'CanceledError' || error.name === 'AbortError') {
        return result('aborted', false, 'aborted');
    }

    if (/maxContentLength|maxBodyLength/i.test(message)) {
        return result('too-large', false, 'response too large');
    }

    if (status) {
        return result('http', RETRYABLE_STATUS.has(status), `HTTP ${status}`);
    }

    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' ||
        /timeout|timed out/i.test(message)) {
        return result('timeout', true, timeout ? `timeout after ${shortDuration(timeout)}` : 'timeout');
    }

    if (code && DNS_CODES.has(code)) {
        // EAI_AGAIN is a resolver hiccup; ENOTFOUND is a name that does not
        // exist and will not exist on the next try either.
        return result('dns', code === 'EAI_AGAIN', `DNS ${code}`);
    }

    if (code === 'ECONNREFUSED') {
        return result('refused', true, 'connection refused');
    }

    if (code && UNREACHABLE_CODES.has(code)) {
        return result('unreachable', true, `network unreachable (${code})`);
    }

    if ((code && RESET_CODES.has(code)) || /socket hang up|socket disconnected|ECONNRESET/i.test(message)) {
        return result('reset', true, `connection reset${code ? ` (${code})` : ''}`);
    }

    if ((code && TLS_CODE_PATTERN.test(code)) || /certificate|SSL|TLS/i.test(message)) {
        return result('tls', false, `TLS error${code ? ` (${code})` : ''}`);
    }

    return result('unknown', false, message ? message.slice(0, 80) : 'unknown error');
}

/**
 * Legacy check kept for callers and tests: does this look like a
 * connection-level failure rather than an HTTP status error?
 *
 * Not used for proxy fallback decisions any more — see classify().proxyFault.
 * @param {Error} error
 * @returns {boolean}
 */
function isConnectionError(error) {
    if (!error) return false;
    if (error.response && error.response.status) return false;

    const connectionErrorCodes = [
        'ECONNREFUSED', 'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND',
        'ENETUNREACH', 'EHOSTUNREACH', 'ECONNRESET', 'EPIPE', 'EAI_AGAIN'
    ];
    if (error.code && connectionErrorCodes.includes(error.code)) return true;

    const message = error.message || '';
    return message.includes('timeout') ||
        message.includes('SOCKS') ||
        message.includes('socket disconnected') ||
        message.includes('Proxy connection');
}

module.exports = {
    classify,
    isConnectionError,
    shortDuration,
    RETRYABLE_STATUS
};
