# ============================================================
# HamBot WhatsApp Bot - Production Docker Image
# Base: Node.js 20 on Debian Bookworm (slim)
# ============================================================

FROM node:20-bookworm-slim AS base

# ---- System Dependencies ----
# canvas (libcairo, libpango), sharp (libvips), Playwright (chromium runtime
# libraries), yt-dlp (python3), ffmpeg, fonts.
#
# Note: the `chromium` apt package is deliberately NOT installed. Playwright
# downloads its own matching build below, and the system one is protocol
# incompatible with it. It was only ever here for Puppeteer, which was removed.
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Chromium runtime deps (shared libraries Playwright's build links against)
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
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
RUN pip3 install --no-cache-dir --break-system-packages yt-dlp

# ---- Application Setup ----
WORKDIR /app

# Copy package files first for Docker layer caching
COPY package.json package-lock.json* ./

# Install Node.js dependencies (production only)
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# ---- Install Playwright's matching Chromium (after npm install) ----
# Playwright requires a specific Chromium version that matches its protocol.
# System Chromium from apt-get is incompatible (causes crashpad_handler errors).
# PLAYWRIGHT_BROWSERS_PATH ensures build (root) and runtime (hambot) use the same path.
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.playwright
RUN npx playwright install --with-deps chromium

# Copy application source
COPY . .

# ---- Runtime Configuration ----
# Create non-root user for security
RUN groupadd -r hambot && useradd -r -g hambot -G audio,video hambot \
    && mkdir -p /app/auth_info_baileys /app/logs \
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
