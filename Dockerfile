# ============================================================
# HamBot WhatsApp Bot - Production Docker Image
# Base: Node.js 24 LTS on Debian Bookworm (slim)
#
# Published prebuilt for amd64 and arm64 at
#   ghcr.io/akilixcode/hambot-wa-bot
# by .github/workflows/docker.yml, so a server normally just pulls it.
# `docker compose build` still builds it locally.
# ============================================================

# Deno, copied from its official image and pinned to a release tag, instead
# of the previous unpinned `curl | sh`. Dependabot proposes bumps.
FROM denoland/deno:bin-2.9.7 AS deno

# ---- Builder: install node_modules ----
# canvas and sharp normally download prebuilt binaries that bundle their own
# libraries. The compilers and -dev headers are here only as the fallback for
# a platform without a prebuild, and never reach the runtime image.
FROM node:26-bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates python3 g++ make pkg-config \
        libcairo2-dev libpango1.0-dev libjpeg62-turbo-dev libgif-dev librsvg2-dev libpixman-1-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- Runtime ----
FROM node:26-bookworm-slim

# ffmpeg (.say, .toimg), python3 + pip (yt-dlp), fonts (.brat, menu banner),
# tini (PID 1: forwards signals so the graceful shutdown runs, reaps
# zombies from ffmpeg/yt-dlp), and the *runtime* shared libraries canvas
# needs if it had to be compiled in the builder. No compilers, no -dev.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates ffmpeg python3 python3-pip fonts-liberation tini \
        libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 libpixman-1-0 \
    && rm -rf /var/lib/apt/lists/*

# ---- yt-dlp (media downloader) ----
# Pinned rather than floating: yt-dlp ships breaking extractor changes often,
# and an unpinned rebuild can silently swap in a version that behaves
# differently. Bump this deliberately — a stale yt-dlp is itself a leading
# cause of YouTube failures, so do not let it drift for long.
# `.security media` reports the installed version and its age.
# NOTE: PyPI versions are not zero-padded — it is 2026.8.19, not 2026.08.19,
# even though `yt-dlp --version` prints the padded form.
ARG YTDLP_VERSION=2026.8.19
RUN pip3 install --no-cache-dir --break-system-packages "yt-dlp==${YTDLP_VERSION}"

# ---- JavaScript runtime for yt-dlp ----
# YouTube requires solving a JS "n-signature" challenge to get playable stream
# URLs; yt-dlp prefers Deno for it and falls back to a slower Python solver
# that fails more often.
COPY --from=deno /deno /usr/local/bin/deno

WORKDIR /app

# Dependencies first, so a code-only change reuses this layer.
COPY --from=builder /app/node_modules ./node_modules
COPY . .

# Non-root user.
# The UID/GID are pinned deliberately. `useradd -r` picks the next free system
# id, which shifts whenever the apt package list changes — it has already
# moved once (997 -> 999) and left the WhatsApp auth volume, owned by the old
# id, unwritable. If you ever change these, chown the hambot_auth volume.
# tmp/ holds yt-dlp and ffmpeg scratch files; data/ holds the proxy toggle,
# the login QR image and the health file. All must be writable.
RUN groupadd -r -g 999 hambot && useradd -r -u 999 -g hambot -G audio,video hambot \
    && mkdir -p /app/auth_info_baileys /app/logs /app/tmp /app/data \
    && chown -R hambot:hambot /app

USER hambot

# Healthy = connected, or waiting to be linked, or briefly reconnecting.
# Unhealthy after 5 minutes disconnected, or if the process stops updating
# its health file (see utils/health.js).
HEALTHCHECK --interval=60s --timeout=10s --start-period=120s --retries=3 \
    CMD ["node", "scripts/healthcheck.js"]

# The heap cap stays below the compose memory limit (2G), so Node collects
# garbage before the kernel's OOM killer steps in.
ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=1536"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "index.js"]
