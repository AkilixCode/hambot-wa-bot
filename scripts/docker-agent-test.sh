#!/bin/sh
# .chat from a bot in Docker to an agent on the Docker host, the way
# docs/ai-chat.md says to set it up. Run by .github/workflows/docker.yml on
# the freshly built image:
#
#   sh scripts/docker-agent-test.sh <image>
#
# Uses the real docker-compose.yml (its host.docker.internal mapping) and
# ./deploy.sh chat test, so it checks what a user's install does.
#   1. agent bound to the Docker bridge (the documented setup): reachable,
#      token accepted, and a real question answered from inside the container
#   2. agent bound to 127.0.0.1 only: refused, with the fix in the output
#   3. CHAT_AGENT_URL=localhost from inside Docker: refused, with the hint
#      that localhost is the container itself
set -eu

image=${1:?usage: docker-agent-test.sh <image>}
cd "$(dirname "$0")/.."

[ ! -f .env ] || { echo "a .env exists here; run this in a disposable checkout" >&2; exit 1; }

bridge=$(ip -4 -o addr show docker0 | awk '{ split($4, a, "/"); print a[1] }')
[ -n "$bridge" ] || { echo "no docker0 bridge address" >&2; exit 1; }
token=ci-agent-token-1234567890
log=$(mktemp)
pids=""

cleanup() {
    # shellcheck disable=SC2086
    [ -z "$pids" ] || kill $pids 2>/dev/null || true
    docker compose down -v >/dev/null 2>&1 || true
    rm -f .env "$log"
}
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

# The compose file runs ghcr.io/...:${HAMBOT_TAG}; point it at this build.
docker tag "$image" ghcr.io/akilixcode/hambot-wa-bot:agent-test

write_env() {
    cat > .env <<ENV
DEPLOY_MODE=docker
HAMBOT_TAG=agent-test
BOT_OWNER_ID=6281234567890
LOG_LEVEL=simple
CHAT_ENABLED=true
CHAT_BACKEND=agent
CHAT_AGENT_PLATFORM=hermes
CHAT_AGENT_URL=$1
CHAT_AGENT_TOKEN=$token
CHAT_AGENT_MEMORY=agent
CHAT_STARTUP_CHECK=false
ENV
    chmod 600 .env
}

node tests/fixtures/fake-agent.cjs "$bridge" 18642 "$token" > "$log" &
pids="$pids $!"
node tests/fixtures/fake-agent.cjs 127.0.0.1 18643 "$token" >/dev/null &
pids="$pids $!"
sleep 1

echo "== 1. agent on the Docker bridge ($bridge), reached as host.docker.internal"
write_env http://host.docker.internal:18642/v1
out=$(HAMBOT_TTY=none ./deploy.sh chat test 2>&1) || { echo "$out"; fail "deploy.sh chat test should pass"; }
echo "$out"
echo "$out" | grep -q "reachable" || fail "check did not report the agent reachable"

answer=$(docker compose run --rm --no-deps --entrypoint node hambot -e '
    const { ChatService } = require("./utils/chat");
    const svc = new ChatService();
    svc.ask({ sender: "6281234567890@s.whatsapp.net", chat: "6281234567890@s.whatsapp.net", isGroup: false, isOwner: true }, "halo dari docker")
        .then(r => { console.log(r.parts.join("\n")); svc.shutdown(); process.exit(0); })
        .catch(e => { console.error(e.code || e.message, JSON.stringify(e.tried || [])); process.exit(1); });
' 2>&1) || { echo "$answer"; fail "a question from inside the container failed"; }
echo "$answer"
echo "$answer" | grep -q "agent heard: halo dari docker" || fail "unexpected answer"
grep -q '"auth":true' "$log" || fail "the agent never saw the right token"
grep -q '"session":"hambot-' "$log" || fail "no agent session id was sent"

echo "== 2. agent listening on 127.0.0.1 only"
write_env http://host.docker.internal:18643/v1
if out=$(HAMBOT_TTY=none ./deploy.sh chat test 2>&1); then echo "$out"; fail "a loopback-only agent cannot be reachable"; fi
echo "$out"
echo "$out" | grep -q "connection refused" || fail "expected connection refused"
echo "$out" | grep -q "API_SERVER_HOST" || fail "expected the Hermes bind hint"
echo "$out" | grep -q "Docker bridge address" || fail "expected the Docker bridge hint"

echo "== 3. localhost from inside Docker"
write_env http://127.0.0.1:18643/v1
if out=$(HAMBOT_TTY=none ./deploy.sh chat test 2>&1); then echo "$out"; fail "localhost inside the container is not the host"; fi
echo "$out"
echo "$out" | grep -q "localhost is the container itself" || fail "expected the Docker localhost hint"

echo "docker agent test passed"
