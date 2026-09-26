# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Quality pass: security fixes, handler bugs, tests and CI.

### Security

- `sharp` upgraded to 0.35.4 (libheif advisories, reachable via `.sticker`).
- OMDB lookups use https; the API key was sent over plain http.
- Reminders capped at 5 per user and 500 in total.

### Fixed

- `.security disable rateLimit` and the `autoBlock` toggle were ignored.
- The chat filter rejected ordinary input (`.calc (2+3)*4`, URLs with `&`,
  words like "update") and counted it towards an auto-block.
- `.security restart|stop` did nothing without pm2 (e.g. in Docker).
- Reminders were lost after a reconnect, and two set in the same millisecond
  overwrote each other.
- Multi-character prefixes and a newline after the command name now parse.
- The cooldown no longer starts when a heavy command is turned away as busy.
- Ctrl-C now shuts down gracefully instead of skipping `sock.end()`.
- `.movie` failed for titles without a poster (dead placeholder service).
- `.spam` now waits its advertised 1.5–5 s between messages.
- Proxy credentials containing `@`, `:` or `/` broke the proxy URL.
- Security event counters grew forever; now pruned after 24 h.
- `.port`, `.dns` and `.trivia` now use the standard cards and escape
  third-party and user text; `.trivia` decodes all HTML entities.

### Changed

- Media downloads are concatenated once instead of per chunk; spawned
  process output is capped at 16 MB.

### Added

- `npm run test:commands` — regression tests driven through a fake socket.
- GitHub Actions workflow running `test:all` and `npm audit` on Node 20/22.
- `HAMBOT_DATA_DIR` to relocate `data/`; the tests no longer overwrite the
  live `data/egress.json`.

### Removed

- Dead `config.getPlaywrightProxyConfig()` and `httpClient.getProxyStatus()`
  (the latter returned proxy credentials).

## [3.2.0] - 2026-08-02

Media reliability release. The commands that fetch from YouTube and Pinterest
were failing because the bot runs on a datacenter IP, which both platforms treat
as automated traffic. Measurement showed the previous workarounds were aimed at
the wrong layer.

### Added

- **`utils/providers.js`** — provider cascade with a circuit breaker. Media
  commands now declare an ordered list of sources and fall through until one
  succeeds. A provider that fails three times running is skipped for an
  exponentially growing cool-down, so a dead primary no longer costs every
  request its full timeout. The last provider always runs regardless, so a stale
  breaker can never be why a user gets nothing.
- **`utils/ytdlp.js`** — single yt-dlp entry point, replacing logic that was
  copy-pasted verbatim into `music.js` and `video.js`.
- **`utils/egress.js`** — runtime proxy toggle, persisted across restarts.
- **`utils/tempdir.js`**, **`utils/cached-fetch.js`**, **`utils/media.js`**.
- **`.security proxy <status|on|off|test>`** — switch the bot between its own
  datacenter IP and a residential proxy without editing `.env` or restarting.
  `test` compares both exit IPs and warns when they are identical, which is the
  failure mode that otherwise looks like success.
- **`.security media`** — diagnostics: yt-dlp version and age, player clients,
  PO token provider, egress state, per-provider health, temp usage.
- **SoundCloud fallback for `.music`.** SoundCloud does not gate on datacenter
  IPs, so `.music` keeps working with the proxy switched off.
- **Wallhaven fallback for `.pinterest`**, locked to SFW (`purity=100`) and
  filtered by the API's own `file_size` so a 12MB wallpaper is never sent.
- `deno` in the Docker image — yt-dlp needs a JS runtime to solve YouTube's
  n-challenge; without one it falls back to a slower Python solver that fails
  more often.
- `docs/MEDIA.md` — architecture, the Tailscale proxy setup, and a runbook.
- `npm run test:media` — 40 offline tests for the new infrastructure.

### Changed

