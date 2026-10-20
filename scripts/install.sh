#!/bin/sh
# ============================================================
# HamBot one-line installer (Linux, macOS, Windows via WSL)
#
#   curl -fsSL https://raw.githubusercontent.com/AkilixCode/hambot-wa-bot/main/scripts/install.sh | sh
#
# Any ./deploy.sh flags can follow, e.g. to skip the Docker/Local question:
#   curl -fsSL .../scripts/install.sh | sh -s -- --local
#
# Downloads HamBot into ./hambot-wa-bot (or updates it if it is already
# there), then hands over to ./deploy.sh, which asks Docker or Local and
# does the rest. Safe to run again.
# ============================================================
set -eu

# Everything runs from main(), called on the last line: if the download is
# cut off halfway, the shell has nothing complete to run.
main() {
    repo=${HAMBOT_REPO:-https://github.com/AkilixCode/hambot-wa-bot.git}
    dir=${HAMBOT_DIR:-hambot-wa-bot}

    info() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
    warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
    die()  { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

    if ! command -v git >/dev/null 2>&1; then
        if [ "$(uname -s)" = Darwin ]; then
            die "git is needed: xcode-select --install (or brew install git), then run this again."
        elif command -v apt-get >/dev/null 2>&1; then
            die "git is needed: sudo apt-get install -y git, then run this again."
        elif command -v dnf >/dev/null 2>&1; then
            die "git is needed: sudo dnf install -y git, then run this again."
        else
            die "git is needed: install it with your package manager, then run this again."
        fi
    fi

    if [ -d "$dir/.git" ]; then
        info "HamBot is already in ./$dir — updating it"
        git -C "$dir" pull --ff-only \
            || warn "Could not update (local edits, or offline). Continuing with the files that are there."
    elif [ -e "$dir" ]; then
        die "./$dir already exists and is not a HamBot download. Move it away, or choose another folder: HAMBOT_DIR=other-name"
    else
        info "Downloading HamBot into ./$dir"
        n=1
        until git clone --depth 1 "$repo" "$dir"; do
            # A half-finished clone would make the next try fail too.
            rm -rf "$dir"
            [ $n -lt 3 ] || die "Download failed 3 times. Check the internet connection, DNS and any proxy, then run this again."
            warn "Download failed — trying again in $((n * ${HAMBOT_RETRY_DELAY:-2}))s ($n/3)"
            sleep $((n * ${HAMBOT_RETRY_DELAY:-2}))
            n=$((n + 1))
        done
    fi

    cd "$dir"
    [ -x deploy.sh ] || chmod +x deploy.sh
    # stdin is this script's pipe; deploy.sh asks its questions on the terminal.
    exec ./deploy.sh "$@"
}

main "$@"
