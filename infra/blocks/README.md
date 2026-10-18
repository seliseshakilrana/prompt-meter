# prompt-meter: Blocks backend definitions

Local files only. Nothing in this folder has been pushed to, imported into, or run against the Blocks project. Everything here is applied later, by a human, from inside the scaffolded web app (see [How to apply](#how-to-apply-later)).

Background: [PLAN.md](../../PLAN.md) (Data model, Time and timezones, Access rules, Trusted writes, Ingest design) and [docs/ingest-contract.md](../../docs/ingest-contract.md).

## Files

```
infra/blocks/
  data/
    schemas/*.json        10 schemas in the `blocks data schema pull/push` format
    rules.json            `security` entries + `policies` (ruleGroups are intent notation, see TODO(spike))
    indexes.json          indexes to create with `blocks data schema indexes create` (not part of schema push)
  workflows/
    ingest.json           webhook (authType none): collector batches -> UsageEvent
    rollup.json           schedule (every 5 min): rebuilds UserHourly + TeamHourly
    issue-key.json        webhook (blocksAuthorization): creates an IngestKey, returns the key once
    revoke-key.json       webhook (blocksAuthorization): owner revokes a key / team admin revokes a removed member's keys
    manual-entry.json     webhook (blocksAuthorization): create / edit / delete the caller's own manual events
    link-start.json       webhook (blocksAuthorization): start connecting a tool account (nonce, or mails a code)
    link-complete.json    webhook (blocksAuthorization): check the ID token / code, store the LinkedAccount
    unlink-account.json   webhook (blocksAuthorization): owner removes a linked account
    link-config.json      public Google / Microsoft client ids + mail template name (placeholders until set)
    build.js              generates the eight JSON files above from the graphs it defines + lib/
    lib/
      sha256.js           SHA-256 in plain JS (no sandbox crypto needed)
      ingest-key.js       key format, hashing, constant-time compare, generation
      redact.js           preview cleaning: secrets removed, then cut to 100 characters
      cost.js             price lookup (model / alias / prefix + effectiveFrom) and cost calculation
      validate-event.js   collector event validation (client userId/teamId/cost/source dropped)
      manual-entry.js     manual entry validation
      rollup.js           watermark planning, hour selection, hourly aggregation
      account-link.js     account linking: methods per tool, challenges, codes, ID-token checks (RS256 in plain JS)
      graphql.js          raw GraphQL documents for dataAction nodes (all gateway naming in one place)
      workflow-io.js      reading webhook requests, node outputs and IAM responses
      nodes/*.js          one file per code node (the node's own script body)
      compose.js          joins helpers + a node body into the code-node script (used by build.js and tests)
      test/*.test.js      node --test suite (no network)
  mail/
    link-code.json        mail template for the email-code method (`blocks mail template save --file`)
  seed/
    model-prices.json     ModelPrice rows (given first-party rates only; unknowns null + needsPrice)
    sample-usage.json     Phase 1 sample: UsageEvent + matching UserHourly / TeamHourly rows
```

### Code-node scripts

Each code node's script is `lib/<helpers>.js` + `lib/nodes/<node>.js`, concatenated by `compose.js` and embedded by `build.js`. Helpers are plain function declarations (no `require`, no `module.exports`), because the code-node sandbox only runs a script body. The tests evaluate the **same composed text** that is in the workflow JSON.

```
node infra/blocks/workflows/build.js           # regenerate the workflow JSON after editing lib/
node infra/blocks/workflows/build.js --check   # fails if a JSON file is stale
node --test infra/blocks/workflows/lib/test/   # 98 tests, no network
```

Don't edit `script` strings in the JSON by hand. Edit `lib/` and rebuild.

## Naming

The skills use PascalCase singular schema names (`Product`, collection `Products`) and camelCase field names (`email`, `createdDate`). That is the same as PLAN.md, so **every schema and field name is PLAN.md's name, unchanged**. Collection names are the schema name plus `s` (`UsageEvents`, `UserHourlys`, ...). The gateway's generated query names add a plain `s` too (`getUserHourlys`). Platform system fields (`ItemId`, `CreatedDate`, `CreatedBy`, `LastUpdatedDate`, `LastUpdatedBy`, `Language`, `OrganizationId`, `Tags`) are not defined.

Where the files go beyond PLAN.md's field list:

| Schema | Field | Why |
|---|---|---|
| IngestKey | `rateWindowStart`, `rateWindowCount` | The contract needs a per-key rate limit (429). A workflow has no other place to keep state, so it is a fixed one-minute window stored on the key (approximate: read-modify-write). |
| UserHourly / TeamHourly | the "token totals" are the 8 event token fields (`totalInputTokens` ... `serverToolRequests`) | PLAN.md says "token totals" without listing them. They are `Float`, not `Int`: a team's hourly sum can pass the 32-bit GraphQL `Int` limit. |
| ModelPrice | `modelAliases` entries ending in `*` are prefixes | PLAN.md says aliases hold "dated IDs and prefixes" without a syntax. |

## Access rules (`data/rules.json`)

`security` (one entry per schema per operation, validated by the CLI's own local checks):

- All schemas: READ / WRITE / EDIT / DELETE at accessLevel 3 (Custom), so anything without an allow policy is denied to browser users.
- ModelPrice READ: accessLevel 1 (any signed-in user). ModelPrice WRITE / EDIT / DELETE: Custom, platform-admin policy.
- Column-level (CLS) READ entries: `UsageEvent.promptPreview` (owner-only policy) and `IngestKey.keyHash`, `rateWindowStart`, `rateWindowCount` (no allow policy, so hidden from everyone).

`policies`, mapped to PLAN.md's access table:

| Data | Policy intent | Expressible today? |
|---|---|---|
| UsageEvent read | owner OR team-admin of row's team OR platform-admin | Format yes; ruleGroup syntax and per-org role **TODO(spike)** |
| UsageEvent write/edit/delete | no allow policy (workflows only) | Yes (Custom with no policy); workflow identity **TODO(spike)** |
| `promptPreview` | owner of that row only, admins excluded | CLS exists (`policyType 1`); row-conditional CLS **TODO(spike)**. Fallback: `UsagePreview` schema (eventId, userId, preview) with owner-only RLS |
| UserHourly read | owner OR team-admin of team OR platform-admin | as UsageEvent read |
| TeamHourly read | any member of the team OR platform-admin | ruleGroup syntax / org membership match **TODO(spike)** |
| IngestKey read | owner (keyHash hidden by CLS) | ruleGroup syntax **TODO(spike)** |
| IngestKey write | none (issue-key / revoke-key workflows only) | Yes |
| LinkedAccount read | owner OR platform-admin | ruleGroup syntax **TODO(spike)** |
| LinkedAccount / LinkChallenge write | none (link-start / link-complete / unlink-account workflows only); LinkChallenge has no read policy and `nonce` / `codeHash` are hidden by CLS | Yes (see Step 0 below) |
| RollupState | platform-admin only (plus workflows) | role condition syntax **TODO(spike)** |
| Budget | read own / read team / team-admin edits team / platform-admin all | **TODO(spike)** as above |
| QuotaSnapshot | owner / team-admin / platform-admin read; writes platform-admin | **TODO(spike)** as above |
| ModelPrice | everyone reads; platform-admin writes | READ yes (accessLevel 1); write policy syntax **TODO(spike)** |

> **Step 0 note for go-live:** Workflows use `dataAction` with `blocksAuthentication` and must be able to **both read and write** `LinkChallenge` and `LinkedAccount`. LinkChallenge has no read policy and CLS hiding `nonce`/`codeHash`; LinkedAccount read policy is owner/platform-admin only. Confirm in the spike that the workflow identity is not blocked by Custom security; if it is, add explicit allow policies for the workflow identity. Also confirm the `sort` syntax of the recent-challenges query, that a failed `getData` returns errors rather than stopping the workflow (workflows fail closed on lookup errors), record the exact shape of a failed `getData` and confirm `lookupItems` rejects it, and record the shapes of a **successful** `getData`, a successful rawQuery mutation (insert / update / delete), and a successful `sendMail`, and confirm `resultErrors` / `lookupItems` treat each correctly.

The `ruleGroup` objects are **intent notation** (`{combinator, rules:[{field, operator, value: "$currentUser.userId" | "$currentUser.organizationIds" | "$currentUser.organizationIdsWithRole:team-admin"}, {currentUserRole}]}`). Neither the skill nor the CLI documents the real syntax (the CLI passes `ruleGroup` through untouched). Translate them after the spike, before any `rules deploy --yes`.

## Workflows

All Blocks calls use `authenticationType: "blocksAuthentication"` (no stored secret). All record I/O goes through `dataAction` nodes. Reads and multi-record writes use `rawQueryMode` with GraphQL built in code nodes (`lib/graphql.js`); the only plain-mode node is `Touch Ingest Key` (updateData by `ItemId`). Every branch ends in a `Respond ...` code node returning `{ statusCode, body }`.

**link-start / link-complete / unlink-account** (PLAN.md "Connected accounts"): caller from `/iam/v4/iam/me`.
- `link-start` validates `{tool, email, method}` (allowed methods per tool). Rate limits: at most 5 starts in 15 minutes per caller (all methods), and per tool-account (`tool + email`) for email-code: at most 3 email-code starts per 24 hours across all callers (each with 5 tries, so at most 15 guesses a day). Google / Microsoft starts stay limited by the per-caller limit only. If any lookup fails (`Load Recent Challenges`, `Load Existing Link`), the workflow fails closed with 503 `limits_unavailable` (not `lookup_failed`) instead of skipping limits or checks. To prevent link-status leakage, `link-start` does not report `linked_to_another_user` (it returns a challenge either way; `already_linked` stays only if already linked to the caller). When the account is linked to another user, `link-start` sends no code email and counts toward the 3-per-day limit without incrementing real emails sent. Accepted trade-offs: the linked-to-other path skipping the mail node is slightly faster (timing signal); one caller can lock an unlinked address out of email codes for a day (the owner can still link via Google / Microsoft, not blocked by per-account limits, or wait 24h). Stores a LinkChallenge (10 minutes) and returns the nonce (google / microsoft) or mails a 6-digit code (email-code; only its hash is stored).
- `link-complete` loads the caller's challenge (404 / 410 / 429 before anything else; fails closed with 503 `lookup_failed` if the `Load Challenge` lookup fails). To prevent parallel attempt racing, it claims the challenge before checking code or token with a conditional update (`challengeId`, `usedAt: null`, `attempts: n`), setting `attempts: n+1` (and `usedAt: now` for token methods or 5th attempt). If the conditional update modifies 0 rows (`totalImpactedData: 0`), it responds 409 `challenge_busy`. On success, it splits by method: only the google/microsoft path runs `Fetch Provider Keys` (the email-code branch makes no external call); if `Load Existing Link` fails, it fails closed with 503 `lookup_failed` (a 503 after the claim still uses up one attempt, and for Google / Microsoft the challenge; the user starts again); checks ID token (including `azp` when `aud` is a string, and Microsoft consumer tenant fallback to `preferred_username` when `email` is absent) or code, inserts `LinkedAccount` and marks the challenge used (`usedAt: now, verified: true`). The client ids come from `link-config.json`; when not configured in "Plan Link Verify" it answers 503 `provider_not_configured` without claiming the challenge.
- `unlink-account` authorizes link removal (fails closed with 503 `lookup_failed` if `Load Link` fails; 404 if not found or not owned by caller), then executes `Delete Link`.
- Fail-closed lookup behaviour and strict lookup rule: lookups strictly enforce that only a real `items` array with no errors is accepted (`resultErrors.length === 0` and `Array.isArray(items)`). Any lookup error or unexpected response shape fails closed instead of falling back to empty results or skipping limits/checks.
  - **Error detection rule (`resultErrors`):** What counts as an error: numeric or numeric-string `statusCode`, `status`, or `httpStatusCode` >= 400 (e.g. `500`, `"500"`); `ok: false`; `error` truthy non-empty (non-empty string, non-empty plain object with own keys, `error: true`, or non-zero number); `errors` non-empty (non-empty array, non-empty plain object with own keys, or non-empty string); `success: false`, `isSuccess: false`, `acknowledged: false`. The check walks **every nested object** from the root (up to its depth limit of 6), **except** `errors` values and `items` arrays, and it does not look inside arrays — so returned rows inside `items` are never inspected. Because of that, an object returned outside `items` (e.g. a single-object result or an echoed document) **is** inspected; no current schema has a field named `status`, `statusCode`, `httpStatusCode`, `ok`, `error`, `errors`, `success`, `isSuccess` or `acknowledged`, and any future schema field with one of these names would be read as an error flag. GraphQL `extensions` is walked too, so e.g. a status >= 400 inside it would fail the call (fails closed). What is NOT an error: empty `errors: []`, `errors: {}`, `errors: null`; empty / falsy / zero `error: null`, `error: ""`, `error: {}`, `error: []`, `error: false`, `error: 0`; `extensions: {}`; `statusCode: 200`, `"200"`; `status: 200`, `"200"`, `"ok"`, `"success"` (a non-numeric `status` string is not an error); `ok: true`; normal write and mail results (`acknowledged: true`, `itemId`, `totalImpactedData` incl. 0, `message`, `success: true`, `{isSuccess: true, errors: {}}`, insertMany / deleteMany); null / empty write results are still treated as success until step 0 settles them. Known gaps, to be settled by step 0's recorded response shapes: errors inside arrays (e.g. `insertMany: [{acknowledged:false}]`) are not detected; non-numeric failure strings (`status:"error"`, `success:"false"`, `statusCode:"500 Internal Server Error"`) are not detected; `errors: {Email: []}` counts as an error even though its value is empty; null / empty write results count as success.
  - If any lookup fails (`Load Recent Challenges`, `Load Existing Link` in `link-start` returning 503 `limits_unavailable`; `Load Challenge`, `Load Existing Link` in `link-complete`, and `Load Link` in `unlink-account` returning 503 `lookup_failed`), the workflow fails closed with 503; in ingest, a failed or malformed `Load Linked Accounts` lookup leaves `accountVerified: false`.
- The My usage gate is a UX gate, not a security boundary: getting past it only shows the user's own data, which the access rules allow anyway.

**ingest** (contract order of checks): key format (401) -> size / batch count (413) -> JSON / `events` (400) -> key by `keyPrefix` + constant-time SHA-256 compare + revoked (401) -> rate limit (429) -> owner still in team via IAM (401) -> load the owner's linked accounts (a failed Load Linked Accounts lookup leaves `accountVerified: false`) -> load prices + existing eventIds -> per event: validate (rejected), duplicate in store or batch (duplicates), userId/teamId from the key, preview re-cleaned + cut to 100 or dropped when `sendPreview` is off, cost -> one `insertManyUsageEvent` -> 200 `{accepted, duplicates, rejected}`. A failed insert answers 500 so the proxy retries; the retry is safe because existing eventIds are skipped and `eventId` is unique.

**rollup** (every 5 minutes): RollupState `hourly` -> `receivedAt >= max(lastRunStartedAt - 2 min, now - 48 h)` -> UTC hours of those events + `dirtyHours` -> load events of exactly those hours -> one mutation deletes the hourly rows of those hours, then inserts the rebuilt UserHourly + TeamHourly rows (grouped by UTC hour, tool, model, source) -> re-read RollupState, save watermark and the dirty hours not processed. Errors fail the run without moving the watermark.

**issue-key / revoke-key / manual-entry**: caller id from `GET /iam/v4/iam/me`, never from the body. issue-key and manual-entry check `teamId` against `GET /iam/v4/iam/organizations/my`; revoke-key `memberRemoved` mode checks the caller's role in that org with `GET /iam/v4/iam/users/{callerId}?organizationId=<teamId>`. manual-entry sets `source: manual`, prices the entry with the same `cost.js`, refuses to touch proxy events or other users' events, and marks the old and new UTC hours dirty in the same mutation.

## Pricing rules (`lib/cost.js`)

1. Row: same provider; exact `model` > exact alias > longest `*` prefix alias; newest `effectiveFrom` not after `occurredAt`.
2. Cost = uncached x input + cacheRead x cacheRead + cacheWrite5m x 5m + cacheWrite1h x 1h + output x output (per 1M). `thinkingTokens` are not added (already in output).
3. Long context: if `longContextThreshold` is set and **totalInputTokens** (cached included) is **above** it, all five rates switch to their `longContext*` columns.
4. `speed: fast` multiplies the token cost by `fastMultiplier`.
5. `serverToolRequests x webSearchPerRequest` is added after the multiplier.
6. Unpriced (`costUsd: null`, `pricingStatus: unpriced`) when there is no row, or a needed value is null (a token kind with count > 0, fast without a multiplier, tool requests without a price). Nothing is guessed.

## Seed data

- `seed/model-prices.json`: Claude rows with only the rates given to this project (Opus 5.5 $4/$20, cache read $0.20, fast x2; Sonnet 5.5 $2/$10, cache read $0.20; Haiku 5.5 $0.10/$0.50, above 100K total input $0.50/$2.50; Fable 5.1 $10/$50, cache read $0.25; cache writes 1.25x / 2x the matching input rate). Every other value is `null` and listed in the row's `needsPrice` (web search for all, Haiku cache read, long-context tiers and fast multipliers that weren't given). OpenAI and Google rows are placeholders with `model: null`: don't load them until filled. Strip `needsPrice` and `notes` before loading.
- `seed/sample-usage.json`: 12 events (two users, one team, Claude Code / Codex / Antigravity CLI / one manual entry) on 2026-10-17 between 16:00 and 19:59 UTC, crossing local midnight for UTC+6 (18:00Z) and UTC+5:30 (18:30Z), plus the 9 UserHourly and 9 TeamHourly rows that `rollup.js` produces from them (the tests check they match). The day is the price `effectiveFrom` day; if it is loaded before those hours have passed, shift every timestamp by the same amount (costs stay valid for any time after 2026-10-17T00:00Z).
- There is no CLI command that inserts records. Load seeds through the portal app (a one-off platform-admin script using `@seliseblocks/client`, `data.collection("ModelPrice").create(...)` etc.) or through the OS portal. RollupState needs no seed: the rollup and manual-entry workflows insert the `hourly` row if it's missing.

## How to apply (later)

Prerequisites: Phase 0 done, the web app scaffolded with `blocks new web prompt-meter-web`, and `blocks init` run **inside** `prompt-meter-web/` (that creates `blocks/data/schemas/` and `blocks/data/rules.json`). Run everything below from `prompt-meter-web/`. Every mutating command is run with `--dry-run` first and with `--yes` only after a human approves that dry-run.

1. Copy the files into the app's Blocks folder.
   ```bash
   blocks data schema pull --json            # see what the project already has first
   cp ../infra/blocks/data/schemas/*.json blocks/data/schemas/
   cp ../infra/blocks/data/rules.json blocks/data/rules.json
   blocks data validate --json               # local only
   ```
2. Schemas (safe before the spike).
   ```bash
   blocks data schema push --dry-run --json
   blocks data schema push --yes --json      # after approval
   blocks data reload --dry-run --json
   blocks data reload --yes --json           # after approval
   ```
3. Indexes. Get each schema's id with `blocks data schema get-by-name <SchemaName> --json`, then for each entry in `data/indexes.json` (dry-run shown; repeat each with `--yes` after approval):
   ```bash
   blocks data schema indexes create --schema-id <UsageEvent id> --fields eventId --unique --name eventId_unique --dry-run --json
   blocks data schema indexes create --schema-id <UsageEvent id> --fields userId,occurredAt:desc --name userId_occurredAt --dry-run --json
   blocks data schema indexes create --schema-id <UsageEvent id> --fields teamId,occurredAt:desc --name teamId_occurredAt --dry-run --json
   blocks data schema indexes create --schema-id <UsageEvent id> --fields occurredAt --name occurredAt --dry-run --json
   blocks data schema indexes create --schema-id <UsageEvent id> --fields receivedAt --name receivedAt --dry-run --json
   blocks data schema indexes create --schema-id <UsageEvent id> --fields pricingStatus,model --name pricingStatus_model --dry-run --json
   blocks data schema indexes create --schema-id <UserHourly id> --fields userId,hourStart:desc --name userId_hourStart --dry-run --json
   blocks data schema indexes create --schema-id <UserHourly id> --fields teamId,hourStart:desc --name teamId_hourStart --dry-run --json
   blocks data schema indexes create --schema-id <UserHourly id> --fields hourStart --name hourStart --dry-run --json
   blocks data schema indexes create --schema-id <UserHourly id> --fields userId,teamId,hourStart,tool,model,source --unique --name rollup_key_unique --dry-run --json
   blocks data schema indexes create --schema-id <TeamHourly id> --fields teamId,hourStart:desc --name teamId_hourStart --dry-run --json
   blocks data schema indexes create --schema-id <TeamHourly id> --fields hourStart --name hourStart --dry-run --json
   blocks data schema indexes create --schema-id <TeamHourly id> --fields teamId,hourStart,tool,model,source --unique --name rollup_key_unique --dry-run --json
   blocks data schema indexes create --schema-id <IngestKey id> --fields keyPrefix --unique --name keyPrefix_unique --dry-run --json
   blocks data schema indexes create --schema-id <IngestKey id> --fields userId,teamId --name userId_teamId --dry-run --json
   blocks data schema indexes create --schema-id <ModelPrice id> --fields model,effectiveFrom:desc --name model_effectiveFrom --dry-run --json
   blocks data schema indexes create --schema-id <RollupState id> --fields name --unique --name name_unique --dry-run --json
   blocks data schema indexes create --schema-id <Budget id> --fields scope,scopeId --name scope_scopeId --dry-run --json
   blocks data schema indexes create --schema-id <QuotaSnapshot id> --fields userId,capturedAt:desc --name userId_capturedAt --dry-run --json
   blocks data schema indexes create --schema-id <QuotaSnapshot id> --fields teamId,capturedAt:desc --name teamId_capturedAt --dry-run --json
   blocks data schema indexes create --schema-id <LinkedAccount id> --fields tool,email --unique --name tool_email_unique --dry-run --json
   blocks data schema indexes create --schema-id <LinkedAccount id> --fields userId --name userId --dry-run --json
   blocks data schema indexes create --schema-id <LinkChallenge id> --fields challengeId --unique --name challengeId_unique --dry-run --json
   blocks data schema indexes create --schema-id <LinkChallenge id> --fields userId,createdAt:desc --name userId_createdAt --dry-run --json
   blocks data schema indexes create --schema-id <LinkChallenge id> --fields tool,email,createdAt:desc --name tool_email_createdAt --dry-run --json
   ```
4. Rules: **only after the spike has fixed the ruleGroup syntax** in `rules.json`.
   ```bash
   blocks data rules pull --json             # compare with what is live first
   blocks data rules deploy --dry-run --json
   blocks data rules deploy --yes --json     # after approval
   blocks data reload --dry-run --json
   blocks data reload --yes --json           # after approval
   ```
   Once schemas and rules are both final, `blocks data sync --dry-run --json` then `--yes` does validate -> push -> rules deploy -> reload in one step.
5. Workflows: spike first with a throwaway test workflow. Then, per file (the slug fixes `projectShortKey` references):
   ```bash
   blocks logic workflow import --file ../infra/blocks/workflows/ingest.json --project-slug <slug> --dry-run --json
   blocks logic workflow import --file ../infra/blocks/workflows/ingest.json --project-slug <slug> --yes --json   # after approval
   blocks logic workflow list --search "prompt-meter" --json
   blocks logic workflow publish <id> --dry-run --json
   blocks logic workflow publish <id> --yes --json   # after approval; activates the webhook / schedule
   ```
   Same for `rollup.json`, `issue-key.json`, `revoke-key.json`, `manual-entry.json`. Import upserts by workflow name (`prompt-meter ingest`, ...).
   Same for `link-start.json`, `link-complete.json` and `unlink-account.json`, after Step 0 access is confirmed (workflows can read and write `LinkChallenge` and `LinkedAccount`), `link-config.json` has real client ids, and `node infra/blocks/workflows/build.js` has been re-run. Re-import `ingest.json` too (it now loads linked accounts).
6. Mail template for the email code (once):
   ```bash
   blocks mail template save --file ../infra/blocks/mail/link-code.json --dry-run --json
   blocks mail template save --file ../infra/blocks/mail/link-code.json --yes --json   # after approval
   ```
7. Seeds: see [Seed data](#seed-data).

## TODO(spike) items

These are the Phase 2 spike questions. Each is also marked `TODO(spike)` in the file that depends on it.

**Data and rules**
1. `ruleGroup` syntax for policies: everything in `rules.json` `policies` is intent notation (rules.json `notes`).
2. Row rule "row's `userId` equals the current user".
3. Per-organization roles: can `team-admin` / `member` be scoped per org, and can a row rule match `teamId` against the viewer's orgs and their role there? Fallback: team-admin views served by a blocksAuthorization workflow; rows readable by owner + platform-admin only.
4. Row-conditional CLS on `promptPreview` that hides it from team-admin and platform-admin too. Fallback: `UsagePreview` schema (eventId, userId, preview), owner-only RLS, and drop `promptPreview` from UsageEvent.
5. Which identity `dataAction` with `blocksAuthentication` acts as; whether Custom security without allow policies also blocks workflows (UsageEvent / IngestKey / hourly writes, IngestKey `keyHash` read through the CLS hide, and LinkChallenge / LinkedAccount reads and writes for account-linking). If so, add allow policies for that identity (Go-live Step 0).
6. Setting `OrganizationId` on workflow-written rows: not attempted (it's a platform field; inserts don't send it). Ownership is our own `userId` / `teamId`.
7. Does `isUniqueData: true` already create a unique index, and does the unique index make `insertManyUsageEvent` reject only the duplicate (or the whole batch, or stop half-way)? The ingest pre-checks existing ids and answers 500 on any insert error, so a retry converges either way.
8. Is GraphQL `Int` 32-bit here? (Rollup totals are `Float` to be safe.)
9. Does `schema push` accept the field `description` / `isUniqueData` / `isPIIData` keys and `collectionName` / `schemaType` at schema level as written?

**Workflows**
10. Data paths: webhook body and headers location; `$json.output.x` (if nodes, expressions) vs `$json.x` (code nodes). `workflow-io.js` accepts all seen shapes; narrow it once known.
11. Custom HTTP status from a webhook (401 / 413 / 429 / 500): the `Respond` nodes return `{ statusCode, body }` with `httpResponseMode: "last"`. If the status can't be set, the ingest must move to a small service (PLAN.md fallback).
12. Request size: uses `Content-Length` when visible, otherwise re-serialized JSON (approximate).
13. Rate-limit state per key: stored on IngestKey (`rateWindowStart`, `rateWindowCount`), 60 requests/minute, approximate under concurrency.
14. `crypto` in the code sandbox: hashing doesn't need it (pure-JS SHA-256, tested against node:crypto). Key generation needs Web Crypto `getRandomValues` or Node `randomBytes`; it fails closed (no `Math.random`).
15. With `authType: blocksAuthorization`, does an `httpRequest` with `blocksAuthentication` act as the caller (so `/iam/v4/iam/me` and `/organizations/my` return the caller)? If not, read the caller from the trigger's auth context.
16. Response shapes of `/iam/v4/iam/me`, `/iam/v4/iam/organizations/my` and `/iam/v4/iam/users/{id}?organizationId=` (membership and per-org roles). Readers fail closed.
17. API host for workflow `httpRequest` (`https://api.seliseblocks.com` assumed) and whether `x-blocks-key` is needed.
18. Gateway GraphQL details, all in `lib/graphql.js`: `get<querySchema>` names, `where` operators (`eq`, `in`, `gte`, `lt`, `or`), `insertMany*` / `update*` / `deleteMany*` argument shapes, the `filter` string format (Mongo-style JSON, `_id` vs `ItemId`, DateTime values inside it), max `pageSize`, and the `sort` syntax of the recent-challenges query.
19. `dataAction` in `rawQueryMode` running mutations, and whether `actionType` matters then.
20. Does a GraphQL/dataAction error stop the workflow or flow on as data? `Respond ...` nodes assume it flows on (confirming that a failed `getData` returns errors rather than stopping the workflow, so workflows fail closed on lookup errors); the rollup assumes either is safe.
21. Does an `if` node pass its input item on? (Respond nodes read named nodes, so it doesn't matter.) No node has two incoming edges, to avoid merge semantics.
22. Does execution history keep node outputs? The webhook output holds the raw ingest key; `Generate Key` holds the new full key.
23. Throughput: how many batched calls per minute one webhook takes.
24. Webhook `roles` for "any signed-in user": set to `platform-admin | team-admin | member`; every user (personal team included) must hold one of them.
25. Paging inside a workflow: the rollup reads at most 10,000 events per query; above that it doesn't move the watermark (touched-hours query) or fails the run (hour rebuild).
26. `RollupState.dirtyHours` is read-modify-write: two simultaneous manual edits can drop a mark (creates are still covered by the receivedAt watermark). Fix if needed with an append-only dirty-hour schema.
27. Schedule trigger parameters (`triggerInterval: "minutes"`, `minutesBetweenTriggers: 5`).

**Account linking**
28. `BigInt` in the code-node sandbox (ID-token signature check). Without it the check fails closed with `signature_check_unavailable`.
29. `httpRequest` with `authenticationType: ""` to a public URL (`Fetch Provider Keys`), and where its JSON body lands in the node output (`jwksKeys` accepts `keys`, `body`, `data`, `output`, or a JSON string).
30. `sendMail`: `to` as one expression string vs an array; whether `template` matches the template's name; the placeholder syntax for `bodyDataContext` (`{{code}}`, `{{toolName}}` assumed in `mail/link-code.json`).
31. The browser URL of a published webhook (portal `VITE_PM_WORKFLOW_WEBHOOK_BASE`), and whether the browser's Blocks session satisfies `blocksAuthorization` there.
32. Execution history: `Create Challenge` holds the mailed code and the webhook output holds the ID token (both one-use and short-lived).

## Deviations from PLAN.md / the ingest contract

- IngestKey has two extra fields for the rate limit (see [Naming](#naming)); rollup token totals are `Float`.
- An insert failure answers **500** (`insert_failed`). The contract lists no 5xx response, but it does define proxy behaviour for 5xx (retry), which is what's wanted.
- Order of checks: key format 401, then 413, then 400, then key lookup 401, 429, membership 401. The contract doesn't define precedence.
- `projectTag` is cut to 100 characters; ids longer than 256 characters are rejected. The contract sets no limit.
- `serverToolRequests` includes web fetches (PLAN.md normalization table), and all of them are priced at `webSearchPerRequest`. If web fetches aren't billed per request, the adapter should send only web searches, or add a separate column.
- The fast multiplier applies to all token kinds (cache reads and writes included) but not to web search.
- `promptCount` counts distinct `promptId`, or `eventId` when there is none (manual entries).
- Manual entries use the contract's tool list (`other` for desktop apps and subscription sign-ins); entries more than 5 minutes in the future are rejected; a portal-generated `manual_...` id is accepted so retries don't duplicate.
- issue-key defaults `sendPreview` to off unless the request sets it to `true`.
- Member removal doesn't trigger revocation by itself (there's no IAM trigger node): the team-admin page calls revoke-key with `mode: memberRemoved`, and ingest's membership check rejects the key in the meantime.
- Indexes live in `data/indexes.json` because `schema push` doesn't carry them.
- LinkedAccount, LinkChallenge and UsageEvent `accountEmail` / `accountVerified` are additions from the Connected accounts design (PLAN.md), not in the original data model.
- No workflows for Budget alerts or QuotaSnapshot posting yet (Phases 4 and 5).
