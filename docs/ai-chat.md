# AI chat (`.chat`)

`.chat` lets people talk to an AI from WhatsApp. HamBot passes the question
on to an AI and sends the answer back to the chat. You choose where the
questions go:

| Backend | What it is | Good for |
| --- | --- | --- |
| **Local model** | Ollama, LM Studio, llama.cpp, vLLM, LocalAI, Jan | Free and private, if the machine can run a model |
| **API provider** | Any OpenAI-compatible API (OpenAI, OpenRouter, Groq, DeepSeek, Mistral, Together, …), Anthropic (Claude), Google Gemini | Strong models with nothing to install |
| **Agent platform** | [Hermes Agent](https://hermes-agent.nousresearch.com), [OpenClaw](https://docs.openclaw.ai), or any agent with an OpenAI-style API | An assistant that can use tools, on this machine or another one on your Tailscale network |

All settings live in `.env`. Keys stay there too: the bot never puts them in
a chat message or a log line.

- [Set it up](#set-it-up)
- [Using it](#using-it)
- [Who may use it, and how much](#who-may-use-it-and-how-much)
- [Local model](#local-model) · [API provider](#api-provider) · [Agent platform](#agent-platform)
- [Across machines with Tailscale](#across-machines-with-tailscale)
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
  - Each person has one question in progress at a time.
  - AI chat has its own slots, so it never holds up `.video` or `.music`.
- **The daily limit** is off unless `CHAT_DAILY_LIMIT_ENABLED=true`.
  - It resets at midnight in `BOT_TIMEZONE`.
  - It survives a restart.
  - The owner is not counted unless `CHAT_DAILY_LIMIT_OWNER=true`.
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
file maps it to the host), and make the server listen beyond loopback. For
Ollama that is `OLLAMA_HOST=0.0.0.0` in its service settings. The wizard
offers the right address.

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
  `CHAT_AGENT_IDLE_TIMEOUT_SEC` defaults to 180 seconds. Hermes sends
  keep-alives while it works.

## Across machines with Tailscale

The agent or model does not have to run where the bot does. A common setup:
**the bot runs on a VPS, and the agent runs on your home PC.** The VPS sends the
question to your PC over [Tailscale](https://tailscale.com), your PC's agent
does the work, and the answer travels back to the VPS and into WhatsApp.
Nothing is opened to the internet.

```
WhatsApp ⇄ HamBot (VPS) ──Tailscale──▶ agent on your PC (127.0.0.1:8642)
```

1. Install Tailscale on both machines and sign in to the same tailnet.
2. On the PC, expose the agent to the tailnet only:

   ```bash
   tailscale serve --bg --tcp 8642 tcp://localhost:8642     # Hermes; OpenClaw: 18789
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

- **The PC must be on.** When it sleeps, `.chat` would fail. Set a fallback, e.g.
  `CHAT_FALLBACK=provider`, and questions are answered there instead. The
  owner gets one message when the agent goes offline and one when it is back.
- **Docker mode.** MagicDNS names (`pc.tailnet.ts.net`) often don't resolve
  inside containers; use the `100.x` address. Tailscale on the host is
  enough: the container's traffic is routed through it.
- **The reverse works too.** A bot at home can use a GPU model on a VPS the
  same way.
- **Same machine, Docker mode.** `http://host.docker.internal:PORT` works if the
  agent listens beyond loopback. Otherwise use `tailscale serve` as above with
  the machine's own `100.x` address.

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
- **`.env` files** are written with owner-only permissions. The backup is
  `.env.bak`; it is ignored by git and kept out of the Docker image.

## Troubleshooting

`./deploy.sh chat test`, or `.chat test` from WhatsApp, runs the same check
and prints one fix per problem.

| Symptom | Fix |
| --- | --- |
| "AI chat belum dinyalakan" | `CHAT_ENABLED=true` (or `./deploy.sh chat`), then restart |
| `connection refused` | Is the server running? Ollama listens only on 127.0.0.1 unless `OLLAMA_HOST=0.0.0.0`; Hermes unless `API_SERVER_HOST` is set. In Docker mode, `localhost` is the container: use `host.docker.internal` or the Tailscale IP. |
| `host name does not resolve` | Check the address. In Docker, use the `100.x` Tailscale IP instead of a MagicDNS name. |
| `no route to host` | Is the other machine on? `tailscale status` on both |
| `401 auth` | Wrong or expired key/token; the log shows the loaded key's fingerprint |
| `model … not found` | `.chat models` lists what exists; for Ollama, `ollama pull <model>` |
| `no response within …s` | The server accepted the connection but said nothing: overloaded, or loading a large model. Raise `CHAT_*_RESPONSE_TIMEOUT_SEC` if it is only slow to start. |
| `went silent` | The answer stopped mid-way. If your agent runs long silent tools, raise `CHAT_AGENT_IDLE_TIMEOUT_SEC`. |
| Empty answers from a reasoning model | Raise `CHAT_MAX_TOKENS`; the thinking counts towards it |
| `input too long` | `.chat reset`, or lower `CHAT_MEMORY_MAX_CHARS` / `CHAT_MAX_INPUT` |
| A backend stays "set aside" after you fixed it | `.chat test`: a passing check puts it back at once |

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
| `CHAT_*_STREAM` | `true` | Per backend; `false` only for servers that cannot stream |
| `CHAT_*_RESPONSE_TIMEOUT_SEC` | 120 / 60 / 90 | No response at all |
| `CHAT_*_IDLE_TIMEOUT_SEC` | 60 / 60 / 180 | Silence mid-answer |
