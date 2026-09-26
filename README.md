# HamBot

A WhatsApp bot built on [Baileys](https://github.com/WhiskeySockets/Baileys),
with a modular command system, media downloading, and a set of networking
reference tools. Command output is in Indonesian.

[![License: ISC](https://img.shields.io/badge/license-ISC-blue.svg)](LICENSE.md)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.19-brightgreen.svg)](https://nodejs.org)

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

- Node.js 20.19 or newer
- `python3` with `yt-dlp` installed — used by `.video` and `.music`
- `ffmpeg` — used by `.say` and `.toimg`
- `deno` — yt-dlp needs a JS runtime to solve YouTube's n-challenge. Without it
  it falls back to a slower Python solver that fails more often.
- `pm2`, optional — only needed for `.security restart` and `.security stop`

No browser is required. `.pinterest` used to drive a headless Chromium; since
3.2.0 it calls Pinterest's JSON endpoint over plain HTTP.

Docker handles all of these for you.

## Installation

### Docker (recommended)

```bash
git clone https://github.com/AkilixCode/hambot-wa-bot.git
cd hambot-wa-bot
cp .env.example .env      # fill in BOT_OWNER_ID and any API keys
docker compose up -d
docker compose logs -f    # scan the QR code that appears
```

The image runs as a non-root user with all capabilities dropped, and persists
the WhatsApp session in a named volume so it survives restarts.

### Local

```bash
git clone https://github.com/AkilixCode/hambot-wa-bot.git
cd hambot-wa-bot
npm install
pip install yt-dlp
curl -fsSL https://deno.land/install.sh | sh
cp .env.example .env      # fill in BOT_OWNER_ID and any API keys
npm start
```

Scan the QR code printed to the terminal with WhatsApp → Linked devices. The
session is written to `auth_info_baileys/`; treat that directory as a
credential, since anyone holding it can act as the linked account.

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env`
and edit. Every value has a working default except the API keys.

### Identity

| Variable | Default | Purpose |
| --- | --- | --- |
| `BOT_NAME` | `HamBot` | Name shown in the menu |
| `BOT_OWNER` | — | Name shown in the menu footer |
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

**QR code will not scan.** The terminal must render block characters. Widen the
window, or use `docker compose logs -f`.

**Repeated disconnects.** Delete `auth_info_baileys/` and pair again. This logs
the device out, so re-link it from the phone.

**`.video` or `.music` fails.** Run `.security media` first — it reports the
yt-dlp version and age, the player clients in use, and the egress state in one
message. A stale yt-dlp is the most common cause (`pip install -U yt-dlp`); the
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
