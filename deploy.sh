#!/bin/sh
# ============================================================
# HamBot deploy helper: Docker or Local (Node.js + pm2), your choice.
#
#   ./deploy.sh                 first-time setup: asks Docker or Local, creates
#                               .env, starts the bot, shows the pairing code/QR
#   ./deploy.sh --docker        setup with Docker, without asking
#   ./deploy.sh --local         setup without Docker (Node.js + pm2)
#   ./deploy.sh update          get the latest version and restart
#   ./deploy.sh config          fix the owner / pairing number (typo? run this)
#   ./deploy.sh relink [--qr | --code <number>]
#                               link the WhatsApp number again from scratch
#   ./deploy.sh restore-session undo the last relink (put the old session back)
#   ./deploy.sh switch docker|local
#                               move to the other way of running; the
#                               WhatsApp session moves too (no relinking)
#   ./deploy.sh chat            set up .chat (AI chat): local model, API provider
#                               or agent; also: chat off | chat test | chat undo
#   ./deploy.sh status          numbers, login state and health
#   ./deploy.sh doctor          check everything and say how to fix problems
#   ./deploy.sh logs            follow the logs
#   ./deploy.sh stop            stop the bot (the WhatsApp session is kept)
#
# Without a terminal: --owner <number> [--pairing <number>] and -y.
# Running it again is always safe: every step checks before it acts, so a
# failed or interrupted setup continues where it stopped.
# ============================================================
set -eu

cd "$(dirname "$0")"
ROOT=$(pwd)

SERVICE=hambot
MAX_TRIES=5
# Tests shorten the waits; real runs never set this.
RETRY_DELAY=${HAMBOT_RETRY_DELAY:-2}

say()  { printf '%s\n' "$*"; }
info() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

# ------------------------------------------------------------
# Clean exit, Ctrl+C, and one deploy at a time
# ------------------------------------------------------------
LOCK=.deploy.lock
HAVE_LOCK=""
TMP_PATHS=""
TMP=""

cleanup() {
    # A Ctrl+C during hidden key entry must not leave the terminal silent.
    [ -z "${STTY_HIDDEN:-}" ] || stty echo <"$STTY_HIDDEN" 2>/dev/null || true
    # TMP_PATHS is a space-separated list of paths this script created.
    # shellcheck disable=SC2086
    [ -z "$TMP_PATHS" ] || rm -rf $TMP_PATHS
    [ -z "$HAVE_LOCK" ] || rm -rf "$LOCK"
    return 0
}
on_signal() {
    cleanup
    HAVE_LOCK=""
    TMP_PATHS=""
    printf '\n' >&2
    warn "Stopped. Nothing is half-done: run ./deploy.sh again to continue."
    exit 130
}
trap cleanup EXIT
trap on_signal INT TERM HUP

# Set TMP to a fresh scratch path that is removed on exit. (A variable, not
# output: $(...) would run it in a subshell and the cleanup list would be lost.)
new_tmp() {
    TMP="$ROOT/.deploy-tmp.$$.$1"
    TMP_PATHS="$TMP_PATHS $TMP"
}

take_lock() {
    if ! mkdir "$LOCK" 2>/dev/null; then
        pid=$(cat "$LOCK/pid" 2>/dev/null || true)
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            die "Another ./deploy.sh is already running (pid $pid). Let it finish first."
        fi
        # Left behind by a run that was killed: safe to take over.
        rm -rf "$LOCK"
        mkdir "$LOCK" || die "Cannot create $LOCK in $ROOT — is this folder writable?"
    fi
    printf '%s\n' "$$" > "$LOCK/pid"
    HAVE_LOCK=1
}

# ------------------------------------------------------------
# Questions: always bounded, and end of input never loops
# ------------------------------------------------------------
# Prompts read the terminal even when stdin is a pipe (curl ... | sh).
# HAMBOT_TTY=none (tests) means "there is no terminal at all";
# HAMBOT_TTY=stdin (tests) treats a piped stdin as the terminal.
if [ "${HAMBOT_TTY:-}" = none ]; then
    TTY=""
elif [ "${HAMBOT_TTY:-}" = stdin ] || [ -t 0 ]; then
    TTY=stdin
elif (: </dev/tty) 2>/dev/null; then
    TTY=/dev/tty
else
    TTY=""
fi
interactive() { [ -n "$TTY" ]; }

# Read one line into ANSWER. Returns 1 at end of input (closed terminal,
# dropped SSH session) so callers stop instead of asking forever.
read_line() {
    printf '%s' "$1" >&2
    if [ "$TTY" = stdin ]; then
        IFS= read -r ANSWER || { ANSWER=""; printf '\n' >&2; return 1; }
    else
        IFS= read -r ANSWER </dev/tty || { ANSWER=""; printf '\n' >&2; return 1; }
    fi
    ANSWER=$(printf '%s' "$ANSWER" | tr -d '\r')
}

input_closed() { die "Input ended before an answer. Run ./deploy.sh again in a terminal."; }

# Yes/no. $2 = what Enter means (y or n). End of input counts as no.
confirm() {
    default=${2:-n}
    hint="[y/N]"
    [ "$default" = y ] && hint="[Y/n]"
    read_line "$1 $hint " || return 1
    case $ANSWER in
        y|Y|yes|YES|Yes) return 0 ;;
        '') [ "$default" = y ] ;;
        *) return 1 ;;
    esac
}

# ------------------------------------------------------------
# .env
# ------------------------------------------------------------
require_env() {
    [ -f .env ] || die "No .env yet — run ./deploy.sh first."
    { [ -r .env ] && [ -w .env ]; } || die "Cannot read or write .env (created with sudo?). Fix: sudo chown $(id -un) .env"
}

# Replace KEY=... (or a commented "# KEY=...") in .env with KEY=value.
# Values reaching here are validated digits, paths we built, or fixed words,
# so no escaping. Written to a temp file and moved into place, so an
# interrupted run never leaves a half-written .env.
set_env() {
    key=$1
    value=$2
    [ -f .env ] || die "Internal error: .env missing while saving $key. Run ./deploy.sh again."
    new_tmp env
    (
        umask 077
        if grep -q "^#* *${key}=" .env; then
            sed "s|^#* *${key}=.*|${key}=${value}|" .env > "$TMP"
        else
            cat .env > "$TMP"
            printf '%s=%s\n' "$key" "$value" >> "$TMP"
        fi
    )
    mv "$TMP" .env
}

# Current value of KEY in .env (empty when unset or commented out).
get_env() {
    [ -f .env ] || return 0
    grep "^${1}=" .env 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '\r' \
        | sed "s/^'\(.*\)'\$/\1/; s/^\"\(.*\)\"\$/\1/" || true
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

clean_number() { printf '%s' "$1" | tr -d ' +-.()'; }

# Ask for a phone number, read it back, and ask to confirm — a misclick is
# caught here instead of locking the owner out.
#   $1 prompt  $2 current value (Enter keeps it)  $3 "optional" allows empty
#   With $3 set, typing "-" clears the value.
# At most MAX_TRIES attempts; end of input stops the script.
ask_number() {
    prompt=$1
    current=${2:-}
    optional=${3:-}
    attempt=0
    while [ $attempt -lt $MAX_TRIES ]; do
        attempt=$((attempt + 1))
        if [ -n "$current" ]; then
            read_line "$prompt [$(pretty_number "$current"), Enter = keep]: " || input_closed
        else
            read_line "$prompt: " || input_closed
        fi
        raw=$(printf '%s' "$ANSWER" | tr -d ' ')

        # "-" clears an optional value; checked before separators are stripped.
        if [ "$raw" = "-" ] && [ -n "$optional" ]; then printf ''; return 0; fi

        answer=$(clean_number "$raw")
        if [ -z "$answer" ]; then
            if [ -n "$current" ]; then printf '%s' "$current"; return 0; fi
            if [ -n "$optional" ]; then printf ''; return 0; fi
            warn "This one is required."
            continue
        fi

        number=$(valid_number "$answer") || continue
        read_line "    -> $(pretty_number "$number") — correct? [Y/n] " || input_closed
        case $ANSWER in n|N|no|NO) continue ;; esac
        printf '%s' "$number"
        return 0
    done
    die "No valid number after $MAX_TRIES tries. Type it with the country code, e.g. 6281234567890."
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
    if [ -f .env ]; then
        info ".env already exists, keeping it (change numbers with ./deploy.sh config)"
        require_env
        return 0
    fi
    [ -f .env.example ] || die ".env.example is missing — run this from the HamBot folder."

    new_tmp newenv
    (umask 077; cp .env.example "$TMP")
    mv "$TMP" .env
    chmod 600 .env
    info "Created .env from .env.example"

    # Numbers given as flags (or already in the environment) skip the questions.
    if [ -n "$OPT_OWNER" ]; then
        set_env BOT_OWNER_ID "$OPT_OWNER"
        set_env PAIRING_NUMBER "$OPT_PAIRING"
        return 0
    fi

    if ! interactive; then
        warn "No terminal to ask in. Either edit .env yourself (BOT_OWNER_ID, PAIRING_NUMBER)"
        warn "and run ./deploy.sh again, or pass the numbers: ./deploy.sh --owner 62812... [--pairing 62813...]"
        exit 0
    fi

    ask_numbers
    say ""
    info "Saved. API keys and other settings can be added to .env later."
}

