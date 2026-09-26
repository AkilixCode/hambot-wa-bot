# Security architecture

How the bot defends itself. For reporting a vulnerability, see
[SECURITY.md](../SECURITY.md).

## Request pipeline

Every inbound message passes through `handler.js` in this order. Each stage can
end the request:

1. Ignore messages sent by the bot itself.
2. Ignore private messages when `ONLY_GROUP_MODE` is on.
3. Ignore blocked users, silently.
4. Ignore everyone but the owner while lockdown is active, silently.
5. Require the command prefix.
6. Sanitise the input (`security.sanitizeInput`, 2000 characters).
7. Reject malicious patterns when the chat filter is enabled.
8. Resolve the command; unknown names get a typo suggestion, rate-limited.
9. Reject runtime-disabled commands.
10. Validate arguments, including URL checks for the download commands.
11. Check permissions against the **canonical** command name.
12. Apply the rate limit, then the per-user cooldown.
13. Queue heavy commands against `MAX_PROCESSES`.
14. Run the command's own `validate()`, then `execute()`.

## Identity and authorisation

Identity is taken from `msg.key.participant` / `msg.key.remoteJid`, which the
WhatsApp server asserts. Display names are never used for authorisation, and
`msg.key.fromMe` only ever causes a message to be ignored.

Two tiers exist above ordinary users:

| Tier | Configured by | Default |
| --- | --- | --- |
| Owner | `BOT_OWNER_ID`, `OWNER_ONLY_COMMANDS` | `security`, `spam` |
| Group admin | `ADMIN_ONLY_COMMANDS` | `tagall` |

Group-admin status is resolved from group metadata, and only for commands that
actually gate on it — otherwise every message would cost an extra API round
trip. If the roster cannot be read, the check denies rather than assumes.

Both `@s.whatsapp.net` and `@lid` owner formats are supported. Cross-matching
between the two is explicitly refused, since the same person carries different
identifiers in the two contexts and treating them as interchangeable would widen
the owner check.

## URL handling

Commands that fetch a user-supplied URL (`.video`, `.music`) apply two checks:

1. **Syntactic** — `security.isValidURL()`. Requires `http`/`https`, rejects
   embedded credentials, and rejects hostnames in loopback (`127/8`), private
   (`10/8`, `172.16/12`, `192.168/16`), link-local (`169.254/16`, which covers
   the cloud metadata endpoint), CGNAT (`100.64/10`), multicast and reserved
   ranges, plus IPv6 loopback, unique-local and link-local addresses.

   The WHATWG URL parser normalises alternate IPv4 encodings before this runs,
   so `2130706433`, `0x7f000001`, `127.1` and `0177.0.0.1` all arrive as
   `127.0.0.1`.

2. **Resolved** — `security.resolvesToPublicHost()`. Looks the hostname up and
   rejects it if *any* returned address is non-public. This is what stops a
   hostname the sender controls from pointing inward. A resolver failure counts
   as unsafe.

A gap remains by design: yt-dlp performs its own DNS resolution, so a record
that changes between our check and its fetch is not covered. Closing that would
require proxying every fetch through the bot.

## Process execution

Every `child_process` call passes arguments as an array with no shell, so user
input can never become shell syntax. `utils/helpers.js` additionally allowlists
the binaries that may be spawned (`yt-dlp`, `ffmpeg`, `ping`, `node`,
`python3`).

`.calc` evaluates expressions with a recursive-descent parser in
`commands/calc.js`. It has no `eval()` or `Function()` anywhere — the grammar
only admits numbers, the arithmetic operators, parentheses, and a fixed table of
maths functions and constants.

## Owner control panel

`.security` is the highest-value target in the bot: it can read logs, describe
the configuration, silence the bot, message arbitrary chats, and stop the
process. It is built assuming someone will eventually try to reach it who should
not.

