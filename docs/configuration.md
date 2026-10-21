# Configuration

All configuration is via environment variables in `.env`. `./deploy.sh`
creates it from `.env.example` and fills in the numbers; edit the rest by
hand, then run `./deploy.sh update` to apply. Every value has a working
default except the API keys.

- [Identity](#identity)
- [Permissions and limits](#permissions-and-limits)
- [Presentation](#presentation)
- [API keys](#api-keys)
- [AI chat](#ai-chat)
- [Proxy and logging](#proxy-and-logging)
- [Deployment](#deployment)

### Identity

| Variable | Default | Purpose |
| --- | --- | --- |
| `BOT_NAME` | `HamBot` | Name shown in the menu |
| `BOT_OWNER` | — | Name shown in the menu footer |
| `BOT_TAGLINE` | `Asisten WhatsApp serba bisa` | Line under the name on the menu image and caption |
| `MENU_IMAGE` | — | Picture on top of `.menu`: a file path or http(s) URL. Falls back to `assets/menu.jpg`, then to a generated banner |
| `BOT_PREFIX` | `.` | Command prefix |
| `BOT_OWNER_ID` | — | Owner JID. Accepts `<number>@s.whatsapp.net`, `<id>@lid`, or a bare number. Comma-separate to register both formats. |
| `ONLY_GROUP_MODE` | `false` | Ignore private messages entirely |

Owner-only commands stay disabled until `BOT_OWNER_ID` is set — the bot fails
closed rather than granting access.

### Permissions and limits

| Variable | Default | Purpose |
| --- | --- | --- |
| `OWNER_ONLY_COMMANDS` | `security,spam` | Commands only the owner may run |
| `ADMIN_ONLY_COMMANDS` | `tagall` | Commands only group admins may run |
| `SECURITY_CHAT_FILTER` | `true` | Reject messages matching malicious patterns |
| `MAX_PROCESSES` | `3` | Concurrent heavy commands |
| `HEAVY_QUEUE_MAX` | `5` | Heavy commands that wait for a free slot instead of being told "busy". `0` refuses straight away. |
| `COOLDOWN_MS` | `3000` | Minimum gap between commands per user |
| `RATE_LIMIT_WINDOW` | `60000` | Rate limit window, ms |
| `RATE_LIMIT_MAX` | `15` | Commands allowed per window |
| `CACHE_EXPIRATION` | `300000` | Default cache TTL, ms |
| `MAX_MUSIC_DURATION` | `600` | Maximum media length, seconds |
| `MAX_MEDIA_SIZE` | `64M` | Maximum download size. `MAX_FILE_SIZE` is the legacy name. |
| `YTDLP_PLAYER_CLIENTS` | `default,web_safari` | YouTube player clients for yt-dlp. Retune here when YouTube changes; no code edit needed. |
| `POT_PROVIDER_URL` | unset | Optional PO token provider, raises the YouTube success rate |
| `WALLHAVEN_API_KEY` | unset | Optional; the `.pinterest` fallback works without one |

### Presentation

| Variable | Default | Purpose |
| --- | --- | --- |
| `UI_FANCY_FONT` | `true` | Decorative Unicode faces in headings. Set `false` for plain ASCII, which is friendlier to screen readers. |
| `BOT_TIMEZONE` | `Asia/Jakarta` | Timezone for greetings and timestamps |
| `BOT_TIMEZONE_LABEL` | `WIB` | Label shown beside times |

### API keys

| Variable | Needed by |
| --- | --- |
| `OMDB_API_KEY` | `.movie` — free key from [omdbapi.com](https://www.omdbapi.com/apikey.aspx) |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | `.say` |
| `GEMINI_API_KEY` | `.chat` with `CHAT_PROVIDER_API=gemini`, when `CHAT_PROVIDER_API_KEY` is empty |

Commands whose key is missing say so rather than failing obscurely. Every other
command works without any key.

### AI chat

`.chat` is configured by the `CHAT_*` variables — easiest with
`./deploy.sh chat`. The main ones:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CHAT_ENABLED` | `false` | Master switch |
| `CHAT_BACKEND` | `local` | `local` (Ollama, LM Studio, …), `provider` (OpenAI-compatible, Anthropic, Gemini) or `agent` (Hermes Agent, OpenClaw) |
| `CHAT_FALLBACK` | `none` | Second backend for when the main one is down |
| `CHAT_ACCESS` | `owner` | `owner`, `allowlist` (`CHAT_ALLOWED_USERS`) or `public` |
| `CHAT_AGENT_ACCESS` | `owner` | Who may reach the agent; never wider than `CHAT_ACCESS` |
| `CHAT_MAX_CONCURRENT` | `2` | Answers worked on at the same time |
| `CHAT_DAILY_LIMIT_ENABLED`, `CHAT_DAILY_LIMIT` | `false`, `20` | Questions per person per day |

Every setting — backends, timeouts, memory, resilience — is in
[docs/ai-chat.md](ai-chat.md#all-settings).

### Proxy and logging

`PROXY_ENABLED`, `PROXY_TYPE` (`http`, `https`, `socks5`), `PROXY_HOST`,
`PROXY_PORT`, `PROXY_USER`, `PROXY_PASS` configure an outbound proxy shared by
yt-dlp and every HTTP request (`HB_PROXY_URL` overrides them all). HTTP
proxies are used through a CONNECT tunnel, so HTTPS sites work through them.
`NETWORK_FALLBACK_TO_LOCAL` retries without the proxy when the proxy itself
fails (refused, unreachable, no answer within `PROXY_CONNECT_TIMEOUT`, or it
refused the CONNECT); a slow or failing *target* never falls back. After 3
proxy failures in a row the proxy is skipped for a minute (doubling on each
repeat, capped at 30 minutes), so a dead phone costs no waiting at all.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HTTP_RETRIES` | `2` | Extra attempts for a failed GET (reset, timeout, 429/5xx), with backoff. POST is never retried. |
| `HTTP_TIMEOUT` | `30000` | Per-attempt HTTP timeout, ms |
| `PROXY_CONNECT_TIMEOUT` | `10000` | How long the proxy may take to answer before it counts as down, ms |
| `FORCE_IPV4` | `true` | IPv4 only, for HTTP and yt-dlp |
| `YTDLP_SOCKET_TIMEOUT`, `YTDLP_RETRIES`, `YTDLP_FRAGMENT_RETRIES`, `YTDLP_EXTRACTOR_RETRIES` | `30`, `5`, `10`, `3` | yt-dlp transport retries; `0` keeps yt-dlp's own default |

Because the bot usually runs on a datacenter IP — which YouTube treats as a bot —
routing media traffic through a residential connection is the most effective fix
available. Toggle it live with `.security proxy on|off|status|test`; the choice
persists across restarts. See [MEDIA.md](MEDIA.md) for the
Tailscale + Every Proxy setup.

`LOG_LEVEL` accepts `simple` (default, one block per command) or `full`
(verbose). `LOG_SILENT=true` suppresses output entirely.

`NET_LOG` controls network log lines, which show in both modes: `problems`
(default — retries, failures, proxy fallbacks, circuit changes), `all` (also
every successful request) or `off`. See
[MEDIA.md](MEDIA.md#reading-the-network-log) for how to read them.

### Deployment

Written by `./deploy.sh`; change them through it rather than by hand.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DEPLOY_MODE` | `docker` | `docker` or `local`. Use `./deploy.sh switch` to change it: that also moves the WhatsApp session. |
| `YTDLP_PYTHON` | `python3` | Local mode: the Python that has yt-dlp (`.venv/bin/python`). Ignored if that file is missing. |
| `PAIRING_NUMBER` | — | The bot's own number for a pairing code; empty = QR code |
| `LOGIN_METHOD` | `auto` | `auto`, `qr` or `code` |
| `HAMBOT_TAG` | `latest` | Docker image version to run |
| `PM2_PROCESS_NAME` | `hambot` | Local mode: the pm2 app name |