# ------------------------------------------------------------
# Network steps: a few tries, then a clear message — never forever
# ------------------------------------------------------------
# retry "what" command...   The command's output is shown as it runs.
retry() {
    what=$1
    shift
    n=1
    while :; do
        if "$@"; then return 0; fi
        if [ $n -ge 3 ]; then
            warn "$what failed 3 times. Check this machine's internet connection, DNS and any proxy."
            return 1
        fi
        warn "$what failed — trying again in $((n * RETRY_DELAY))s ($n/3)"
        sleep $((n * RETRY_DELAY))
        n=$((n + 1))
    done
}

# Like retry, but keeps the (long) output in a log and shows its tail only
# on failure. A full disk is reported as such and not retried.
retry_quiet() {
    what=$1
    shift
    new_tmp log
    log=$TMP
    n=1
    while :; do
        if "$@" >"$log" 2>&1; then return 0; fi
        if grep -q "ENOSPC\|No space left on device" "$log"; then
            tail -n 15 "$log" >&2
            warn "$what failed: the disk is full."
            df -h . >&2 || true
            warn "Free some space (old Docker images: docker image prune -a), then run ./deploy.sh again."
            return 1
        fi
        if [ $n -ge 3 ]; then
            tail -n 15 "$log" >&2
            warn "$what failed 3 times (last lines above). Check the internet connection, DNS and any proxy."
            return 1
        fi
        warn "$what failed — trying again in $((n * RETRY_DELAY))s ($n/3)"
        sleep $((n * RETRY_DELAY))
        n=$((n + 1))
    done
}

# ------------------------------------------------------------
# Choosing Docker or Local
# ------------------------------------------------------------
DOCKER_PROBLEM=""
docker_ready() {
    DOCKER_PROBLEM=""
    if ! command -v docker >/dev/null 2>&1; then
        DOCKER_PROBLEM="Docker is not installed (https://docs.docker.com/engine/install/)."
    elif ! docker compose version >/dev/null 2>&1; then
        if command -v docker-compose >/dev/null 2>&1; then
            DOCKER_PROBLEM="Only the old docker-compose v1 is installed; HamBot needs the Compose v2 plugin ('docker compose'): https://docs.docker.com/compose/install/"
        else
            DOCKER_PROBLEM="The Docker Compose v2 plugin is missing ('docker compose'): https://docs.docker.com/compose/install/"
        fi
    elif ! docker info >/dev/null 2>&1; then
        if [ "$(uname -s)" = Darwin ]; then
            DOCKER_PROBLEM="Docker Desktop is not running. Start it, wait until it says it is running, and try again."
        elif [ -S /var/run/docker.sock ] && [ ! -w /var/run/docker.sock ]; then
            DOCKER_PROBLEM="Your user may not use Docker. Fix: sudo usermod -aG docker $(id -un), then log out and back in."
        else
            DOCKER_PROBLEM="The Docker daemon is not running. Start it: sudo systemctl start docker"
        fi
    fi
    [ -z "$DOCKER_PROBLEM" ]
}

require_docker() {
    docker_ready || die "$DOCKER_PROBLEM  Or run without Docker: ./deploy.sh switch local (--local on a new install)."
}

# The mode in use: a flag on this run, else DEPLOY_MODE in .env, else Docker
# for installs made before Local existed (their .env has no DEPLOY_MODE).
current_mode() {
    if [ -n "$OPT_MODE" ]; then printf '%s' "$OPT_MODE"; return 0; fi
    m=$(get_env DEPLOY_MODE)
    case $m in
        docker|local) printf '%s' "$m" ;;
        '') printf docker ;;
        *) printf 'invalid:%s' "$m" ;;
    esac
}

ask_mode() {
    say "" >&2
    say "How should HamBot run on this machine?" >&2
    say "  [D] Docker (recommended) — everything in one container; needs Docker." >&2
    say "  [L] Local — Node.js + pm2 directly on this machine; no Docker needed." >&2
    attempt=0
    while [ $attempt -lt $MAX_TRIES ]; do
        attempt=$((attempt + 1))
        read_line "Docker or Local? [D/l] " || input_closed
        case $ANSWER in
            ''|d|D|docker|Docker) printf docker; return 0 ;;
            l|L|local|Local) printf local; return 0 ;;
            *) warn "Type D for Docker or L for Local." ;;
        esac
    done
    die "No choice after $MAX_TRIES tries. Run ./deploy.sh --docker or ./deploy.sh --local."
}

# The mode for setup. Explains why Docker is not offered when it is not usable.
choose_mode() {
    mode=$(current_mode)
    case $mode in
        invalid:*)
            warn "DEPLOY_MODE=${mode#invalid:} in .env is not docker or local."
            interactive || die "Set DEPLOY_MODE=docker or DEPLOY_MODE=local in .env, or run ./deploy.sh --docker / --local."
            mode=$(ask_mode)
            ;;
    esac
    # A fresh install with no flag: ask, or take what works.
    if [ ! -f .env ] && [ -z "$OPT_MODE" ]; then
        if docker_ready; then
            if interactive; then mode=$(ask_mode); else mode=docker; fi
        else
            warn "Docker isn't usable here: $DOCKER_PROBLEM"
            if interactive; then
                confirm "Install HamBot locally instead (Node.js + pm2, no Docker)?" y \
                    || die "Fix Docker as described above, then run ./deploy.sh again."
            elif [ -z "$OPT_YES" ]; then
                die "Fix Docker as described above, or run ./deploy.sh --local."
            fi
            mode=local
        fi
    fi
    printf '%s' "$mode"
}

# ------------------------------------------------------------
# Docker backend
# ------------------------------------------------------------
docker_start() {
    info "Pulling the prebuilt image"
    if retry "Downloading the image" docker compose pull "$SERVICE"; then
        docker compose up -d --no-build "$SERVICE"
    else
        warn "Could not pull the image (offline, or the package is private) — building it here instead. This takes a few minutes."
        docker compose up -d --build "$SERVICE" \
            || { warn "The image could neither be downloaded nor built."; run_doctor_hint; exit 1; }
    fi
}

docker_running() {
    docker_ready || return 1
    [ "$(docker compose ps -a --format '{{.State}}' "$SERVICE" 2>/dev/null | head -n 1)" = running ]
}

# ------------------------------------------------------------
# Local backend (Node.js + pm2)
# ------------------------------------------------------------
APP=${PM2_PROCESS_NAME:-hambot}
PM2_LOG_DIR="${PM2_HOME:-$HOME/.pm2}/logs"
OUT_LOG="$PM2_LOG_DIR/$APP-out.log"
ERR_LOG="$PM2_LOG_DIR/$APP-error.log"
NODE_MIN_MAJOR=22
NODE_MIN_MINOR=12
UID_NOW=${HAMBOT_TEST_UID:-$(id -u)}

# Pinned versions come from the Dockerfile, so both modes run the same ones.
ytdlp_pin() { sed -n 's/^ARG YTDLP_VERSION=//p' Dockerfile 2>/dev/null | head -n 1; }
deno_pin() { sed -n 's/^FROM denoland\/deno:bin-\([0-9.]*\).*/\1/p' Dockerfile 2>/dev/null | head -n 1; }

# yt-dlp prints its version zero-padded (2026.08.19) while the pin is not
# (2026.8.19); compare them without the padding.
norm_ver() { printf '%s' "$1" | tr -d '\r' | sed 's/\.0*\([0-9]\)/.\1/g'; }
ytdlp_current() {
    [ -x .venv/bin/python ] || return 1
    [ "$(norm_ver "$(.venv/bin/python -m yt_dlp --version 2>/dev/null)")" = "$(norm_ver "$(ytdlp_pin)")" ]
}

add_path() { case ":$PATH:" in *":$1:"*) ;; *) PATH="$1:$PATH"; export PATH ;; esac; }

# nvm is often installed but not loaded in a non-login shell.
load_nvm() {
    if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
        set +eu
        # shellcheck disable=SC1091
        . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" >/dev/null 2>&1
        set -eu
    fi
}

node_ok() {
    command -v node >/dev/null 2>&1 || return 1
    v=$(node -v 2>/dev/null | sed 's/^v//')
    major=${v%%.*}
    rest_v=${v#*.}
    minor=${rest_v%%.*}
    case "$major$minor" in *[!0-9]*|'') return 1 ;; esac
    [ "$major" -gt $NODE_MIN_MAJOR ] || { [ "$major" -eq $NODE_MIN_MAJOR ] && [ "$minor" -ge $NODE_MIN_MINOR ]; }
}

require_node() {
    node_ok || load_nvm
    if ! node_ok; then
        have=$(node -v 2>/dev/null || echo "not installed")
        warn "Node.js $NODE_MIN_MAJOR.$NODE_MIN_MINOR or newer is needed (found: $have)."
        say "  Install Node 24 for your user (no sudo needed):" >&2
        say "    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash" >&2
        say "    . ~/.nvm/nvm.sh && nvm install 24" >&2
        die "Then run ./deploy.sh again."
    fi
}

lock_hash() { cksum < package-lock.json | cut -d' ' -f1; }

modules_current() {
    [ -f node_modules/.hambot-lock ] && [ "$(cat node_modules/.hambot-lock)" = "$(lock_hash)" ]
}

install_node_modules() {
    modules_current && return 0
    info "Installing Node.js packages (a minute or two the first time)"
    retry_quiet "Installing Node.js packages (npm ci)" npm ci --omit=dev --no-audit --no-fund \
        || { run_doctor_hint; exit 1; }
    lock_hash > node_modules/.hambot-lock
}

find_pm2() {
    add_path "$HOME/.local/bin"
    command -v pm2 >/dev/null 2>&1
}

