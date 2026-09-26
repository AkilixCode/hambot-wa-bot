#!/bin/sh
# ============================================================
# HamBot deploy helper
#
#   ./deploy.sh                 first-time setup: create .env, start the bot,
#                               show the pairing code or QR
#   ./deploy.sh update          pull the latest image (and repo files), restart
#   ./deploy.sh config          fix the owner / pairing number (typo? run this)
#   ./deploy.sh relink [--qr | --code <number>]
#                               link the WhatsApp number again from scratch
#   ./deploy.sh restore-session undo the last relink (put the old session back)
#   ./deploy.sh status          numbers, login state and health
#   ./deploy.sh logs            follow the logs
#   ./deploy.sh stop            stop the bot (the WhatsApp session is kept)
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

require_env() {
    [ -f .env ] || die "No .env yet — run ./deploy.sh first."
}

interactive() { [ -t 0 ]; }

# Replace KEY=... (or a commented "# KEY=...") in .env with KEY=value.
# Values reaching here are validated digits or fixed words, so no escaping.
set_env() {
    key=$1
    value=$2
    if grep -q "^#* *${key}=" .env; then
        sed -i.bak "s|^#* *${key}=.*|${key}=${value}|" .env && rm -f .env.bak
    else
        printf '%s=%s\n' "$key" "$value" >> .env
    fi
}

# Current value of KEY in .env (empty when unset or commented out).
get_env() {
    [ -f .env ] || return 0
    grep "^${1}=" .env | tail -n 1 | cut -d= -f2- | tr -d '\r' || true
}

# +62 812-3456-7890 style, for reading a number back to the user.
pretty_number() {
    printf '%s' "$1" | sed -E 's/^([0-9]{2})([0-9]{3})([0-9]{4})([0-9]*)$/+\1 \2-\3-\4/'
}