- **`.pinterest` no longer runs a browser.** Pinterest's search page is
  client-rendered, which is why HTML scraping returned nothing and why a
  headless browser was introduced. But the XHR endpoint the page itself calls
  answers plain unauthenticated HTTP from a datacenter IP — measured at 25 pins
  and ~677 image URLs per request. The command went from 618 lines to ~300, is
  no longer `isHeavy`, and dropped from roughly 30s to about 1.3s.
- **Player clients are configuration, not code.** `YTDLP_PLAYER_CLIENTS`
  replaces the hardcoded `player_client=android`, which is deprecated upstream
  and a likely cause of the failures. YouTube retires clients every few months;
  this can now be retuned from `.env` without a deploy.
- **Media is streamed from disk** rather than read into a Buffer. Baileys
  accepts a file path and streams it, so a large download no longer has to sit
  in the heap in its entirety.
- **`MAX_MEDIA_SIZE` (default 64M) is actually enforced.** `MAX_FILE_SIZE` was
  parsed into config and then never read — both commands hardcoded `200M`, a
  size WhatsApp will not accept as inline media anyway.
- Temp files moved from the repo root to `tmp/`, with startup sweeping of files
  left by a previous crash. `cleanupFiles()` is now scoped to that directory
  instead of prefix-scanning the project.
- 13 commands converted from hand-rolled strings to `utils/ui.js`, so the whole
  bot shares one card style. Remaining English strings in `.toimg` and `.tagall`
  translated to match the Indonesian house voice.
- `.meme`, `.qr` and `.movie` now fetch image bytes through `utils/http-client`
  instead of handing a URL to Baileys, which fetched it outside the HTTP client
  and therefore ignored the proxy entirely.

### Fixed

- **No spawned process had a timeout.** A hung `yt-dlp` or `ffmpeg` held one of
  only three heavy-command slots for the lifetime of the process; three of them
  and the bot stopped accepting media commands until a restart. Every spawn now
  has a deadline with SIGTERM → SIGKILL escalation.
- `.video` captions bypassed the 1024-character clamp by calling
  `sock.sendMessage` directly.
- `-y` was placed after the output path in `.toimg`'s ffmpeg invocation, where
  it does not act as an overwrite flag for that output.
- Proxy fallback no longer triggers on a YouTube bot check — retrying that
  without the proxy just hands YouTube the datacenter IP being avoided.

### Removed

- `playwright`, its Chromium download, and the Chromium runtime libraries from
  the Docker image. With no browser, the container also no longer needs the
  `SYS_ADMIN` capability, and `cap_drop: ALL` is now unqualified.
- The stale `PUPPETEER_EXECUTABLE_PATH` in `docker-compose.yml`, pointing at a
  binary removed in 3.1.0.

## [3.1.0] - 2026-08-01

Dependency and security release. `npm audit` now reports zero vulnerabilities,
down from six (one critical, four high, one moderate).

### Removed

- The entire Puppeteer stack: `puppeteer`, `puppeteer-extra`, and
  `puppeteer-extra-plugin-stealth`, along with `utils/browser-manager.js` and
  `config.getPuppeteerProxyArgs()`.

  This was dead code. `.pinterest` migrated to Playwright in 2.9.0 and nothing
  else ever launched a browser — `index.js` only called `destroy()` on a browser
  that was never created. Removing it eliminated four of the six advisories,
  including a critical path traversal in `basic-ftp`, and dropped roughly 150
  transitive packages plus a Chromium download from the install.
- The `chromium` apt package from the Docker image. Playwright ships its own
  matching build and the system one is protocol incompatible with it, as the
  Dockerfile already noted.

### Changed

- `sharp` 0.34.5 → 0.35.3, bundling libvips 8.18.3. Fixes four inherited libvips
  CVEs reachable from `.sticker`. None of the release's breaking changes affect
  this codebase: no `failOnError`, no `metadata()`, no `sharpen()`, no jp2k.
