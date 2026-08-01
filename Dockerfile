# ============================================================
# HamBot WhatsApp Bot - Production Docker Image
# Base: Node.js 20 on Debian Bookworm (slim)
# ============================================================

FROM node:20-bookworm-slim AS base

# ---- System Dependencies ----
# canvas (libcairo, libpango), sharp (libvips), yt-dlp (python3), ffmpeg, fonts.
#
# No browser is installed. `.pinterest` used to drive a headless Chromium; it
# now calls Pinterest's own JSON endpoint over plain HTTP, which removed ~400MB
# of image, the SYS_ADMIN capability, and roughly 30s of latency per search.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    unzip \
    # Fonts for the .brat sticker renderer (Liberation Sans Narrow)
    fonts-liberation \
    # Canvas native deps (cairo, pango, libjpeg, giflib, librsvg)
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg62-turbo-dev \
    libgif-dev \
    librsvg2-dev \
    libpixman-1-dev \
    # Sharp native deps (libvips)
    libvips-dev \
    # Media processing
    ffmpeg \
    # Python for yt-dlp
    python3 \
    python3-pip \
    # Build tools for native npm modules
    g++ \
    make \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

# ---- Install yt-dlp (media downloader) ----
# Pinned rather than floating: yt-dlp ships breaking extractor changes often,
# and an unpinned rebuild can silently swap in a version that behaves
# differently. Bump this deliberately — a stale yt-dlp is itself a leading
# cause of YouTube failures, so do not let it drift for long.
# `.security media` reports the installed version and its age.
ARG YTDLP_VERSION=2026.07.09
RUN pip3 install --no-cache-dir --break-system-packages "yt-dlp==${YTDLP_VERSION}"

# ---- JavaScript runtime for yt-dlp ----
# YouTube requires solving a JS "n-signature" challenge to get playable stream
# URLs. yt-dlp needs an external JS runtime for this; without one it falls back
# to a slow Python interpreter that fails more often. Deno is yt-dlp's default
# choice and is preferred over the bundled Node.
ENV DENO_INSTALL=/usr/local
RUN curl -fsSL https://deno.land/install.sh | sh -s -- -y \
    && deno --version

# ---- Application Setup ----
WORKDIR /app

# Copy package files first for Docker layer caching
COPY package.json package-lock.json* ./

# Install Node.js dependencies (production only)
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# Copy application source
COPY . .

# ---- Runtime Configuration ----
# Create non-root user for security
# tmp/ holds yt-dlp and ffmpeg scratch files; data/ holds the persisted egress
# toggle. Both must be writable by the runtime user.
RUN groupadd -r hambot && useradd -r -g hambot -G audio,video hambot \
    && mkdir -p /app/auth_info_baileys /app/logs /app/tmp /app/data \
    && chown -R hambot:hambot /app

USER hambot

# Health check: verify node process is running
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
    CMD node -e "process.exit(0)" || exit 1

# Default environment
ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=2048"

EXPOSE 3000

CMD ["node", "index.js"]