install_pm2() {
    find_pm2 && return 0
    info "Installing pm2 (keeps the bot running and restarts it after a crash)"
    new_tmp pm2log
    if npm install -g pm2 >"$TMP" 2>&1 && find_pm2; then return 0; fi
    info "No permission for a global install — installing pm2 for your user instead"
    retry_quiet "Installing pm2" npm install -g --prefix "$HOME/.local" pm2 \
        || { run_doctor_hint; exit 1; }
    find_pm2 || die "pm2 was installed but cannot be found. Add $HOME/.local/bin to PATH and run ./deploy.sh again."
}

# The install command for this system's package manager.
#   $1 package name (most systems)  $2 name(s) on Debian/Ubuntu
pkg_hint() {
    if [ "$(uname -s)" = Darwin ]; then
        case $1 in python3|python3-venv) printf 'brew install python' ;; *) printf 'brew install %s' "$1" ;; esac
    elif command -v apt-get >/dev/null 2>&1; then printf 'sudo apt-get install -y %s' "$2"
    elif command -v dnf >/dev/null 2>&1; then printf 'sudo dnf install -y %s' "$1"
    elif command -v pacman >/dev/null 2>&1; then printf 'sudo pacman -S %s' "$1"
    elif command -v apk >/dev/null 2>&1; then printf 'sudo apk add %s' "$1"
    else printf "your system's package manager (package: %s)" "$1"
    fi
}

# yt-dlp in a private virtualenv: pip refuses system-wide installs on
# Debian 12+ / Ubuntu 23.04+, and a venv never touches the system Python.
# Optional: on failure .video/.music are off and the rest of the bot runs.
install_ytdlp() {
    pin=$(ytdlp_pin)
    py=.venv/bin/python
    if ytdlp_current; then
        set_env YTDLP_PYTHON "$py"
        return 0
    fi
    if ! command -v python3 >/dev/null 2>&1; then
        warn "python3 is missing, so .video and .music will not work. Install it: $(pkg_hint python3 "python3 python3-venv")"
        return 0
    fi
    if [ ! -x "$py" ]; then
        info "Creating a private Python environment for yt-dlp (.venv)"
        new_tmp venvlog
        if ! python3 -m venv .venv >"$TMP" 2>&1; then
            rm -rf .venv
            if grep -q "ensurepip\|No module named venv" "$TMP"; then
                warn "Python's venv module is missing. Install it: $(pkg_hint python3-venv python3-venv)"
            else
                tail -n 5 "$TMP" >&2
                warn "Could not create .venv."
            fi
            warn "Until then .video and .music will not work (the rest does). Then run ./deploy.sh update."
            return 0
        fi
    fi
    info "Installing yt-dlp $pin"
    if retry_quiet "Installing yt-dlp" "$py" -m pip install --disable-pip-version-check -q "yt-dlp==$pin"; then
        set_env YTDLP_PYTHON "$py"
    else
        warn ".video and .music will not work until yt-dlp installs. Run ./deploy.sh update to try again."
    fi
}

check_ffmpeg() {
    command -v ffmpeg >/dev/null 2>&1 && return 0
    cmd=$(pkg_hint ffmpeg ffmpeg)
    warn "ffmpeg is missing, so .say and .toimg will not work (everything else does)."
    case $cmd in
        sudo*|brew*)
            if interactive && confirm "Install it now with: $cmd ?" n; then
                sh -c "$cmd" || warn "That did not work; install ffmpeg later, then ./deploy.sh update."
            else
                say "  Install it later with: $cmd" >&2
            fi
            ;;
        *) say "  Install ffmpeg with $cmd" >&2 ;;
    esac
}

check_deno() {
    add_path "$HOME/.deno/bin"
    command -v deno >/dev/null 2>&1 && return 0
    ver=$(deno_pin)
    warn "Deno is missing; YouTube downloads work without it but fail more often."
    if ! command -v curl >/dev/null 2>&1 || { ! command -v unzip >/dev/null 2>&1 && ! command -v 7z >/dev/null 2>&1; }; then
        say "  Deno's installer needs curl and unzip: $(pkg_hint unzip "curl unzip"), then ./deploy.sh update" >&2
        return 0
    fi
    if interactive && ! confirm "Install Deno $ver for your user (into ~/.deno, no sudo)?" y; then
        return 0
    fi
    new_tmp deno-install.sh
    # Downloaded first, then run: piping curl into sh would report success
    # even when the download failed.
    if retry "Downloading the Deno installer" curl -fsSL -o "$TMP" https://deno.land/install.sh \
        && sh "$TMP" --no-modify-path "v$ver" >/dev/null 2>&1 \
        && command -v deno >/dev/null 2>&1; then
        info "Deno $ver installed"
    else
        warn "Deno did not install; YouTube may fail more often. ./deploy.sh update tries again."
    fi
}

# Everything Local needs. Only Node is required; the rest warns and continues.
local_prepare() {
    if [ "$UID_NOW" = 0 ]; then
        warn "Running as root: the bot, its files and pm2 will belong to root."
        warn "That works, but a normal user account is safer."
        if interactive && [ -z "$OPT_YES" ]; then
            confirm "Continue as root?" y || die "Nothing changed. Run ./deploy.sh as your normal user."
        fi
    fi
    require_node
    install_node_modules
    install_pm2
    install_ytdlp
    check_ffmpeg
    check_deno
}

# "<status> <restarts>" of the pm2 app (status words joined by -), or "missing".
pm2_state() {
    find_pm2 || { printf missing; return 0; }
    command -v node >/dev/null 2>&1 || { printf missing; return 0; }
    pm2 jlist 2>/dev/null | node -e '
        let s = "";
        process.stdin.on("data", d => s += d).on("end", () => {
            let app;
            try { app = JSON.parse(s.slice(s.indexOf("["))).find(a => a.name === process.argv[1]); } catch {}
            console.log(app ? `${String(app.pm2_env.status).replace(/ /g, "-")} ${app.pm2_env.restart_time || 0}` : "missing");
        });' "$APP" 2>/dev/null || printf missing
}

local_running() {
    case $(pm2_state) in online*|launching*) return 0 ;; *) return 1 ;; esac
}

log_size() { if [ -f "$1" ]; then wc -c < "$1" | tr -d ' '; else echo 0; fi; }
LOG_OUT_START=0
LOG_ERR_START=0

local_start() {
    # Registered afresh from ecosystem.config.cjs every time, so a moved
    # folder or changed settings are picked up and a stale entry never lingers.
    pm2 delete "$APP" >/dev/null 2>&1 || true
    LOG_OUT_START=$(log_size "$OUT_LOG")
    LOG_ERR_START=$(log_size "$ERR_LOG")
    PM2_PROCESS_NAME=$APP pm2 start ecosystem.config.cjs >/dev/null \
        || { warn "pm2 could not start the bot."; run_doctor_hint; exit 1; }
    pm2 save >/dev/null 2>&1 || true
}

# Whether pm2 will bring the bot back after a reboot.
startup_installed() {
    user=$(id -un)
    [ -n "${HAMBOT_ASSUME_STARTUP:-}" ] \
        || [ -f "/etc/systemd/system/pm2-$user.service" ] \
        || [ -f "$HOME/Library/LaunchAgents/pm2.$user.plist" ]
}

startup_hint() {
    startup_installed && return 0
    line=$(pm2 startup 2>&1 | grep -E '^ *sudo ' | head -n 1 | sed 's/^ *//' || true)
    if startup_installed; then
        info "pm2 will start the bot after a reboot."
    elif [ -n "$line" ]; then
        warn "One more step so the bot comes back after a reboot — run this once:"
        say "    $line" >&2
    else
        warn "To start the bot after a reboot, run: pm2 startup (and the line it prints)"
    fi
}

# ------------------------------------------------------------
# Backend dispatch: the commands below go through these
# ------------------------------------------------------------
MODE=""

be_check() {
    case $MODE in
        docker) require_docker ;;
        local) local_prepare ;;
    esac
}
be_start() {
    case $MODE in
        docker) docker_start ;;
        local) local_start ;;
    esac
}
# Restart so .env changes take effect, without pulling or reinstalling.
be_restart() {
    case $MODE in
        docker) docker compose up -d --no-build --force-recreate "$SERVICE" ;;
        local) find_pm2 || install_pm2; local_start ;;
    esac
}
be_stop() {
    case $MODE in
        docker) docker compose stop "$SERVICE" >/dev/null 2>&1 || true ;;
        local) if find_pm2; then pm2 stop "$APP" >/dev/null 2>&1 || true; pm2 save >/dev/null 2>&1 || true; fi ;;
    esac
}
be_running() {
    case $MODE in
        docker) docker_running ;;
        local) local_running ;;
    esac
}
# Everything the bot printed since this run started it.
be_log_text() {
    case $MODE in
        docker) docker compose logs --no-log-prefix "$SERVICE" 2>&1 || true ;;
        local)
            if [ -f "$OUT_LOG" ]; then tail -c +$((LOG_OUT_START + 1)) "$OUT_LOG"; fi
            if [ -f "$ERR_LOG" ]; then tail -c +$((LOG_ERR_START + 1)) "$ERR_LOG"; fi
            return 0
            ;;
    esac
}
be_log_tail() {
    case $MODE in
        docker) docker compose logs --no-log-prefix --tail "$1" "$SERVICE" ;;
        local) be_log_text | tail -n "$1" ;;
    esac
}
# running / exited / restarting, in Docker's words.
be_state() {
    case $MODE in
        docker) docker compose ps -a --format '{{.State}}' "$SERVICE" 2>/dev/null | head -n 1 ;;
        local)
            st=$(pm2_state)
            case ${st%% *} in
                online|launching) printf running ;;
                waiting-restart) printf restarting ;;
                *) printf exited ;;
            esac
            ;;
    esac
}
# Run a one-off Node snippet against the session, with the bot stopped.
be_node() {
    case $MODE in
        docker) docker compose run --rm --no-deps --entrypoint node "$SERVICE" -e "$1" ;;
        local) node -e "$1" ;;
    esac
}
be_version() {
    case $MODE in
        docker) docker compose exec -T "$SERVICE" node -p "require('./package.json').version" 2>/dev/null || echo "?" ;;
        local) node -p "require('./package.json').version" 2>/dev/null || echo "?" ;;
    esac
}