# Validate a number with country code. Prints it, or an error to stderr.
valid_number() {
    case $1 in
        0*) warn "Use the country code instead of the leading 0 (62812..., not 0812...)."; return 1 ;;
        *[!0-9]*|'') warn "Digits only, please."; return 1 ;;
    esac
    if [ ${#1} -lt 8 ] || [ ${#1} -gt 15 ]; then
        warn "That should be 8-15 digits including the country code."
        return 1
    fi
    printf '%s' "$1"
}

confirm() {
    printf '%s [y/N] ' "$1" >&2
    read -r reply || reply=""
    case $reply in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

# Ask for a phone number, read it back, and ask to confirm — a misclick is
# caught here instead of locking the owner out.
#   $1 prompt  $2 current value (Enter keeps it)  $3 "optional" allows empty
#   With $3 set, typing "-" clears the value.
ask_number() {
    prompt=$1
    current=${2:-}
    optional=${3:-}
    while :; do
        if [ -n "$current" ]; then
            printf '%s [%s, Enter = keep]: ' "$prompt" "$(pretty_number "$current")" >&2
        else
            printf '%s: ' "$prompt" >&2
        fi
        read -r raw || raw=""
        raw=$(printf '%s' "$raw" | tr -d ' ')

        # "-" clears an optional value; checked before separators are stripped.
        if [ "$raw" = "-" ] && [ -n "$optional" ]; then printf ''; return 0; fi

        answer=$(printf '%s' "$raw" | tr -d '+-.()')
        if [ -z "$answer" ]; then
            if [ -n "$current" ]; then printf '%s' "$current"; return 0; fi
            if [ -n "$optional" ]; then printf ''; return 0; fi
            warn "This one is required."
            continue
        fi

        number=$(valid_number "$answer") || continue
        printf '    -> %s — correct? [Y/n] ' "$(pretty_number "$number")" >&2
        read -r ok || ok=""
        case $ok in n|N|no|NO) continue ;; esac
        printf '%s' "$number"
        return 0
    done
}

# Owner and pairing number questions, shared by setup and `config`.
ask_numbers() {
    say ""
    say "Your WhatsApp number becomes the bot owner (can use owner-only commands)."
    owner=$(ask_number "  Owner number, with country code (e.g. 6281234567890)" "$(get_env BOT_OWNER_ID)")
    set_env BOT_OWNER_ID "$owner"

    say ""
    say "The bot's own number can be linked with a pairing code (type 8 characters"
    say "on the phone) instead of scanning a QR code. Leave empty for the QR code."
    current=$(get_env PAIRING_NUMBER)
    [ -n "$current" ] && say "  (type - to remove it and use the QR code)"
    pairing=$(ask_number "  Bot's number for a pairing code" "$current" optional)
    set_env PAIRING_NUMBER "$pairing"
}

create_env() {
    [ -f .env ] && { info ".env already exists, keeping it (change numbers with ./deploy.sh config)"; return 0; }
    [ -f .env.example ] || die ".env.example is missing — run this from the repository folder."

    cp .env.example .env
    chmod 600 .env
    info "Created .env from .env.example"

    if ! interactive; then
        warn "Not running interactively: edit .env yourself (BOT_OWNER_ID, PAIRING_NUMBER), then run ./deploy.sh again."
        exit 0
    fi

    ask_numbers
    say ""
    info "Saved. API keys and other settings can be added to .env later."
}

start() {
    info "Pulling the prebuilt image"
    if docker compose pull "$SERVICE"; then
        docker compose up -d --no-build "$@" "$SERVICE"
    else
        warn "Could not pull the image (offline, or the package is private) — building it here instead. This takes a few minutes."
        docker compose up -d --build "$@" "$SERVICE"
    fi
}

# Recreate the container so .env changes take effect, without pulling.
restart_with_env() {
    docker compose up -d --no-build --force-recreate "$SERVICE"
}

# Run a one-off Node snippet against the session volume, with the bot stopped.
session_tool() {
    docker compose run --rm --no-deps --entrypoint node "$SERVICE" -e "$1"
}

# Wait for the bot to print a pairing code, a QR code, or "connected".
# Problems it reports on the way (no answer from WhatsApp, disconnects, a
# crash) are shown as they happen instead of waiting silently.
show_login() {
    info "Waiting for the bot to start (Ctrl+C stops waiting; the bot keeps running)"
    tries=0
    shown=0
    problems=""
    # HAMBOT_WAIT_TRIES exists for the tests; each try is 2 seconds.
    max_tries=${HAMBOT_WAIT_TRIES:-60}
    while [ $tries -lt "$max_tries" ]; do
        tries=$((tries + 1))
        sleep 2
        logs=$(docker compose logs --no-log-prefix "$SERVICE" 2>&1 || true)

        if printf '%s' "$logs" | grep -q "connected to WhatsApp"; then
            info "Connected to WhatsApp. Send .menu to the bot to try it."
            return 0
        fi
        if printf '%s' "$logs" | grep -q "PAIRING CODE"; then
            say ""
            printf '%s\n' "$logs" | grep -B 1 -A 8 "PAIRING CODE" | tail -n 10
            say ""
            info "Type that code on the bot's phone. Then check: ./deploy.sh logs"
            info "Code not working? ./deploy.sh relink --qr"
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

        # Relay new problem lines so a stuck start explains itself.
        problems=$(printf '%s\n' "$logs" | grep -E "No answer from WhatsApp|Disconnected \(|Pairing code request failed|falling back to the QR|❌" || true)
        count=$(printf '%s' "$problems" | grep -c . || true)
        if [ "$count" -gt "$shown" ]; then
            printf '%s\n' "$problems" | tail -n $((count - shown)) | sed 's/^/   /'
            shown=$count
        fi

        # A container that exited or keeps restarting will never get there.
        state=$(docker compose ps -a --format '{{.State}}' "$SERVICE" 2>/dev/null | head -n 1)
        case "$state" in
            exited|dead|restarting)
                warn "The bot container is $state. Its last log lines:"
                docker compose logs --no-log-prefix --tail 25 "$SERVICE"
                warn "Fix the error above (settings: ./deploy.sh config), then: ./deploy.sh update"
                return 1
                ;;
        esac
    done
    warn "No pairing code, QR or connection after 2 minutes. Last log lines:"
    docker compose logs --no-log-prefix --tail 25 "$SERVICE"
    if [ "$shown" -gt 0 ] && printf '%s' "$problems" | grep -q "No answer from WhatsApp"; then
        warn "This server can't reach WhatsApp. Check its internet, DNS and firewall (outbound 443)."
    fi
    warn "The bot keeps trying in the background. Follow it with: ./deploy.sh logs"
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

cmd_config() {
    require_docker
    require_env
    interactive || die "./deploy.sh config asks questions — run it in a terminal."
    ask_numbers
    say ""
    info "Saved. Restarting the bot with the new settings."
    restart_with_env
    info "Done. The WhatsApp session was kept; no need to link again."
}

cmd_relink() {
    require_docker
    require_env
    mode=auto
    number=""
    assume_yes=""
    while [ $# -gt 0 ]; do
        case $1 in
            --qr) mode=qr ;;
            --code)
                mode=code
                shift
                [ $# -gt 0 ] || die "--code needs the bot's number, e.g. --code 6281234567890"
                # Accept a number typed with spaces and no quotes
                # (--code +62 812-3456-7890): gather the pieces.
                raw=$1
                while [ $# -gt 1 ]; do
                    case $2 in -*) break ;; esac
                    printf '%s' "$2" | grep -Eq '^[0-9+().-]+$' || break
                    raw="$raw$2"
                    shift
                done
                number=$(valid_number "$(printf '%s' "$raw" | tr -d ' +-.()')") || exit 1
                ;;
            -y|--yes) assume_yes=1 ;;
            *) die "Unknown option '$1'. Usage: ./deploy.sh relink [--qr | --code <number>] [-y]" ;;
        esac
        shift
    done

    say "This unlinks the bot's WhatsApp session and links it again from scratch."
    say "The current session is archived, not deleted (undo: ./deploy.sh restore-session)."
    if [ -z "$assume_yes" ]; then
        interactive || die "Add -y to relink without a terminal."
        confirm "Continue?" || { info "Nothing changed."; exit 0; }
    fi

    docker compose stop "$SERVICE" >/dev/null 2>&1 || true
    info "Archiving the current session"
    session_tool "const p = require('./utils/session').archiveSession('auth_info_baileys'); console.log(p ? 'archived to ' + p : 'no session to archive')"

    case $mode in
        qr) set_env LOGIN_METHOD qr ;;
        code) set_env PAIRING_NUMBER "$number"; set_env LOGIN_METHOD code ;;
        *) set_env LOGIN_METHOD auto ;;
    esac

    restart_with_env
    show_login
}

