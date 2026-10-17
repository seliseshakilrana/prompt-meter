# prompt-meter-proxy

A local HTTP proxy that sits between your AI coding tools and the provider APIs. It passes every request through unchanged, reads token usage from each completed response, groups calls into prompts, and sends the usage events in batches to the prompt-meter ingest webhook.

```
Claude Code ── ANTHROPIC_BASE_URL ──────┐
Codex ──────── base_url ────────────────┤──► prompt-meter-proxy (127.0.0.1:8787) ──► provider APIs
agy ────────── GOOGLE_GEMINI_BASE_URL ──┘            │
                                                     └─ disk queue ─► POST <ingestUrl> (X-Ingest-Key)
```

Background and design: [../PLAN.md](../PLAN.md). Wire format: [../docs/ingest-contract.md](../docs/ingest-contract.md).

## Limitation: API-key mode only

The proxy only sees traffic from tools that call a provider API with an **API key** and let you change the base URL. Subscription sign-ins (Claude Pro/Max, ChatGPT sign-in, Antigravity signed in with Google, the Antigravity desktop app) talk to endpoints that can't be redirected, so they can't be measured here. Use manual entry in the portal for those.

## Install and build

Needs Node 20 or later.

```sh
cd proxy
npm install
npm run build
npm test
```

Run it:

```sh
node dist/cli.js start                  # or: npx prompt-meter-proxy start, after npm link
node dist/cli.js start --sink stdout    # print events instead of sending them (no webhook needed)
node dist/cli.js start --port 9000 --config ./my-config.json
```

## Routes

| Proxy path | Upstream (default) |
|---|---|
| `http://127.0.0.1:8787/anthropic/*` | `https://api.anthropic.com/*` |
| `http://127.0.0.1:8787/openai/*` | `https://api.openai.com/*` |
| `http://127.0.0.1:8787/gemini/*` | `https://generativelanguage.googleapis.com/*` |

`GET /__prompt-meter/health` returns `{"ok":true}`.

## Configuration

Default file: `~/.config/prompt-meter/config.json` (or `$XDG_CONFIG_HOME/prompt-meter/config.json`). Precedence: CLI flags, then environment variables, then the file, then defaults.

```json
{
  "host": "127.0.0.1",
  "port": 8787,
  "ingestUrl": "https://<blocks-host>/…/ingest",
  "defaultKey": "pm_a1b2c3d4_<32 chars>",
  "sendPreview": true,
  "keys": {
    "e5f6g7h8": { "sendPreview": false }
  },
  "upstreams": {
    "anthropic": "https://api.anthropic.com",
    "openai": "https://api.openai.com",
    "gemini": "https://generativelanguage.googleapis.com"
  },
  "queuePath": "~/.local/state/prompt-meter/queue.db",
  "sessionGapMinutes": 30,
  "flushIntervalMs": 10000,
  "batchSize": 50
}
```

- `keys` holds per-key settings, looked up by the key's 8-character prefix or by the full key. `sendPreview: false` means `promptPreview` is always `null` for that key.
- Environment variables: `PROMPT_METER_CONFIG`, `PROMPT_METER_HOST`, `PROMPT_METER_PORT`, `PROMPT_METER_INGEST_URL`, `PROMPT_METER_DEFAULT_KEY` (or `PROMPT_METER_KEY`), `PROMPT_METER_QUEUE_PATH`, `PROMPT_METER_ANTHROPIC_UPSTREAM`, `PROMPT_METER_OPENAI_UPSTREAM`, `PROMPT_METER_GEMINI_UPSTREAM`, `PROMPT_METER_SINK` (`ingest` or `stdout`), `PROMPT_METER_LOG_LEVEL` (`debug`, `info`, `warn`, `error`).
- **Choosing the key:** the request header `X-Prompt-Meter-Key` comes first, then `defaultKey`. The header is removed before the request goes upstream. With no key at all, events are dropped with a warning.
- Logs never show provider API keys or full ingest keys. Ingest keys appear only as `pm_<prefix>_…`.

## Pointing your tools at the proxy

### Claude Code (API key)

```sh
export ANTHROPIC_API_KEY=sk-ant-…
export ANTHROPIC_BASE_URL=http://127.0.0.1:8787/anthropic
export ANTHROPIC_CUSTOM_HEADERS="X-Prompt-Meter-Key: pm_a1b2c3d4_…"   # optional; otherwise defaultKey
claude
```

### Codex (API key)

Add a custom provider in `~/.codex/config.toml` whose base URL points at the proxy:

```toml
model_provider = "openai-metered"

[model_providers.openai-metered]
name = "OpenAI via prompt-meter"
base_url = "http://127.0.0.1:8787/openai/v1"
env_key = "OPENAI_API_KEY"
wire_api = "responses"
# optional, to pick a team key per provider:
# http_headers = { "X-Prompt-Meter-Key" = "pm_a1b2c3d4_…" }
```

