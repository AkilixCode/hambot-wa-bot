/**
 * A stand-in agent for tests: speaks the OpenAI chat-completions API the way
 * Hermes Agent does (SSE, `: keepalive` comments, X-Hermes-Session-Id) and
 * logs what it received, one JSON line per request, to stdout.
 *
 *   node tests/fixtures/fake-agent.cjs <host> <port> [token]
 *
 * Used by scripts/docker-agent-test.sh to check that a bot in a container
 * reaches an agent on its host.
 */

const http = require('http');

const [host = '127.0.0.1', port = '8642', token = ''] = process.argv.slice(2);

http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
        console.log(JSON.stringify({
            method: req.method,
            url: req.url,
            auth: req.headers.authorization === `Bearer ${token}`,
            session: req.headers['x-hermes-session-id'] || null
        }));
        if (token && req.headers.authorization !== `Bearer ${token}`) {
            res.writeHead(401, { 'content-type': 'application/json' });
            return res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));
        }
        if (req.url.endsWith('/models')) {
            res.writeHead(200, { 'content-type': 'application/json' });
            return res.end(JSON.stringify({ object: 'list', data: [{ id: 'hermes-agent', object: 'model' }] }));
        }
        let question = '';
        try {
            const messages = JSON.parse(body).messages || [];
            question = String(messages[messages.length - 1].content || '');
        } catch {
            // answer anyway
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(': keepalive\n\n');
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `agent heard: ${question.slice(0, 60)}` } }] })}\n\n`);
        res.end('data: [DONE]\n\n');
    });
}).listen(Number(port), host, () => {
    console.error(`fake agent on ${host}:${port}`);
});
