# Contributing

## Setup

```bash
git clone https://github.com/AkilixCode/hambot-wa-bot.git && cd hambot-wa-bot
npm install
python3 -m venv .venv && .venv/bin/pip install yt-dlp   # for .video / .music
cp .env.example .env    # set BOT_OWNER_ID, and YTDLP_PYTHON=.venv/bin/python
npm run dev
```

`./deploy.sh --local` does all of this (plus pm2 and Deno) if you would rather
run the bot the way users do; `pm2 stop hambot` then frees the session for
`npm run dev`. Never run two copies against one session.

You need a spare WhatsApp account to link. Do not develop against an account you
rely on — a bad reconnection loop can get a number rate-limited.

## Before opening a pull request

```bash
npm run test:all
```

All suites must pass (CI runs them on every push, on Node 22 and 24). They
live in `tests/` and need no network, WhatsApp session, Docker or yt-dlp. If
you change behaviour that a test asserts, update the test in the same commit
and say why in the message.

Changing `.chat`? `npm run test:chat` drives it against fake AI servers on
127.0.0.1 (every wire format, timeouts, limits, failures); add a case for any
new failure path. Changed `utils/logo.js`? Run `node scripts/render-art.cjs`
and commit the images (a test checks the SVG is current).

Changing `deploy.sh` or `scripts/install.sh`? `npm run test:deploy` runs them
against recording fakes on a sealed `PATH` (see `tests/deploy.test.cjs`); add
a test for any new failure path, and keep both scripts POSIX `sh` (they are
checked with `sh -n`, and run on macOS in CI).

## Conventions

**Commits** follow [Conventional Commits](https://www.conventionalcommits.org/):
`feat(scope):`, `fix(scope):`, `docs:`, `refactor:`, `chore:`.

**Code style** matches the surrounding file: 4-space indent, single quotes,
semicolons, `camelCase`. There is no linter; match what is already there.

**JSDoc** on anything non-obvious — exported functions, command classes, and any
helper whose behaviour is not clear from its name. Document *why*, not *what*.

**User-facing text is Indonesian.** Code, comments, and documentation are
English.

## Writing a command

Start from `commands/_template.js`. Files beginning with `_` are not loaded, so
the template never ships as a live command.

Requirements enforced by the test suite:

- Extend `CommandBase` and implement `async execute(sock, msg, args, context)`
- Provide `name`, `description` (10 characters or more), `usage`, and `category`
- Keep `cooldown` between 0 and 60000
- Do not reuse an alias another command already claims — the registry warns, but
  the loser is decided by directory read order
- Begin the file with a JSDoc header comment

Build every reply from `utils/ui.js`:

| Need | Use |
| --- | --- |
| Command help, no arguments given | `this.replyUsage(...)` |
| A failure | `this.replyError(reason, { hint: [...] })` |
| A normal result | `ui.card({ icon, title, lines, footer })` |
| A label/value line | `ui.kv(label, value, icon)` |
| Echoing user input | `ui.safe(text)` — always |
| An image or video with a caption | `this.replyMedia(...)` |
| Cache provenance | `ui.sourceBadge(fromCache)` |

Do not write `**bold**`. WhatsApp does not parse it; use `ui.bold()`.

Set `isHeavy: true` on anything that spawns a process or drives a browser, so it
is queued against `MAX_PROCESSES`.

## Security expectations

- Never build a shell string. `spawn` with an argument array, never `shell: true`.
- Pass any user-supplied URL through `security.isValidURL()` and, before
  fetching it, `security.resolvesToPublicHost()`.
- Never log or send an API key. Anything that might contain one goes through
  `redact.redact()`.
- Owner and admin gating belongs in `handler.js` and `config`, not in the
  command. Add the command name to `OWNER_ONLY_COMMANDS` or
  `ADMIN_ONLY_COMMANDS` instead of writing your own check.

## Notes on yt-dlp

`.video` and `.music` invoke `python3 -m yt_dlp` (or `$YTDLP_PYTHON -m yt_dlp`
in a local install) rather than a `yt-dlp` binary, so pip-installed plugins
such as the PO token provider are picked up. All runs go through
`utils/ytdlp.js`. Arguments worth preserving:

- YouTube player clients come from `YTDLP_PLAYER_CLIENTS`; never hardcode one
  (the old `android` client is deprecated).
- Do not pass a format selector (`-f`) for audio; download the best available
  and let `-x --audio-format mp3` convert it.
- Proxy and network flags come from `config.getYtDlpProxyArgs()` and
  `config.getYtDlpNetworkArgs()` — do not hardcode them.

## Reporting bugs

Use the bug report form. Include the command, the exact input, what happened,
what you expected, whether you run Docker or Local, the output of
`./deploy.sh doctor`, and the log output with `LOG_LEVEL=full`. Redact your
own phone number and any keys.

For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead — do not open a
public issue.
