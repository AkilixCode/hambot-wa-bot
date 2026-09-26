#!/bin/sh
# ============================================================
# HamBot deploy helper
#
#   ./deploy.sh           first-time setup: create .env, start the bot,
#                         show the pairing code or QR
#   ./deploy.sh update    pull the latest image (and repo files), restart
#   ./deploy.sh logs      follow the logs
#   ./deploy.sh status    container state and health
#   ./deploy.sh stop      stop the bot (the WhatsApp session is kept)
#
# Needs Docker with the Compose v2 plugin (`docker compose`).
# ============================================================
set -eu

cd "$(dirname "$0")"

SERVICE=hambot

say()  { printf '%s\n' "$*"; }
info() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

require_docker() {
    command -v docker >/dev/null 2>&1 \
        || die "Docker is not installed. See https://docs.docker.com/engine/install/"
    docker compose version >/dev/null 2>&1 \
        || die "The Docker Compose v2 plugin is missing ('docker compose'). See https://docs.docker.com/compose/install/"
    docker info >/dev/null 2>&1 \
        || die "Cannot talk to the Docker daemon. Is it running, and is your user in the 'docker' group (or use sudo)?"
}

# Replace KEY=... (or a commented "# KEY=...") in .env with KEY=value.
# Values reaching here are validated digits, so no sed escaping is needed.
set_env() {
    key=$1
    value=$2
    if grep -q "^#* *${key}=" .env; then
        sed -i.bak "s|^#* *${key}=.*|${key}=${value}|" .env && rm -f .env.bak
    else
        printf '%s=%s\n' "$key" "$value" >> .env
    fi
}

# Ask for a phone number with country code; empty answer allowed if $2 = optional.
ask_number() {
    prompt=$1
    optional=${2:-}
    while :; do
        printf '%s' "$prompt" >&2
        read -r answer || answer=""
        answer=$(printf '%s' "$answer" | tr -d ' +-')
        if [ -z "$answer" ] && [ -n "$optional" ]; then
            printf ''
            return 0
        fi
        case $answer in
            0*) warn "Use the country code instead of the leading 0 (62812..., not 0812...)." ;;
            *[!0-9]*|'') warn "Digits only, please." ;;
            *)
                if [ ${#answer} -ge 8 ] && [ ${#answer} -le 15 ]; then
                    printf '%s' "$answer"
                    return 0
                fi
                warn "That should be 8-15 digits including the country code."
                ;;
        esac
    done
}

create_env() {
    [ -f .env ] && { info ".env already exists, keeping it"; return 0; }
    [ -f .env.example ] || die ".env.example is missing — run this from the repository folder."

    cp .env.example .env
    chmod 600 .env
    info "Created .env from .env.example"

    if [ ! -t 0 ]; then
        warn "Not running interactively: edit .env yourself (BOT_OWNER_ID, PAIRING_NUMBER), then run ./deploy.sh again."
        exit 0
    fi

    say ""
    say "Your WhatsApp number becomes the bot owner (can use owner-only commands)."
    owner=$(ask_number "  Owner number, with country code (e.g. 6281234567890): ")
    set_env BOT_OWNER_ID "$owner"

    say ""
    say "The bot's own number can be linked with a pairing code (type 8 characters"
    say "on the phone) instead of scanning a QR code. Leave empty to use the QR code."
    pairing=$(ask_number "  Bot's number for a pairing code (empty = QR): " optional)
    [ -n "$pairing" ] && set_env PAIRING_NUMBER "$pairing"

    say ""
    info "Saved. API keys and other settings can be added to .env later."
}

start() {
    info "Pulling the prebuilt image"
    if docker compose pull "$SERVICE"; then
        docker compose up -d --no-build "$SERVICE"
    else
        warn "Could not pull the image (offline, or the package is private) — building it here instead. This takes a few minutes."
        docker compose up -d --build "$SERVICE"
    fi
}

# Wait for the bot to print a pairing code, a QR code, or "connected".
show_login() {
    info "Waiting for the bot to start (Ctrl+C stops waiting; the bot keeps running)"
    tries=0
    while [ $tries -lt 60 ]; do
        tries=$((tries + 1))
        sleep 2
        logs=$(docker compose logs --no-log-prefix "$SERVICE" 2>&1 || true)

        if printf '%s' "$logs" | grep -q "connected to WhatsApp"; then
            info "Connected to WhatsApp. Send .menu to the bot to try it."
            return 0
        fi
        if printf '%s' "$logs" | grep -q "PAIRING CODE"; then
            say ""
            printf '%s\n' "$logs" | grep -B 1 -A 7 "PAIRING CODE" | tail -n 9
            say ""
            info "Type that code on the bot's phone. Then check: ./deploy.sh logs"
            return 0
        fi
        if printf '%s' "$logs" | grep -q "Scan QR"; then
            docker compose logs --no-log-prefix --tail 45 "$SERVICE"
            if docker compose cp "$SERVICE:/app/data/qr.png" ./qr.png >/dev/null 2>&1; then
                info "QR also saved as ./qr.png (delete it after linking)."
            fi
            info "Scan it with WhatsApp → Linked devices. Then check: ./deploy.sh logs"
            return 0
        fi
    done
    warn "No pairing code, QR or connection after 2 minutes. Check: ./deploy.sh logs"
}

cmd_setup() {
    require_docker
    create_env
    start
    show_login
}

cmd_update() {
    require_docker
    if [ -d .git ] && command -v git >/dev/null 2>&1; then
        info "Updating repository files (compose file, scripts)"
        git pull --ff-only || warn "git pull failed — continuing with the current files"
    fi
    start
    docker image prune -f >/dev/null 2>&1 || true
    version=$(docker compose exec -T "$SERVICE" node -p "require('./package.json').version" 2>/dev/null || echo "?")
    info "Running HamBot v${version}"
}

cmd_status() {
    require_docker
    docker compose ps "$SERVICE"
    docker compose exec -T "$SERVICE" node scripts/healthcheck.js 2>/dev/null || true
}

case ${1:-setup} in
    setup|install) cmd_setup ;;
    update|upgrade) cmd_update ;;
    logs) require_docker; docker compose logs -f --tail 100 "$SERVICE" ;;
    status) cmd_status ;;
    stop) require_docker; docker compose down; info "Stopped. The WhatsApp session is kept; ./deploy.sh starts it again." ;;
    -h|--help|help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//' ;;
    *) die "Unknown command '$1'. Try: ./deploy.sh help" ;;
esac