- `socks-proxy-agent` 8.0.5 → 10.1.0, resolving an XSS advisory in `ip-address`.
  Version 9 converted the package to ESM, so it is now loaded through Node's
  `require(esm)` support — which is why the minimum Node version moved.
- `canvas` 3.2.1 → 3.2.3, `axios`, `playwright`, and Baileys ranges realigned to
  the versions actually installed.
- Minimum Node.js is now 20.19.0, the first release able to `require()` an ESM
  package.

### Fixed

- `.brat` now loads. `canvas` had no usable native binding, so the command
  failed to register at all; the upgrade pulls a working prebuilt binary. All 36
  commands now load, up from 35.
- Corrected an integration test that asserted Puppeteer must be installed.

## [3.0.0] - 2026-08-01

A presentation and hardening release. Every message the bot sends was rebuilt on
a shared toolkit, and several long-standing defects were fixed along the way.

### Added

- `utils/ui.js`, a single presentation layer for everything the bot says:
  framed cards, usage panels, error cards with actionable hints, decorative
  Unicode faces, meters, and consistent number, duration, and timestamp
  formatting. Set `UI_FANCY_FONT=false` to disable the decorative alphabets.
- Time-of-day greeting in `.menu`, using the sender's WhatsApp display name.
  Timezone comes from `BOT_TIMEZONE` (default `Asia/Jakarta`).
- Typo suggestions for unknown commands, and for unknown arguments to `.menu`.
  Suggestions never include commands the requester is not allowed to see.
- Group-admin authorisation, driven by `ADMIN_ONLY_COMMANDS` (default
  `tagall`). Admin status is resolved from group metadata only for commands
  that gate on it.
- `security.resolvesToPublicHost()`, which resolves a hostname and rejects it if
  any address it maps to is non-public. Applied by `.video` and `.music` before
  handing a URL to yt-dlp.
- `docs/security-architecture.md`, `CHANGELOG.md`, `LICENSE.md`, and
  `CONTRIBUTING.md`.

### Changed

- All command output is now Indonesian. Sixteen commands previously replied in
  English, and some mixed both languages in a single message.
- `.menu` redesigned: banner, greeting, commands grouped into ordered categories
  one line each, with full detail behind `.menu <command>`.
- `.security` documentation moved out of `SECURITY.md`, which is now an actual
  vulnerability disclosure policy rather than a feature list.
- `.trivia` now waits 15 seconds before revealing the answer, instead of 5.
- `.rps` accepts Indonesian choices (`batu`, `kertas`, `gunting`) as well as the
  English ones.
- The bot version is read from `package.json` in one place and surfaced by
  `.menu` and `.ping`. It previously existed in four places that disagreed.
- Error messages carry a suggested next step rather than only stating failure.

### Fixed

- `.calc` evaluated expressions by building a string and passing it to
  `Function()`. Replaced with a recursive-descent parser, removing the eval
  primitive entirely. This also fixes `ceil()`, which the previous substitution
  chain silently corrupted into `Math.cMath.Eil(`.
- `.rps` compared the player's choice against English names after the choices
  had been renamed, so every non-tied round was scored as a loss.
- Nine messages used `**bold**`, which WhatsApp does not parse — it rendered
  with stray asterisks.
- The SSRF denylist missed `169.254.0.0/16` (cloud metadata), most of
  `172.16.0.0/12` (including the default Docker bridge), IPv6 literals, and the
  alternate IPv4 encodings. `.music` was not URL-checked at all.
- `_template.js` registered itself as a live `.template` command and appeared in
  the public menu.
- Per-user cooldown dropped messages in complete silence; it now explains itself
  once per cooldown window.
- Unknown commands were ignored entirely, making a typo indistinguishable from
  the bot being offline.
- `.netinfo` listed available topics from a hardcoded string that had drifted
  from the topics that actually exist; both listings are now derived from the
  topic table.
