# Deployment

HamBot runs either **in Docker** or **locally** (Node.js + pm2, no Docker).
Both are set up and managed by the same script, `./deploy.sh`, with the same
commands. Pick whichever suits the machine; you can switch later without
relinking WhatsApp.

- [Quick install](#quick-install)
- [Docker or Local?](#docker-or-local)
- [Docker](#docker)
- [Local](#local)
- [Linking the number](#linking-the-number)
- [Day-to-day commands](#day-to-day-commands)
- [Switching between Docker and Local](#switching-between-docker-and-local)
- [Unattended installs](#unattended-installs)
- [Troubleshooting](#troubleshooting)

## Quick install

On Linux or macOS (on Windows, inside [WSL](https://learn.microsoft.com/windows/wsl/install)):

```bash
curl -fsSL https://raw.githubusercontent.com/AkilixCode/hambot-wa-bot/main/scripts/install.sh | sh
```

This downloads HamBot into `./hambot-wa-bot` and starts `./deploy.sh`, which
asks three things — Docker or Local, your WhatsApp number (the owner), and
optionally the bot's number for a pairing code — then starts the bot and shows
the pairing code or QR code.

Prefer to look before you run? The same thing by hand:

```bash
git clone https://github.com/AkilixCode/hambot-wa-bot.git
cd hambot-wa-bot
./deploy.sh
```

Running either again is always safe: every step checks before it acts, so an
interrupted or failed setup simply continues where it stopped.

## Docker or Local?

| | Docker (recommended) | Local |
| --- | --- | --- |
| **You need** | Docker Engine + Compose v2 | Node.js 22.12+ (24 recommended) |
| **Installed for you** | Everything, inside one prebuilt image | Node packages, pm2, yt-dlp (private `.venv`), Deno |
| **Not installed for you** | — | ffmpeg (needs sudo; the exact command is shown) |
| **Keeps running** | Docker restarts it; survives reboots | pm2 restarts it; one `sudo` line for reboots |
| **Platforms** | x86-64 and ARM64 Linux | Linux, macOS, WSL |
| **Good for** | Servers, VPS, Raspberry Pi | Machines without Docker, development |

`./deploy.sh` asks when it first runs (`--docker` or `--local` skips the
question). If Docker isn't usable, it says exactly why — not installed, daemon
stopped, your user not in the `docker` group, Docker Desktop not running — and
offers Local instead.

## Docker

A prebuilt image is published to `ghcr.io/akilixcode/hambot-wa-bot` for x86-64
and ARM64 (e.g. a Raspberry Pi 4/5 or an ARM VPS), so nothing is compiled on
your server.

```bash
./deploy.sh --docker
```

checks Docker, creates `.env`, pulls the image (3 tries; if that fails it
builds the image locally), starts the bot and shows the pairing code or QR.

The container runs as a non-root user with all capabilities dropped. The
WhatsApp session, logs and runtime state live in named volumes
(`hambot_auth`, `hambot_logs`, `hambot_data`), so they survive restarts and
updates.

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

## Local

```bash
./deploy.sh --local
```

What it does, in order — each step is skipped when already done:

1. **Node.js** — checks for 22.12 or newer (loads `nvm` if it is installed
   but not active). Too old or missing: it stops and prints the two commands
   to install Node 24 for your user, without sudo.
2. **Packages** — `npm ci --omit=dev`, only when `package-lock.json` changed.
3. **pm2** — installs it if missing (globally, or for your user in
   `~/.local` when there is no permission). pm2 restarts the bot after a crash.
4. **yt-dlp** — into a private Python environment, `.venv/`, at the same
   pinned version as the Docker image. This works on Debian 12+ / Ubuntu
   23.04+, where plain `pip install` is refused. Needs `python3` with the
   `venv` module (`sudo apt-get install -y python3-venv` on Debian/Ubuntu).
5. **ffmpeg** — needed only by `.say` and `.toimg`. If missing, the exact
   install command for your system is shown (and offered).
6. **Deno** — makes YouTube downloads more reliable. Installed for your user
   into `~/.deno` (no sudo, no changes to your shell files).
7. **Start** — `pm2 start ecosystem.config.cjs`, then the pairing code or QR.

Only Node.js is required: if yt-dlp, ffmpeg or Deno can't be installed, the
bot still starts and the affected commands say what is missing.

**Start after a reboot.** pm2 needs one `sudo` command for that, which
`./deploy.sh` prints at the end (it looks like
`sudo env PATH=… pm2 startup systemd -u you --hp /home/you`). Run it once.
`./deploy.sh status` reminds you until it's done.

**Running as root** works, but files and pm2 then belong to root; the script
warns and asks first.

The session is written to `auth_info_baileys/`; treat that directory as a
credential, since anyone holding it can act as the linked account.

**Without the script**

```bash
npm ci --omit=dev
python3 -m venv .venv && .venv/bin/pip install "yt-dlp==$(sed -n 's/^ARG YTDLP_VERSION=//p' Dockerfile)"
echo 'YTDLP_PYTHON=.venv/bin/python' >> .env
npm install -g pm2 && pm2 start ecosystem.config.cjs && pm2 save
```

or simply `npm start` to run it in the foreground.

## Linking the number

On the first start the bot has to be linked as a device of its WhatsApp
account. Two ways:

- **Pairing code (easiest on a server).** Give the bot's number when asked (or
  set `PAIRING_NUMBER` in `.env`, with country code, e.g. `6281234567890`).
  An 8-character code appears; on that phone open WhatsApp → Linked devices →
  Link a device → *Link with phone number instead*, and type it.
- **QR code.** Leave the bot's number empty and scan the QR from WhatsApp →
  Linked devices. The same QR is saved as `qr.png` (Docker) or `data/qr.png`
  (Local), handy when the terminal mangles it. It is deleted once linked.

Either way this is needed only once; the session survives restarts and updates.

## Day-to-day commands

The same in both modes:

| Command | What it does |
| --- | --- |
| `./deploy.sh update` | Get the latest version and restart |
| `./deploy.sh status` | Mode, numbers, login state and health |
| `./deploy.sh doctor` | Check everything and print one fix per problem |
| `./deploy.sh logs` | Follow the logs |
| `./deploy.sh stop` | Stop the bot; the WhatsApp session is kept |
| `./deploy.sh config` | Fix the owner or pairing number (typo? run this) |
| `./deploy.sh relink [--qr \| --code <number>]` | Link the WhatsApp number again from scratch |
| `./deploy.sh restore-session` | Undo the last relink |
| `./deploy.sh switch docker\|local` | Move to the other mode (see below) |
| `./deploy.sh help` | All of the above |

API keys and other settings go in `.env` ([configuration](configuration.md));
`./deploy.sh update` applies them.

## Switching between Docker and Local

```bash
./deploy.sh switch local     # or: switch docker
```

stops the bot, copies the WhatsApp session across (out of the Docker volume,
or into it), starts the bot the new way, and records the choice
(`DEPLOY_MODE` in `.env`). No relinking. The copy is staged first and only
put in place once complete; the session it replaces is archived, never
deleted. If the copy fails, the old bot is started again and nothing changes.

Don't run both at once: two copies share one login and keep knocking each
other off WhatsApp. `status` and `doctor` warn if they see both.

## Unattended installs

For scripts, cloud-init and CI — no questions asked:

```bash
./deploy.sh --docker --owner 6281234567890 --pairing 6289876543210 -y
curl -fsSL https://raw.githubusercontent.com/AkilixCode/hambot-wa-bot/main/scripts/install.sh \
  | sh -s -- --local --owner 6281234567890 -y
```

`BOT_OWNER_ID` (and `PAIRING_NUMBER`) exported beforehand work like the
flags. Without a terminal and without a number, setup stops with that hint
rather than waiting for an answer that cannot come.

## Troubleshooting

**Start here: `./deploy.sh doctor`.** It checks the mode, `.env`, disk space,
Docker or Node/pm2/yt-dlp/ffmpeg/Deno, whether the bot is online, whether it
starts after a reboot, whether WhatsApp is reachable, and whether two copies
are running — and prints the fix for each problem.

**The installer stopped with an error.** Fix what it names, then run
`./deploy.sh` again; it continues where it stopped. Downloads (image, npm,
pip, Deno) are tried 3 times before it gives up and says so — it never loops.
A full disk is reported as such. Ctrl+C is safe at any point.

**"Another ./deploy.sh is already running".** Wait for it to finish. If none
is (the other one was killed), the stale lock is removed automatically on the
next run.

**"Input ended before an answer".** The terminal closed mid-question (e.g. an
SSH connection dropped). Run `./deploy.sh` again; for scripts use `--owner`.

**Stuck on "Waiting for the bot to start".** The bot never got a QR, code or
connection. `./deploy.sh` shows why while it waits:
- *"No answer from WhatsApp"* or *"ENOTFOUND web.whatsapp.com"* — the machine
  can't reach WhatsApp. Check its internet, DNS and firewall (outbound port
  443 to `web.whatsapp.com`); on a VPS, also the provider's firewall. The bot
  keeps retrying on its own.
- *"The bot container is restarting/exited"* or *"The bot is exited (pm2)"* —
  it crashed at startup; the error is printed right below (often a setting:
  `./deploy.sh config`).

Nothing shown? `./deploy.sh logs` follows the bot live.

**Docker: "permission denied" / "Cannot talk to the Docker daemon".** Your user
isn't in the `docker` group: `sudo usermod -aG docker $USER`, then log out and
back in. Or the daemon isn't running: `sudo systemctl start docker`. On macOS,
start Docker Desktop. Or use `./deploy.sh switch local`.

**Local: "Node.js 22.12 or newer is needed".** Install Node 24 for your user
with nvm (the commands are printed), then run `./deploy.sh` again.

**Local: ".video and .music will not work".** yt-dlp couldn't be installed —
usually Python's venv module is missing (`sudo apt-get install -y
python3-venv`) or PyPI was unreachable. Fix it, then `./deploy.sh update`.

**Local: the bot doesn't come back after a reboot.** Run the `pm2 startup`
line from `./deploy.sh status` once.

**QR code will not scan.** Use a pairing code instead: `./deploy.sh relink
--code <the bot's number>`. Or open the saved image (`qr.png` / `data/qr.png`).

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
login — e.g. Docker and Local at once, `npm start` next to pm2, or two
containers. Stop one (`./deploy.sh status` names the command); the bot backs
off (1, 5, then 15 minutes) instead of fighting for it.

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
message. A stale yt-dlp is the most common cause (`./deploy.sh update` in
either mode); the next is a retired player client, which you fix by changing
`YTDLP_PLAYER_CLIENTS` in `.env`. If YouTube is blocking the server outright,
turn on the proxy with `.security proxy on`. `.music` falls back to SoundCloud
automatically. Full runbook in [MEDIA.md](MEDIA.md).

**`.pinterest` returns nothing.** It falls back to Wallhaven automatically, so
this should be rare. If both tiers fail, check `.security media` for tripped
circuit breakers.

**`.sticker` or `.brat` fails to load.** `sharp` and `canvas` need native
bindings. Run `./deploy.sh update` (Local reinstalls packages when needed), or
use Docker.

**Owner commands say access denied.** `BOT_OWNER_ID` is unset or does not match.
Group chats report an `@lid` identifier that differs from the
`@s.whatsapp.net` one used in private chats — register both, comma-separated.