# The other mode's bot, if it runs too: two copies fight over one WhatsApp
# session, each knocking the other off.
other_running() {
    case $MODE in
        docker) find_pm2 && local_running ;;
        local) docker_running ;;
    esac
}
other_stop_cmd() {
    case $MODE in
        docker) printf 'pm2 stop %s' "$APP" ;;
        local) printf 'docker compose stop %s' "$SERVICE" ;;
    esac
}
warn_two_copies() {
    other_running || return 1
    warn "Two copies of the bot are running (Docker and Local). They keep knocking each other off WhatsApp."
    warn "Stop one: $(other_stop_cmd)   — or move for good: ./deploy.sh switch $MODE"
}

# ------------------------------------------------------------
# Waiting for the bot
# ------------------------------------------------------------
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
        logs=$(be_log_text)

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
            be_log_tail 45
            if [ "$MODE" = docker ]; then
                if docker compose cp "$SERVICE:/app/data/qr.png" ./qr.png >/dev/null 2>&1; then
                    info "QR also saved as ./qr.png (delete it after linking)."
                fi
            elif [ -f data/qr.png ]; then
                info "QR also saved as data/qr.png (removed once linked)."
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

        # A bot that exited or keeps restarting will never get there.
        state=$(be_state)
        case "$state" in
            exited|dead|restarting)
                if [ "$MODE" = docker ]; then
                    warn "The bot container is $state. Its last log lines:"
                else
                    warn "The bot is $state (pm2). Its last log lines:"
                fi
                be_log_tail 25
                warn "Fix the error above (settings: ./deploy.sh config), then: ./deploy.sh update"
                run_doctor_hint
                return 1
                ;;
        esac
    done
    warn "No pairing code, QR or connection after $((max_tries * 2)) seconds. Last log lines:"
    be_log_tail 25
    if [ "$shown" -gt 0 ] && printf '%s' "$problems" | grep -Eq "No answer from WhatsApp|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ENETUNREACH"; then
        warn "This server can't reach WhatsApp. Check its internet, DNS and firewall (outbound 443)."
    fi
    warn "The bot keeps trying in the background. Follow it with: ./deploy.sh logs"
}

# ------------------------------------------------------------
# Doctor
# ------------------------------------------------------------
DOCTOR_FAILS=0
ok()  { printf '  \033[1;32mok\033[0m    %s\n' "$*"; }
bad() { printf '  \033[1;31mFIX\033[0m   %s\n' "$*"; DOCTOR_FAILS=$((DOCTOR_FAILS + 1)); }
note() { printf '  \033[1;33mnote\033[0m  %s\n' "$*"; }

run_doctor_hint() { warn "For a full check with fixes: ./deploy.sh doctor"; }

cmd_doctor() {
    MODE=$(current_mode)
    case $MODE in invalid:*) bad "DEPLOY_MODE=${MODE#invalid:} in .env: use docker or local"; MODE=docker ;; esac
    say "HamBot doctor ($MODE mode, $ROOT)"

    if [ ! -f .env ]; then
        bad ".env is missing: run ./deploy.sh"
    elif [ ! -r .env ] || [ ! -w .env ]; then
        bad ".env is not readable/writable by you: sudo chown $(id -un) .env"
    else
        owner=$(get_env BOT_OWNER_ID)
        if [ -n "$owner" ]; then ok "owner number: $owner"; else bad "BOT_OWNER_ID is empty: ./deploy.sh config"; fi
    fi

    free_kb=$(df -Pk . 2>/dev/null | awk 'NR == 2 { print $4 }')
    case $free_kb in
        ''|*[!0-9]*) ;;
        *)
            if [ "$free_kb" -lt 512000 ]; then
                bad "only $((free_kb / 1024)) MB free on this disk: free some space"
            else
                ok "disk space: $((free_kb / 1024)) MB free"
            fi
            ;;
    esac

    if [ "$MODE" = docker ]; then
        if docker_ready; then
            ok "Docker and Compose v2"
            state=$(be_state)
            case $state in
                running) ok "container is running" ;;
                '') bad "no container yet: ./deploy.sh" ;;
                *) bad "container is $state: ./deploy.sh logs, then ./deploy.sh update" ;;
            esac
            if [ "$state" = running ]; then
                h=$(docker compose exec -T "$SERVICE" node scripts/healthcheck.js 2>/dev/null || true)
                case $h in healthy*) ok "$h" ;; '') ;; *) bad "$h" ;; esac
            fi
        else
            bad "$DOCKER_PROBLEM"
            note "or run without Docker: ./deploy.sh switch local"
        fi
    else
        node_ok || load_nvm
        if node_ok; then ok "Node.js $(node -v)"; else bad "Node.js $NODE_MIN_MAJOR.$NODE_MIN_MINOR+ needed (found: $(node -v 2>/dev/null || echo none)): see ./deploy.sh --local"; fi
        if modules_current; then ok "Node.js packages installed"; else bad "Node.js packages missing or out of date: ./deploy.sh update"; fi
        if find_pm2; then
            st=$(pm2_state)
            restarts=${st#* }
            case ${st%% *} in
                online) ok "pm2: the bot is online (restarts: $restarts)" ;;
                missing) bad "pm2 has no '$APP' app: ./deploy.sh" ;;
                *) bad "pm2: the bot is ${st%% *} (restarts: $restarts): ./deploy.sh logs, then ./deploy.sh update" ;;
            esac
            if startup_installed; then ok "starts again after a reboot"; else bad "won't start after a reboot: run 'pm2 startup' and the sudo line it prints"; fi
        else
            bad "pm2 is not installed: ./deploy.sh"
        fi
        pin=$(ytdlp_pin)
        if ytdlp_current; then
            ok "yt-dlp $pin (.venv)"
        else
            bad "yt-dlp $pin is not installed, so .video/.music are off: ./deploy.sh update"
        fi
        add_path "$HOME/.deno/bin"
        if command -v deno >/dev/null 2>&1; then ok "Deno"; else note "Deno missing: YouTube fails more often (./deploy.sh update installs it)"; fi
        if command -v ffmpeg >/dev/null 2>&1; then ok "ffmpeg"; else note "ffmpeg missing: .say and .toimg are off ($(pkg_hint ffmpeg ffmpeg))"; fi
        if command -v node >/dev/null 2>&1 && [ -z "${HAMBOT_SKIP_NET_CHECK:-}" ]; then
            if node -e 'const s = require("net").connect(443, "web.whatsapp.com"); s.setTimeout(5000, () => process.exit(1)); s.on("connect", () => process.exit(0)); s.on("error", () => process.exit(1));' 2>/dev/null; then
                ok "can reach web.whatsapp.com:443"
            else
                bad "cannot reach web.whatsapp.com:443: check the internet connection, DNS and firewall"
            fi
        fi
    fi

    if other_running; then bad "two copies are running (Docker and Local): $(other_stop_cmd)"; fi

    case $(get_env CHAT_ENABLED) in
        true|yes|on|1)
            say "AI chat (.chat):"
            if [ "$MODE" = docker ] && ! docker_ready; then
                note "skipped: Docker is not usable"
            else
                chat_check || true
            fi
            ;;
    esac

    if [ "$DOCTOR_FAILS" -eq 0 ]; then
        say "All good."
    else
        say "$DOCTOR_FAILS thing(s) to fix: see FIX above."
        return 1
    fi
}

# ------------------------------------------------------------
# AI chat (.chat): wizard, check, off, undo
# ------------------------------------------------------------
ENV_BACKUP=.env.bak
EDIT_ROUNDS=3

# Write KEY VALUE [KEY VALUE ...] into .env in one atomic step. Unlike
# set_env, values may hold | & \ $ # and spaces (keys, URLs): they are
# written through awk (never sed) and single-quoted when needed, which
# dotenv and Docker Compose both take literally. A value with ' or a
# newline cannot be quoted that way and must be refused before this.
# The first line for a key (set or "# KEY=" commented out) is replaced;
# later duplicates are dropped; missing keys are appended.
set_env_many() {
    [ -f .env ] || die "Internal error: .env missing while saving settings. Run ./deploy.sh again."
    n=0
    while [ $# -ge 2 ]; do
        n=$((n + 1))
        export "HBK_$n=$1" "HBV_$n=$2"
        shift 2
    done
    export HB_N=$n
    new_tmp env
    (
        umask 077
        awk '
            function q(s) { return (s ~ /^[A-Za-z0-9._:\/@+,=-]*$/) ? s : "\047" s "\047" }
            BEGIN {
                n = ENVIRON["HB_N"] + 0
                for (i = 1; i <= n; i++) { k[i] = ENVIRON["HBK_" i]; v[i] = ENVIRON["HBV_" i]; at[k[i]] = i }
            }
            {
                line = $0
                sub(/\r$/, "", line)
                if (match(line, /^#* *[A-Za-z_][A-Za-z0-9_]*=/)) {
                    key = substr(line, 1, RLENGTH - 1)
                    sub(/^#* */, "", key)
                    if (key in at) {
                        if (!(key in done)) { print key "=" q(v[at[key]]); done[key] = 1 }
                        next
                    }
                }
                print line
            }
            END { for (i = 1; i <= n; i++) if (!(k[i] in done)) print k[i] "=" q(v[i]) }
        ' .env > "$TMP"
    ) || die "Could not write the new .env (disk full?). Nothing was changed."
    mv "$TMP" .env
}

# Answers are collected here and written only after the summary is
# confirmed: Ctrl+C, end of input or "no" leave .env exactly as it was.
PENDING=""
pend() {
    case " $PENDING " in *" $1 "*) ;; *) PENDING="$PENDING $1" ;; esac
    eval "PV_$1=\$2"
}
# The pending (or saved) value, or $2 when there is none.
pending_or() {
    v=$(pending_value "$1")
    printf '%s' "${v:-$2}"
}
pending_value() {
    case " $PENDING " in *" $1 "*) eval "printf '%s' \"\$PV_$1\"" ;; *) get_env "$1" ;; esac
}
save_pending() {
    set --
    for key in $PENDING; do
        eval "value=\$PV_$key"
        set -- "$@" "$key" "$value"
    done
    if [ ! -f "$ENV_BACKUP.taken" ]; then
        (umask 077; cp .env "$ENV_BACKUP")
        : > "$ENV_BACKUP.taken"
        TMP_PATHS="$TMP_PATHS $ROOT/$ENV_BACKUP.taken"
    fi
    set_env_many "$@"
}

