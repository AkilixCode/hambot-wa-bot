#!/bin/sh
# Smoke test for the Docker image: everything the bot loads or shells out
# to, run inside the real image. Used by .github/workflows/docker.yml:
#   docker run --rm --entrypoint sh <image> scripts/smoke-test.sh
set -eu

echo "node $(node --version)"
node -e 'require("canvas"); require("sharp"); require("./utils/menu-image").renderBanner(); console.log("canvas + sharp ok")'
node -e 'import("@whiskeysockets/baileys").then(b => { if (typeof b.default !== "function") process.exit(1); console.log("baileys ok"); })'
python3 -m yt_dlp --version
ffmpeg -hide_banner -version | head -n 1
deno --version | head -n 1
node scripts/healthcheck.js --self-test

if [ "${SMOKE_EXPECT_UID:-}" ] && [ "$(id -u)" != "$SMOKE_EXPECT_UID" ]; then
    echo "expected to run as uid $SMOKE_EXPECT_UID, got $(id -u)" >&2
    exit 1
fi
echo "smoke test passed"
