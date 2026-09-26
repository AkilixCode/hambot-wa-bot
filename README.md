# HamBot

A WhatsApp bot built on [Baileys](https://github.com/WhiskeySockets/Baileys),
with a modular command system, media downloading, and a set of networking
reference tools. Command output is in Indonesian.

[![License: ISC](https://img.shields.io/badge/license-ISC-blue.svg)](LICENSE.md)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.12-brightgreen.svg)](https://nodejs.org)

## Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Commands](#commands)
- [Architecture](#architecture)
- [Adding a command](#adding-a-command)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Requirements

- Node.js 22.12 or newer (24 LTS recommended; Node 20 is end-of-life)
- `python3` with `yt-dlp` installed — used by `.video` and `.music`
- `ffmpeg` — used by `.say` and `.toimg`
- `deno` — yt-dlp needs a JS runtime to solve YouTube's n-challenge. Without it
  it falls back to a slower Python solver that fails more often.
- `pm2`, optional — only needed for `.security restart` and `.security stop`

No browser is required. `.pinterest` used to drive a headless Chromium; since
3.2.0 it calls Pinterest's JSON endpoint over plain HTTP.

Docker handles all of these for you: you only need Docker Engine with the
Compose v2 plugin.

## Installation

### Docker (recommended)

Works on any Linux server with Docker and the Compose v2 plugin, on x86-64
and ARM64 (e.g. a Raspberry Pi 4/5 or an ARM VPS). A prebuilt image is
published to `ghcr.io/akilixcode/hambot-wa-bot`, so nothing is compiled on
your server.

**Quick start**

```bash
git clone https://github.com/AkilixCode/hambot-wa-bot.git
cd hambot-wa-bot
./deploy.sh
```

`deploy.sh` checks that Docker is ready, creates `.env` (asking for your owner
number and, optionally, the bot's number for a pairing code), pulls the image,
starts the bot, and shows the pairing code or QR code to link the number (see
[Linking the number](#linking-the-number)). Add API keys to `.env` later and
run `./deploy.sh update` to apply them.

**Day to day**

| Command | What it does |
| --- | --- |
| `./deploy.sh update` | Pull the latest image (and repo files) and restart |
| `./deploy.sh logs` | Follow the logs |
| `./deploy.sh status` | Container state and health |
| `./deploy.sh stop` | Stop the bot; the WhatsApp session is kept |
| `./deploy.sh config` | Fix the owner or pairing number (typo? run this) |
| `./deploy.sh relink [--qr \| --code <number>]` | Link the WhatsApp number again from scratch |
| `./deploy.sh restore-session` | Undo the last relink |

**Without the script**

```bash
cp .env.example .env      # set BOT_OWNER_ID, PAIRING_NUMBER and any API keys
docker compose pull
docker compose up -d
docker compose logs -f    # pairing code or QR code, then the bot's logs
```

- **Pin a version:** set `HAMBOT_TAG` in `.env` (e.g. `HAMBOT_TAG=3.3.0` or
  `sha-<commit>`) instead of following `latest`.
- **Build it yourself:** `docker compose build && docker compose up -d`
  builds the image from your checkout, e.g. after local code changes.
  `deploy.sh` does this automatically if the pull fails.
- **"denied" when pulling:** the image package on GitHub is private. Either
  make it public (repository → Packages → hambot-wa-bot → Package settings →
  Change visibility), or run `docker login ghcr.io` on the server with a token
  that has `read:packages`.
- **Health:** `docker compose ps` shows `healthy` while the bot is connected
  or waiting to be linked, and `unhealthy` after 5 minutes without a
  connection.

The container runs as a non-root user with all capabilities dropped. The
WhatsApp session, logs and runtime state live in named volumes
(`hambot_auth`, `hambot_logs`, `hambot_data`), so they survive restarts and
updates.

### Local

```bash
git clone https://github.com/AkilixCode/hambot-wa-bot.git
cd hambot-wa-bot
npm install               # needs Node.js 22.12+ (24 LTS recommended)
pip install yt-dlp        # plus ffmpeg from your package manager
curl -fsSL https://deno.land/install.sh | sh
cp .env.example .env      # set BOT_OWNER_ID, PAIRING_NUMBER and any API keys
npm start
```

Then link the bot's number (see below). The session is written to
`auth_info_baileys/`; treat that directory as a credential, since anyone
holding it can act as the linked account.

### Linking the number

On the first start the bot has to be linked as a device of its WhatsApp
account. Two ways:

- **Pairing code (easiest on a server).** Set `PAIRING_NUMBER` in `.env` to the
  bot's number with country code (e.g. `6281234567890`). The logs show an
  8-character code; on that phone open WhatsApp → Linked devices → Link a
  device → *Link with phone number instead*, and type it.
- **QR code.** Leave `PAIRING_NUMBER` empty and scan the QR printed in the
  logs from WhatsApp → Linked devices. The same QR is saved as
  `data/qr.png`, handy when the terminal mangles it. It is deleted once
  linked.

Either way this is needed only once; the session survives restarts.

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env`
and edit. Every value has a working default except the API keys.

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
| `GEMINI_API_KEY` | reserved, not currently used |

Commands whose key is missing say so rather than failing obscurely. Every other
command works without any key.

### Proxy and logging

`PROXY_ENABLED`, `PROXY_TYPE` (`http`, `https`, `socks5`), `PROXY_HOST`,
`PROXY_PORT`, `PROXY_USER`, `PROXY_PASS` configure an outbound proxy shared by
yt-dlp and axios. `NETWORK_FALLBACK_TO_LOCAL` retries without the proxy when the
proxy itself is unreachable.

Because the bot usually runs on a datacenter IP — which YouTube treats as a bot —
routing media traffic through a residential connection is the most effective fix
available. Toggle it live with `.security proxy on|off|status|test`; the choice
persists across restarts. See [docs/MEDIA.md](docs/MEDIA.md) for the
Tailscale + Every Proxy setup.

`LOG_LEVEL` accepts `simple` (default, one block per command) or `full`
(verbose). `LOG_SILENT=true` suppresses output entirely.

## Commands

36 commands. Type `.menu` for the list, `.menu <command>` for usage and
examples, or `.menu <category>` for one category.

### General

| Command | Aliases | Description |
| --- | --- | --- |
| `.menu` | `.help`, `.intro`, `.commands`, `.bantuan` | Menampilkan daftar perintah bot |

### Media

| Command | Aliases | Description |
| --- | --- | --- |
| `.music` | `.song`, `.mp3`, `.audio`, `.lagu` | Cari dan unduh musik YouTube |
| `.pinterest` | `.pin`, `.pint` | Cari gambar estetik dari Pinterest |
| `.say` | `.tts`, `.speak`, `.bicara` | Ubah teks jadi suara dengan AI |
| `.video` | `.vid`, `.dl`, `.download` | Unduh video dari banyak platform |

### Tools

| Command | Aliases | Description |
| --- | --- | --- |
| `.brat` | `.bratgen`, `.stikerbrat`, `.charli` | Bikin stiker gaya sampul Brat |
| `.reminder` | `.remind`, `.ingetin`, `.alarm` | Atur pengingat untuk dirimu |
| `.sticker` | `.s`, `.stiker`, `.stik` | Ubah gambar menjadi stiker |
| `.toimg` | `.toimage`, `.stickertoimg` | Ubah stiker menjadi gambar |

### Utility

| Command | Aliases | Description |
| --- | --- | --- |
| `.calc` | `.calculate`, `.math` | Hitung ekspresi matematika |
| `.qr` | `.qrcode`, `.qrgen` | Buat QR code dari teks atau URL |
| `.time` | `.timezone`, `.clock` | Cek waktu di berbagai zona waktu |
| `.translate` | `.tr`, `.trans`, `.terjemah` | Terjemahkan teks ke bahasa lain |
| `.weather` | `.cuaca`, `.wthr` | Info cuaca untuk lokasi manapun |

### Networking

| Command | Aliases | Description |
| --- | --- | --- |
| `.dns` | `.nslookup`, `.dig`, `.resolve` | Lookup DNS untuk domain |
| `.ipinfo` | `.ip`, `.whois`, `.ipcheck` | Dapatkan informasi alamat IP |
| `.netinfo` | `.network`, `.netcheat`, `.jaringan` | Referensi jaringan komputer |
| `.port` | `.ports`, `.portlist`, `.portinfo` | Referensi port jaringan umum |
| `.subnet` | `.cidr`, `.ipcalc`, `.subnetcalc` | Hitung subnet dari IP dan CIDR |

### Information

| Command | Aliases | Description |
| --- | --- | --- |
| `.crypto` | `.kripto`, `.bitcoin`, `.btc` | Cek harga cryptocurrency terkini |
| `.gempa` | `.earthquake`, `.quake` | Info gempa terbaru dari BMKG |
| `.wiki` | `.wikipedia` | Cari ringkasan artikel Wikipedia |

### Entertainment

| Command | Aliases | Description |
| --- | --- | --- |
| `.movie` | `.film`, `.imdb` | Info film, rating, dan sinopsis |

### Fun

| Command | Aliases | Description |
| --- | --- | --- |
| `.8ball` | `.8b`, `.ask` | Tanya bola ajaib ya atau tidak |
| `.dice` | `.roll`, `.d` | Lempar dadu, bisa banyak sekaligus |
| `.fact` | `.randomfact`, `.funfact`, `.fakta` | Dapatkan fakta menarik acak |
| `.flip` | `.coin`, `.coinflip` | Lempar koin, angka atau gambar |
| `.meme` | `.memes`, `.memeindo` | Dapatkan meme Indonesia acak |
| `.quote` | `.quotes`, `.inspire`, `.kutipan`, `.motivasi` | Kutipan inspirasional acak |
| `.rps` | `.rockpaperscissors`, `.suit` | Main batu gunting kertas |
| `.spam` | `.prank` | Prank spam chat (owner only) |
| `.trivia` | `.quiz`, `.question` | Main kuis trivia acak |

### Group

| Command | Aliases | Description |
| --- | --- | --- |
| `.info` | `.groupinfo`, `.grup` | Info dan statistik grup |
| `.tagall` | `.everyone`, `.all`, `.hidetag` | Tag semua anggota grup (admin only) |

### System

| Command | Aliases | Description |
| --- | --- | --- |
| `.ping` | `.p`, `.status` | Cek waktu respon dan status sistem |

### Security

| Command | Aliases | Description |
| --- | --- | --- |
| `.security` | `.sec`, `.secstatus` | Panel manajemen keamanan (owner only) |

`.video` and `.music` accept URLs from 30+ platforms, including short forms such
as `vt.tiktok.com`, `youtu.be`, and `fb.watch`. See `utils/url-parser.js` for
the full list.

## Architecture

```
index.js            Baileys connection, QR pairing, reconnection
handler.js          Message pipeline: filtering, auth, rate limiting, dispatch
config.js           Environment parsing, owner and admin resolution
commands/
  base.js           CommandBase — metadata, validation, reply helpers
  registry.js       Loading, alias resolution, runtime toggles, suggestions
  <name>.js         One file per command
utils/
  ui.js             Presentation toolkit — every reply is built here
  security.js       Input sanitising, URL guards, permissions, blocking
  rate-limiter.js   Sliding-window limiter, bounded and self-evicting
  cache.js          In-memory TTL cache
  http-client.js    axios wrapper with proxy support
  url-parser.js     Platform detection and per-platform yt-dlp arguments
  logger.js         Command logging in simple or full mode
  redact.js         Secret scrubbing for anything printed or sent
  helpers.js        Media download, translation, filenames
```

A message flows `index.js` → `handler.js` → `registry.get()` →
`command.validate()` → `command.execute()`. `handler.js` is the only place
authorisation and rate limiting happen, so a command cannot accidentally skip
them.

Presentation is centralised in `utils/ui.js`. Commands describe *what* to say;
the toolkit decides how it looks. See
[docs/security-architecture.md](docs/security-architecture.md) for the security
design.

## Adding a command

Copy `commands/_template.js` — files beginning with `_` are not loaded — and
drop it into `commands/`. The registry picks it up on the next start.

```js
const CommandBase = require('./base');
const ui = require('../utils/ui');

class HelloCommand extends CommandBase {
    constructor() {
        super({
            name: 'hello',
            aliases: ['hai'],
            description: 'Menyapa pengguna',   // shown in .menu, keep under 34 chars
            usage: '.hello <nama>',
            category: 'fun',
            cooldown: 2000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        if (!args[0]) {
            return await this.replyUsage(sock, from, msg, {
                icon: '👋',
                title: 'Sapaan',
                description: 'Bot akan menyapamu.',
                usage: ['.hello <nama>'],
                examples: ['.hello Budi']
            });
        }

        await this.reply(sock, from, msg, ui.card({
            icon: '👋',
            title: 'Halo',
            lines: [`Senang bertemu, ${ui.bold(ui.safe(args.join(' ')))}!`]
        }));
    }
}

module.exports = HelloCommand;
```

Conventions worth following:

- Build replies from `utils/ui.js`. Do not hand-roll layout — inconsistent
  hand-rolled strings are what this toolkit replaced.
- Route any user input you echo through `ui.safe()`, or a name containing `*`
  will corrupt the message.
- Use `this.replyError()` with a `hint` so failures tell the user what to do
  next.
- Set `isHeavy: true` for anything that spawns a process or drives a browser, so
  it gets queued.
- Write user-facing text in Indonesian.

## Testing

```bash
npm test                 # module loading, config, registry, helpers
npm run test:integration # command metadata and alias integrity
npm run test:security    # sanitising, URL guards, permissions, blocking
npm run test:media       # yt-dlp runner, provider cascade, egress toggle
npm run test:commands    # handler and command regressions, via a fake socket
npm run test:all
```

All suites run offline, and CI (`.github/workflows/test.yml`) runs them on every
push and pull request.

## Troubleshooting

**QR code will not scan.** Use a pairing code instead: set `PAIRING_NUMBER` in
`.env` and restart. Or open the saved image: `data/qr.png` locally, or
`docker compose cp hambot:/app/data/qr.png .` with Docker (`./deploy.sh` does
this for you).

**Typed the wrong number** (owner or pairing). `./deploy.sh config` asks
again, showing the current values; the WhatsApp session is kept. The owner
number as the bot understood it is printed at startup (`Owner: …`), and a
number it cannot use — e.g. `0812…` without the country code — is reported
there instead of silently ignored.

**Pairing code doesn't work** (expired, rejected on the phone, or sent to the
wrong number). The bot issues at most two codes, then switches to the QR code
by itself. To start over right away: `./deploy.sh relink --qr`, or
`./deploy.sh relink --code <the bot's number>` for a new code. Without the
script: set `LOGIN_METHOD=qr` in `.env` and restart.

**Removed the linked device on the phone / logged out.** Nothing to do: the
bot archives the dead session and shows a new pairing code or QR in the logs
(`./deploy.sh logs`). Relinked by mistake? `./deploy.sh restore-session` puts
the previous session back (archives live in `auth_info_baileys/.archive/`).

**"Another copy of the bot is using this session".** Two copies share one
login — e.g. `npm start` while the container runs, or two containers. Stop one;
the bot backs off (1, 5, then 15 minutes) instead of fighting for it.

**Repeated disconnects.** The bot retries with growing delays (up to a minute)
and relinks by itself if the saved session is corrupted. If it still will not
stay connected, `./deploy.sh relink`.

**Container shows `unhealthy`.** No WhatsApp connection for 5 minutes, or
waiting to be linked for over 30 minutes. `./deploy.sh status` and
`./deploy.sh logs` show which — usually a code or QR nobody scanned, or no
internet on the server.

**Changed the prefix and forgot it.** Restart the bot; the prefix comes back
from `BOT_PREFIX` in `.env`.

**`.video` or `.music` fails.** Run `.security media` first — it reports the
yt-dlp version and age, the player clients in use, and the egress state in one
message. A stale yt-dlp is the most common cause (`./deploy.sh update` with Docker,
`pip install -U yt-dlp` locally); the
next is a retired player client, which you fix by changing
`YTDLP_PLAYER_CLIENTS` in `.env`. If YouTube is blocking the server outright,
turn on the proxy with `.security proxy on`. `.music` falls back to SoundCloud
automatically. Full runbook in [docs/MEDIA.md](docs/MEDIA.md).

**`.pinterest` returns nothing.** It falls back to Wallhaven automatically, so
this should be rare. If both tiers fail, check `.security media` for tripped
circuit breakers.

**`.sticker` or `.brat` fails to load.** `sharp` and `canvas` need native
bindings. Reinstall with build scripts enabled, or use the Docker image.

**Owner commands say access denied.** `BOT_OWNER_ID` is unset or does not match.
Group chats report an `@lid` identifier that differs from the
`@s.whatsapp.net` one used in private chats — register both, comma-separated.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities through the
process in [SECURITY.md](SECURITY.md).

## License

[ISC](LICENSE.md) © Ilham

This project is not affiliated with or endorsed by WhatsApp or Meta. Automating
a WhatsApp account may conflict with the WhatsApp Terms of Service; you are
responsible for how you use it.