# Pick one of several options by number or name (prefix). Prints the choice.
#   $1 question  $2 default (Enter)  $3.. "name|description" options
ask_choice() {
    question=$1
    default=$2
    shift 2
    say "" >&2
    say "$question" >&2
    i=0
    for opt in "$@"; do
        i=$((i + 1))
        name=${opt%%|*}
        mark=""
        [ "$name" = "$default" ] && mark=" (Enter)"
        say "  $i) ${opt#*|}$mark" >&2
    done
    attempt=0
    while [ $attempt -lt $MAX_TRIES ]; do
        attempt=$((attempt + 1))
        read_line "Choice [1-$i]: " || input_closed
        answer=$(printf '%s' "$ANSWER" | tr -d ' ' | tr 'A-Z' 'a-z')
        if [ -z "$answer" ] && [ -n "$default" ]; then printf '%s' "$default"; return 0; fi
        j=0
        for opt in "$@"; do
            j=$((j + 1))
            name=${opt%%|*}
            if [ "$answer" = "$j" ] || [ "$answer" = "$name" ]; then printf '%s' "$name"; return 0; fi
        done
        for opt in "$@"; do
            name=${opt%%|*}
            case $name in "$answer"*) [ -n "$answer" ] && { printf '%s' "$name"; return 0; } ;; esac
        done
        warn "Type a number from 1 to $i."
    done
    die "No valid choice after $MAX_TRIES tries. Run ./deploy.sh chat again."
}

# Free text. $1 prompt  $2 current (Enter keeps it)  $3 "required"
ask_text() {
    attempt=0
    while [ $attempt -lt $MAX_TRIES ]; do
        attempt=$((attempt + 1))
        if [ -n "$2" ]; then
            read_line "$1 [$2, Enter = keep]: " || input_closed
        else
            read_line "$1: " || input_closed
        fi
        value=$(printf '%s' "$ANSWER" | sed "s/^[[:space:]]*//; s/[[:space:]]*\$//; s/^[\"']//; s/[\"']\$//")
        if [ -z "$value" ]; then
            if [ -n "$2" ]; then printf '%s' "$2"; return 0; fi
            if [ "${3:-}" != required ]; then printf ''; return 0; fi
            warn "This one is required."
            continue
        fi
        case $value in
            *"'"*) warn "Quotes (') cannot be saved here — type it without them."; continue ;;
        esac
        printf '%s' "$value"
        return 0
    done
    die "No answer after $MAX_TRIES tries. Run ./deploy.sh chat again."
}

# Hidden input for keys. Enter keeps the current one, "-" removes it.
STTY_HIDDEN=""
read_secret() {
    if [ "$TTY" = /dev/tty ] || { [ "$TTY" = stdin ] && [ -t 0 ]; }; then
        dev=/dev/tty
        [ "$TTY" = stdin ] && dev=/dev/stdin
        if stty -echo <"$dev" 2>/dev/null; then
            STTY_HIDDEN=$dev
            read_line "$1" || { stty echo <"$dev" 2>/dev/null; STTY_HIDDEN=""; return 1; }
            stty echo <"$dev" 2>/dev/null || true
            STTY_HIDDEN=""
            printf '\n' >&2
            return 0
        fi
    fi
    read_line "$1"
}

# "…abcd (51 chars)": enough to recognise a key, useless to anyone else.
key_hint() {
    [ -n "$1" ] || { printf 'none'; return 0; }
    printf '…%s (%s chars)' "$(printf '%s' "$1" | tail -c 4)" "${#1}"
}

ask_secret() {
    prompt=$1
    current=$2
    required=${3:-}
    attempt=0
    while [ $attempt -lt $MAX_TRIES ]; do
        attempt=$((attempt + 1))
        if [ -n "$current" ]; then
            read_secret "$prompt [saved: $(key_hint "$current"); Enter = keep, - = remove]: " || input_closed
        else
            read_secret "$prompt: " || input_closed
        fi
        # Pasted keys often carry spaces, quotes or a "Bearer " prefix.
        value=$(printf '%s' "$ANSWER" | tr -d ' \t' | sed "s/^[\"']//; s/[\"']\$//; s/^[Bb]earer//")
        if [ "$value" = "-" ]; then printf ''; return 0; fi
        if [ -z "$value" ]; then
            if [ -n "$current" ]; then printf '%s' "$current"; return 0; fi
            if [ "$required" != required ]; then printf ''; return 0; fi
            warn "This backend needs a key or token."
            continue
        fi
        case $value in
            *"'"*) warn "A key with ' in it cannot be saved by this wizard. Put it in .env yourself, in double quotes."; continue ;;
        esac
        say "    -> key $(key_hint "$value")" >&2
        printf '%s' "$value"
        return 0
    done
    die "No key after $MAX_TRIES tries. Run ./deploy.sh chat again."
}

# Hosts where a key may travel over plain http: loopback, private ranges,
# Tailscale (encrypted by WireGuard), Docker's host alias, single-label names.
private_host() {
    case $1 in
        localhost|127.*|10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*) return 0 ;;
        100.6[4-9].*|100.[7-9][0-9].*|100.1[01][0-9].*|100.12[0-7].*) return 0 ;;
        *.ts.net|host.docker.internal|*.local|*.internal|*.lan|\[*) return 0 ;;
        *.*) return 1 ;;
        *) return 0 ;;
    esac
}
url_host() { printf '%s' "$1" | sed 's|^[a-zA-Z]*://||; s|/.*||; s|:[0-9]*$||'; }

# A URL, forgiving the usual paste mistakes. $1 prompt $2 current/default
ask_url() {
    attempt=0
    while [ $attempt -lt $MAX_TRIES ]; do
        attempt=$((attempt + 1))
        url=$(ask_text "$1" "$2" required)
        url=$(printf '%s' "$url" | tr -d ' ')
        case $url in
            http://*|https://*) ;;
            *://*) warn "Only http:// or https:// addresses work."; continue ;;
            *)
                if confirm "    No http:// in front. Use http://$url ?" y; then url="http://$url"; else continue; fi
                ;;
        esac
        stripped=$(printf '%s' "$url" | sed -E 's#/+$##; s#/(chat/completions|completions|api/chat|api/generate|api/tags|messages|models)/*$##')
        if [ "$stripped" != "${url%/}" ]; then
            say "    -> using $stripped (the endpoint path is added by the bot)" >&2
        fi
        url=$stripped
        host=$(url_host "$url")
        if [ "$MODE" = docker ]; then
            case $host in
                localhost|127.0.0.1|::1|\[::1\])
                    warn "Inside the Docker container, $host is the container itself, not this machine."
                    alt=$(printf '%s' "$url" | sed "s#://$host#://host.docker.internal#")
                    if confirm "    Use $alt instead (this machine, seen from the container)?" y; then url=$alt; fi
                    ;;
            esac
        fi
        printf '%s' "$url"
        return 0
    done
    die "No usable address after $MAX_TRIES tries. Run ./deploy.sh chat again."
}

# A key over plain http to the internet would travel in clear text.
url_safe_for_key() {
    case $1 in http://*) [ -n "$2" ] || return 0; private_host "$(url_host "$1")" ;; *) return 0 ;; esac
}

# Bounded number. $1 prompt $2 default $3 min $4 max
ask_count() {
    attempt=0
    while [ $attempt -lt $MAX_TRIES ]; do
        attempt=$((attempt + 1))
        read_line "$1 [$2]: " || input_closed
        value=$(printf '%s' "$ANSWER" | tr -d ' ')
        [ -z "$value" ] && value=$2
        case $value in ''|*[!0-9]*) warn "A whole number, please."; continue ;; esac
        if [ "$value" -lt "$3" ] || [ "$value" -gt "$4" ]; then warn "Between $3 and $4, please."; continue; fi
        printf '%s' "$value"
        return 0
    done
    die "No valid number after $MAX_TRIES tries. Run ./deploy.sh chat again."
}

docker_localhost() {
    if [ "$MODE" = docker ]; then printf 'http://host.docker.internal'; else printf 'http://127.0.0.1'; fi
}

