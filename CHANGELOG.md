# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- **`.sticker` and `.toimg` could be made to fetch any address.** A WhatsApp
  message carries its own download location, and Baileys' downloader trusted
  it, host included, so a crafted attachment (sent from a modified client)
  made the bot connect to localhost, the LAN or cloud metadata. The bot also
  read the response without a size limit. Attachments now come only from
  WhatsApp's media CDN (`https`, `*.whatsapp.net`); redirects are checked hop
  by hop; the declared size, `Content-Length` and the bytes read are each
  capped at `MAX_MEDIA_SIZE`, cancelling the transfer as soon as it is over;
  the file's MAC is verified before it is decrypted
  ([details](docs/security-architecture.md#incoming-attachments)).
- Images over 40 megapixels are refused before decoding (decompression bombs).
- `.sticker` and `.toimg` now wait for a heavy-command slot like the other
  conversions, so a burst of them is queued and bounded.

### Fixed

- **The `.chat` daily limit could be exceeded.** It was checked when a
  question started but counted only when it was answered, and "one question
  at a time" applied per chat. So one person asking in two chats at once got
  two answers on a limit of one. Now:
  - a question reserves its place in the count the moment it starts (in the
    same step as the check);
  - an answer keeps the reservation; an error, an empty answer, a queue
    timeout or `.chat stop` gives it back;
  - each person has one question in progress across all chats, while every
    chat keeps its own history;
  - `.chat stop` cancels your question from whichever chat you send it in.

## [4.2.0] - 2026-10-26

HamBot runs the same on Linux, macOS and Windows, on a PC, a laptop or a
server. CI now tests the bot on Windows and macOS, on Node 22 and 24.

### Fixed

- **Started from another folder, the bot lost its settings and its session.**
  `.env` was read from the folder the bot was started in, in four places
  (`index.js`, `handler.js`, `config.js`, the chat check), and the session
  folder was relative to it too. A shortcut, a service manager or
  `node /path/to/index.js` picked up the wrong `.env`, or none, and started a
  fresh, unlinked session. Both now come from the bot's own folder;
  real environment variables still win over `.env`.
- **Windows:**
  - yt-dlp was run with `python3`, which Windows does not have. It now uses
    `python` there (still `python3` elsewhere), and `YTDLP_PYTHON` takes
    either slash. A venv path written on another OS
    (`.venv/bin/python` ↔ `.venv\Scripts\python.exe`) is translated.
  - `.security restart`, `stop` and `logs` could not start pm2, whose launcher
    on Windows is a `.cmd` file. pm2 now runs as its own JavaScript entry
    point under the bot's Node, on every OS, never through a shell.
  - `npm run dev` and `npm run test:verbose` used POSIX-only `VAR=value`
    syntax; they take `--dev` and `--verbose` flags now.
  - The pm2 config put `.venv/bin` on `PATH`; on Windows it is `.venv\Scripts`.
- **`.brat`** looked for its font relative to the working folder.
- **Shutdown** could exit with a session write half done, and a reconnect
  timer could start a new connection mid-shutdown. One routine now handles
  every stop:
  - `Ctrl+C`, `docker stop` (SIGTERM), a closed terminal or console (SIGHUP),
    `Ctrl+Break`, and pm2's shutdown message on Windows, where pm2 cannot
    send signals;
  - it runs once, cancels reconnects, and waits for session writes;
  - it ends within `SHUTDOWN_DEADLINE_MS` (default 4 s), and pm2's
    `kill_timeout` is set 4 s longer, so pm2 never cuts it short.
- **A timed-out ffmpeg or yt-dlp that ignored SIGTERM kept running.** Both
  process runners armed the SIGKILL fallback and then cancelled it at once,
  while reporting the timeout. The SIGKILL now stays armed until the process
  has really exited.
- **A checkout on Windows turned line endings into CRLF** (Git's usual
  `core.autocrlf`), which breaks `deploy.sh` in WSL or Git Bash. A new
  `.gitattributes` keeps every text file LF on every OS.
- **`.env.example` set `NODE_OPTIONS=--max-old-space-size=2048`.** Docker
  passes `.env` to the container, so that replaced the image's 1536 MB heap
  ceiling with one above the container's 2 GB memory limit. It is no longer
  set.

### Security

- **Private-address check for user-supplied URLs** (`.video`, `.music`): a
  DNS answer in IPv4-mapped dotted form (`::ffff:169.254.169.254`), NAT64
  (`64:ff9b::/96`) or 6to4 slipped past it. It now uses Node's `net.BlockList`
  with one documented table of the IANA special-purpose ranges. Addresses the
  owner configures (AI backends on `localhost`, Docker, Tailscale or the LAN;
  the egress proxy) are untouched.
- `PM2_PROCESS_NAME` must be a plain name (letters, digits, `.` `-` `_`, not
  starting with `-`). It ends up in pm2's arguments and in log file paths.
- **Agent files:** folder and file are resolved with the OS's own realpath and
  compared case-exactly on every OS, so a sibling folder that differs only in
  letter case is never admitted. The docs now state what the checks cover on
  each OS.

### Changed

- **`canvas` is an optional dependency.** Where it has no prebuilt binary
  (Windows on ARM, musl Linux, some boards), the install no longer fails:
  `.menu` is sent as text and `.brat` says it is unavailable.
- **"Files from the agent"** docs work for any agent and any setup. They spell
  out that HamBot must be able to read the folder: a shared volume, a shared
  folder, or a sync from the agent's machine. A Tailscale connection alone
  shares answers, not files.
- **Docs:** a platform table (native Windows, WSL2, macOS, Linux; what CI
  tests), and setting HamBot up on Windows without WSL.

### Added

- **Settings:**
  - `HAMBOT_MAX_HEAP_MB`: heap ceiling for pm2, so it fits a small machine;
  - `SHUTDOWN_DEADLINE_MS`;
  - `PM2_BIN`;
  - `HAMBOT_ENV_FILE`.
- **Tests:**
  - `tests/platform.test.cjs`;
  - `tests/pm2-stop.test.cjs`, which runs real pm2 in CI on all three OSes;
  - the yt-dlp fake now runs through the machine's real Python on every OS.

## [4.1.0] - 2026-10-21

Agents can send **files** to WhatsApp through `.chat`, and seven media
command fixes.

### Added

- **Files from the agent.** With `CHAT_AGENT_MEDIA_DIR` set, the `MEDIA:<path>`
  lines in an agent's answer are taken out of the text and sent as files:
  - images, video and audio go as WhatsApp media;
  - anything else goes as a named document.

  Opt-in, and only for the agent backend. Settings and setup are in
  [docs/ai-chat.md](docs/ai-chat.md#files-from-the-agent).
- `CHAT_AGENT_MEDIA_MAX_FILES` (default 5): files per answer. Each file is
  capped at `MAX_MEDIA_SIZE`.
- `.chat status` (owner) shows the outbox folder.

### Security

- Only a regular file strictly inside the outbox folder is opened:
  - symlinks are resolved first;
  - the open refuses a link swapped in afterwards (`O_NOFOLLOW`, plus a check
    of the opened path on Linux);
  - FIFOs and folders are refused.

  `MEDIA:/app/.env` and `../` paths never leave the bot. File contents and
  paths are never logged.

### Fixed

- **YouTube:** `utils/url-parser.js` still pinned
  `youtube:player_client=android`. yt-dlp keeps the last `youtube:` args, so
  with `YTDLP_PLAYER_CLIENTS` empty ("let yt-dlp choose") the deprecated
  android client was what ran. `YTDLP_PLAYER_CLIENTS` is now the only source.
- **`.music`:**
  - When YouTube refused the *download* of a search hit (the bot check usually
    lands there, not at the search), the user got an error instead of the
    SoundCloud fallback. Now it falls back once, and repeated refusals make
    searches skip YouTube for a while.
  - A pasted URL is never swapped for another song.
  - Words after a pasted URL are no longer sent to yt-dlp as part of it.
- **`.video`:** WebM and MKV files were sent as `video/mp4` and would not play.
  They now arrive as a file.
- **`.say`:** ElevenLabs answers 401 for a used-up quota and for a blocked
  free account, not only for a bad key. The reply now reads the reason from
  the response, instead of always blaming the API key. A missing ffmpeg is
  named as such.
- **`.toimg`:** animated stickers failed, because ffmpeg 5's WebP decoder
  cannot read them. It now converts with sharp: the first frame, no temp
  files, no ffmpeg.
- **`.pinterest`:** a failed full-size (`/originals/`) image was never retried
  at a smaller size.

## [4.0.0] - 2026-10-21

HamBot 4.0: **AI chat from WhatsApp** (`.chat`) with your own local model,
API provider or agent, a new logo, and everything since 3.2 — a quality pass,
a new look and menu, typo-tolerant commands, Node 24, a faster and lighter
bot, reliable networking, and a one-command install that runs it with Docker
or without. Nothing changes for an existing setup until you turn `.chat` on.

### Security

- **`.chat` keeps keys secret.** Keys and tokens come only from `.env` and
  no chat command can set an address, key or header. They travel only in
  request headers (Gemini's too, never in the URL), never over plain http to
  a public address, and never on a redirect (redirects are not followed).
  Provider errors are redacted before logging; prompts, answers and keys
  are never logged; answers are scrubbed of the bot's own secrets (an agent
  that reads `.env` cannot echo it into a chat). Agents, which can run tools
  on their machine, are owner-only unless `CHAT_AGENT_ACCESS` opens them.
- `./deploy.sh chat` writes `.env` with owner-only permissions and keeps the
  previous one as `.env.bak`, which git and the Docker image ignore.

- `sharp` upgraded to 0.35.4 (libheif advisories, reachable via `.sticker`).
- `sharp` 0.35.5 (librsvg CVE-2026-96889), and through their parents
  `ip-address` 10.7.4 (SSRF classifier fixes on the proxy path) and
  `music-metadata` 11.16.1 (crash on crafted media). `pino` 10.4.0,
  `dotenv` 18.0.8 and `protobufjs` 7.6.6 alongside. `npm audit`: 0.
- OMDB lookups use https; the API key was sent over plain http.
- Reminders capped at 5 per user and 500 in total.

### Fixed

- **Networking: content fetches fail far less often.** The HTTP layer had
  several bugs that made `.pinterest`, `.meme`, `.weather` and friends fail
  for no good reason:
  - Falling back to the server IP when a SOCKS proxy was down did not work:
    the "direct" retry still went through the dead proxy.
  - An HTTP proxy (Every Proxy) was used through axios's built-in proxy
    support, which does not tunnel HTTPS. Nearly every site is HTTPS. Requests
    now use a proper CONNECT tunnel, and `.security proxy test` checks that
    same path.
  - A slow *site* counted as a dead proxy, so the request was repeated
    direct after a second full timeout, leaking it to the datacenter IP.
    Only failures of the proxy itself fall back now.
  - A proxy that accepted the connection and then went silent could hang a
    request for minutes; it is now cut off after `PROXY_CONNECT_TIMEOUT` (10s).
  - Nothing was retried: one connection reset or one 503 failed the whole
    command. GET/HEAD now retry resets, timeouts and 429/5xx with backoff
    (`HTTP_RETRIES`, default 2), honouring `Retry-After`. POST is not retried.
  - No connection reuse: every request paid a fresh TCP, TLS and proxy
    handshake. Connections are now kept alive and shared.
  - `HB_PROXY_URL` was used by yt-dlp but ignored by HTTP requests.
  - `FORCE_IPV4` applied to yt-dlp only; it now covers HTTP requests too.
- **Network problems were invisible.** Retries, failures, proxy fallbacks and
  circuit-breaker trips logged only in `full` mode, so the default log showed
  `❌ Failed` and nothing else. They now print in both modes, one line each,
  tagged with the command and a run id, with secrets and query strings
  removed. See [docs/MEDIA.md](docs/MEDIA.md#reading-the-network-log).

- **The installer could ask forever.** If input ended mid-question (an SSH
  connection dropped, a closed terminal), `./deploy.sh` repeated "This one is
  required." endlessly. Every question now allows 5 tries and stops at once
  when input ends.

- **Stuck on "Waiting for the bot to start".** When the server could not
  reach WhatsApp, the bot sat in "connecting" forever without a word, and
  `./deploy.sh` waited blind. The bot now gives up on a silent connection
  after 45s, says so, and retries with backoff; disconnect reasons and
  pairing problems show in the default log mode too. `./deploy.sh` relays
  those messages while it waits, stops early if the container crashed, and
  prints the last log lines when it gives up.
- **Logged out = locked out.** Removing the linked device made the bot exit;
  Docker restarted it into the same dead session, forever, with no QR or
  code. It now archives the session (never deletes it) and relinks by
  itself. Corrupted sessions relink after 3 failures, a session used by two
  copies backs off instead of fighting, a banned number stops retrying, and
  reconnects back off from 3s to 60s.
- **Stuck pairing.** An unused or wrong pairing code was re-requested on
  every cycle; now at most 2, then the QR code. `LOGIN_METHOD` overrides.
  Waiting to be linked for 30+ minutes reports unhealthy.
- **Owner lock-outs:** a `BOT_OWNER_ID` like `0812…` (no country code) was
  silently unusable; it is now reported at startup. `.security onlygroup on`
  no longer ignores the owner's private chat.
- `.security stop` under Docker explains that it restarts, and points at
  `./deploy.sh stop`.
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

- **Cleaner repository.** The test suites moved to `tests/`, and the README
  became a short front page; the long sections are now guides in `docs/`
  (deployment, configuration, commands, development). Issue forms and a pull
  request template were added.

- **Faster replies in groups.** Baileys fetched the whole group roster
  before every message it sent to a group, and the admin check, `.tagall`
  and `.info` fetched it again. Rosters are now cached for 5 minutes and
  dropped the moment someone joins, leaves or is promoted.
- **One slow command no longer delays others.** Messages that arrive
  together were handled one after another, so a `.video` held up everyone
  else's commands. Each now runs on its own.
- **`.video` and `.music` start yt-dlp once, not twice.** Metadata and the
  download come from the same run, and over-long media is skipped by
  yt-dlp itself before any download starts.
- **Less disk work per message.** Signal keys stay in memory between
  messages (Baileys' cacheable key store); writes still go straight to disk.
- **~19 MB less memory when idle.** `sharp` and `canvas` load on first use
  instead of at startup.

- **Node 24 LTS.** Node 20 reached end-of-life in April 2026; `engines` is
  now `>=22.12`, `.nvmrc` 24, CI tests 22 and 24, and the Docker image runs
  `node:24-bookworm-slim`.
- `axios` 1.20.0, `dotenv` 18.0.4, yt-dlp 2026.8.19 in the image; Deno is
  pinned (2.9.7) instead of installed with an unpinned `curl | sh`.
- **Slimmer Docker image:** compilers and `-dev` packages only in a build
  stage; `tini` as PID 1 so the graceful shutdown runs; heap capped at
  1536MB, below the container's 2G limit.
- **New "bold heavy" look for every reply** (`┏━━` title in small caps,
  `┃` rail, `┗━━ ✧` footer). Hand-written replies (owner panel, `.netinfo`,
  meme fallbacks) are converted automatically, so no message is left in
  the old style.
- **`.menu` is one message: a picture with the menu as its caption.** The
  overview is now compact (an ASCII-framed name, then every command grouped
  by category) to fit the caption; descriptions moved to
  `.menu <kategori>`.
- `.security logs` shows the log in a monospace block, so `*` and `_` in
  log lines no longer turn into formatting.
- Media downloads are concatenated once instead of per chunk; spawned
  process output is capped at 16 MB.

### Added

- **AI chat: `.chat`** (aliases `.ai`, `.ask`, `.tanya`). Questions go to a
  local model (Ollama, LM Studio, llama.cpp, vLLM, …), an API provider
  (OpenAI-compatible, Anthropic through the official SDK, Gemini) or an agent
  platform (Hermes Agent, OpenClaw, or any OpenAI-style agent) — on the
  bot's machine or another one on your Tailscale network, e.g. the bot on a
  VPS and the agent on your home PC. Reply to a message with `.chat` to
  include it; the AI remembers recent turns per person (`.chat reset`
  forgets); `.chat stop` cancels. Owner tools: `.chat status`, `test`,
  `models`, `use local|provider|agent`, `stop all`. Guide: docs/ai-chat.md.
  - **Timeouts mean silence, not slowness.** Every request streams; answer
    text, reasoning, tool progress and keep-alives all keep a session
    active, so a long-thinking model or a busy agent is never cut off. Only
    no response, or silence mid-answer, times out (per-backend settings).
  - **At most 2 answers at once** (`CHAT_MAX_CONCURRENT`), a short queue,
    one question per person, an optional daily limit
    (`CHAT_DAILY_LIMIT_ENABLED`), its own slots apart from media downloads.
  - **Broken backends are dropped, not waited on.** Unusable settings turn a
    backend off before the first message; a wrong key or missing model sets
    it aside at once; repeated failures set it aside without timeouts until
    one probe succeeds. A fallback backend answers meanwhile, and the owner
    is told once when a backend goes down and when it is back.
  - **Logs say what to fix:** one line per failure with the backend, masked
    host, status, timing and the exact `.env` variable or step to fix it.
  - Every setting is in `.env` (`CHAT_*`); `utils/chat` is only loaded once
    `.chat` is used.
- **`./deploy.sh chat`** sets it up: who may chat, where questions go,
  fallback, limits; tests the connection from where the bot runs; restarts.
  Nothing is written before the summary is confirmed, every question has
  5 tries, a failed check offers retry / edit / keep / undo, and
  `chat undo` restores the earlier `.env`. Also `chat test`, `chat off`;
  `./deploy.sh doctor` includes the AI chat check.
- **New logo**: a robot in a speech bubble. The `.menu` banner carries it;
  `docs/images` has the SVG, a PNG, and an avatar for the bot's WhatsApp
  profile picture and the GitHub social preview
  (`node scripts/render-art.cjs` regenerates them).
- `npm run test:chat`: `.chat` against fake AI servers on 127.0.0.1.
- `docker-compose.yml` maps `host.docker.internal`, so the container can
  reach a model or agent on the same machine.

- **Network log lines and totals.** A `Network :` line in each command block
  (requests, failures, retries, bytes, route); a `🔁` line showing which media
  source failed, why, and which one answered; a `🎬` line for each failed
  yt-dlp run with its reason (`bot-check`, `proxy`, `timeout`, …) and its last
  error line. `NET_LOG=problems|all|off` chooses how much is shown.
- **`.security media` shows proxy health and the last five network problems.**
- **A shared proxy circuit breaker.** After 3 proxy failures in a row, HTTP
  requests and yt-dlp go direct straight away, instead of each waiting on
  the dead proxy first, until the proxy answers again.
- **yt-dlp transport retries** (`--socket-timeout`, `--retries`,
  `--fragment-retries`, `--extractor-retries`, with exponential sleeps),
  tunable through `YTDLP_*` in `.env`.
- `npm run test:network`: local-server tests for all of the above.

- **Local mode: run HamBot without Docker.** `./deploy.sh` asks Docker or
  Local (`--docker` / `--local` skip the question) and every command works the
  same in both. Local installs the Node packages, pm2 (keeps the bot running),
  yt-dlp in a private `.venv` at the same pinned version as the image — which
  works where `pip install` is refused — and Deno; it shows the one `sudo`
  line needed to start after a reboot. Existing Docker installs are unchanged.
- **One-line install:** `curl -fsSL
  https://raw.githubusercontent.com/AkilixCode/hambot-wa-bot/main/scripts/install.sh | sh`.
- `./deploy.sh switch docker|local` moves the bot and its WhatsApp session
  (no relinking; the session it replaces is archived, never deleted).
- `./deploy.sh doctor` checks the whole setup and prints one fix per problem;
  setup points at it whenever a step fails.
- The installer expects mistakes: downloads are retried 3 times and then
  explained, a full disk is said plainly, a second copy of the bot is never
  started (and Docker + Local running together is flagged), only one
  `./deploy.sh` runs at a time, Ctrl+C leaves nothing half-done, and running
  it again continues where it stopped. Unattended installs take `--owner`,
  `--pairing` and `-y`.

- **Heavy commands wait in line instead of "busy, try again".** With all
  `MAX_PROCESSES` slots in use, up to `HEAVY_QUEUE_MAX` (default 5) requests
  wait (one per user), are told their place, and start by themselves. A full line or a
  2-minute wait still answers "Sedang Sibuk"; `HEAVY_QUEUE_MAX=0` keeps the
  old behaviour.
- `.ping` shows processing and delivery time, heavy slots in use and
  waiting, and the group cache hit rate. "Latensi" used to read ~0 ms
  whatever happened.

- **Recovery commands:** `./deploy.sh config` (fix a mistyped owner or
  pairing number), `./deploy.sh relink [--qr | --code <number>]`,
  `./deploy.sh restore-session` (undo a relink), and a read-back
  confirmation for every number typed into `deploy.sh`. `status` shows the
  configured numbers and login method.
- `npm run test:deploy` — runs `deploy.sh` against a fake Docker under a
  pseudo-terminal, including the misclick paths.
- **`./deploy.sh`** — one-command setup (creates `.env`, starts the bot,
  shows the pairing code or QR) plus `update`, `logs`, `status` and `stop`.
- **Prebuilt image on GHCR** (`ghcr.io/akilixcode/hambot-wa-bot`, amd64 and
  arm64), built and smoke-tested by CI; `docker compose pull` replaces
  building on the server. `HAMBOT_TAG` pins a version.
- **Pairing-code login:** set `PAIRING_NUMBER` and type an 8-character code
  on the phone instead of scanning a QR. The QR is also saved as
  `data/qr.png`.
- **Real Docker health check:** healthy while connected or waiting to be
  linked, unhealthy after 5 minutes without a connection or if the process
  stops responding. The old check always passed.
- Dependabot: weekly PRs for npm packages, the Docker base images and
  GitHub Actions (Baileys excluded; it is bumped deliberately).
- Dependency-contract tests covering every third-party API the bot calls.
- **Typo-tolerant commands.** An unambiguous typo (`.mneu`, `.stikcer`,
  `.wether`) runs the intended command, and the reply starts with a small
  "✏️ .mneu ➜ .menu" note. Ties get "did you mean" suggestions, owner-only
  commands are never guessed, and chat that merely starts with a dot
  (`.ok`, `...`) is still ignored. `.menu <typo>` works the same way.
- Menu picture: `MENU_IMAGE` (file path or URL), or `assets/menu.jpg`, or
  a banner the bot draws itself. `BOT_TAGLINE` sets the line under the name.
- `npm run test:commands` — regression tests driven through a fake socket.
- GitHub Actions workflow running `test:all` and `npm audit` on Node 20/22.
- `HAMBOT_DATA_DIR` to relocate `data/`; the tests no longer overwrite the
  live `data/egress.json`.

### Removed

- `EXPOSE 3000` from the Dockerfile; nothing listened on it.
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