cmd_restore() {
    require_docker
    require_env
    say "This puts back the most recently archived session (the one before the last relink)."
    interactive && { confirm "Continue?" || { info "Nothing changed."; exit 0; }; }

    docker compose stop "$SERVICE" >/dev/null 2>&1 || true
    session_tool "const r = require('./utils/session').restoreSession('auth_info_baileys'); if (!r) { console.log('no archived session found'); process.exit(3); } console.log('restored ' + r)" \
        || warn "Nothing restored."
    restart_with_env
    show_login
}

cmd_status() {
    require_docker
    if [ -f .env ]; then
        owner=$(get_env BOT_OWNER_ID)
        pairing=$(get_env PAIRING_NUMBER)
        method=$(get_env LOGIN_METHOD)
        say "Owner number:    ${owner:-(not set!)}"
        say "Pairing number:  ${pairing:-(none — QR code)}"
        say "Login method:    ${method:-auto}"
        say "Wrong number? ./deploy.sh config"
        say ""
    fi
    docker compose ps "$SERVICE"
    docker compose exec -T "$SERVICE" node scripts/healthcheck.js 2>/dev/null || true
}

cmd="${1:-setup}"
[ $# -gt 0 ] && shift
case $cmd in
    setup|install) cmd_setup ;;
    update|upgrade) cmd_update ;;
    config|configure) cmd_config ;;
    relink) cmd_relink "$@" ;;
    restore-session) cmd_restore ;;
    logs) require_docker; docker compose logs -f --tail 100 "$SERVICE" ;;
    status) cmd_status ;;
    stop) require_docker; docker compose down; info "Stopped. The WhatsApp session is kept; ./deploy.sh starts it again." ;;
    -h|--help|help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//' ;;
    *) die "Unknown command '$cmd'. Try: ./deploy.sh help" ;;
esac
