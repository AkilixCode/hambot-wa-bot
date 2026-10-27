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

These checks run once, before yt-dlp starts. yt-dlp then resolves names
itself, follows redirects, and fetches every playlist and segment the media
names. A redirect, a DNS answer that changes in between (rebinding), or an
HLS/DASH manifest listing internal addresses would get past them, so every
yt-dlp run also goes through the **egress guard**.

### Egress guard — `utils/egress-guard.js`

yt-dlp's proxy is a small forward proxy inside the bot, on `127.0.0.1`. That
holds on every route: direct, through the owner's proxy, and the automatic
direct fallback. For each connection the guard:

1. **Checks the route.** It accepts only its own per-route token, so other
   programs on the machine cannot use it, or the owner's proxy behind it.
2. **Checks the port.** Only 80 and 443 are allowed.
3. **Checks the address.** It resolves the name once and refuses
   (`403 Egress Blocked`) if any answer is not a public address, using the
   same table as above.
4. **Dials what it checked.** It connects to that address and never resolves
   the name again. Behind the owner's proxy it asks for the IP, not the name:
   `CONNECT <ip>:<port>` for HTTP(S) proxies, an IP destination for SOCKS.

Three more settings close the routes around it:

- **Only yt-dlp's own downloader** (`--downloader native`), and only formats
  it fetches over HTTP(S). rtmp, rtsp and similar would hand the transfer to
  rtmpdump or ffmpeg, which connect on their own; such formats are never
  chosen.
- **No proxy settings from the environment.** yt-dlp honours `NO_PROXY` even
  when given a proxy, and Docker, Kubernetes and corporate machines often
  list localhost or internal ranges there, exactly what the guard refuses.
  ffmpeg reads the same variables. yt-dlp therefore runs without them. The
  owner's proxy is `PROXY_*` in `.env`, as for the rest of the bot.
- **The circuit breaker and fallback behave as before.** Only the owner's proxy
  failing (`502 Upstream Proxy Failed`) counts as a proxy failure. A refused
  destination is never retried.

**What it trusts:**

- **The owner's own endpoints,** dialled directly even though they are
  private: the PO token provider (`POT_PROVIDER_URL`).
- **The owner's proxy,** for what it does with a public IP the bot approved.
  It must route that IP to the internet; the bot cannot see past it.

`YTDLP_EGRESS_GUARD=false` turns all of this off, for diagnosing a site that
breaks. The bot logs a warning when it is off. Do not leave it off.

The tests prove the guard with the real tools. `tests/egress-real.test.cjs`
runs real yt-dlp and ffmpeg against:

- a redirect, HLS segments, DASH segments, a rebinding name and an
  rtmp-only page, each aimed at a canary that must never be contacted;
- matching downloads that must succeed (direct, HLS, DASH merged by ffmpeg),
  directly and through HTTP and SOCKS5 proxies.

`NO_PROXY` is set in that test, so the environment bypass is covered as well.

## Incoming attachments

`.sticker` and `.toimg` download the image or sticker the sender attached. The
message carries its own download location (`url`, `directPath`), and a
modified client can put any address there. Baileys' own downloader trusted it,
host included, so `utils/incoming-media.js` replaces it:

- **Destination.** Only WhatsApp's media CDN is contacted: `https`, a
  `*.whatsapp.net` host, port 443. A `directPath` goes to `mmg.whatsapp.net`
  unless the message names another WhatsApp media host. Anything else is
  refused before a connection is made.
- **Redirects** are followed by hand, at most 3, each one held to the same
  rule.
- **Size.** The size the message declares, the `Content-Length`, and the bytes
  actually read are each capped at `MAX_MEDIA_SIZE`; the transfer is cancelled
  as soon as it goes over. The whole download has a 60 s timeout.
- **Integrity.** The file's HMAC is checked before decryption, as WhatsApp
  clients do, so a tampered file never reaches the image decoder.
- **Decoding.** sharp refuses images over 40 megapixels before decoding them,
  so a small file cannot unpack into gigabytes.
- **Concurrency.** Both commands take a heavy-command slot, so a burst waits in
  the bounded queue instead of converting without limit.

Addresses the owner configures (AI backends, the egress proxy) are settings,
not message content, and never pass through this path.

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
| Download size cap | `.video`, `.music`, `.sticker`, `.toimg` | `MAX_MEDIA_SIZE` (64 MB) |
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