# The questions for one backend. Everything goes to pend(), nothing to .env.
configure_backend() {
    case $1 in
        local)
            say ""
            info "Local model"
            api=$(ask_choice "Which kind of local server?" "$(pending_or CHAT_LOCAL_API ollama)" \
                "ollama|Ollama" \
                "openai|OpenAI-compatible (LM Studio, llama.cpp, vLLM, LocalAI, Jan)")
            pend CHAT_LOCAL_API "$api"
            if [ "$api" = ollama ]; then def="$(docker_localhost):11434"; else def="$(docker_localhost):1234/v1"; fi
            cur=$(pending_value CHAT_LOCAL_URL)
            pend CHAT_LOCAL_URL "$(ask_url "  Server address" "${cur:-$def}")"
            pend CHAT_LOCAL_MODEL "$(ask_text "  Model name (e.g. llama3.2 — ollama list shows yours)" "$(pending_value CHAT_LOCAL_MODEL)" required)"
            if [ "$api" = openai ]; then
                pend CHAT_LOCAL_API_KEY "$(ask_secret "  API key, only if the server was started with one (Enter = none)" "$(pending_value CHAT_LOCAL_API_KEY)")"
            fi
            ;;
        provider)
            say ""
            info "API provider"
            api=$(ask_choice "Which API does the provider speak?" "$(pending_or CHAT_PROVIDER_API openai)" \
                "openai|OpenAI-compatible (OpenAI, OpenRouter, Groq, DeepSeek, Mistral, Together, ...)" \
                "anthropic|Anthropic (Claude)" \
                "gemini|Google Gemini")
            pend CHAT_PROVIDER_API "$api"
            if [ "$api" = openai ]; then
                say "  Addresses: OpenAI https://api.openai.com/v1 · OpenRouter https://openrouter.ai/api/v1"
                say "             Groq https://api.groq.com/openai/v1 · DeepSeek https://api.deepseek.com/v1"
                say "  Type - to use the official OpenAI address."
            else
                say "  Type - to use the official $api address."
            fi
            cur=$(pending_value CHAT_PROVIDER_URL)
            attempt_url=0
            while :; do
                attempt_url=$((attempt_url + 1))
                [ $attempt_url -le $MAX_TRIES ] || die "No usable address after $MAX_TRIES tries. Run ./deploy.sh chat again."
                read_line "  Address [${cur:-official}, Enter = keep]: " || input_closed
                case $(printf '%s' "$ANSWER" | tr -d ' ') in
                    '') url=$cur ;;
                    -) url="" ;;
                    *) url=$(printf '%s' "$ANSWER" | tr -d ' '); case $url in http://*|https://*) ;; *) url="https://$url"; say "    -> using $url" ;; esac
                       url=$(printf '%s' "$url" | sed -E 's#/+$##; s#/(chat/completions|completions|messages|models)/*$##') ;;
                esac
                break
            done
            pend CHAT_PROVIDER_URL "$url"
            # The official addresses always need a key; a custom one may not.
            req=required
            [ -n "$url" ] && req=""
            pend CHAT_PROVIDER_API_KEY "$(ask_secret "  API key" "$(pending_value CHAT_PROVIDER_API_KEY)" $req)"
            ex="the name from your provider's model list"
            [ "$api" = anthropic ] && ex="e.g. claude-opus-5-5"
            pend CHAT_PROVIDER_MODEL "$(ask_text "  Model ($ex)" "$(pending_value CHAT_PROVIDER_MODEL)" required)"
            ;;
        agent)
            say ""
            info "Agent platform"
            say "  The agent can run on this machine or on another one in your Tailscale network,"
            say "  e.g. your home PC while the bot runs on a VPS. See docs/ai-chat.md."
            platform=$(ask_choice "Which agent?" "$(pending_or CHAT_AGENT_PLATFORM hermes)" \
                "hermes|Hermes Agent (hermes gateway, API_SERVER_ENABLED=true)" \
                "openclaw|OpenClaw (gateway.http.endpoints.chatCompletions.enabled)" \
                "openai|Another agent with an OpenAI-style API")
            pend CHAT_AGENT_PLATFORM "$platform"
            case $platform in
                hermes) def="$(docker_localhost):8642/v1" ;;
                openclaw) def="$(docker_localhost):18789/v1" ;;
                *) def="" ;;
            esac
            cur=$(pending_value CHAT_AGENT_URL)
            say "  On another machine? Use its Tailscale address, e.g. http://100.101.102.103:8642/v1"
            pend CHAT_AGENT_URL "$(ask_url "  Agent address" "${cur:-$def}")"
            pend CHAT_AGENT_TOKEN "$(ask_secret "  Token (Hermes: API_SERVER_KEY · OpenClaw: gateway token)" "$(pending_value CHAT_AGENT_TOKEN)")"
            if [ "$platform" = openclaw ]; then
                pend CHAT_AGENT_ID "$(ask_text "  OpenClaw agent id (Enter = default agent)" "$(pending_value CHAT_AGENT_ID)")"
            fi
            if [ "$platform" = openai ]; then
                pend CHAT_AGENT_MODEL "$(ask_text "  Model name the agent expects" "$(pending_value CHAT_AGENT_MODEL)" required)"
            elif confirm "  Let the agent keep the conversation itself (its own memory)? Otherwise HamBot sends it." n; then
                pend CHAT_AGENT_MEMORY agent
            else
                pend CHAT_AGENT_MEMORY bot
            fi
            ;;
    esac

    # A key must never cross the internet in clear text.
    case $1 in
        local) u=CHAT_LOCAL_URL; k=CHAT_LOCAL_API_KEY ;;
        provider) u=CHAT_PROVIDER_URL; k=CHAT_PROVIDER_API_KEY ;;
        agent) u=CHAT_AGENT_URL; k=CHAT_AGENT_TOKEN ;;
    esac
    url=$(pending_value $u)
    if ! url_safe_for_key "$url" "$(pending_value $k)"; then
        warn "$url is plain http:// on the internet — the key would travel unencrypted."
        https=$(printf '%s' "$url" | sed 's#^http://#https://#')
        if confirm "    Use $https instead?" y; then
            pend $u "$https"
        else
            die "Not saved. Use an https:// address, or reach the server over Tailscale."
        fi
    fi
}

configured_backend() {
    case $1 in
        local) [ -n "$(pending_value CHAT_LOCAL_MODEL)" ] ;;
        provider) [ -n "$(pending_value CHAT_PROVIDER_MODEL)" ] ;;
        agent) [ -n "$(pending_value CHAT_AGENT_URL)" ] ;;
        *) return 1 ;;
    esac
}

collect_chat_answers() {
    access=$(ask_choice "Who may use .chat?" "$(pending_or CHAT_ACCESS owner)" \
        "owner|Only you (the owner)" \
        "allowlist|You and the numbers you list" \
        "public|Everyone who can message the bot")
    if [ "$access" = public ]; then
        warn "Everyone's questions will use your AI (and your API credit)."
        confirm "    Open .chat to everyone?" n || access=owner
    fi
    pend CHAT_ACCESS "$access"
    if [ "$access" = allowlist ]; then
        say "  Numbers allowed to chat, with country code. Empty line when done."
        list=$(pending_value CHAT_ALLOWED_USERS)
        [ -n "$list" ] && say "  Current: $list  (Enter = keep, - = start a new list)"
        read_line "  Number: " || input_closed
        first=$(printf '%s' "$ANSWER" | tr -d ' ')
        if [ -n "$first" ]; then
            [ "$first" = "-" ] && first=""
            list=""
            count=0
            fails=0
            entry=$first
            while [ $count -lt 50 ]; do
                if [ -n "$entry" ]; then
                    if number=$(valid_number "$(clean_number "$entry")"); then
                        list="${list:+$list,}$number"
                        count=$((count + 1))
                    else
                        fails=$((fails + 1))
                        [ $fails -lt $MAX_TRIES ] || die "Too many invalid numbers. Run ./deploy.sh chat again."
                    fi
                fi
                read_line "  Number (Enter = done): " || input_closed
                entry=$(printf '%s' "$ANSWER" | tr -d ' ')
                [ -z "$entry" ] && break
            done
        fi
        pend CHAT_ALLOWED_USERS "$list"
    fi

    backend=$(ask_choice "Where should questions go?" "$(pending_or CHAT_BACKEND local)" \
        "local|A local model (Ollama, LM Studio, llama.cpp, ...)" \
        "provider|An API provider (OpenAI-compatible, Anthropic, Gemini)" \
        "agent|An agent platform (Hermes Agent, OpenClaw), here or over Tailscale")
    pend CHAT_BACKEND "$backend"
    configure_backend "$backend"

    say ""
    say "A fallback answers when the main backend is down (e.g. your PC is off)."
    others=""
    for b in local provider agent; do [ "$b" = "$backend" ] || others="$others $b"; done
    set -- "none|No fallback"
    for b in $others; do
        if configured_backend "$b"; then set -- "$@" "$b|$b (already set up)"; else set -- "$@" "$b|$b (set it up now)"; fi
    done
    cur=$(pending_value CHAT_FALLBACK)
    case " $others " in *" $cur "*) ;; *) cur=none ;; esac
    fallback=$(ask_choice "Fallback?" "$cur" "$@")
    pend CHAT_FALLBACK "$fallback"
    if [ "$fallback" != none ] && ! configured_backend "$fallback"; then configure_backend "$fallback"; fi

    if [ "$backend" = agent ] || [ "$fallback" = agent ]; then
        say ""
        say "An agent can run tools on the machine it lives on (files, shell, mail...)."
        agent_access=$(ask_choice "Who may use the agent?" "$(pending_or CHAT_AGENT_ACCESS owner)" \
            "owner|Only you (recommended)" \
            "allowlist|You and the allowed numbers" \
            "public|Everyone allowed to use .chat")
        if [ "$agent_access" != owner ]; then
            warn "Others will be able to make your agent act on your machine."
            confirm "    Are you sure?" n || agent_access=owner
            if [ "$agent_access" = public ]; then confirm "    Really everyone? This cannot be undone once they act." n || agent_access=owner; fi
        fi
        pend CHAT_AGENT_ACCESS "$agent_access"
    fi

    say ""
    cur=$(pending_value CHAT_MAX_CONCURRENT)
    pend CHAT_MAX_CONCURRENT "$(ask_count "AI questions answered at the same time (1-10)" "${cur:-2}" 1 10)"
    cur=$(pending_value CHAT_DAILY_LIMIT_ENABLED)
    dflt=n
    case $cur in true|yes|on|1) dflt=y ;; esac
    if confirm "Limit how many questions each person may ask per day?" $dflt; then
        pend CHAT_DAILY_LIMIT_ENABLED true
        cur=$(pending_value CHAT_DAILY_LIMIT)
        pend CHAT_DAILY_LIMIT "$(ask_count "  Questions per person per day" "${cur:-20}" 1 100000)"
    else
        pend CHAT_DAILY_LIMIT_ENABLED false
    fi
    pend CHAT_ENABLED true
}

