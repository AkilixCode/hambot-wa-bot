# Development

- [Architecture](#architecture)
- [Adding a command](#adding-a-command)
- [Testing](#testing)

## Architecture

```
index.js              Baileys connection, pairing code / QR, reconnection
handler.js            Message pipeline: filtering, auth, rate limits, queue, dispatch
config.js             Environment parsing, owner and admin resolution
commands/
  base.js             CommandBase: metadata, validation, reply helpers
  registry.js         Loading, alias resolution, typo matching, runtime toggles
  <name>.js           One file per command (_template.js is not loaded)
utils/
  ui.js               Presentation toolkit: every reply is built here
  security.js         Input sanitising, URL guards, permissions, blocking
  session.js          Disconnect decisions, session archive and restore
  login.js            Pairing code vs QR, QR image
  health.js           Health state for Docker, deploy.sh status and doctor
  group-cache.js      Group roster cache (one fetch, not one per reply)
  work-slots.js       Heavy-command slots and their waiting line
  ytdlp.js            Every yt-dlp run: timeouts, proxy fallback, one-pass download
  rate-limiter.js     Sliding-window limiter, bounded and self-evicting
  cache.js            In-memory TTL cache; cached-fetch.js on top of it
  http-client.js      axios wrapper with proxy support (egress.js toggles it)
  url-parser.js       Platform detection and per-platform yt-dlp arguments
  logger.js           Command logging in simple or full mode
  redact.js           Secret scrubbing for anything printed or sent
  chat/               .chat: settings, streaming client (4 wire formats),
                      health, memory, formatting; loaded on first use
  logo.js             The logo, drawn on canvas or written as SVG
deploy.sh             Install and manage, Docker or Local
ecosystem.config.cjs  pm2 settings for Local mode
scripts/              install.sh (one-line installer), healthcheck.js, smoke-test.sh,
                      render-art.cjs (regenerates docs/images from utils/logo.js)
tests/                Offline test suites (npm run test:all)
docs/                 Guides (start at docs/README.md)
```

A message flows `index.js` → `handler.js` → `registry.get()` →
`command.validate()` → `command.execute()`. `handler.js` is the only place
authorisation and rate limiting happen, so a command cannot accidentally skip
them.

Presentation is centralised in `utils/ui.js`. Commands describe *what* to say;
the toolkit decides how it looks. See
[security-architecture.md](security-architecture.md) for the security
design.

## Adding a command

Copy `commands/_template.js` — files beginning with `_` are not loaded — and
drop it into `commands/`. The registry picks it up on the next start.

```js
const CommandBase = require('./base');
const ui = require('../utils/ui');

class HelloCommand extends CommandBase {
    constructor() {
        super({
            name: 'hello',
            aliases: ['hai'],
            description: 'Menyapa pengguna',   // shown in .menu, keep under 34 chars
            usage: '.hello <nama>',
            category: 'fun',
            cooldown: 2000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        if (!args[0]) {
            return await this.replyUsage(sock, from, msg, {
                icon: '👋',
                title: 'Sapaan',
                description: 'Bot akan menyapamu.',
                usage: ['.hello <nama>'],
                examples: ['.hello Budi']
            });
        }

        await this.reply(sock, from, msg, ui.card({
            icon: '👋',
            title: 'Halo',
            lines: [`Senang bertemu, ${ui.bold(ui.safe(args.join(' ')))}!`]
        }));
    }
}

module.exports = HelloCommand;
```

Conventions worth following:

- Build replies from `utils/ui.js`. Do not hand-roll layout — inconsistent
  hand-rolled strings are what this toolkit replaced.
- Route any user input you echo through `ui.safe()`, or a name containing `*`
  will corrupt the message.
- Use `this.replyError()` with a `hint` so failures tell the user what to do
  next.
- Set `isHeavy: true` for anything that spawns a process or drives a browser, so
  it gets queued.
- Write user-facing text in Indonesian.

## Testing

```bash
npm test                 # module loading, config, registry, helpers
npm run test:integration # command metadata and alias integrity
npm run test:security    # sanitising, URL guards, permissions, blocking
npm run test:media       # yt-dlp runner, provider cascade, egress toggle
npm run test:commands    # handler and command regressions, via a fake socket
npm run test:chat        # .chat against fake AI servers: formats, timeouts, limits, health
npm run test:network     # HTTP client: proxy, retries, fallback
npm run test:deploy      # deploy.sh and the installer, both modes, failure paths
npm run test:all
```

The suites live in `tests/` and all run offline: no WhatsApp session,
Docker, yt-dlp or ffmpeg needed. `test:deploy` runs `deploy.sh` against
recording fakes (docker, pm2, npm, python, curl, …) on a sealed `PATH`, so it
also covers the paths where a tool is missing. CI
(`.github/workflows/test.yml`) runs everything on Node 22 and 24, and the
deploy suite on macOS too.
