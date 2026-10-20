<div align="center">

<img src="docs/images/banner.jpg" alt="HamBot" width="720">

**A WhatsApp bot with media downloads, stickers, networking tools and a security panel.**<br>
Built on [Baileys](https://github.com/WhiskeySockets/Baileys) · replies in Indonesian · runs in Docker or locally.

[![Tests](https://github.com/AkilixCode/hambot-wa-bot/actions/workflows/test.yml/badge.svg)](https://github.com/AkilixCode/hambot-wa-bot/actions/workflows/test.yml)
[![Docker image](https://github.com/AkilixCode/hambot-wa-bot/actions/workflows/docker.yml/badge.svg)](https://github.com/AkilixCode/hambot-wa-bot/pkgs/container/hambot-wa-bot)
[![Version](https://img.shields.io/github/package-json/v/AkilixCode/hambot-wa-bot?label=version)](CHANGELOG.md)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A522.12-brightgreen)](https://nodejs.org)
[![License: ISC](https://img.shields.io/badge/license-ISC-blue)](LICENSE.md)

[Quick start](#quick-start) · [Features](#features) · [Docs](docs/README.md) · [Changelog](CHANGELOG.md)

</div>

---

## Quick start

One command on Linux or macOS (Windows: inside [WSL](https://learn.microsoft.com/windows/wsl/install)):

```bash
curl -fsSL https://raw.githubusercontent.com/AkilixCode/hambot-wa-bot/main/scripts/install.sh | sh
```

It asks three things — **Docker or Local**, your WhatsApp number (the owner),
and optionally the bot's number for a pairing code — then starts the bot and
shows the code to type on the bot's phone (or a QR code to scan). That's it.

Prefer to look first? `git clone https://github.com/AkilixCode/hambot-wa-bot.git && cd hambot-wa-bot && ./deploy.sh`
does the same.

| | 🐳 Docker (recommended) | 💻 Local |
| --- | --- | --- |
| **You need** | Docker + Compose v2 | Node.js 22.12+ |
| **Set up for you** | Everything, in one prebuilt image (x86-64 / ARM64) | Packages, pm2, yt-dlp, Deno |
| **Keeps running** | Docker restarts it | pm2 restarts it |
| **Choose it with** | `./deploy.sh --docker` | `./deploy.sh --local` |

Changed your mind? `./deploy.sh switch local` (or `docker`) moves the bot and
its WhatsApp session — no relinking.

The installer is built to survive mistakes: wrong answers are asked again (a
few times, never forever), failed downloads are retried and then explained,
and running it again simply continues where it stopped. When something is
off, **`./deploy.sh doctor`** checks everything and prints the fix.

## Day to day

| Command | What it does |
| --- | --- |
| `./deploy.sh update` | Get the latest version and restart |
| `./deploy.sh status` | Mode, numbers, login state and health |
| `./deploy.sh doctor` | Check everything; one fix per problem |
| `./deploy.sh logs` | Follow the logs |
| `./deploy.sh config` | Fix the owner or pairing number |
| `./deploy.sh relink` | Link the WhatsApp number again (`--qr` or `--code <number>`) |
| `./deploy.sh stop` | Stop the bot; the session is kept |

Settings and API keys live in `.env` — see [configuration](docs/configuration.md).

## Features

| | |
| --- | --- |
| 🎬 **Media** | `.video` and `.music` from 30+ platforms (YouTube, TikTok, Instagram, …), `.pinterest`, text-to-speech with `.say` |
| 🖼️ **Stickers** | `.sticker` from any image, `.brat` text stickers, `.toimg` back to a picture |
| 🌐 **Networking** | `.dns`, `.ipinfo`, `.subnet`, `.port` and a `.netinfo` reference |
| 🧰 **Utilities** | `.weather`, `.translate`, `.calc`, `.qr`, `.time`, `.reminder`, `.wiki`, `.crypto`, `.gempa` |
| 🎲 **Fun** | `.trivia`, `.meme`, `.quote`, `.fact`, `.8ball`, `.dice`, `.rps`, `.flip` |
| 👥 **Groups** | `.tagall` (admins), `.info` |
| 🔒 **Security** | Owner-only `.security` panel: lockdown, blocks, audit log, proxy toggle, media doctor |

36 commands in all — send `.menu` to the bot, or see the [command list](docs/commands.md).
Mistyped a command? The bot runs the one you meant and says so.

**Under the hood:** input sanitising and SSRF guards, rate limits and
cooldowns, a queue for heavy downloads, automatic reconnect with backoff, and
self-recovery from a logged-out or corrupted session (the old one is archived,
never deleted).

## Documentation

| Guide | |
| --- | --- |
| [Deployment](docs/deployment.md) | Docker, Local, linking the number, switching, unattended installs, troubleshooting |
| [Configuration](docs/configuration.md) | Every `.env` setting |
| [Commands](docs/commands.md) | All commands and their aliases |
| [Media](docs/MEDIA.md) | Keeping `.video` / `.music` working: yt-dlp, player clients, proxy |
| [Development](docs/development.md) | Architecture, adding a command, tests |
| [Security design](docs/security-architecture.md) | How requests are checked |

## Contributing

Pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). All test
suites run offline: `npm run test:all`. Please report vulnerabilities
privately, as described in [SECURITY.md](SECURITY.md).

## License

[ISC](LICENSE.md) © Ilham

This project is not affiliated with or endorsed by WhatsApp or Meta. Automating
a WhatsApp account may conflict with the WhatsApp Terms of Service; you are
responsible for how you use it.