show_pending() {
    say ""
    info "AI chat settings to save in .env:"
    for key in $PENDING; do
        eval "value=\$PV_$key"
        case $key in
            *_KEY|*_TOKEN) shown=$(key_hint "$value") ;;
            *) shown=${value:-(empty)} ;;
        esac
        printf '  %-28s %s\n' "$key" "$shown"
    done
    say "  Everything else (memory, timeouts, prompt, ...) is in .env — see docs/ai-chat.md"
}

# Run the bot's own check where the bot runs (inside the container in
# Docker mode). Returns 0 ok, 1 something to fix, 2 could not run, 3 off.
chat_check() {
    snippet='try { require.resolve("./utils/chat/check"); } catch (e) { console.log("MISSING"); process.exit(4); } require("./utils/chat/check").main();'
    new_tmp check
    out=$TMP
    rc=0
    be_node "$snippet" >"$out" 2>&1 || rc=$?
    if grep -q '^MISSING' "$out"; then
        warn "This version of the bot has no AI chat check yet: run ./deploy.sh update first."
        return 2
    fi
    while IFS= read -r line; do
        case $line in
            "ok "*) ok "${line#ok }" ;;
            "FIX "*) bad "${line#FIX }" ;;
            "note "*) note "${line#note }" ;;
        esac
    done < "$out"
    case $rc in
        0) return 0 ;;
        1) grep -q '^FIX ' "$out" && return 1 ;;
        3) return 3 ;;
    esac
    warn "The check could not run (exit $rc). Last lines:"
    tail -n 5 "$out" >&2
    return 2
}

chat_restart() {
    if be_running; then
        if [ -n "$OPT_YES" ] || ! interactive || confirm "Restart the bot now so .chat uses the new settings?" y; then
            info "Restarting the bot..."
            new_tmp restart
            # A subshell: the backends may `exit` on failure, and this run
            # still has to say how to get back.
            if ! (be_restart) >"$TMP" 2>&1; then
                tail -n 5 "$TMP" >&2
                warn "The restart failed. ./deploy.sh logs shows why; ./deploy.sh chat undo puts the old settings back."
                return 1
            fi
            info "Restarted."
        else
            say "  The new settings apply at the next restart (./deploy.sh update or .security restart)."
        fi
    else
        say "  The bot is not running; start it with ./deploy.sh"
    fi
}

cmd_chat() {
    sub=${1:-setup}
    require_env
    MODE=$(current_mode)
    case $MODE in invalid:*) die "DEPLOY_MODE=${MODE#invalid:} in .env: use docker or local." ;; esac
    # Editing .env never needs Docker; checking from inside the container does.
    case $sub in setup|test|check|'') [ "$MODE" != docker ] || require_docker ;; esac
    [ "$MODE" != local ] || { node_ok || load_nvm; }

    case $sub in
        off)
            take_lock
            set_env_many CHAT_ENABLED false
            info "AI chat is off (settings kept; ./deploy.sh chat turns it on again)."
            chat_restart
            return 0
            ;;
        test|check)
            say "AI chat check ($MODE mode)"
            DOCTOR_FAILS=0
            rc=0
            chat_check || rc=$?
            if [ $rc -eq 0 ]; then say "All good."; return 0; fi
            [ $rc -eq 3 ] && say "Turn it on with ./deploy.sh chat"
            return 1
            ;;
        undo)
            take_lock
            [ -f "$ENV_BACKUP" ] || die "No earlier settings to go back to ($ENV_BACKUP is missing)."
            if [ -z "$OPT_YES" ] && interactive; then
                confirm "Put back the .env from before the last ./deploy.sh chat?" y || die "Nothing changed."
            fi
            new_tmp undo
            (umask 077; cp "$ENV_BACKUP" "$TMP")
            mv "$TMP" .env
            info "Restored the earlier .env."
            chat_restart
            return 0
            ;;
        setup|'') ;;
        *) die "Unknown: ./deploy.sh chat $sub. Use: ./deploy.sh chat [off|test|undo]" ;;
    esac

    take_lock
    interactive || die "./deploy.sh chat asks questions — run it in a terminal, or set CHAT_* in .env yourself (docs/ai-chat.md)."
    say "Set up .chat: questions from WhatsApp go to an AI and the answer comes back."
    rm -f "$ENV_BACKUP.taken"

    round=0
    while :; do
        round=$((round + 1))
        collect_chat_answers
        show_pending
        confirm "Save these settings?" y || die "Nothing saved."
        save_pending
        info "Saved (the previous .env is in $ENV_BACKUP; ./deploy.sh chat undo goes back)."

        say ""
        say "Checking from where the bot runs..."
        DOCTOR_FAILS=0
        rc=0
        chat_check || rc=$?
        if [ $rc -eq 0 ]; then
            break
        fi
        [ $round -lt $EDIT_ROUNDS ] || {
            warn "Still not working after $EDIT_ROUNDS rounds. The settings are saved: fix them in .env, then ./deploy.sh chat test (or ./deploy.sh chat undo)."
            return 1
        }
        choice=$(ask_choice "What now?" "" \
            "r|Retry the check (fixed something on the other machine?)" \
            "e|Edit the answers" \
            "s|Keep these settings anyway (the bot says 'AI offline' until fixed)" \
            "u|Undo: back to the earlier .env")
        case $choice in
            r)
                rc=0
                chat_check || rc=$?
                [ $rc -eq 0 ] && break
                warn "Still failing. Edit the answers next."
                ;;
            e) ;;
            s) say "  Kept. ./deploy.sh chat test checks again later."; break ;;
            u)
                new_tmp undo
                (umask 077; cp "$ENV_BACKUP" "$TMP")
                mv "$TMP" .env
                info "Back to the earlier .env. Nothing changed."
                return 0
                ;;
        esac
        PENDING=""
    done
    rm -f "$ENV_BACKUP.taken"
    chat_restart
    say ""
    info "Done. Try it in WhatsApp: .chat halo"
}

# ------------------------------------------------------------
# Commands
# ------------------------------------------------------------
cmd_setup() {
    take_lock
    MODE=$(choose_mode)

    # Already set up and running: never start a second copy.
    if [ -f .env ] && be_running; then
        info "HamBot is already running ($MODE). Nothing to set up."
        say "  Update: ./deploy.sh update   Status: ./deploy.sh status   Numbers: ./deploy.sh config"
        return 0
    fi
    if other_running; then
        die "HamBot already runs the other way on this machine. Move it instead: ./deploy.sh switch $MODE"
    fi

    # Quick checks before asking anything, installs after .env exists.
    if [ "$MODE" = docker ]; then require_docker; else require_node; fi
    create_env
    set_env DEPLOY_MODE "$MODE"
    be_check
    be_start
    if [ "$MODE" = local ]; then startup_hint; fi
    show_login
}

cmd_update() {
    take_lock
    require_env
    MODE=$(current_mode)
    case $MODE in invalid:*) die "DEPLOY_MODE=${MODE#invalid:} in .env: set it to docker or local." ;; esac
    be_check
    if [ -d .git ] && command -v git >/dev/null 2>&1; then
        info "Updating HamBot's files"
        if ! git pull --ff-only; then
            warn "Continuing with the current files. If you edited tracked files: git stash, then ./deploy.sh update"
        fi
    fi
    if [ "$MODE" = local ]; then
        # The new files may need other packages or another yt-dlp.
        install_node_modules
        install_ytdlp
    fi
    be_start
    if [ "$MODE" = docker ]; then docker image prune -f >/dev/null 2>&1 || true; fi
    warn_two_copies || true
    info "Running HamBot v$(be_version)"
}

cmd_config() {
    take_lock
    require_env
    MODE=$(current_mode)
    [ "$MODE" != docker ] || require_docker
    interactive || die "./deploy.sh config asks questions — run it in a terminal."
    ask_numbers
    say ""
    info "Saved. Restarting the bot with the new settings."
    be_restart
    info "Done. The WhatsApp session was kept; no need to link again."
}

