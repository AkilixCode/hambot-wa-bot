# Security Policy

## Supported versions

Only the latest release on `main` receives security fixes.

| Version | Supported |
| --- | --- |
| 3.x | Yes |
| < 3.0 | No |

## Reporting a vulnerability

Report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/AkilixCode/hambot-wa-bot/security/advisories/new).
If you cannot use that form, open an issue containing only the words "security
report" and a way to reach you — do not put details in a public issue.

Please include:

- The affected command, file, or code path
- Steps to reproduce, or a proof of concept
- What an attacker gains: reading files, running commands, reaching the internal
  network, bypassing the owner check, and so on

What to expect:

- Acknowledgement within 7 days
- An assessment and a planned fix date within 14 days
- Credit in the release notes unless you would rather not be named

Please allow a reasonable window for a fix before disclosing publicly.

## Scope

In scope:

- Command injection, path traversal, or arbitrary file access
- Server-side request forgery via any command that fetches a URL
- Bypassing the owner or group-admin authorisation checks
- Leaking API keys, session credentials, or the WhatsApp auth state
- Denial of service reachable by an ordinary chat user

Out of scope:

- Vulnerabilities in WhatsApp itself or in Baileys — report those upstream
- Rate-limit tuning and similar configuration preferences with no demonstrated
  impact
- Anything that requires the operator's own shell or credentials

## How authorisation works

Useful context when assessing a report:

- Identity comes from `msg.key.participant` / `msg.key.remoteJid`, which the
  server asserts. Display names are never trusted, and `fromMe` only ever causes
  a message to be ignored.
- Permission checks run against the canonical command name, never the alias, so
  `.sec` cannot slip past an allowlist that names `security`.
- With `BOT_OWNER_ID` unset the owner panel is disabled rather than open — it
  fails closed.
- Owner-only commands are hidden from `.menu` and from typo suggestions for
  everyone else.
- Repeated attempts on owner-only commands escalate to temporary blocks.
- User-supplied URLs are checked syntactically and then resolved, with loopback,
  private, link-local, and CGNAT ranges rejected.

A fuller description of the owner panel's defences is in
[docs/security-architecture.md](docs/security-architecture.md).

## Operator responsibilities

These are the operator's job, not defects in this project:

- Keep `.env` out of version control. It is listed in `.gitignore`; verify it
  stays there.
- Set `BOT_OWNER_ID`, otherwise every owner-only command stays disabled.
- Treat `auth_info_baileys/` as a credential. Anyone holding it can act as the
  linked WhatsApp account.
- Run `npm audit` after changing dependencies, and keep Baileys current — it is
  the component that authenticates every inbound message.
