# Ingest contract (proxy → Blocks ingest webhook)

The single source of truth for what `prompt-meter-proxy` sends and what the ingest workflow accepts. Both sides must match it exactly. Background: [PLAN.md](../PLAN.md).

## Request

`POST <ingest webhook URL>`

Headers:
- `Content-Type: application/json`
- `X-Ingest-Key: pm_<prefix>_<secret>`. Read it case-insensitively.

Body:

```json
{
  "collector": { "name": "prompt-meter-proxy", "version": "0.1.0" },
  "events": [
    {
      "eventId": "msg_01ABC…",
      "tool": "claude-code",
      "provider": "anthropic",
      "model": "claude-opus-5-5",
      "sessionId": "string or null",
      "promptId": "string",
      "callIndex": 0,
      "totalInputTokens": 0,
      "uncachedInputTokens": 0,
      "cacheReadTokens": 0,
      "cacheWrite5mTokens": 0,
      "cacheWrite1hTokens": 0,
      "outputTokens": 0,
      "thinkingTokens": null,
      "serverToolRequests": 0,
      "speed": "standard",
      "promptPreview": "string (≤100 chars, already cleaned) or null",
      "projectTag": "string or null",
      "occurredAt": "2026-10-17T09:30:00.000Z"
    }
  ]
}
```

Field rules:
- `eventId`: the provider's response ID (Claude `msg_…`, OpenAI `resp_…` / `chatcmpl-…`, Gemini `responseId`). If the provider gives none, the proxy builds a stable one as `sha256(provider + model + occurredAt + totalInputTokens + outputTokens)`, prefixed `pm_`.
- `tool`: one of `claude-code`, `codex`, `antigravity-cli`, `api`, `other`.
- `provider`: one of `anthropic`, `openai`, `google`.
- `model`: the model named in the **response**, not the request.
- **Token fields:** whole numbers ≥ 0, normalized as in PLAN.md → *Token normalization*. `thinkingTokens` may be `null` when the provider doesn't report it.
- `speed`: `standard`, `fast`, or `null`.
- `occurredAt`: an ISO 8601 UTC timestamp, taken when the proxy finished reading the response.
- **The proxy never sends** `userId`, `teamId`, `costUsd`, `source` or `pricingStatus`. The workflow sets them. If any of them arrive, they are ignored.

## Ingest key

- **Format:** `pm_` + an 8-character lowercase alphanumeric **prefix** + `_` + a 32-character base62 **secret**. Example: `pm_a1b2c3d4_<32 chars>`.
- **Storage:** `keyPrefix` holds the 8-character prefix, and `keyHash` holds the lowercase hex SHA-256 of the **full** key string.
- **Lookup:** find the IngestKey by `keyPrefix`, then compare hashes in constant time.

## Limits

- At most **100 events** and **256 KB** per request.
- The proxy sends a batch every **10 s** or every **50 events**, whichever comes first.

## Responses

| Status | When | Body |
|---|---|---|
| 200 | Batch processed (some events may be duplicates or rejected) | `{ "accepted": n, "duplicates": n, "rejected": [{ "eventId": "…", "reason": "…" }] }` |
| 400 | Body isn't valid JSON, or `events` is missing | `{ "error": "…" }` |
| 401 | Key missing, unknown, wrong hash, revoked, or its owner left the team | `{ "error": "invalid_key" }` |
| 413 | Over 100 events or 256 KB | `{ "error": "too_large" }` |
| 429 | Rate limit for this key exceeded | `{ "error": "rate_limited", "retryAfterSeconds": n }` |

What the proxy does with each status:
- **200:** removes accepted, duplicate and rejected events from its queue. Rejected events are logged locally.
- **400 / 413:** splits the batch, or logs and drops events that are malformed.
- **401:** keeps the events and stops sending until the key is fixed.
- **429 / 5xx / network error:** keeps the events and retries with exponential backoff (1 s, doubling, capped at 5 min, with jitter).

## Choosing the key (proxy side)

1. A request header `X-Prompt-Meter-Key`, sent by the tool. Claude Code can send it through `ANTHROPIC_CUSTOM_HEADERS`. The proxy **removes this header** before forwarding upstream.
2. Otherwise, the default key from the proxy's config file.