cmd_relink() {
    mode_arg=auto
    number=""
    while [ $# -gt 0 ]; do
        case $1 in
            --qr) mode_arg=qr ;;
            --code)
                mode_arg=code
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
                number=$(valid_number "$(clean_number "$raw")") || exit 1
                ;;
            *) die "Unknown option '$1'. Usage: ./deploy.sh relink [--qr | --code <number>] [-y]" ;;
        esac
        shift
    done

    take_lock
    require_env
    MODE=$(current_mode)
    [ "$MODE" != docker ] || require_docker

    say "This unlinks the bot's WhatsApp session and links it again from scratch."
    say "The current session is archived, not deleted (undo: ./deploy.sh restore-session)."
    if [ -z "$OPT_YES" ]; then
        interactive || die "Add -y to relink without a terminal."
        confirm "Continue?" || { info "Nothing changed."; exit 0; }
    fi

    be_stop
    info "Archiving the current session"
    be_node "const p = require('./utils/session').archiveSession('auth_info_baileys'); console.log(p ? 'archived to ' + p : 'no session to archive')"

    case $mode_arg in
        qr) set_env LOGIN_METHOD qr ;;
        code) set_env PAIRING_NUMBER "$number"; set_env LOGIN_METHOD code ;;
        *) set_env LOGIN_METHOD auto ;;
    esac

    be_restart
    show_login
}

cmd_restore() {
    take_lock
    require_env
    MODE=$(current_mode)
    [ "$MODE" != docker ] || require_docker
    say "This puts back the most recently archived session (the one before the last relink)."
    if interactive && [ -z "$OPT_YES" ]; then
        confirm "Continue?" || { info "Nothing changed."; exit 0; }
    fi

    be_stop
    be_node "const r = require('./utils/session').restoreSession('auth_info_baileys'); if (!r) { console.log('no archived session found'); process.exit(3); } console.log('restored ' + r)" \
        || warn "Nothing restored."
    be_restart
    show_login
}

# Move the WhatsApp session between Docker's volume and the local folder.
# Copied to a staging dir first and only moved into place once creds.json is
# there; what was at the destination is archived, never deleted.
cmd_switch() {
    target=${1:-}
    case $target in
        docker|local) ;;
        *) die "Usage: ./deploy.sh switch docker|local" ;;
    esac
    take_lock
    require_env
    from=$(current_mode)
    case $from in invalid:*) from=docker ;; esac
    if [ "$from" = "$target" ]; then
        info "Already set to $target mode."
        return 0
    fi

    say "This stops the $from bot and starts it in $target mode. The WhatsApp session moves along."
    if [ -z "$OPT_YES" ]; then
        interactive || die "Add -y to switch without a terminal."
        confirm "Continue?" y || { info "Nothing changed."; exit 0; }
    fi

    # Make sure the destination works before stopping anything.
    require_docker
    MODE=$target
    be_check

    MODE=$from
    be_stop
    new_tmp session
    staging=$TMP
    mkdir -p "$staging"
    moved=""

    # Through a file, not a pipe: a pipe reports only its last command, and
    # some tar versions happily "extract" the empty output of a failed copy.
    new_tmp session.tar
    archive=$TMP

    if [ "$from" = docker ]; then
        info "Copying the session out of Docker"
        if docker compose run --rm --no-deps -T --entrypoint tar "$SERVICE" -C /app/auth_info_baileys --exclude=./.archive -cf - . > "$archive" \
            && tar -C "$staging" -xf "$archive"; then
            if [ -f "$staging/creds.json" ]; then
                mkdir -p auth_info_baileys
                node -e "require('./utils/session').archiveSession('auth_info_baileys')" >/dev/null 2>&1 || true
                for f in "$staging"/* "$staging"/.[!.]*; do
                    if [ -e "$f" ]; then mv "$f" auth_info_baileys/; fi
                done
                moved=1
            fi
        else
            be_restart
            die "Could not copy the session out of Docker. The Docker bot was started again; nothing changed."
        fi
    elif [ -f auth_info_baileys/creds.json ]; then
        info "Copying the session into Docker"
        if tar -C auth_info_baileys --exclude=./.archive -cf "$archive" . \
            && docker compose run --rm --no-deps -T --entrypoint sh "$SERVICE" -c \
                "node -e \"require('./utils/session').archiveSession('auth_info_baileys')\" >/dev/null 2>&1; tar -C /app/auth_info_baileys -xf -" < "$archive"; then
            # Archived here too, so the session is active in one place only.
            node -e "require('./utils/session').archiveSession('auth_info_baileys')" >/dev/null 2>&1 || true
            moved=1
        else
            be_restart
            die "Could not copy the session into Docker. The local bot was started again; nothing changed."
        fi
    fi
    if [ -n "$moved" ]; then
        info "Session moved; no need to link again."
    else
        info "There was no linked session to move; you'll link the number below."
    fi

    set_env DEPLOY_MODE "$target"
    MODE=$target
    be_start
    if [ "$MODE" = local ]; then startup_hint; fi
    show_login
}

cmd_status() {
    MODE=$(current_mode)
    case $MODE in invalid:*) warn "DEPLOY_MODE=${MODE#invalid:} in .env is not docker or local."; MODE=docker ;; esac
    if [ "$MODE" = docker ]; then require_docker; fi
    if [ -f .env ]; then
        owner=$(get_env BOT_OWNER_ID)
        pairing=$(get_env PAIRING_NUMBER)
        method=$(get_env LOGIN_METHOD)
        say "Mode:            $MODE"
        say "Owner number:    ${owner:-(not set!)}"
        say "Pairing number:  ${pairing:-(none — QR code)}"
        say "Login method:    ${method:-auto}"
        say "Wrong number? ./deploy.sh config"
        say ""
    fi
    if [ "$MODE" = docker ]; then
        docker compose ps "$SERVICE"
        docker compose exec -T "$SERVICE" node scripts/healthcheck.js 2>/dev/null || true
    else
        if find_pm2; then
            st=$(pm2_state)
            say "pm2:             ${st%% *} (restarts: ${st#* })"
            startup_installed || say "After a reboot:  won't start by itself; run 'pm2 startup' and its sudo line"
        else
            say "pm2:             not installed (run ./deploy.sh)"
        fi
        node scripts/healthcheck.js 2>/dev/null || true
    fi
    warn_two_copies || true
}

cmd_stop() {
    take_lock
    MODE=$(current_mode)
    case $MODE in invalid:*) MODE=docker ;; esac
    if [ "$MODE" = docker ]; then
        require_docker
        docker compose down
    else
        be_stop
    fi
    info "Stopped. The WhatsApp session is kept; ./deploy.sh starts it again."
}

cmd_logs() {
    MODE=$(current_mode)
    case $MODE in invalid:*) MODE=docker ;; esac
    if [ "$MODE" = docker ]; then
        require_docker
        docker compose logs -f --tail 100 "$SERVICE"
    else
        find_pm2 || die "pm2 is not installed — run ./deploy.sh first."
        pm2 logs "$APP" --lines 100
    fi
}

show_help() {
    awk 'NR > 2 && /^# =====/ { exit } NR > 2 { sub(/^# ?/, ""); print }' "$0"
}

KNOWN="setup update config relink restore-session switch status doctor logs stop help chat"
# The command a typo most likely meant (same first 3, then 2 letters).
suggest() {
    for n in 3 2; do
        start=$(printf '%s' "$1" | cut -c1-$n)
        [ ${#start} -eq $n ] || continue
        for c in $KNOWN; do
            case $c in "$start"*) printf '%s' "$c"; return 0 ;; esac
        done
    done
}

# ------------------------------------------------------------
# Arguments: global flags may appear anywhere
# ------------------------------------------------------------
OPT_MODE=""
OPT_YES=""
OPT_OWNER=""
OPT_PAIRING=""
cmd=""
rest=""
quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
while [ $# -gt 0 ]; do
    case $1 in
        --docker) OPT_MODE=docker ;;
        --local) OPT_MODE=local ;;
        -y|--yes) OPT_YES=1 ;;
        --owner)
            [ $# -gt 1 ] || die "--owner needs a number, e.g. --owner 6281234567890"
            OPT_OWNER=$(valid_number "$(clean_number "$2")") || exit 1
            shift
            ;;
        --pairing)
            [ $# -gt 1 ] || die "--pairing needs a number, e.g. --pairing 6281234567890"
            OPT_PAIRING=$(valid_number "$(clean_number "$2")") || exit 1
            shift
            ;;
        -h|--help) cmd=help ;;
        *)
            if [ -z "$cmd" ]; then cmd=$1; else rest="$rest $(quote "$1")"; fi
            ;;
    esac
    shift
done
# Numbers exported beforehand (BOT_OWNER_ID=... ./deploy.sh) work like the flags.
if [ -z "$OPT_OWNER" ] && [ -n "${BOT_OWNER_ID:-}" ] && [ ! -f .env ]; then
    OPT_OWNER=$(valid_number "$(clean_number "$BOT_OWNER_ID")") || exit 1
    OPT_PAIRING=$(valid_number "$(clean_number "${PAIRING_NUMBER:-}")" 2>/dev/null || true)
fi
eval "set -- $rest"

case ${cmd:-setup} in
    setup|install) cmd_setup ;;
    update|upgrade) cmd_update ;;
    config|configure) cmd_config ;;
    relink) cmd_relink "$@" ;;
    restore-session) cmd_restore ;;
    switch) cmd_switch "$@" ;;
    logs) cmd_logs ;;
    status) cmd_status ;;
    doctor) cmd_doctor ;;
    chat|ai) cmd_chat "$@" ;;
    stop) cmd_stop ;;
    help) show_help ;;
    *)
        guess=$(suggest "$cmd")
        if [ -n "$guess" ]; then
            die "Unknown command '$cmd'. Did you mean: ./deploy.sh $guess ?  (all commands: ./deploy.sh help)"
        fi
        die "Unknown command '$cmd'. Try: ./deploy.sh help"
        ;;
esac