| Layer | Protection |
| --- | --- |
| Double authorisation | `handler.js` gates on the canonical command name, and the command re-checks `config.isOwner()` itself. Neither trusts the other. |
| Fail closed | With no `BOT_OWNER_ID`, the panel is disabled entirely rather than open. |
| Anti-probing | Repeated attempts by a non-owner escalate to a block: 3 attempts → 30 min, 5 → 2 h, 8 → 12 h, over a 10-minute window. |
| No credential disclosure | Keys are never printed. `.security env` reports presence, length, and a SHA-256 fingerprint. Proxy passwords are never rendered. |
| Output redaction | Logs, errors, and audit detail pass through `utils/redact.js`, which strips known env secrets by value plus generic secret shapes (Bearer, JWT, `AIza…`, `sk-…`, `?api_key=`, `user:pass@host`). |
| Channel control | Sensitive subcommands run in a group deliver output to the owner's private chat and post only a neutral notice in the group. |
| Confirmation tokens | `restart`, `stop`, `unblock all`, `broadcast`, `setprefix`, and disabling a security feature require a single-use, 90-second, sender-bound token. |
| Bounded reads | Log tails are capped at 512 KB and 200 lines, so a large PM2 log cannot exhaust memory. |
| Strict input validation | Broadcast targets must match a real JID shape; prefixes must be punctuation; durations, cooldowns, and process limits are range-clamped. |
| Protected commands | `security` and `menu` cannot be disabled at runtime, so the owner cannot lock themselves out. |

### Subcommands

```
Info      .security help | status | uptime | health | env [full] | whoami
          .security audit [n] | threats | list | logs [n]
Security  .security enable <fitur> | disable <fitur> | lock | unlock
Commands  .security cmd list | cmd disable <nama> | cmd enable <nama> | cmd enableall
Settings  .security owneronly <on|off> | setcooldown <ms> | setprefix <p> | setmaxproc <n>
Users     .security block <target> <menit> | unblock <target|all>
Ops       .security clearcache | broadcast <jid> <pesan> | restart | stop
Flow      .security confirm <token> | cancel
```

**Lockdown** — `.security lock` makes the bot silently ignore every message that
is not from an owner. The silence is deliberate: a reply would confirm the bot
is alive and reveal when the owner is present.

**Runtime versus `.env`** — everything the panel changes lives in memory only.
Nothing is written back to `.env`, and a restart returns the bot to its
configured baseline, so a compromised session cannot leave a persistent
backdoor.

## Abuse controls

| Control | Where | Default |
| --- | --- | --- |
| Rate limit | `utils/rate-limiter.js` | 15 commands / 60 s per user |
| Cooldown | `handler.js` | 3 s, or the command's own value |
| Heavy-command queue | `handler.js` | 3 concurrent |
| Download size cap | `.video`, `.music` | 200 MB |
| Duration cap | `.video`, `.music` | 10 minutes |
| Message length cap | `utils/ui.js` | 4000 characters |

The rate limiter tracks at most 5000 users and evicts inactive entries, so it
cannot grow without bound.

## Audit trail

Security events and owner actions are mirrored into an in-memory audit trail
(`.security audit`) holding the last 200 entries. It is never written to disk,
identifiers are masked, and free text is redacted.

Command logging records the command name and sender number only — never message
bodies. Error detail is passed through the redactor before printing, because a
failed HTTP call carries the request URL and some upstream APIs take their key
as a query parameter.

## Incident response

1. **Contain** — `.security lock`. The bot serves only you until `.security unlock`.
2. **Investigate** — `.security threats`, `.security audit 50`, `.security logs 100`.
   All are redacted and, in a group, delivered to your DM.
3. **Block** — `.security list`, then `.security block <nomor> <menit>`.
4. **Restore** — `.security unlock`, `.security status`. Rotate any credential
   you believe was exposed and restart, so runtime overrides fall back to `.env`.

If you suspect a key leaked, rotate it at the provider and update `.env`. The
panel cannot print a key, so a leak means it escaped some other way — check any
custom command that logs request URLs.

## Known limitations

Stated plainly, because a security document that claims completeness is not
useful:

- DNS rebinding between our resolution check and yt-dlp's own fetch is not
  covered, and neither are HTTP redirects: yt-dlp follows them, so a public URL
  that redirects to an internal address still reaches it. Restrict the
  container's egress at the network layer if that matters for your deployment.
- Runtime state (blocks, disabled commands, lockdown) is in memory and does not
  survive a restart.
- The malicious-pattern filter only matches path traversal, `<script>` tags and
  null bytes. It used to match shell and SQL metacharacters too, but nothing in
  the bot runs a shell or a database, so that only produced false positives
  (`.calc (2+3)*4`, URLs containing `&`). It is not a substitute for the argument
  validation each command does.
- Dependency vulnerabilities are the largest realistic exposure. Baileys
  authenticates every inbound message; keeping it current matters more than any
  control listed above.
