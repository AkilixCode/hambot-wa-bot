# AI chat (`.chat`)

`.chat` lets people talk to an AI from WhatsApp. HamBot passes the question
on to an AI and sends the answer back to the chat. You choose where the
questions go:

| Backend | What it is | Good for |
| --- | --- | --- |
| **Local model** | Ollama, LM Studio, llama.cpp, vLLM, LocalAI, Jan | Free and private, if the machine can run a model |
| **API provider** | Any OpenAI-compatible API (OpenAI, OpenRouter, Groq, DeepSeek, Mistral, Together, …), Anthropic (Claude), Google Gemini | Strong models with nothing to install |
| **Agent platform** | [Hermes Agent](https://hermes-agent.nousresearch.com), [OpenClaw](https://docs.openclaw.ai), or any agent with an OpenAI-style API | An assistant that can use tools — next to the bot (Docker or Local) or on another machine on your Tailscale network |

All settings live in `.env`. Keys stay there too: the bot never puts them in
a chat message or a log line.

- [Set it up](#set-it-up)
- [Using it](#using-it)
- [Who may use it, and how much](#who-may-use-it-and-how-much)
- [Local model](#local-model) · [API provider](#api-provider) · [Agent platform](#agent-platform)
- [Where the bot and the agent run](#where-the-bot-and-the-agent-run) (Docker, Local, Tailscale)
- [Timeouts: silence, not slowness](#timeouts-silence-not-slowness)
- [When a backend fails](#when-a-backend-fails)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [All settings](#all-settings)

## Set it up

```bash
./deploy.sh chat
```

The wizard asks:

- who may chat;
- where questions go;
- the address, model and key;
- an optional fallback;
- the limits.

It then shows a summary. Nothing is written until you confirm it. After that
it:

1. saves `.env`, keeping the old one as `.env.bak`;
2. tests the connection **from where the bot runs** (inside the container in
   Docker mode);
3. restarts the bot.

If the test fails, it says what to fix, then offers to retry, edit your
answers, keep the settings anyway, or undo. It never asks forever, and
Ctrl+C at any point leaves `.env` as it was.

| Command | What it does |
| --- | --- |
| `./deploy.sh chat` | Set up or change `.chat` |
| `./deploy.sh chat test` | Check every configured backend again |
| `./deploy.sh chat off` | Turn `.chat` off (settings are kept) |
| `./deploy.sh chat undo` | Put back the `.env` from before the last wizard run |
| `./deploy.sh doctor` | Includes the AI chat check when `.chat` is on |

To configure by hand instead, edit the `AI CHAT` section of `.env` (every
setting is listed [below](#all-settings)), set `CHAT_ENABLED=true` and
restart the bot.

## Using it

| Message | What happens |
| --- | --- |
| `.chat <question>` | Ask. The aliases `.ai`, `.ask` and `.tanya` work too. |
| reply to a message with `.chat summarise this` | The replied-to message is sent along, so long texts can be summarised, translated or answered |
| `.chat reset` | Forget your conversation in this chat |
| `.chat stop` | Cancel your running or queued question |
| `.chat status` | What is set up, how it is doing, your remaining questions |

**Owner only:**

| Message | What happens |
| --- | --- |
| `.chat test` | Check each backend: reachable, key accepted, model present, a test answer |
| `.chat models` | List the models the backend offers |
| `.chat use local\|provider\|agent` | Switch the main backend. Only backends already set up in `.env` can be chosen. The choice survives a restart. |
| `.chat stop all` | Cancel everyone's questions |

**How the conversation works:**

- **Memory.** The AI remembers your last turns in each chat: ten exchanges, for
  30 minutes of quiet. In a group, each person has their own conversation.
  Memory is kept in RAM only, never written to disk.
- **Formatting.** Answers are converted to WhatsApp formatting. Long answers
  arrive in several messages.
- **Thinking.** Reasoning that some models print (`<think>…</think>`) is
  removed.
- **Waiting.** While the AI works you see "typing…". After 30 seconds there is
  one "still working" note, which names the tool an agent is using.

## Who may use it, and how much

```ini
CHAT_ACCESS=owner           # owner | allowlist | public
CHAT_ALLOWED_USERS=6281234567890,6289876543210
CHAT_AGENT_ACCESS=owner     # owner | allowlist | public
CHAT_MAX_CONCURRENT=2       # answers worked on at the same time
CHAT_DAILY_LIMIT_ENABLED=false
CHAT_DAILY_LIMIT=20         # per person per day, when enabled
```

- **Access** is owner-only by default. `allowlist` lets in the numbers you
  list (with country code; `@lid` IDs work too). `public` lets in everyone who
  can message the bot.
- **Agents have their own, stricter setting.** An agent can run tools on the
  machine it lives on: files, shell, email. OpenClaw treats its token as full
  operator access. `CHAT_AGENT_ACCESS` therefore stays `owner` unless you
  change it, and it can never be wider than `CHAT_ACCESS`.
- **At most `CHAT_MAX_CONCURRENT` answers are in progress at once** (2 by
  default).
  - Further questions wait in a short queue (`CHAT_QUEUE_MAX`, up to
    `CHAT_QUEUE_WAIT_SEC`), and the person is told their place.
  - Each person has one question in progress at a time, across all chats
    (each chat still keeps its own history). `.chat stop` cancels it from any
    chat.
  - AI chat has its own slots, so it never holds up `.video` or `.music`.
- **The daily limit** is off unless `CHAT_DAILY_LIMIT_ENABLED=true`.
  - It resets at midnight in `BOT_TIMEZONE`.
  - It survives a restart.
  - The owner is not counted unless `CHAT_DAILY_LIMIT_OWNER=true`.
  - A question takes its place in the count as soon as it starts. An answer
    keeps it; an error, an empty answer, a queue timeout or `.chat stop` gives
    it back.
- **Where it works:** `CHAT_IN_GROUPS` / `CHAT_IN_PRIVATE` turn `.chat` off in
  groups or in private chats.

## Local model

### Ollama

```ini
CHAT_ENABLED=true
CHAT_BACKEND=local
CHAT_LOCAL_API=ollama
CHAT_LOCAL_URL=http://127.0.0.1:11434
CHAT_LOCAL_MODEL=llama3.2
CHAT_LOCAL_CONTEXT=8192        # context window (Ollama's num_ctx)
CHAT_LOCAL_KEEP_ALIVE=5m       # how long the model stays loaded after a question
```

Run `ollama pull llama3.2` first; `ollama list` shows what you have. Loading a
large model can take a while, which is why the local response timeout is
generous (`CHAT_LOCAL_RESPONSE_TIMEOUT_SEC=120`).

### LM Studio, llama.cpp, vLLM, LocalAI, Jan

All of these speak the OpenAI API:

```ini
CHAT_ENABLED=true
CHAT_BACKEND=local
CHAT_LOCAL_API=openai
CHAT_LOCAL_URL=http://127.0.0.1:1234/v1      # LM Studio; llama.cpp :8080/v1, vLLM :8000/v1
CHAT_LOCAL_MODEL=qwen2.5-7b-instruct
CHAT_LOCAL_API_KEY=                          # only if the server was started with one
```

**Docker mode, model on the same machine.** Inside the container, `127.0.0.1`
is the container itself. Use `http://host.docker.internal:PORT` (the compose
file maps it to the host), and make the server listen on the Docker bridge
address too, e.g. `OLLAMA_HOST=172.17.0.1` in Ollama's service settings —
see [Bot in Docker, agent on the same machine](#bot-in-docker-agent-on-the-same-machine),
which works the same for a model. The wizard offers the right address.

## API provider

```ini
CHAT_ENABLED=true
CHAT_BACKEND=provider
CHAT_PROVIDER_API=openai          # openai | anthropic | gemini
CHAT_PROVIDER_URL=                # empty = the official address for that API
CHAT_PROVIDER_API_KEY=sk-...
CHAT_PROVIDER_MODEL=your-model-name
```

| Provider | `CHAT_PROVIDER_API` | `CHAT_PROVIDER_URL` |
| --- | --- | --- |
| OpenAI | `openai` | empty |
| OpenRouter | `openai` | `https://openrouter.ai/api/v1` |
| Groq | `openai` | `https://api.groq.com/openai/v1` |
| DeepSeek | `openai` | `https://api.deepseek.com/v1` |
| Mistral | `openai` | `https://api.mistral.ai/v1` |
| Together | `openai` | `https://api.together.xyz/v1` |
| Anthropic (Claude) | `anthropic` | empty — e.g. `CHAT_PROVIDER_MODEL=claude-opus-5-5` |
| Google Gemini | `gemini` | empty — `GEMINI_API_KEY` is used if `CHAT_PROVIDER_API_KEY` is empty |

**Notes:**

- **Models.** Use the model name from your provider's list. `.chat models` shows
  the names the provider accepts.
- **Token cap.** `CHAT_MAX_TOKENS` caps the answer length. On reasoning models it
  includes the thinking, so raise it if answers come back empty.
- **Sampling.** `CHAT_TEMPERATURE` and `CHAT_TOP_P` are only sent when you set
  them, because many current models reject them. An OpenAI-style server that
  rejects `max_tokens` or `temperature` gets one corrected retry.
- **Extra headers.** `CHAT_PROVIDER_HEADERS` adds them as JSON, e.g.
  OpenRouter's `{"HTTP-Referer":"https://example.com"}`.
- **Proxy.** `CHAT_PROVIDER_USE_PROXY=true` sends provider traffic through the
  bot's `PROXY_*` proxy. Local and agent traffic never use it.

## Agent platform

### Hermes Agent

In `~/.hermes/.env` on the agent's machine:

```ini
API_SERVER_ENABLED=true
API_SERVER_KEY=a-long-random-secret
```

Start it with `hermes gateway`; it listens on `127.0.0.1:8642`. Then, in
HamBot's `.env`:

```ini
CHAT_ENABLED=true
CHAT_BACKEND=agent
CHAT_AGENT_PLATFORM=hermes
CHAT_AGENT_URL=http://127.0.0.1:8642/v1
CHAT_AGENT_TOKEN=a-long-random-secret
CHAT_AGENT_MEMORY=bot          # or agent: Hermes keeps the session (X-Hermes-Session-Id)
```

### OpenClaw

Turn on its OpenAI-compatible endpoint in the gateway config:

```json5
{ gateway: { http: { endpoints: { chatCompletions: { enabled: true } } } } }
```

Then:

```ini
CHAT_ENABLED=true
CHAT_BACKEND=agent
CHAT_AGENT_PLATFORM=openclaw
CHAT_AGENT_URL=http://127.0.0.1:18789/v1
CHAT_AGENT_TOKEN=your-gateway-token
CHAT_AGENT_ID=                 # empty = the default agent, or e.g. main
CHAT_AGENT_MEMORY=bot          # or agent: OpenClaw keeps the session (the OpenAI `user` field)
```

### Any other agent

Use `CHAT_AGENT_PLATFORM=openai` with the agent's base URL, token and the
model name it expects (`CHAT_AGENT_MODEL`).

### How the bot treats agents

- **No overrides.** The agent manages its own model, token budget and sampling;
  HamBot sends none of them.
- **Never resent.** An agent request is never sent twice, so a timeout cannot
  make it run its tools twice. The one exception is a refused connection: then
  the request never arrived.
- **Silent tools.** Agents may run a long tool without saying anything, so
  `CHAT_AGENT_IDLE_TIMEOUT_SEC` defaults to 180 seconds. Hermes sends a
  keep-alive every 30 seconds while it works, so keep this above 30 (the bot
  warns if it isn't).

## Where the bot and the agent run

The bot and the agent don't have to be on the same machine, and the bot can
run in Docker or Local mode. Every combination works; only the address in
`CHAT_AGENT_URL`, and where the agent listens, change:

| Bot | Agent | `CHAT_AGENT_URL` | Where the agent listens |
| --- | --- | --- | --- |
| Local mode (pm2) | same machine | `http://127.0.0.1:8642/v1` | its default (127.0.0.1) — nothing to change |
| Docker | same machine | `http://host.docker.internal:8642/v1` | the Docker bridge, not 127.0.0.1 ([below](#bot-in-docker-agent-on-the-same-machine)) |
| Docker | its own container, same machine | `http://host.docker.internal:8642/v1` | its port published on the Docker bridge ([below](#agent-in-its-own-container)) |
| Docker or Local, on a VPS | your home PC (or any other machine) | `http://100.x.y.z:8642/v1` | the tailnet ([below](#bot-on-a-vps-agent-on-your-pc-tailscale)) |

The ports are Hermes'; OpenClaw uses `18789`. Run `./deploy.sh chat test`
after any change: in Docker mode it checks from **inside the container**, so
it sees exactly what the bot will. (`./deploy.sh chat` sets all of this up
and, in Docker mode, offers `host.docker.internal` when you type `localhost`.)

### Bot in Docker, agent on the same machine

Inside the container, `127.0.0.1` is the container itself, so the bot reaches
the machine as `host.docker.internal` (mapped in `docker-compose.yml`). That
name points at the **Docker bridge** address of the machine (usually
`172.17.0.1`; `ip -4 addr show docker0` shows it), and an agent listening
only on 127.0.0.1 can't be reached there. Make it listen on the bridge — only
containers and this machine can reach that address, nothing from outside:

- **Hermes Agent**, in `~/.hermes/.env`:

  ```ini
  API_SERVER_HOST=172.17.0.1
  API_SERVER_KEY=a-long-random-secret     # required when not on 127.0.0.1
  ```

  Start `hermes gateway` after Docker, so the bridge address exists (with
  systemd: `After=docker.service`).
- **OpenClaw** prefers tailnet binds: set `gateway.bind: "tailnet"`, then use
  this machine's own Tailscale address, `CHAT_AGENT_URL=http://100.x.y.z:18789/v1`
  (`tailscale ip -4`). The container reaches it through the host.

Don't bind an agent to `0.0.0.0` unless a firewall closes the port: anyone
who can reach the machine could then drive it.

```ini
CHAT_AGENT_URL=http://host.docker.internal:8642/v1
```

### Agent in its own container

Publish the agent's port on the Docker bridge only, then use the same
address as above:

```bash
docker run -d --name hermes -p 172.17.0.1:8642:8642 -e API_SERVER_HOST=0.0.0.0 ... <hermes image>
```

```ini
CHAT_AGENT_URL=http://host.docker.internal:8642/v1
```

(`API_SERVER_HOST=0.0.0.0` is inside the agent's container; the `-p` keeps
the port off every outside interface.)

### Bot on a VPS, agent on your PC (Tailscale)

A common setup: **the bot runs on a VPS, and the agent runs on your home
PC.** The VPS sends the question to your PC over [Tailscale](https://tailscale.com),
your PC's agent does the work, and the answer travels back to the VPS and
into WhatsApp. Nothing is opened to the internet. It works the same whether
the bot on the VPS runs in Docker or Local mode.

```
WhatsApp ⇄ HamBot on the VPS (Docker or Local) ──Tailscale──▶ agent on your PC
```

1. Install Tailscale on **both machines** (on the VPS: on the host itself,
   not in the bot's container) and sign in to the same tailnet.
2. On the PC, expose the agent to the tailnet only, and note its address:

   ```bash
   tailscale serve --bg --tcp 8642 tcp://localhost:8642     # Hermes; OpenClaw: 18789, or gateway.bind: "tailnet"
   tailscale ip -4                                           # e.g. 100.101.102.103
   ```

3. On the VPS, point the bot at it:

   ```ini
   CHAT_AGENT_URL=http://100.101.102.103:8642/v1
   ```

   Plain `http://` is fine here: Tailscale traffic is already encrypted
   (WireGuard). The bot refuses to send a key over plain http to any
   *public* address.
4. Optional: in the Tailscale admin console, add an ACL so only the VPS may
   reach that port.

**Things to know:**

- **The PC must be on.** When it sleeps, `.chat` would fail. Set a fallback,
  e.g. `CHAT_FALLBACK=provider`, and questions are answered there instead.
  The owner gets one message when the agent goes offline and one when it is
  back.
- **Docker mode: use the `100.x` address,** not the MagicDNS name
  (`pc.tailnet.ts.net`): inside containers those names often don't resolve.
  Tailscale on the host is enough; the container's traffic goes through it.
- **The reverse works too.** A bot at home can use a GPU model on a VPS the
  same way.

The bot-in-Docker paths are tested on every change: CI builds the image and
runs `scripts/docker-agent-test.sh`, which asks an agent on the host a real
question from inside the container (through `docker-compose.yml` and
`./deploy.sh chat test`), and checks that a loopback-only agent and a
`localhost` address fail with the fixes above.

## Files from the agent

An agent can send files back, not only text: a chart it plotted, a script
it wrote, a PDF. It marks each file with a line of its own in the answer
(Hermes Agent uses this convention already; any agent can be told to):

```text
Ini grafiknya.
MEDIA:/outbox/chart.png
```

With `CHAT_AGENT_MEDIA_DIR` set, HamBot takes those lines out of the text and
sends each file in the chat:

| File | Sent as |
| --- | --- |
| `png`, `jpg`, `jpeg` | image |
| `mp4` | video |
| `mp3`, `m4a`, `ogg`, `opus`, `wav` | audio |
| anything else (`py`, `pdf`, `zip`, `gif`, …) | a document, with its file name |

### The one requirement: HamBot must be able to read the files

The answer only carries a **path**. HamBot opens that path on its own machine,
so it must see the folder the agent writes to. **Reaching the agent over
Tailscale (or any network) shares its answers, not its files.** Pick one:

| Where the agent runs | How HamBot sees its files |
| --- | --- |
| Same machine, both without Docker | One plain folder both use |
| Same machine, either in Docker | A shared Docker volume or bind mount |
| Another machine (e.g. a home PC, over Tailscale) | Sync the folder to the bot's machine: Syncthing, `rsync`/`scp` on a schedule, an SMB/NFS share mounted on the bot's machine |

Whichever you pick, the agent must write `MEDIA:` paths **as HamBot sees them**.
The simplest way: the same path on both sides (e.g. `/outbox` in both
containers). If the paths differ, tell the agent HamBot's path.

### Rules

- **Opt-in.** It is off while `CHAT_AGENT_MEDIA_DIR` is empty, and only the
  agent backend's answers are read for `MEDIA:` lines.
- **One folder.** Only a regular file inside that folder (subfolders are fine)
  is ever sent:
  - the path is checked as written, then with every symlink resolved;
  - the comparison is exact, letter case included, on every OS.

  So `MEDIA:/app/.env`, `MEDIA:../../etc/passwd`, a folder that merely starts
  with the same name (`/outbox-old`), and a link in the folder pointing
  elsewhere are refused.
- **What that does not cover.** On Linux, a file or folder swapped for a link
  *between* the check and the read is refused as well. On macOS and Windows a
  program that rewrites the folder at that exact moment could slip past the
  check, so only let agents you already trust with those files write there.
- **Limits:**
  - at most `CHAT_AGENT_MEDIA_MAX_FILES` files per answer (default 5);
  - each file at most `MAX_MEDIA_SIZE` (default 64M);
  - a `MEDIA:` line inside a ``` code block is left as text.
- **Refused files:** the chat gets one short note ("1 file tidak terkirim (di
  luar folder outbox)"), and the log one line, e.g.
  `files: 2 sent, refused 1 outside`. File contents and paths are never logged.

### Set it up

**Permissions, on any setup:** the agent's user can **write** to the folder;
HamBot's user can **read** it. HamBot never writes there.

- In Docker, HamBot runs as UID `999`. Files the agent creates with the usual
  `0644` mode are readable by anyone, so this only matters for a restrictive
  umask: then give the folder a group both users share.
- Find the agent's user with `id` on its machine, or in its image docs
  (`docker run --rm --entrypoint id <agent image>`).

**Docker: a shared volume**

1. Create the volume once, owned by the agent's user (replace `UID:GID`):

   ```bash
   docker volume create agent-outbox
   docker run --rm -v agent-outbox:/outbox alpine chown UID:GID /outbox
   ```

2. Mount it writable in the agent's compose file, for example Hermes Agent:

   ```yaml
   services:
     hermes:            # or openclaw, or your agent's service
       volumes:
         - agent-outbox:/outbox
   volumes:
     agent-outbox:
       external: true
   ```

3. Mount it read-only in HamBot. Put this in a `docker-compose.override.yml`
   next to HamBot's `docker-compose.yml`, so updates never touch it:

   ```yaml
   services:
     hambot:
       volumes:
         - agent-outbox:/outbox:ro
   volumes:
     agent-outbox:
       external: true
   ```

4. In HamBot's `.env`: `CHAT_AGENT_MEDIA_DIR=/outbox`
5. Recreate the bot so it reads `.env` again: `docker compose up -d --force-recreate`

**Without Docker (Local mode):** create a folder the agent's user owns and
HamBot can read, and set `CHAT_AGENT_MEDIA_DIR` to its absolute path:

| OS | Example |
| --- | --- |
| Linux | `/srv/agent-outbox` |
| macOS | `/Users/Shared/agent-outbox` |
| Windows | `C:\agent-outbox` |

**Tell the agent.** Add the convention to its standing instructions (its system
prompt or persona file: `SOUL.md` for Hermes Agent, the agent's instructions
for OpenClaw). Back the file up first:

```text
When you make a file for the user (image, chart, script, document, archive),
save it in /outbox and put a line MEDIA:/outbox/<file name> on its own line
in your reply, one line per file, plus one sentence saying what it is.
```

Use the folder path HamBot sees in place of `/outbox`.

**Check it:**

- `.chat status` (owner) shows the folder on its "File agen" line.
- A wrong folder appears there, and in the startup log, as a config problem.
  The feature then stays off; the rest of `.chat` keeps working.

**Old files.** Nothing deletes them. To clear files older than a week:

```bash
# Docker volume
docker run --rm -v agent-outbox:/outbox alpine find /outbox -type f -mtime +7 -delete
# Linux / macOS folder
find /srv/agent-outbox -type f -mtime +7 -delete
```

```powershell
# Windows folder
Get-ChildItem C:\agent-outbox -Recurse -File | Where-Object LastWriteTime -lt (Get-Date).AddDays(-7) | Remove-Item
```

## Timeouts: silence, not slowness

Every request streams. A timeout means the AI **stopped responding**; it never
means "it took a long time". Two timers, per backend:

| Timer | Ends a request when | Settings (local / provider / agent defaults) |
| --- | --- | --- |
| Response timeout | Nothing at all comes back: no headers, no first event | `CHAT_*_RESPONSE_TIMEOUT_SEC` — 120 / 60 / 90 s |
| Idle timeout | An answer that had started goes quiet | `CHAT_*_IDLE_TIMEOUT_SEC` — 60 / 60 / 180 s |

Every piece of output restarts the idle timer:

- answer text;
- reasoning tokens;
- an agent's tool-progress events;
- keep-alive comments and pings.

So a model that thinks for five minutes, or an agent that works for twenty, is
an **active session** and is never cut off.

- **No total limit by default.** `CHAT_MAX_ACTIVE_MIN` adds an optional hard
  cap; `0` means none.
- **Partial answers.** If an answer stops halfway, the part that arrived is sent,
  marked as cut off.
- **Servers that cannot stream.** Use `CHAT_*_STREAM=false` for such a server.
  Only the response timeout applies then, so raise it to cover the whole
  answer.

## When a backend fails

The bot keeps a health state for each backend, so a broken one costs nothing
instead of a timeout on every message:

| What happened | What the bot does |
| --- | --- |
| Settings unusable at start (no URL, no model, a missing key, a key over plain http to the internet) | That backend is off before the first message; the startup log names the fix |
| Wrong key (401/403) or unknown model | Set aside at once, until the settings are fixed or `.chat test` passes. A wrong key never fixes itself. |
| Connection refused, no response, went silent, 5xx | Counted. After `CHAT_FAIL_THRESHOLD` (3) in a row it is set aside for `CHAT_RETRY_COOLDOWN_SEC` (30 s), doubling up to 10 minutes. While set aside, questions skip it **without waiting**. When the pause ends, one real question goes through as a probe. |
| 429 rate limit | A short `Retry-After` (≤ 10 s) gets one retry; otherwise it counts as a failure |

When a backend is set aside, questions go to `CHAT_FALLBACK` if you have one.
Otherwise people get a short "AI offline" reply and the owner sees why.

**Every failure is one log line that says what to fix,** in both log modes:

```
🤖 [.chat #a3f9] provider(openai) host=•••.openai.com model=gpt-x → 401 auth: HTTP 401 auth after 0.8s · set aside until fixed · trying local
       server: Incorrect API key provided
       fix: CHAT_PROVIDER_API_KEY is wrong, expired or lacks access (loaded key: 51 chars, fingerprint 3fa9c2d1)
🤖 [.chat #b71c] agent(hermes) host=100.101.•.• model=hermes-agent → no_response: no response within 90s after 90.0s · 2/3
       fix: the server accepted the connection but sent nothing — overloaded, or still loading the model? Raise CHAT_AGENT_RESPONSE_TIMEOUT_SEC if it is only slow to start
```

- **Never logged:** prompts, answers and keys. Hosts are masked.
- **Recent problems:** `.chat status` (for the owner) shows the latest error and
  its fix for each backend, and lists config problems.

## Security

- **Keys** come only from `.env`.
  - No chat command can set an address, a key or a header.
  - `.chat use` only picks among backends you already configured.
- **Where keys go:**
  - Keys travel only in request headers (Gemini's too, never in the URL).
  - Redirects are never followed, so a key cannot be sent on to another host.
  - A key is never sent over plain http to a public address.
- **Answers** are scrubbed of the bot's own secrets before they reach the chat.
  This catches an agent with file access that reads `.env`.
- **Logs, status and the security panel:**
  - Errors from providers are redacted before they are logged.
  - `.chat status` shows hosts masked and keys as a fingerprint.
  - `.security logs` redacts `CHAT_*_KEY` / `CHAT_*_TOKEN` like every other
    secret.
- **Agents** are owner-only unless you open them with `CHAT_AGENT_ACCESS`.
  With it open, anyone who may chat can make the agent run its tools.
- **Files from the agent** are only read from `CHAT_AGENT_MEDIA_DIR`; see
  [Files from the agent](#files-from-the-agent).
- **`.env` files** are written with owner-only permissions. The backup is
  `.env.bak`; it is ignored by git and kept out of the Docker image.

## Troubleshooting

`./deploy.sh chat test`, or `.chat test` from WhatsApp, runs the same check
and prints one fix per problem.

| Symptom | Fix |
| --- | --- |
| "AI chat belum dinyalakan" | `CHAT_ENABLED=true` (or `./deploy.sh chat`), then restart |
| `connection refused` | Is the server running? Ollama listens only on 127.0.0.1 unless `OLLAMA_HOST` is set; Hermes unless `API_SERVER_HOST` is. In Docker mode, `localhost` is the container: use `host.docker.internal` and have the server listen on the Docker bridge (`172.17.0.1`), or use the Tailscale IP. |
| `host name does not resolve` | Check the address. In Docker, use the `100.x` Tailscale IP instead of a MagicDNS name. |
| `no route to host` | Is the other machine on? `tailscale status` on both |
| `401 auth` | Wrong or expired key/token; the log shows the loaded key's fingerprint |
| `model … not found` | `.chat models` lists what exists; for Ollama, `ollama pull <model>` |
| `no response within …s` | The server accepted the connection but said nothing: overloaded, or loading a large model. Raise `CHAT_*_RESPONSE_TIMEOUT_SEC` if it is only slow to start. |
| `went silent` | The answer stopped mid-way. If your agent runs long silent tools, raise `CHAT_AGENT_IDLE_TIMEOUT_SEC`. |
| Empty answers from a reasoning model | Raise `CHAT_MAX_TOKENS`; the thinking counts towards it |
| `input too long` | `.chat reset`, or lower `CHAT_MEMORY_MAX_CHARS` / `CHAT_MAX_INPUT` |
| A backend stays "set aside" after you fixed it | `.chat test`: a passing check puts it back at once |
| The agent's files arrive as `MEDIA:` text | `CHAT_AGENT_MEDIA_DIR` is empty or was refused (see `.chat status`), or the answer came from another backend |
| "file tidak terkirim (di luar folder outbox)" | The agent saved the file outside the folder, wrote its own path where HamBot's differs (two containers mounting it at different paths), or spelled the folder in another letter case |
| "file tidak terkirim (tidak ditemukan)" | HamBot cannot see the file: an agent on another machine needs the folder synced or shared to the bot's machine ([above](#the-one-requirement-hambot-must-be-able-to-read-the-files)) |
| "file tidak terkirim (tidak bisa dibaca)" | Permissions: HamBot's user (UID 999 in Docker) must be able to read the files; the usual `0644` is fine |

## All settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `CHAT_ENABLED` | `false` | Master switch; the other settings are kept when off |
| `CHAT_BACKEND` | `local` | `local`, `provider` or `agent` |
| `CHAT_FALLBACK` | `none` | Second backend for when the main one is down |
| `CHAT_ACCESS` | `owner` | `owner`, `allowlist` or `public` |
| `CHAT_ALLOWED_USERS` | — | Numbers with country code and/or `@lid` IDs, comma-separated |
| `CHAT_AGENT_ACCESS` | `owner` | Who may reach the agent; never wider than `CHAT_ACCESS` |
| `CHAT_IN_GROUPS` / `CHAT_IN_PRIVATE` | `true` | Where `.chat` works |
| `CHAT_MAX_CONCURRENT` | `2` | Answers worked on at the same time (1-10) |
| `CHAT_QUEUE_MAX` | `3` | Questions that may wait for a slot; `0` = "busy" at once |
| `CHAT_QUEUE_WAIT_SEC` | `120` | Longest wait in the queue |
| `CHAT_COOLDOWN_SEC` | `5` | Per person, between questions |
| `CHAT_DAILY_LIMIT_ENABLED` | `false` | Enforce `CHAT_DAILY_LIMIT` |
| `CHAT_DAILY_LIMIT` | `20` | Questions per person per day |
| `CHAT_DAILY_LIMIT_OWNER` | `false` | Count the owner too |
| `CHAT_MAX_INPUT` | `6000` | Characters: question plus the replied-to message |
| `CHAT_MAX_TOKENS` | `2048` | Answer length cap (includes thinking on reasoning models) |
| `CHAT_MAX_PARTS` | `4` | WhatsApp messages one answer may fill |
| `CHAT_MAX_ACTIVE_MIN` | `0` | Optional hard cap per answer, minutes; `0` = none |
| `CHAT_SYSTEM_PROMPT` | built in | Instructions for the AI; `\n` for a new line |
| `CHAT_SYSTEM_PROMPT_FILE` | — | A file with the instructions (wins over the inline one) |
| `CHAT_TEMPERATURE` / `CHAT_TOP_P` | server default | Only sent when set |
| `CHAT_MEMORY_ENABLED` | `true` | Remember recent turns |
| `CHAT_MEMORY_TURNS` | `10` | Exchanges kept per person per chat |
| `CHAT_MEMORY_IDLE_MIN` | `30` | Forgotten after this much quiet |
| `CHAT_MEMORY_MAX_CHARS` | `12000` | History budget per request; oldest turns go first |
| `CHAT_MEMORY_MAX_CHATS` | `500` | Conversations held at once |
| `CHAT_QUOTED_CONTEXT` | `true` | Send the replied-to message along |
| `CHAT_SHOW_MODEL` | `true` | Footer with the model (and "via cadangan") |
| `CHAT_TYPING_INDICATOR` | `true` | Show "typing…" while it works |
| `CHAT_STRIP_THINKING` | `true` | Remove `<think>…</think>` blocks |
| `CHAT_FAIL_THRESHOLD` | `3` | Failures in a row before a backend is set aside |
| `CHAT_RETRY_COOLDOWN_SEC` | `30` | First pause; doubles up to 10 minutes |
| `CHAT_NOTIFY_OWNER` | `true` | Message the owner when a backend goes down or comes back |
| `CHAT_STARTUP_CHECK` | `true` | Probe the backends at startup (logged only) |
| `CHAT_LOCAL_API` | `ollama` | `ollama` or `openai` |
| `CHAT_LOCAL_URL` | `http://127.0.0.1:11434` | Local server address |
| `CHAT_LOCAL_MODEL` | — | Model name; setting it is what turns the local backend on |
| `CHAT_LOCAL_API_KEY` | — | Only if the server needs one |
| `CHAT_LOCAL_CONTEXT` | `8192` | Ollama `num_ctx` |
| `CHAT_LOCAL_KEEP_ALIVE` | `5m` | Ollama `keep_alive` |
| `CHAT_PROVIDER_API` | `openai` | `openai`, `anthropic` or `gemini` |
| `CHAT_PROVIDER_URL` | official | Base URL |
| `CHAT_PROVIDER_API_KEY` | — | Key (Gemini falls back to `GEMINI_API_KEY`) |
| `CHAT_PROVIDER_MODEL` | — | Model name |
| `CHAT_PROVIDER_HEADERS` | — | Extra headers as JSON |
| `CHAT_PROVIDER_USE_PROXY` | `false` | Route through the `PROXY_*` proxy |
| `CHAT_AGENT_PLATFORM` | `hermes` | `hermes`, `openclaw` or `openai` |
| `CHAT_AGENT_URL` | — | Agent base URL (e.g. a Tailscale address) |
| `CHAT_AGENT_TOKEN` | — | Hermes `API_SERVER_KEY` / OpenClaw gateway token |
| `CHAT_AGENT_ID` | default | OpenClaw agent id |
| `CHAT_AGENT_MODEL` | platform default | `hermes-agent`, `openclaw/<id>`, or what your agent expects |
| `CHAT_AGENT_MEMORY` | `bot` | `bot`: HamBot sends the history; `agent`: the agent keeps the session |
| `CHAT_AGENT_MEDIA_DIR` | — | Folder the agent saves files in; its `MEDIA:` lines are sent as files. Empty = off |
| `CHAT_AGENT_MEDIA_MAX_FILES` | `5` | Files per answer (1-10); each at most `MAX_MEDIA_SIZE` |
| `CHAT_*_STREAM` | `true` | Per backend; `false` only for servers that cannot stream |
| `CHAT_*_RESPONSE_TIMEOUT_SEC` | 120 / 60 / 90 | No response at all |
| `CHAT_*_IDLE_TIMEOUT_SEC` | 60 / 60 / 180 | Silence mid-answer |
