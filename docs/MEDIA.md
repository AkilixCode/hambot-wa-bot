# Media Commands: Architecture and Runbook

How `.music`, `.video`, `.pinterest` and `.meme` fetch content, why they used to
fail, and what to do when they fail again.

---

## The core problem

The bot runs on a **datacenter IP**. YouTube and Pinterest both classify
datacenter ASNs as automated traffic and treat them differently from home
connections. This is the single reason media commands were unreliable.

It is worth being precise about what does and does not work, because a lot of
effort has previously gone into approaches that could not have worked:

| Approach | Outcome |
|---|---|
| Spoofing User-Agent / headers | **No effect.** The ASN is the signal, not the headers. |
| Cookies from a logged-in account | **No effect on the block**, and risks the account. |
| Headless browser with stealth patches | **No effect**, and cost ~400MB of image and ~30s per request. |
| Public "community API" instances | **Unreliable.** Half the well-known instances were dead when last measured. |
| A current yt-dlp with the right player clients | **Works, mostly.** See below. |
| Routing through a residential IP | **Works reliably.** This is the real fix. |
| Falling back to a source that does not gate on ASN | **Works.** SoundCloud, Wallhaven. |

The last three are what this codebase now does.

---

## Measured behaviour

Taken from the production VPS (AS133800, Indonesia), 2026-08:

- **Pinterest's internal JSON endpoint answers plain HTTP requests** —
  unauthenticated, no cookies, no CSRF token. 25 pins and ~677 image URLs from
  one request. This is why the browser is gone.
- **`i.pinimg.com` image downloads return 200**, including `/originals/`. An
  older note in the codebase claiming `/originals/` 403s was out of date.
- **YouTube works with a current yt-dlp**, returning the full format ladder
  including audio-only formats. It fails when yt-dlp is stale or pinned to a
  deprecated player client — which is what was happening.
- **A hand-rolled InnerTube request with the `TVHTML5` client returns
  `UNPLAYABLE`.** Do not try to reimplement YouTube extraction; yt-dlp handles
  signature and challenge solving that a bare HTTP call does not.
- **SoundCloud and Wallhaven are unaffected** by the datacenter IP.

---

## Architecture

### Provider cascade — `utils/providers.js`

Each media command declares an ordered list of ways to get what it needs.
The cascade walks them until one succeeds.

```
.pinterest   Pinterest JSON API  →  Wallhaven (SFW-locked)
.music       YouTube             →  SoundCloud
.video       (no fallback — a specific video cannot be substituted)
```

A **circuit breaker** takes a provider out of rotation after 3 consecutive
failures, with an exponential cool-down capped at 30 minutes. Without it, a dead
primary costs every request its full timeout before the fallback is even tried.
The *last* provider always runs even if its breaker is open, so a stale breaker
can never be the reason a user gets nothing.

When a fallback serves, the reply carries a source badge.

### yt-dlp runner — `utils/ytdlp.js`

Single entry point for every yt-dlp call. Replaces logic that was copy-pasted
into both `music.js` and `video.js`.

- **Hard timeouts with SIGTERM → SIGKILL escalation.** There was previously no
  timeout at all; a hung download held one of only three heavy-command slots
  permanently.
- **Player clients come from `YTDLP_PLAYER_CLIENTS`**, not from source.
- **PO token support** via `POT_PROVIDER_URL`.
- Invoked as `python3 -m yt_dlp` so pip-installed plugins are on the module path.

### Egress toggle — `utils/egress.js`

Owns `config.proxy.enabled`, which every consumer already reads. Flipping it
moves the whole bot at once. The choice is persisted to `data/` so it survives a
restart.

---

## Setting up a residential proxy (free)

The strongest fix. Uses a phone on a home connection as the exit point.

1. **Install Tailscale** on the server and on an Android phone; sign both into
   the same tailnet.
2. **Install Every Proxy** on the phone. Enable the HTTP proxy (default port
   8080). Leave it running on Wi-Fi or mobile data.
3. **Find the phone's tailnet IP** (`100.x.y.z`) from the Tailscale app.
4. **Configure `.env`:**
   ```
   PROXY_ENABLED=true
   PROXY_TYPE=http
   PROXY_HOST=100.x.y.z
   PROXY_PORT=8080
   ```
5. **Verify:**
   ```
   .security proxy test
   ```
   The two IPs shown must differ. If they are the same, the proxy is not
   actually changing the exit point — which looks like success right up until
   YouTube blocks the bot again.

Toggle live, without a restart:

```
.security proxy on
.security proxy off
.security proxy status
```

SOCKS5 works too — set `PROXY_TYPE=socks5`.

---

## Runbook: when media breaks

**Start here:**

```
.security media
```

One message with yt-dlp's version and age, the player clients in use, whether a
PO provider is set, the egress state, and which providers the breaker has
tripped.

### `.music` / `.video` fail with a bot check

In order of likelihood:

1. **yt-dlp is stale.** By far the most common cause — YouTube fixes ship
   continuously. Check the age in `.security media`; anything over ~45 days is
   flagged. Rebuild the image after bumping `YTDLP_VERSION` in the `Dockerfile`.
2. **The player clients need retuning.** YouTube retires clients every few
   months. Change `YTDLP_PLAYER_CLIENTS` in `.env` — no code change, no rebuild.
   Check the [yt-dlp issue tracker](https://github.com/yt-dlp/yt-dlp/issues) for
   the current working set. Leaving it empty defers to yt-dlp's own default,
   which is a good first thing to try after an upgrade.
3. **Turn the proxy on:** `.security proxy on`.
4. **Add a PO token provider.** Uncomment the `pot-provider` service and
   `POT_PROVIDER_URL` in `docker-compose.yml`.

`.music` should still work throughout, via SoundCloud, at reduced fidelity.

### `.pinterest` returns nothing

Tier 1 will have tripped its breaker and Wallhaven will be serving. To confirm,
look for `served by fallback "wallhaven"` in the logs.

If Pinterest's endpoint has changed, the request shape is in
`searchPinterest()` in `commands/pinterest.js`. Open Pinterest search in a
browser, watch the network tab for the `BaseSearchResource` XHR, and update the
headers or the `data` payload to match. Adding a new tier is ~40 lines.

### A command hangs

It cannot any more — every spawn has a timeout. If heavy commands stop
responding, check `activeProcesses` via `.security status`; slots are released
in a `finally` block.

---

## Dependencies

| Component | Needed by | Notes |
|---|---|---|
| `python3` + `yt-dlp` | `.music`, `.video` | Pinned in the `Dockerfile`; bump deliberately |
| `ffmpeg` | `.music` (mp3), `.say`, `.toimg` | |
| `deno` | `.music`, `.video` | yt-dlp needs a JS runtime to solve YouTube's n-challenge; without it it falls back to a slower Python solver that fails more |
| `sharp`, `canvas` | `.sticker`, `.brat` | |
| *(no browser)* | — | Removed in 3.2.0 |

Locally, `yt-dlp`, `ffmpeg` and `deno` are usually absent — use Docker, or
install them, to exercise the media commands.

---

## Adding a fallback source

```js
const { runProviders } = require('../utils/providers');

const outcome = await runProviders('my-command', [
    { id: 'primary',  label: 'Primary',  run: () => this.fetchPrimary(query) },
    { id: 'fallback', label: 'Fallback', run: () => this.fetchFallback(query) }
]);

// outcome.degraded is true when a fallback served — badge the reply.
```

Return an empty array to signal "no usable result"; the cascade treats that as
failure and moves on, because an empty result from a scraper almost always means
*blocked*, not *nothing matched*.
