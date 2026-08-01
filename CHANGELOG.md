# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
