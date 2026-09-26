# Contributing

## Setup

```bash
npm install
npx playwright install chromium
pip install yt-dlp
cp .env.example .env
npm run dev
```

You need a spare WhatsApp account to link. Do not develop against an account you
rely on — a bad reconnection loop can get a number rate-limited.

## Before opening a pull request

```bash
npm run test:all
```

All suites must pass (CI runs them on every push). If you change behaviour that a test asserts, update
the test in the same commit and say why in the message.

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

`.video` and `.music` invoke `python3 -m yt_dlp` rather than a `yt-dlp` binary,
so locally installed plugins such as `yt-dlp-get-pot` are picked up. Arguments
worth preserving:

- The `android` extractor client is more reliable than the default web client.
- Do not pass a format selector (`-f`) for audio; download the best available
  and let `-x --audio-format mp3` convert it.
- Proxy and network flags come from `config.getYtDlpProxyArgs()` and
  `config.getYtDlpNetworkArgs()` — do not hardcode them.

## Reporting bugs

Include the command, the exact input, what happened, what you expected, and the
log output with `LOG_LEVEL=full`. Redact your own phone number and any keys.

For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead — do not open a
public issue.
