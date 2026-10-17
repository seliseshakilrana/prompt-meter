# prompt-meter — Build Plan

**Goal:** a web portal that tracks tokens and cost per prompt across AI coding tools, for individuals and teams.

**Status:** planning. Nothing has been executed against the Blocks project yet. Reviewed on 2026-10-17 by Claude Code and Antigravity CLI (see [Review log](#review-log-2026-10-17)).

## Decisions

| Topic | Decision |
|---|---|
| Users | Individuals and teams. A team is a Blocks organization (multi-org), and everyone also has a personal team. |
| My usage | Each person sees all of their own data |
| Team usage | Members see team totals only. Team admins also see each person's usage. |
| Prompt detail | Numbers plus a ~100-character prompt preview that only its owner can read, admins included |
| Collector | A local proxy (no log import), written in TypeScript (Node), with one adapter per provider: Claude, OpenAI, Gemini |
| What can be measured | Tools running on an **API key**: Claude Code (`ANTHROPIC_BASE_URL`), Codex (custom `base_url`), Antigravity CLI (`GOOGLE_GEMINI_BASE_URL`). Subscription sign-ins (Claude Pro/Max, ChatGPT, Google) can't be proxied. Those use manual entry and optional quota snapshots. |
| Antigravity | Through the proxy when `agy` runs on a Gemini API key. Manual entry when signed in with Google, and for the desktop app. See [Antigravity](#antigravity-verified-2026-10-17). |
| Platform | SELISE Blocks project `D056c99a5cd2a47b4bcf702d8874cf280` (dev, `https://dbbvxg-eptqw.slsblx.com`), deployed from `seliseshakilrana/prompt-meter` |
| Subscription usage | Entered by hand and labeled **Manual** everywhere it appears (entries, charts, totals) |
| Personal team | Created automatically on a user's first login if they don't have one |
| Leaving a team / revoked key | Their past events are kept and still count toward team history. They lose access to team data, and a revoked key is rejected from then on. |
| Time | Everything is **stored and counted in UTC**. The portal **shows dates and times in the viewer's local timezone**, so "today" and daily charts follow the viewer's own day. |

---

## Architecture

```
Tools (API-key mode)
  Claude Code ─ANTHROPIC_BASE_URL─┐
  Codex ─────── base_url ─────────┤
  agy ───── GOOGLE_GEMINI_BASE_URL┤
                                  ▼
              prompt-meter-proxy (local, TypeScript)
               • passes every request through unchanged
               • adapters read usage → common event shape
               • disk queue + retry, sends batches
                                  │ POST /ingest (batch) + X-Ingest-Key
                                  ▼
              Blocks Workflow: ingest webhook
               • checks key, sets userId/teamId, cleans preview
               • computes cost, inserts UsageEvent (no duplicates)
                                  │
              Blocks Data (schemas + row/column access rules)
                                  ▲
              Blocks Workflow: scheduled rollup (e.g. every 5 min)
               • rebuilds UserHourly + TeamHourly from UsageEvent
                                  ▲
              Portal (React, blocks new web, Blocks login) + manual entry
```

Why the work is split this way: the Blocks workflow guide says workflows are not for *high-throughput* or *transactional multi-step* work. One typed prompt in Claude Code causes many API calls. So the proxy **sends events in batches**, the ingest workflow only inserts, and the totals are **rebuilt on a schedule**. A per-event read-modify-write would lose counts when two events arrive together.

## Data model

| Schema | Fields |
|---|---|
| **UsageEvent** | eventId (provider response id, e.g. `msg_…`, **unique index**), userId, teamId, tool, provider, model (taken from the **response**), sessionId, promptId, callIndex, totalInputTokens, uncachedInputTokens, cacheReadTokens, cacheWrite5mTokens, cacheWrite1hTokens, outputTokens, thinkingTokens, serverToolRequests, speed, costUsd, pricingStatus (`priced` / `unpriced`), promptPreview, projectTag, occurredAt (collector), receivedAt (server) |
| **UserHourly** | userId, teamId, hourStart (UTC, top of the hour), tool, model, source (`proxy` / `manual`), token totals, costUsd, eventCount, promptCount |
| **TeamHourly** | teamId, hourStart (UTC), tool, model, source, token totals, costUsd, eventCount |
| **IngestKey** | userId, teamId, label, keyPrefix (shown, used for lookup), keyHash, sendPreview (on/off), lastUsedAt, revoked |
| **ModelPrice** | provider, model, effectiveFrom, inputPer1M, outputPer1M, cacheReadPer1M, cacheWrite5mPer1M, cacheWrite1hPer1M, longContextThreshold, longContextInputPer1M, longContextOutputPer1M, fastMultiplier, webSearchPerRequest |
| **Budget** | scope (user or team), scopeId, monthlyLimitUsd, alertPercent |
| **QuotaSnapshot** *(optional)* | userId, teamId, tool, quotaName, percentUsed, resetsAt, capturedAt. For subscriptions that report quota but not tokens. |

Rules:
- **Cost is computed when an event arrives and stored on it.** Later price changes don't rewrite history. An event for a model with no price is stored as `unpriced` and priced later by a re-pricing job.
- **No duplicates:** `eventId` is unique, so a retried batch never counts twice.
- **Ownership comes from our own fields.** Blocks adds system fields (`CreatedBy`, `OrganizationId`, …) itself, but webhook-written records won't name the person in `CreatedBy`. Ownership comes from `userId` / `teamId`, which the workflow sets from the ingest key. The collector never sends them.
- **Usage is self-reported.** Collectors run on users' own machines, so usage can be under-counted. Budgets alert people. They don't enforce limits.
- **Manual entries** are UsageEvents with `source: manual` and no provider `eventId`; the portal generates one. They show the **Manual** label wherever they appear.

## Time and timezones

- **Stored in UTC:** every timestamp (`occurredAt`, `receivedAt`, `hourStart`, `resetsAt`) is UTC.
- **Totals are hourly, not daily.** The rollups hold one row per **UTC hour**. A UTC day doesn't line up with a local day (in Dhaka, UTC+6, a local day runs 18:00–18:00 UTC), so daily rows in UTC would put the wrong usage into "today".
- **The portal builds local days.** It takes the viewer's timezone from the browser and groups hourly rows into local days, weeks and months. Ranges such as "today" become UTC start and end times in the query.
- **Half-hour timezones are slightly off at day edges.** Places such as India (UTC+5:30) and Nepal (UTC+5:45) have local days that don't start on a UTC hour. Hourly totals put up to 45 minutes of usage near midnight into the neighbouring day. Small enough for charts. If exact numbers are needed, count those edge hours from raw events.
- **Budgets use calendar months in UTC,** so a team's budget is the same for everyone wherever they are. The portal shows that window in the viewer's local time.
- **Settings:** an optional timezone override, for people whose browser timezone is wrong.

## Token normalization (per adapter)

Every adapter fills the same fields, so totals compare like with like:

| Field | Claude (Messages API) | OpenAI (Responses API, Codex) | Gemini (`agy`, Gemini API) |
|---|---|---|---|
| totalInputTokens | `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` | `input_tokens` | `promptTokenCount` (already includes cached) |
| uncachedInputTokens | `input_tokens` | `input_tokens − input_tokens_details.cached_tokens` | `promptTokenCount − cachedContentTokenCount` |
| cacheReadTokens | `cache_read_input_tokens` | `input_tokens_details.cached_tokens` | `cachedContentTokenCount` |
| cacheWrite5m / 1h | `usage.cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens` | — | — |
| outputTokens | `output_tokens` (includes thinking) | `output_tokens` (includes reasoning) | `candidatesTokenCount + thoughtsTokenCount` (thinking billed as output) |
| thinkingTokens | `output_tokens_details.thinking_tokens` if present | `output_tokens_details.reasoning_tokens` | `thoughtsTokenCount` |
| Where it arrives when streaming | `message_start.usage` (input and cache) + **last** `message_delta.usage` (`output_tokens` is a running total, don't add them up). `message_stop` has none. | `response.completed` event | usage in the final chunk |

Notes:
- **Check the OpenAI and Gemini columns against live responses in Phase 4.** Only the Claude column has been checked so far, against the API reference and a real Claude Code run.
- **Claude Code uses 1-hour cache writes** (seen in a real run), which are priced at about 2× input. Pricing them as 5-minute writes would under-count cost.
- **`agy --output-format json` reports `total_tokens = input_tokens + output_tokens`**, with cache reads left out (seen: 44,964 + 1,958 = 46,922). Never use `total_tokens` directly. Whether `thinking_tokens` is part of `output_tokens` still needs checking.

## Proxy requirements (`prompt-meter-proxy`)

- **Pass everything through unchanged.**
  - Every path and all headers, including `x-api-key`, `Authorization: Bearer`, `anthropic-beta` and `anthropic-version`.
  - Stream responses chunk by chunk with no buffering.
  - Don't break compressed responses: leave `accept-encoding` alone and decompress a copy for reading.
- **Only record real usage:** generation calls such as `/v1/messages` and `/v1/responses`. Never record `count_tokens` or `models` calls.
- **Group calls into prompts.**
  - A new `promptId` starts when the newest user message contains typed text, not just tool results.
  - The preview comes from that newest typed text block.
  - `sessionId` comes from the tool's session marker if it sends one (Claude Code `metadata.user_id`: check in Phase 3), otherwise from a gap-in-time heuristic.
- **Never lose an event.** Hold events in a disk queue (SQLite) and retry with backoff. Send in batches every ~10 s, or every 50 events.
- **Choose the team key** per project folder (a `.prompt-meter` file) or per shell (the `PROMPT_METER_KEY` environment variable), with a default key for everything else.
- **Clean the preview twice.** The proxy removes secret-looking text before sending, and the workflow repeats it. When `sendPreview` is off, no preview is sent.
- **Local TLS is optional.** Plain `http://127.0.0.1` is enough for the tools above. Add a locally trusted certificate only if a tool refuses plain http.

## Access rules (enforced in Blocks, not just hidden in the portal)

| Data | Owner | Team member | Team admin | Platform admin |
|---|---|---|---|---|
| UsageEvent rows | ✅ | ❌ | ✅ | ✅ |
| `promptPreview` field | ✅ | ❌ | ❌ | ❌ |
| UserHourly | ✅ own | ❌ | ✅ team | ✅ |
| TeamHourly (team totals) | ✅ | ✅ | ✅ | ✅ |
| IngestKey | ✅ own | ❌ | ❌ | ❌ (the ingest workflow reads it) |
| Budget | read own | read team | read + edit team | ✅ |
| QuotaSnapshot | ✅ own | ❌ | ✅ team | ✅ |
| ModelPrice | read | read | read | read + edit |

- Members get team totals from **TeamHourly**, and admins get per-person numbers from **UserHourly**, so neither needs raw rows for dashboards.
- **If column rules can't hide `promptPreview` from admins,** move previews to a separate `UsagePreview` schema (eventId, userId, preview) that only the owner can read.

## Ingest design

- **Collector request:** sends `POST /ingest` with a **batch** of events and the header `X-Ingest-Key`.
- **The webhook has no Blocks login of its own** (`authType: none`). The workflow:
  1. finds the key by `keyPrefix`, checks `keyHash`, and rejects revoked keys
  2. sets `userId` and `teamId` from the key, ignoring anything the client sends for them
  3. cleans the preview, or drops it when `sendPreview` is off
  4. looks up ModelPrice by model and date, and computes `costUsd` or marks the event `unpriced`
  5. inserts the events and skips any `eventId` already stored
- **Limits:** a maximum batch size and body size, and a rate limit per key.
- **Rollup:** a **scheduled** workflow rebuilds UserHourly and TeamHourly for the UTC hours touched since its last run. If an event arrives late, the next run fixes the totals.

---

## Phases

### Phase 0: Platform setup

Every command is run as `--dry-run` first, and with `--yes` only after approval.

| # | Task | Command |
|---|---|---|
| 0.1 | Create a public OIDC client for the portal | `blocks auth oidc-clients save …` |
| 0.2 | Switch on login | `blocks auth config save --oidc-enabled …` |
| 0.3 | Switch on multi-org | `blocks iam organizations config save --multi-org-enabled` |
| 0.4 | Create the `platform-admin`, `team-admin` and `member` roles | `blocks iam roles create --name …` |
| 0.5 | Create the first team, and confirm the portal will be allowed to create a personal team on a user's first login (organization permissions and signup settings) | `blocks iam organizations create --name …` |
| 0.6 | Create the first user, as platform-admin and team-admin | `blocks iam users create …` |

**Done when:** a real login works through the hosted login page.

### Phase 1: Portal skeleton

- [ ] Scaffold with `blocks new web prompt-meter-web` (dry run, then run) and set up local HTTPS.
- [ ] Write the schemas and access rules in `blocks/data/`, with a unique index on `UsageEvent.eventId`, then push them with `blocks data sync` (dry run, then run).
- [ ] Load ModelPrice with current Claude, OpenAI and Gemini rates, including the cache-write, long-context, fast-mode and web-search columns.
- [ ] First-login step: create the user's personal team if they don't have one.
- [ ] Build the **My usage** overview from a small set of sample events, showing times in the viewer's local timezone. Test with the browser set to UTC+6 and UTC+5:30.
- [ ] Decide whether to remove the leftover localization data (`todoApp` modules and test languages) from another project.

**Done when:** you log in and see charts drawn from sample data.

### Phase 2: Ingest

- [ ] **Spike first (about 1 day).** Check in a test workflow:
  - Can a code node hash the key?
  - Which identity does a workflow write data as, and can that identity read IngestKey?
  - Do row rules on `userId` and column rules on `promptPreview` behave as planned, including for admins? If not, fall back to the `UsagePreview` schema.
  - Does a duplicate `eventId` get skipped by the unique index?
  - How many batched calls per minute can one webhook take?
  - Can a scheduled workflow rebuild the hourly totals?
  - **If several of these fail,** replace the workflow with a small ingest service.
- [ ] Build the ingest workflow and the rollup workflow, and import both with `blocks logic workflow import` (dry run, then run).
- [ ] Settings page: create and revoke ingest keys, showing each key once.

**Done when:**
- A batched `curl` with a valid key creates events.
- Resending the same batch creates no duplicates.
- A bad or revoked key gets a 401.
- The totals update after the next rollup.

### Phase 3: Claude collector

- [ ] The `prompt-meter-proxy` core: pass everything through, disk queue, batching, choosing a key (see [Proxy requirements](#proxy-requirements-prompt-meter-proxy)).
- [ ] Claude adapter. Claude Code points at the proxy through `ANTHROPIC_BASE_URL` (API-key mode).
- [ ] Grouping calls into prompts, and checking whether Claude Code sends a session marker.

**Done when:** a Claude Code session's **token counts** (not dollar amounts) match `claude -p … --output-format json` `usage` for the same work. Prices can differ from Claude Code's own table.

### Phase 4: Codex, Antigravity and manual entry

- [ ] OpenAI adapter. Codex points at the proxy through its custom provider `base_url` (API-key mode). Check the normalization table against live responses.
- [ ] Gemini adapter. Antigravity CLI (`agy`) points at the proxy with `modelProvider: "gemini"` in its `settings.json`, `GEMINI_API_KEY`, and `GOOGLE_GEMINI_BASE_URL=<proxy>`. Check the normalization table against live responses and against `agy -p … --output-format json` `usage`.
- [ ] Test the Gemini route against the installed `agy` version. Custom-endpoint support is recent, and related fixes have shipped since.
- [ ] A manual entry form in the portal for subscription sign-ins (Antigravity with Google, Claude Pro/Max, ChatGPT), the Antigravity desktop app, and anything else. The user enters the date and time in their local timezone, and it's stored in UTC. Entries carry the **Manual** label.
- [ ] *(Optional)* Quota snapshots from `agy -p "/usage"` (JSON output, timestamps in UTC), posted as QuotaSnapshot. Check first that it reports quota without spending model tokens.

**Done when:** a Codex session and an `agy` session using an API key both show up with token counts that match each tool's own report.

### Phase 5: Team features

- [ ] **Team usage** page from TeamHourly, plus the per-person table for admins from UserHourly.
- [ ] **Team admin** page: invite members and assign roles.
- [ ] Budgets: the rollup workflow checks budgets and sends an email (Blocks mail) when a threshold is crossed. Budgets alert people. They don't enforce limits.

### Phase 6: Ship it

- [ ] Deploy to `https://dbbvxg-eptqw.slsblx.com` with `blocks release setup` (dry run, then run).
- [ ] Collector install guide on the Settings page, with the setup for each tool.

---

## Portal pages

| Page | Who | Content |
|---|---|---|
| My usage | Everyone | Today, this week and this month in tokens and $, trends, breakdown by tool, model and project, prompt and session drill-down with previews. Covers all teams or one. |
| Team usage | Members | Team totals and breakdown by tool and model |
| Team usage: people | Team admins | Per-person table |
| Team admin | Team admins | Members, roles, team budgets |
| Prices | Everyone reads, platform admins edit | ModelPrice table and unpriced models |
| Settings | Everyone | Ingest keys (one per team), preview on/off, collector setup |

## Risks to check early

| Risk | Check in / fallback |
|---|---|
| Workflow can't hash keys, can't read IngestKey, or writes data as an unexpected identity | Phase 2 spike. Fallback: a small ingest service. |
| Row or column rules don't behave as planned | Phase 2 spike. Fallback: a separate `UsagePreview` schema. |
| Workflow throughput too low for Claude Code's call volume | Batching in the proxy, and checked in the Phase 2 spike. Fallback: an ingest service. |
| Totals drift because of late or retried events | Hourly totals are rebuilt on a schedule, and retries can't create duplicates (unique `eventId`) |
| Local days don't line up with UTC days | Hourly UTC totals grouped into local days in the browser. Half-hour timezones can be off by up to 45 minutes at day edges. |
| Lost events (network down, proxy restarts) | Disk queue with retries |
| Previews leaking secrets | Cleaned in both the proxy and the workflow, with a per-key off switch |
| Wrong costs from missing price details | Cache-write kinds, long context, fast mode and web search are all priced. Unknown models are marked `unpriced`. |
| Provider prices change | ModelPrice is dated by effective-from, and costs are stored on each event when it arrives |
| Each provider counts tokens differently | Normalization table. Store whatever providers report and never re-tokenize. |
| Subscription sign-ins can't be proxied (Claude Pro/Max, ChatGPT, Google) | Manual entry and quota snapshots, labeled **Manual** |
| Usage is self-reported and can be under-counted | Documented. Budgets alert people and don't enforce limits. |
| Antigravity's custom-endpoint route is new and could change | Phase 4 test against the installed `agy` version. Manual entry stays as the fallback. |
| Leftover localization data from another project | Phase 1 decision |

## Antigravity (verified 2026-10-17)

Checked against the installed `agy` 1.3.6 (its changelog), a live `agy -p --output-format json` run, and public sources.

| Way of measuring | Usable? | Notes |
|---|---|---|
| Proxy, with `agy` on a Gemini API key | ✅ | Officially supported. The changelog says: set `modelProvider: "gemini"`, export `GEMINI_API_KEY`, and point `GOOGLE_GEMINI_BASE_URL` at a custom endpoint. Bills to Gemini API pay-as-you-go, not the subscription. |
| Proxy, with `agy` signed in with Google | ❌ | No endpoint override. The plan is flat-rate, so there's no per-token bill. |
| `agy -p … --output-format json` | ✅ scripted runs only | Returns `usage`: `input_tokens`, `output_tokens`, `thinking_tokens`, `cache_read_tokens`, `total_tokens` (total leaves out cache reads). Interactive sessions don't. |
| `/usage` | ⚠️ | Quota percentage and reset time only. The changelog describes `-p "/usage"` output, with UTC timestamps in JSON. |
| Hooks | ❌ | Their data includes no token counts |
| OpenTelemetry (`OTEL_*`) | ❌ | Does nothing. Feature request [#366](https://github.com/google-antigravity/antigravity-cli/issues/366) is still open. |
| Local conversation files | ❌ | Undocumented internal format that can change with any release |
| Antigravity desktop app | ❌ | No proxy or endpoint setting. Only unofficial patches. Use manual entry. |

## Review log (2026-10-17)

The plan was reviewed read-only by Claude Code (`claude -p`, plan mode) and Antigravity CLI (`agy -p`, plan mode, sandboxed).

**Taken into the plan:**
- **Streaming usage:** where it arrives.
- **Token totals:** each adapter maps its provider's numbers to a common meaning.
- **Prices:** the two cache-write kinds, long context, fast mode and web search.
- **Grouping:** calls grouped into prompts.
- **Rollups:** batching plus scheduled rollups instead of per-event updates in the workflow. The Blocks workflow guide rules out high-throughput and transactional work.
- **Reliability:** the disk queue, retries and no-duplicate event IDs.
- **Keys:** choosing a team key per folder or shell.
- **ModelPrice:** only platform admins can edit it.
- **Webhook:** rate and size limits.
- **Gaps filled:** access rules for every table, unpriced models, UTC dates, the self-reporting caveat, and the subscription-sign-in limit for every tool.

**Rejected, because the evidence says otherwise:**

| Claim | Why it was rejected |
|---|---|
| "The variable is `GEMINI_BASE_URL`, not `GOOGLE_GEMINI_BASE_URL`" | The installed `agy` changelog names `GOOGLE_GEMINI_BASE_URL` |
| "`-p "/usage"` sends the text to the model" | The changelog describes `-p "/usage"` output. It's still re-checked in Phase 4 before relying on it. |
| "Blocks has no column-level rules" | The Blocks docs define them (`policyType: 1`). The fallback design is kept in case they don't work as needed. |

## Rough effort

| Scope | Estimate |
|---|---|
| Phases 0–2 (working portal fed by curl) | 4–5 days |
| Phase 3 | 2–3 days |
| Phases 4–6 | ~1–1.5 weeks |
