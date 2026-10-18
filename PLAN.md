# prompt-meter — Build Plan

**Goal:** a web portal that tracks tokens and cost per prompt across AI coding tools, for individuals and teams.

**Status (2026-10-17):** Phase 0 partly done. The proxy (Phase 3 code) and the Blocks definitions (`infra/blocks/`, files only, nothing applied) are built and pass local tests. Reviewed by Claude Code and Antigravity CLI (see [Review log](#review-log-2026-10-17)).

## Progress

| Item | State |
|---|---|
| 0.1 OIDC client `prompt-meter` (public, PKCE) + identity provider | ✅ Created. Client ID `e140c37a-1cc3-4edc-b77b-e00edcac0f97`. Redirects: deployed `/login/callback` and `:5173/login/callback`. |
| 0.2 Login switched on | ✅ The server also set `accountActionBaseUrl` to `https://iam.seliseblocks.com` and the activation path to `oidc/activate/` (expected with OIDC login). |
| 0.3 Multi-org | ⏸ **Skipped for now.** A save without consent left it off, and saving with consent fails with a network error in the CLI. |
| 0.4 Roles `platform-admin`, `team-admin`, `member` | ✅ Created |
| 0.5 Team "SELISE" | ⛔ Blocked. Blocks refuses to create organizations while multi-org is off (`multi_org_disabled`). Until then, everyone is in the built-in `default` organization, which acts as the only team. Personal teams wait for multi-org too. |
| 0.6 User shakil.rana@selisegroup.com (platform-admin, team-admin) | ✅ Created. Inactive until the activation email is used. |
| Sign-in method | Google / Microsoft chosen. Needs a provider app registration (client ID, secret, redirect URI) from the user. The callback address to register with the provider is still to be confirmed. |
| Proxy (`proxy/`) | ✅ Built: TypeScript, better-sqlite3 queue, Claude/OpenAI/Gemini adapters (OpenAI and Gemini not checked against live responses), 66 tests passing |
| Blocks definitions (`infra/blocks/`) | ✅ Written: schemas, rules, indexes, 8 workflows, seeds. 98 workflow tests passing. Rule condition syntax and 27 spike items still open (see `infra/blocks/README.md`). |
| Phase 1: portal scaffold (`prompt-meter-web/`) | ✅ `blocks new web` reused the OIDC client, with no change to the auth config. `blocks init` and project selection done inside the app. npm 10.8 needs `--legacy-peer-deps`. |
| Phase 1: 8 schemas, 20 indexes, data reload | ✅ Live. ⚠️ **Temporary access: "user"** (any signed-in user can read and write every collection) until the Phase 2 spike settles the rule-condition format. **Tighten before inviting anyone.** Access rules (`rules.json` policies) not deployed. |
| Phase 1: portal UI & My usage overview | ✅ Built: My usage dashboard (RangePicker, KpiCards, UsageTrendChart, Breakdowns, EventsList, SampleUserSwitcher), PricesPage, SeedPage, routing (`/`, `/prices`, `/admin/seed`, `/profile`), 47 passing tests in `prompt-meter-web`. |
| Connected accounts (link a Claude / Codex / Antigravity email, My usage locked until one is linked) | 🟡 Built locally, nothing applied: 2 schemas, 3 workflows, ingest marks `accountEmail` verified, proxy detects each tool's signed-in email, portal pages + gate. **Fixes 1–18 completed locally** (parallel claim before check, per-account limits, no link-status leak, Google `response_mode`, docs, `azp` check, Microsoft personal fallback, split key fetch, no mail for already-linked accounts, code-email limit leak fix, recent-challenges method filter/sort/pagesize, portal wait message, fail-closed lookup error handling, simplified 3 email-code starts per tool-account limit, strict lookupItems fail closed, empty errors/error regression fix, fail-safe hardening in resultErrors, missing failure-path tests; 98 workflow tests passing); see [Fixes before go-live](#fixes-before-go-live). Still needs before live: Google + Microsoft client ids, mail template save, schema push, index creation, workflow import, and Step 0 spike access check. |
| Leftover localization data (`todoApp` modules, test languages) | Left in place by decision. Revisit when adding translations. |

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
| Connected accounts | Each user connects the account email they use with Claude Code, Codex or Antigravity. Ownership is proven with Google, Microsoft or an emailed code. **My usage opens only after at least one account is connected** (`VITE_PM_ACCOUNT_LINKING=on`). The proxy detects each tool's signed-in email automatically and the ingest marks it verified against the owner's links. |
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
| **UsageEvent** | eventId (provider response id, e.g. `msg_…`, **unique index**), source (`proxy` / `manual`), userId, teamId, tool, provider, model (taken from the **response**), sessionId, promptId, callIndex, totalInputTokens, uncachedInputTokens, cacheReadTokens, cacheWrite5mTokens, cacheWrite1hTokens, outputTokens, thinkingTokens, serverToolRequests, speed, costUsd, pricingStatus (`priced` / `unpriced`), promptPreview, projectTag, occurredAt (collector), receivedAt (server) |
| **UserHourly** | userId, teamId, hourStart (UTC, top of the hour), tool, model, source (`proxy` / `manual`), token totals, costUsd, eventCount, promptCount |
| **TeamHourly** | teamId, hourStart (UTC), tool, model, source, token totals, costUsd, eventCount |
| **IngestKey** | userId, teamId, label, keyPrefix (shown, used for lookup), keyHash, sendPreview (on/off), lastUsedAt, revoked |
| **ModelPrice** | provider, model, modelAliases (dated IDs and prefixes that share this price), effectiveFrom, inputPer1M, outputPer1M, cacheReadPer1M, cacheWrite5mPer1M, cacheWrite1hPer1M, longContextThreshold (compared against **total** input, cached tokens included), longContextInputPer1M, longContextOutputPer1M, longContextCacheReadPer1M, longContextCacheWrite5mPer1M, longContextCacheWrite1hPer1M, fastMultiplier, webSearchPerRequest |
| **RollupState** | name, lastRunStartedAt, lastRunFinishedAt, dirtyHours (UTC hours marked for rebuild by manual edits or deletes). Platform-admin and workflow access only. |
| **Budget** | scope (user or team), scopeId, monthlyLimitUsd, alertPercent |
| **QuotaSnapshot** *(optional)* | userId, teamId, tool, quotaName, percentUsed, resetsAt, capturedAt. For subscriptions that report quota but not tokens. |

Rules:
- **Cost is computed when an event arrives and stored on it.** Later price changes don't rewrite history. An event for a model with no price is stored as `unpriced` and priced later by a re-pricing job.
- **No duplicates:** `eventId` is unique, so a retried batch never counts twice.
- **Ownership comes from our own fields.** Blocks adds system fields (`CreatedBy`, `OrganizationId`, …) itself, but webhook-written records won't name the person in `CreatedBy`. Ownership comes from `userId` / `teamId`, which the workflow sets from the ingest key. The collector never sends them.
- **The browser never writes ownership fields.** IngestKey records and manual UsageEvents are created only by server-side workflows (see [Trusted writes](#trusted-writes)). Those workflows take `userId` from the caller's Blocks login and check that the caller belongs to the `teamId` they ask for. Portal users have no direct write access to IngestKey or UsageEvent.
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
| outputTokens | `output_tokens` (includes thinking) | `output_tokens` (includes reasoning) | `candidatesTokenCount + thoughtsTokenCount` (thinking billed as output; check in Phase 4 that `candidatesTokenCount` doesn't already include thoughts) |
| thinkingTokens | usually not reported by the API, so leave empty (Claude Code's own JSON adds `output_tokens_details.thinking_tokens`) | `output_tokens_details.reasoning_tokens` | `thoughtsTokenCount` |
| serverToolRequests | `usage.server_tool_use.web_search_requests` (+ `web_fetch_requests`) | — | — |
| speed | `usage.speed` (`standard` / `fast`) | — | — |
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
- **Only record real usage:** generation calls (Claude `/v1/messages`, OpenAI `/v1/responses` and `/v1/chat/completions`, Gemini `*:generateContent` and `*:streamGenerateContent`). Never record `count_tokens` or `models` calls.
- **Never delay the request.** Copy the request body for reading the preview, and send the original upstream straight away.
- **Group calls into prompts.**
  - A new `promptId` starts when the newest user message contains typed text, not just tool results.
  - **Background calls don't start a new prompt.** Subagent (Task) calls, title generation and compaction calls belong to the prompt that triggered them. Recognize them by their system prompt and model (for example small, fast side calls) and check the rules in Phase 3, or prompt counts will be inflated.
  - The preview comes from that newest typed text block.
  - `sessionId` comes from the tool's session marker if it sends one (Claude Code `metadata.user_id`: check in Phase 3), otherwise from a gap-in-time heuristic.
- **Never lose an event.** Hold events in a disk queue (SQLite) and retry with backoff. Send in batches every ~10 s, or every 50 events.
- **Choose the team key** through the `X-Prompt-Meter-Key` request header sent by the tool (Claude Code: `ANTHROPIC_CUSTOM_HEADERS`). The proxy removes it before forwarding. Otherwise the proxy uses its default key. A per-folder file can't work, because the proxy can't see the tool's working directory. For per-folder keys, set the environment variable per folder with something like direnv.
- **Clean the preview twice.** The proxy removes secret-looking text before sending, and the workflow repeats it. When `sendPreview` is off, no preview is sent.
- **Local TLS is optional.** Plain `http://127.0.0.1` is enough for the tools above. Add a locally trusted certificate only if a tool refuses plain http.

## Access rules (enforced in Blocks, not just hidden in the portal)

| Data | Owner | Team member | Team admin | Platform admin |
|---|---|---|---|---|
| UsageEvent rows (read) | ✅ | ❌ | ✅ | ✅ |
| UsageEvent (write) | only through the manual-entry workflow; own `source: manual` events can be edited or deleted, proxy events never | ❌ | ❌ | ❌ |
| `promptPreview` field | ✅ | ❌ | ❌ | ❌ |
| UserHourly | ✅ own | ❌ | ✅ team | ✅ |
| TeamHourly (team totals) | ✅ | ✅ | ✅ | ✅ |
| IngestKey | read own (no `keyHash`); create and revoke only through the key workflow | ❌ | ❌ | ❌ (workflows read it) |
| RollupState | ❌ | ❌ | ❌ | ✅ (and the rollup workflow) |
| Budget | read own | read team | read + edit team | ✅ |
| QuotaSnapshot | ✅ own | ❌ | ✅ team | ✅ |
| ModelPrice | read | read | read | read + edit |

- Members get team totals from **TeamHourly**, and admins get per-person numbers from **UserHourly**, so neither needs raw rows for dashboards.
- **If column rules can't hide `promptPreview` from admins,** move previews to a separate `UsagePreview` schema (eventId, userId, preview) that only the owner can read.
- **Team scoping has to be checked.** `team-admin` and `member` must apply per team (per Blocks organization), and row rules must match `teamId` against the viewer's organizations and role there. Webhook-written rows won't carry the team's `OrganizationId` by themselves, so the workflow should set it, if Blocks allows that. This is checked in the Phase 2 spike.

## Trusted writes

Anything that sets `userId` or `teamId` runs server-side, in workflows the browser calls with its Blocks login (`authType: blocksAuthorization`):

| Workflow | What it does |
|---|---|
| **issue-key** | Takes `userId` from the caller's login and checks they belong to the requested `teamId`. It generates the key, stores `keyPrefix` and `keyHash`, and returns the full key **once**. |
| **revoke-key** | Lets owners revoke their own keys. When a member is removed from a team, all of their keys for that team are revoked. |
| **manual-entry** | Create, edit or delete the caller's own manual events. `userId` comes from the login, `teamId` is checked against their membership, `source: manual` is set, the cost is computed, and the affected UTC hour is marked dirty in RollupState. |

**Ingest also checks membership.** When a key is used, the ingest workflow checks that its owner still belongs to its team, in case a revocation was missed.

## Ingest design

- **Collector request:** sends `POST /ingest` with a **batch** of events and the header `X-Ingest-Key`, read case-insensitively.
- **The webhook has no Blocks login of its own** (`authType: none`). The workflow:
  1. finds the key by `keyPrefix`, checks `keyHash`, rejects revoked keys, and checks that the owner still belongs to the team
  2. sets `userId` and `teamId` from the key, ignoring anything the client sends for them
  3. cleans the preview, or drops it when `sendPreview` is off
  4. looks up ModelPrice by model, alias or prefix, and date, and computes `costUsd` or marks the event `unpriced`
  5. inserts the events and skips any `eventId` already stored
- **Limits:** a maximum batch size and body size, and a rate limit per key.
- **Rollup:** a **scheduled** workflow rebuilds UserHourly and TeamHourly for the UTC hours touched since its last run. If an event arrives late, the next run fixes the totals.
  - It records each run in **RollupState**. Each run selects events with `receivedAt` after the previous run's start, **minus a 2-minute overlap**, so events saved just as a run began aren't missed. Rebuilding an hour twice is harmless.
  - It also rebuilds the `dirtyHours` marked by manual edits and deletes.
  - It only scans the last 48 hours plus the dirty hours, never the whole collection.

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

- [x] Scaffold with `blocks new web prompt-meter-web` (dry run, then run) and set up local HTTPS.
- [x] Write the schemas and access rules in `blocks/data/`, with a unique index on `UsageEvent.eventId`, then push them with `blocks data sync` (dry run, then run).
- [x] Load ModelPrice with current Claude, OpenAI and Gemini rates, including the cache-write, long-context, fast-mode and web-search columns (seeded via `SeedPage` / `infra/blocks/seed/model-prices.json`).
- [ ] First-login step: create the user's personal team if they don't have one (waiting on multi-org).
- [x] Build the **My usage** overview from a small set of sample data (seed **both** UsageEvent and UserHourly rows, since the rollup arrives in Phase 2), showing times in the viewer's local timezone. Test with the browser set to UTC+6 and UTC+5:30.
- [x] Decide whether to remove the leftover localization data (`todoApp` modules and test languages) from another project (kept in place).
- [x] Wire routes and navigation: My usage (`/`), Prices (`/prices`), Seed data (`/admin/seed`), Profile (`/profile`).

**Done when:** you log in and see charts drawn from sample data. ✅ Phase 1 complete.

### Phase 2: Ingest

- [ ] **Spike first (about 1 day).** Check in a test workflow:
  - Can a code node hash the key?
  - Which identity does a workflow write data as, and can that identity read IngestKey?
  - Do row rules on `userId` and column rules on `promptPreview` behave as planned, including for admins? If not, fall back to the `UsagePreview` schema.
  - Does a duplicate `eventId` get skipped by the unique index?
  - How many batched calls per minute can one webhook take?
  - Can a scheduled workflow rebuild the hourly totals?
  - Does the code sandbox provide `crypto` (Node or Web Crypto) for hashing keys?
  - Can a webhook return custom status codes (401, 429) and keep rate-limit state per key?
  - With `blocksAuthorization`, does the workflow see the caller's user ID and organization memberships (for issue-key and manual-entry)?
  - Can roles be scoped per organization, and can a row rule match `teamId` against the viewer's organization and role?
  - Can the workflow set `OrganizationId` on the rows it writes?
  - **If several of these fail,** replace the workflow with a small ingest service.
- [ ] Build the ingest, rollup, issue-key, revoke-key and manual-entry workflows, and import them with `blocks logic workflow import` (dry run, then run).
- [ ] Settings page: create and revoke ingest keys through the key workflows, showing each key once.

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
| Connected accounts | Everyone | Connect / remove Claude, Codex and Antigravity account emails (also on Profile). Until one is connected, My usage shows the connect prompt instead of the dashboard. |
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

## Connected accounts (2026-10-18)

Claude, ChatGPT/Codex and Antigravity have no "sign in with" for other apps and no API that reads a personal account's usage. So the portal proves **the email**, not access to the tool account:

| Tool | Ways to prove the email |
|---|---|
| Claude Code | Google, emailed code |
| Codex | Google, Microsoft, emailed code |
| Antigravity | Google |

- **Google / Microsoft:** OpenID Connect sign-in that returns only an ID token (`response_type=id_token`, nonce from the server, `login_hint` = the typed email; `response_mode=fragment` sent to Microsoft only). The `link-complete` workflow checks the RS256 signature against the provider's published keys, the issuer, the audience (our client id) and, when present, `azp` (whatever the shape of `aud`), expiry, the nonce, and that the email is verified (Google `email_verified`; Microsoft personal accounts, or work accounts with `xms_edov`). For Microsoft personal accounts only, a missing `email` claim falls back to `preferred_username`; work accounts never use it. The signed-in email must equal the typed one.
- **Provider keys** are fetched only for Google / Microsoft links; checking an email code makes no outside call.
- **Email code:** 6 digits, stored only as a hash, 10 minutes, 5 tries **per challenge, counted before the code is checked** so parallel requests can't get extra tries. Sent with the `prompt-meter-link-code` mail template.
- **Limits:** at most 5 starts per user per 15 minutes (all methods), and per tool account (tool + email) for email-code: at most 3 email-code starts per 24 hours, whoever asks (each with 5 tries, so at most 15 guesses a day). Google / Microsoft starts stay limited by the per-caller limit only.
- One tool account belongs to one portal user (unique `tool + email`). Challenges are single-use: a challenge is claimed with a conditional update (only if `usedAt` is empty and `attempts` is unchanged), and a request whose update changes no row is refused.
- **No link-status leak:** `link-start` answers the same whether the account is free or linked to someone else. "Linked to another user" is only reported after the email has been proven, by `link-complete`. When the account is already linked to someone else, no code email is sent (completion can't succeed), so fake starts can't use up that address's daily code emails. Every email-code start counts toward the 3-per-day limit so response status and body never leak whether the address is linked to someone else.
- **Accepted cost (trade-offs):** someone can still use up the 3 email-code starts a day of an address that isn't linked yet. The owner can then use Google / Microsoft if the tool allows it (not blocked by the per-account limits), or wait a day; the linked-to-other path skipping the mail node is slightly faster (timing signal).
- Writes go through the `link-start`, `link-complete` and `unlink-account` workflows only. `LinkedAccount` is readable by its owner (and platform-admin); `LinkChallenge` by nobody. The workflows themselves must still be able to read and write both (see go-live step 0).
- **Usage:** the proxy puts the tool's signed-in email on every event (`accountEmail`, read from `~/.claude.json`, `~/.codex/auth.json`, `~/.gemini/…`, or set in its config). The ingest stores it and sets `accountVerified` when the key owner linked that tool account. The key still decides whose usage it is, so a wrong email never moves usage to someone else.
- **Antigravity detection:** the CLI's own token file has no ID token, so the proxy falls back to the Antigravity IDE's token file. If only the CLI is installed, `accountEmail` is `null`; if the CLI and the IDE are signed in with different Google accounts, it's the IDE's. In both cases set `accounts["antigravity-cli"]` in the proxy config.
- **Gate:** with `VITE_PM_ACCOUNT_LINKING=on`, My usage shows the connect prompt until the user has at least one linked account. This is a **UX gate, not a security boundary**: getting past it only shows the user's own data, which the access rules allow anyway.

### Fixes before go-live

From the 2026-10-18 reviews and verification (each checked against the code). **Before Google / Microsoft linking goes live: 1, 2, 4 and 6** (and step 0). **Email codes stay off until all of 1-16 are done** (3, 8, 9, 10, 11, 13, 14, 15, 16 matter most there). 5 and 7 are docs and a tested fallback.

| # | Fix | Where | Found by | Status |
|---|---|---|---|---|
| 1 | Count the attempt and claim the challenge **before** checking the code or token, with a conditional update (`challengeId`, `usedAt: null`, `attempts: n`); refuse when no row changed. Today the update filters by id only, so N parallel requests get N guesses. | `link-complete` (`link-complete-verify.js`, new "Claim Challenge" step) | both | Done |
| 2 | Per tool account limits for email-code (at most 3 email-code starts per tool account per 24 hours, whoever asks; removed 10 starts and 15 wrong codes limits), counted over LinkChallenge by `tool + email` and applied to email-code only (Google / Microsoft starts stay limited by per-caller limit only). Today only per-caller starts are counted. | `link-start-plan.js`, `link-start-create.js`, new index `tool_email_createdAt` | Claude Code | Done |
| 3 | `link-start` stops answering `linked_to_another_user`; it starts a challenge either way (`already_linked` stays for the caller's own link). | `link-start-create.js`, portal error text | Claude Code | Done |
| 4 | Leave out `response_mode=fragment` for Google (Microsoft keeps it). One reviewer says Google answers 400 to it; not confirmed, but fragment is the default for `id_token` anyway, so dropping it is safe. **Must do.** | `prompt-meter-web/src/features/accounts/linking.ts` | both | Done |
| 5 | Docs: go-live step 0, the Antigravity fallback, the gate being UX only, the accepted lockout cost (done in this plan; mirror in `infra/blocks/README.md` and `proxy/README.md`). | READMEs | both | Done |
| 6 | Check `azp` also when `aud` is a single string (today it returns early). Low risk, since `aud` must still be our client id, but the OIDC spec asks for it. | `account-link.js` `audienceMatches` | Antigravity | Done |
| 7 | Microsoft **personal** accounts (consumer tenant) without an `email` claim: fall back to `preferred_username`. Never for work accounts. Test with a real outlook.com account first; we request the `email` scope, so it may never be needed. | `account-link.js` `verifyIdToken` | Antigravity | Done in code, test with a real personal account at go-live step 5 |
| 8 | Fetch provider keys only for Google / Microsoft: split `link-complete` after "Challenge Usable" into a token branch and a code branch, so a slow or down Google endpoint can't break email codes. | `build.js` `linkComplete`, `link-complete-plan-verify.js` | Antigravity | Done |
| 9 | With fix 3: when the tool account is already linked to someone else, `link-start` answers normally but sends **no** code email. | `link-start-create.js`, `link-start-stored.js` | Antigravity | Done |
| 10 | Count every email-code start toward the 3-per-day limit (mailed or not), making the response for a linked-to-other address indistinguishable from a free one in status and body (no link status leak). | `link-start-create.js` | verification | Done |
| 11 | Filter per-account recent challenges lookup by `method: { eq: "email-code" }`, sort newest first, and raise page size to 200 so Google starts don't push email-code rows past the page. | `graphql.js`, `link-start-plan.js` | verification | Done |
| 12 | Portal wait message for `too_many_attempts` updated to cover 24-hour per-account limits ("Too many attempts. Try again later, or use Google / Microsoft sign-in if this tool offers it."). | `prompt-meter-web/src/features/accounts/linking.ts` | verification | Done |
| 13 | Fail-closed lookup error handling: if a gateway lookup returns errors, link workflows fail closed with 503 (`limits_unavailable` in `link-start`, `lookup_failed` in `link-complete` and `unlink-account`); in `link-complete`, existing-link lookup failure comes **after** the claim, so it has already used one attempt (and for Google / Microsoft the whole challenge) and writes nothing else; ingest stores events with `accountVerified: false`. | `link-start-create.js`, `link-complete-plan-verify.js`, `link-complete-verify.js`, `unlink-authorize.js`, `ingest-prepare-events.js` | verification round 3 | Done |
| 14 | Simplified per-account limits to at most 3 email-code starts per tool account per 24 hours, whoever asks, with 5 tries each; removed dead 10 starts and 15 wrong codes limits. | `link-start-create.js`, `account-link.js` | verification round 3 | Done |
| 15 | Strict lookupItems helper: lookups with unexpected shape fail closed with 503; only a real items array with no errors is accepted. | `workflow-io.js` (`lookupItems`), workflow code nodes | verification round 4 | Done |
| 16 | Regression fix: empty `errors` / `error` were counted as failures; now ignored (count errors only when non-empty array or plain object with own keys). | `workflow-io.js` (`resultErrors`) | verification round 5 | Done |
| 17 | Fail-safe hardening in resultErrors: numeric/string statusCode, status, httpStatusCode >= 400; ok: false; error: true or non-zero number; errors non-empty string; middle wrapper layer flags on json beside output; recursive visit across all wrapper layers. | workflow-io.js (resultErrors) | verification round 6 | Done |
| 18 | Missing failure-path tests: link-start Respond Code Sent returns 500 mail_failed on mail failure; ingest Respond Accepted returns 500 insert_failed on insert failure; success counterparts still return 200. | workflow-io.test.js | verification round 6 | Done |

### To go live (in order)

0. **Spike first:** confirm that the workflows (`dataAction` with `blocksAuthentication`) can **read and write** `LinkChallenge` and `LinkedAccount` under the access rules (rules.json spike item 5): Load Challenge, Load Recent Challenges, Load Linked Accounts (ingest), Store Challenge, Write Link Result, Delete Link. Also confirm the `sort` syntax of the recent-challenges query, that a failed `getData` returns errors rather than stopping the workflow (workflows fail closed on lookup errors), record the exact shape of a failed `getData` and confirm `lookupItems` rejects it, and record the shapes of a **successful** `getData`, a successful rawQuery mutation (insert / update / delete), and a successful `sendMail`, and confirm `resultErrors` / `lookupItems` treat each correctly. If they can't, every link fails and `accountVerified` is always false; add an allow policy for the workflow identity. Note: the "known gaps" in the README's error rule (errors inside arrays, non-numeric failure strings, `errors: {Email: []}`, null / empty write results) are to be checked against the recorded shapes and fixed only if Blocks returns them.
1. Make fixes 1-18 above (1, 2, 4 and 6 before Google / Microsoft; all of them before email codes).
2. Register the Google OAuth client (Web) and the Microsoft Entra app (ID tokens enabled; optional claims `email`, `xms_edov`) with redirect URI `<origin>/accounts/link/callback`.
3. Put both client ids in `infra/blocks/workflows/link-config.json` (then `node infra/blocks/workflows/build.js`) and in `VITE_PM_GOOGLE_CLIENT_ID` / `VITE_PM_MICROSOFT_CLIENT_ID`.
4. Save the mail template; push the 2 new schemas and `UsageEvent`'s 2 new fields; create the new indexes; import and publish the 3 workflows (and re-import `ingest`).
5. Set `VITE_PM_WORKFLOW_WEBHOOK_BASE`, then test end to end: one Google link, one Microsoft **personal** link (checks fix 4 and 7), one Microsoft work link, one email-code link, a wrong code, and parallel requests with wrong codes plus one with the correct code (checks fix 1; note: if every completion answers `challenge_busy`, the claim filter's `_id` vs `ItemId` format is wrong (TODO(spike))). Then turn on `VITE_PM_ACCOUNT_LINKING`.

Exact commands are in `infra/blocks/README.md`.

**Not done (later):** a per-account breakdown in the charts (the hourly rollups don't carry `accountEmail`), and picking a linked account on manual entries (the manual entry form isn't built yet).

## Review log (2026-10-18): Connected accounts

**Round 8 (2026-10-18):** docs only, README count and error-rule wording, no code change; all test suites pass (workflows 98, proxy 66, portal 47).

**Round 7 verification & hardening (2026-10-18):** round 7 fail-safe hardening in `resultErrors` (handling numeric and string `statusCode`, `status`, `httpStatusCode` >= 400, `ok: false`, `error: true` or non-zero numbers, `errors` non-empty string, middle wrapper layer flags on `json` beside `output`, recursive traversal across all wrapper layers), missing failure-path tests (`mail_failed` 500 in link-start Respond Code Sent, `insert_failed` 500 in ingest Respond Accepted, 200 on success), and documentation updates in `infra/blocks/README.md` and `PLAN.md` (rows 16–18); all test suites pass (workflows 98, proxy 66, portal 47).

**Round 6 corrections (2026-10-18):** round 6 corrections from independent verification of round 5: empty `errors` / `error` counted as failure regression fixed (`resultErrors` counts errors only when non-empty array or plain object with own keys; empty `errors: []`, `errors: {}`, empty `error: ""`, `error: {}`, `error: []`, `error: null`, `errors: null`, `extensions: {}` are not errors), node-level tests for write results and `sendMail` with empty errors/error, doc updates (Fix 13 clarification, Step 0 spike shapes, test count alignment); all test suites pass (workflows 95, proxy 66, portal 47).

**Round 5 corrections (2026-10-18):** round 5 corrections from independent verification of round 4: strict lookup error handling (lookupItems helper rejects malformed/error responses, link-start limits_unavailable, link-complete/unlink lookup_failed, ingest accountVerified: false), test cleanup, test count updates; all test suites pass (workflows 82, proxy 66, portal 47).

**Round 4 corrections (2026-10-18):** round 4 corrections from independent verification of round 3: fail-closed lookups with 503 (limits fail open fix), simplified per-account limits to at most 3 email-code starts per tool account per 24h, test rewrite and lookup failure tests, portal error message for limits_unavailable, audit note on LinkChallenge schema; all test suites pass (workflows 80, proxy 66, portal 47).

**Round 3 verification (2026-10-18):** items 1–3 fixed (fixes 10–12 in table above: code-email limit leak closed, recent-challenges method filter/sort/pagesize, portal wait message for 24h limits); provider client ID verified before claim in Plan Link Verify (item 7); portal dialog resets to step 1 on 5th wrong code (item 8); step 5 parallel test updated (item 9); all test suites pass (workflows 73, proxy 66, portal 47).

Reviewed read-only by **Claude Code** (`claude -p`, plan mode) and **Antigravity CLI** (`agy -p`, plan mode, `--sandbox`). All three test suites passed in the review (workflows 68, proxy 66, portal 47).

Antigravity's first two runs produced nothing: headless mode denied shell commands, then `read_file`. The third run used `--dangerously-skip-permissions` (chosen by the user) together with plan mode and the sandbox; a checksum of all 295 repo files before and after showed **no file changed**. That run also reviewed the fixes planned after Claude Code's review.

**Claude Code, taken into the plan** (each confirmed in the code): parallel requests beat the 5-try limit and single use (fix 1); no per-email limit, about 2,400 guesses a day against one address and about 20 code emails an hour to anyone (fix 2); `link-start` reveals whether someone else linked an address (fix 3); the workflows' own data access depends on an unconfirmed spike (step 0); Antigravity detection can pick the IDE's account (documented); the gate is UX only (documented).

**Antigravity, taken into the plan:** fixes 1, 2 and 4 confirmed as blockers; `azp` not checked for a string `aud` (fix 6, confirmed); Microsoft personal accounts may lack `email` (fix 7, plausible, to test); email-code checks depend on Google's key endpoint (fix 8, confirmed); fix 3 + fix 2 would let fake starts use up an already-linked address's code emails (fix 9); step 0 must cover writes as well as reads; CLI-only Antigravity installs detect no email (documented).

**Not confirmed:** "Google answers 400 to `response_mode=fragment`". The reviewer had no network access, so it can't have observed it. Fix 4 removes the parameter for Google either way, and the end-to-end test in step 5 checks it.

**Checked and found correct (both):** the ID-token signature, issuer, audience, expiry and nonce checks; Google `email_verified`; Microsoft `xms_edov` against the "nOAuth" spoof; the token removed from the address bar; one-use state; the code never returned to the browser; owner-only unlink; `response_type=id_token` for this use.

**Verdict (both): not ready** until fixes 1, 2 and 4 are in and step 0 passes. No hole found in the Google / Microsoft token checks.

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

**Second review (readiness):** agy said ready. Claude found two blockers, both now fixed:
- **Forgeable ownership:** keys and manual entries are now created only by server-side workflows that take the user from the login token and check team membership. See [Trusted writes](#trusted-writes).
- **Missing field:** UsageEvent was missing `source`.

Also taken in from the second review:
- **Team-scoped roles:** added to the spike.
- **Membership:** checked at ingest.
- **Rollup:** a RollupState watermark with overlap and dirty hours, and the scan limited to recent hours.
- **Phase 1 sample data:** seeds the hourly totals too.
- **Normalization:** rows for `serverToolRequests` and `speed`, and Claude's thinking count left empty.
- **Prices:** cache rates above the long-context threshold, and model alias and prefix matching.
- **Webhook:** spike checks for custom status codes, rate limits and `crypto`.
- **Proxy:** Gemini paths, copying the request without delaying it, and keeping background calls from starting new prompts.
- **Header:** `X-Ingest-Key` is read case-insensitively.

**Rejected in the first review, because the evidence says otherwise:**

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