- `coin` was claimed as an alias by both `.crypto` and `.flip`, with the winner
  decided by directory read order. `.crypto` now uses `kripto`, and the registry
  warns when an alias is claimed twice.
- Error detail was printed to logs without redaction, so a failed request could
  echo a URL containing an API key.
- Outgoing messages and media captions are now length-capped, so WhatsApp cannot
  silently truncate a long reply.
- `package-lock.json` was out of sync with `package.json` and `npm ci` failed.
- `socks-proxy-agent` was required at runtime but never declared as a
  dependency, so SOCKS proxying silently did nothing.

### Removed

- The owner's real phone number and WhatsApp Linked ID from tracked files.
- `UPDATE-REPORT.md`, a 99 KB log of AI sessions, replaced by this changelog.
- `README-FOR-AI.md`; its yt-dlp notes moved into the contributor guide.
- `test-quality.cjs`, which counted lines of code rather than testing behaviour
  and asserted nothing about correctness.
- Eight unused web-font files (`.woff`, `.woff2`, `.eot`, `.svg`) that
  `node-canvas` cannot load.

### Security

- Two security tests asserted the wrong behaviour and were corrected. One
  expected owner-only commands to be *granted* to ordinary users when
  `BOT_OWNER_ID` was unset; the code correctly denies them.

## [2.10.0] - 2026-07-31

### Added

- `.security` rebuilt as an owner control panel: audit trail, threat list,
  lockdown, runtime command toggles, confirmation tokens for destructive
  actions, and DM redirection for sensitive output in groups.

### Security

- Owner-only commands are authorised against the canonical command name, so an
  alias no longer bypasses the allowlist.
- Owner-only commands hidden from `.menu` for non-owners.
- Output redaction applied across logs, errors, and audit entries.

## [2.9.1] - 2026-07-29

### Fixed

- `.movie` falls back through several IMDb lookup strategies when OMDb's title
  search misses, which it often did for recent releases.

## [2.9.0] - 2026-07

### Added

- Proxy support across yt-dlp, axios, Puppeteer, and Playwright.

### Changed

- Pinterest scraping migrated from Puppeteer to Playwright.
- Logging reworked into `simple` and `full` modes.

## [2.8.2] - 2026-06

### Fixed

- Pinterest stealth configuration for Puppeteer.

## [2.8.0] - 2026-05

### Changed

- Baileys 7.0.0-rc.10, which is ESM-only and is now loaded via dynamic
  `import()`.
- Minimum Node.js raised to 20, required by Pino 10.
- dotenv 17 configured with `{ quiet: true }`.
- Puppeteer `headless: "new"` replaced by `headless: true`.

## [2.7.0] - 2026-04

### Added

- Owner control panel with log retrieval, runtime configuration, system
  monitoring, broadcast, and cache management.

## [2.6.0] - 2026-03

### Changed

- `.netinfo` output reformatted for mobile; ASCII tables removed.
- `.meme` narrowed to r/indonesia with caching.
- `.movie` attempts high-resolution posters.

## [2.5.0] - 2026-02

### Added

- Dual owner ID support, for private and group contexts.
- Owner protection: the owner cannot be blocked.

### Fixed

- `.spam` argument handling.

## [2.4.1] - 2026-02

### Added

- `@lid` owner ID format.

## [2.4.0] - 2026-02

### Added

- Configurable owner-only command list.

### Changed

- Command output translated to Indonesian.
- Cache and rate limiter given eviction and bounds.

## [2.3.0] - 2026-01

### Added

- `.brat` sticker generation.

## [2.2.0] - 2026-01

### Added

- `.spam`, owner-only, with safety limits.

### Changed

- Output reformatted for mobile.

## [2.1.0] - 2026-01

### Added

- URL parser covering 30+ platforms, with short-URL and mobile-URL handling and
  per-platform yt-dlp arguments.

[3.0.0]: https://github.com/AkilixCode/hambot-wa-bot/releases/tag/v3.0.0