### Antigravity CLI (`agy`, Gemini API key)

In agy's `settings.json` set `"modelProvider": "gemini"`, then:

```sh
export GEMINI_API_KEY=AIza…
export GOOGLE_GEMINI_BASE_URL=http://127.0.0.1:8787/gemini
agy
```

agy can't send a custom header, so its events use `defaultKey`.

## What it records

Only real generation calls with a 2xx response:

- Anthropic `POST /v1/messages` (not `count_tokens`, `models` or batches)
- OpenAI `POST /v1/responses` and `POST /v1/chat/completions`
- Gemini `POST …/models/<model>:generateContent` and `:streamGenerateContent` (SSE `alt=sse` and the JSON-array stream)

Each one becomes one event in the shape of the ingest contract. Token fields follow PLAN.md → *Token normalization*. Highlights:

- **Anthropic streaming:** input and cache counts from `message_start`, then overwritten by the **last** `message_delta.usage`. Its `output_tokens` is a running total and is never summed. Cache writes are split into 5-minute and 1-hour writes from `usage.cache_creation`. When that breakdown is missing, `cache_creation_input_tokens` counts as 5-minute writes.
- **OpenAI chat streaming** only carries usage when the client sets `stream_options.include_usage`. Without it nothing is recorded.
- `model` comes from the response. `eventId` is the provider's response id, or `pm_` + sha256(provider + model + occurredAt + totalInputTokens + outputTokens) when there is none.

### Verification status

| Adapter | Status |
|---|---|
| Anthropic (Claude Code) | Built against the API reference and the shapes in PLAN.md. Still needs the Phase 3 check against `claude -p --output-format json`. |
| OpenAI (Codex) | **Not yet verified against live responses.** Built from the public API reference. Phase 4. |
| Gemini (agy) | **Not yet verified against live responses.** Built from the public API reference. Phase 4: confirm that `candidatesTokenCount` doesn't already include `thoughtsTokenCount`. |

## Prompt grouping and previews

- A **new prompt** starts when the newest user message contains typed text, not just tool results. Tool-injected text (`<system-reminder>`, Codex `<environment_context>` and similar) doesn't count as typed. Resending the same request (same text, same message count) keeps the same prompt.
- **Background calls** (subagent/Task calls, title or topic generation, compaction, small side-model calls without tools) attach to the current prompt. The heuristics live in `src/heuristics/background.ts`.
- **sessionId** comes from Claude Code's `metadata.user_id` session part, or Codex's `session_id` header (unverified). Otherwise a new session starts after 30 minutes of inactivity, per provider and key.
- `callIndex` counts recorded calls within a prompt: 0, 1, 2, …
- **Preview:** the prompt's typed text with secret-looking text removed (API keys such as `sk-…`, `sk-ant-…`, `AIza…`, `ghp_…`, Bearer tokens, JWTs, private keys, `password=…`, long hex or base64 runs), whitespace collapsed, and cut to 100 characters. Every event of a prompt carries the same preview. It is `null` when previews are off for the key.
- Tool detection (`claude-code`, `codex`, `antigravity-cli`, `api`) is a User-Agent heuristic in `src/heuristics/tool.ts`.

## Delivery

- Each event is written to a SQLite queue (`better-sqlite3`, WAL, `synchronous=FULL`, file mode 0600) before anything is sent, so events survive restarts. The full ingest key is stored with each event, so events that arrived with a header key can still be sent after a restart.
- Batches are per ingest key. A key's batch goes out when it has 50 events, or when its oldest event has waited 10 seconds. A batch holds at most 100 events and 256 KB.
- **200:** the whole batch is removed. Rejected events are logged.
- **400 / 413:** the batch is split in half and retried. A single event that is still refused is logged and dropped.
- **401:** the events are kept and that key is paused until the proxy restarts. Fix the key, then restart.
- **429 / 5xx / network error:** the events are kept and retried with backoff: 1 s, doubling, capped at 5 min, with jitter. A 429's `retryAfterSeconds` is honoured.
- Retries can resend an `eventId` the server already stored. The server skips duplicates.

## Layout

```
src/
  cli.ts            command line
  app.ts            wires config, queue, sender and server together
  config.ts         config file, env and flags
  proxy.ts          passthrough server, side copies, recording
  adapters/         anthropic.ts, openai.ts, gemini.ts
  heuristics/       tool.ts, background.ts, typed-text.ts
  grouping.ts       sessions, prompts, callIndex
  redact.ts         preview cleaning
  queue.ts          SQLite disk queue
  sender.ts         batching, retries, backoff
  sinks.ts          queue sink, stdout sink
test/               vitest suites with mock upstream and ingest servers
```
