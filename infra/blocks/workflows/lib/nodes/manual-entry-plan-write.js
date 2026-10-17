// Code node "Plan Manual Write" (manual-entry.json). Mode: each.
// Authorizes and builds one mutation: the event write, then the RollupState dirty-hour mark.
//  - userId = the caller; teamId must be one of the caller's organizations.
//  - source is always "manual"; proxy events can never be edited or deleted here.
//  - cost is computed with the same price rules as ingest.
//  - the old hour (update/delete) and new hour (create/update) are marked dirty.
// TODO(spike): RollupState.dirtyHours is read-modify-write; two manual edits at the same
// moment can drop one mark (creates are still covered by the receivedAt watermark).
// Helpers: workflow-io, graphql, validate-event, redact, cost, rollup, manual-entry.

const bad = function (statusCode, error) { return { ok: false, statusCode: statusCode, responseBody: { error: error } }; };
const caller = nodeOutput($node, "Identify Caller");
if (!caller.ok) return caller;
const lookup = nodeOutput($node, "Plan Manual Lookup");
if (!lookup.ok) return lookup;
const json = function (name) { return $node[name] ? $node[name].json : null; };
const orgs = json("Get Caller Organizations");
const existing = extractItems(json("Load Existing Event"))[0] || null;
const prices = extractItems(json("Load Model Prices"));
const state = extractItems(json("Load Rollup State"))[0] || null;
const body = caller.body || {};
const nowMs = Date.now();
const now = new Date(nowMs).toISOString();
const dirty = [];
const fields = [];
let responseBody;

if (lookup.action === "create" && existing) {
  if (existing.userId !== caller.callerId) return bad(409, "event_id_taken");
  return { ok: true, hasWrites: false, statusCode: 200, responseBody: { eventId: existing.eventId, duplicate: true } };
}
if (lookup.action !== "create") {
  if (!existing || existing.userId !== caller.callerId) return bad(404, "event_not_found");
  if (existing.source !== "manual") return bad(403, "only_manual_events_can_change");
  dirty.push(hourStartOf(existing.occurredAt));
}

if (lookup.action === "delete") {
  fields.push(deleteField("event", "UsageEvent", itemIdFilter(existing.ItemId || existing.itemId)));
  responseBody = { eventId: existing.eventId, deleted: true };
} else {
  const v = validateManualEntry(body, nowMs);
  if (!v.ok) return bad(400, v.reason);
  if (!membershipIn(orgs, v.entry.teamId)) return bad(403, "not_a_team_member");
  const e = v.entry;
  const cost = priceEvent(prices, e);
  const values = {
    teamId: e.teamId,
    tool: e.tool,
    provider: e.provider,
    model: e.model,
    sessionId: e.sessionId,
    promptId: e.promptId,
    callIndex: e.callIndex,
    totalInputTokens: e.totalInputTokens,
    uncachedInputTokens: e.uncachedInputTokens,
    cacheReadTokens: e.cacheReadTokens,
    cacheWrite5mTokens: e.cacheWrite5mTokens,
    cacheWrite1hTokens: e.cacheWrite1hTokens,
    outputTokens: e.outputTokens,
    thinkingTokens: e.thinkingTokens,
    serverToolRequests: e.serverToolRequests,
    speed: e.speed,
    costUsd: cost.costUsd,
    pricingStatus: cost.pricingStatus,
    promptPreview: e.promptPreview,
    projectTag: e.projectTag,
    occurredAt: e.occurredAt
  };
  dirty.push(hourStartOf(e.occurredAt));
  if (lookup.action === "create") {
    fields.push(insertField("event", "UsageEvent", Object.assign({ eventId: lookup.eventId, source: "manual", userId: caller.callerId }, values, { receivedAt: now })));
  } else {
    fields.push(updateField("event", "UsageEvent", itemIdFilter(existing.ItemId || existing.itemId), values));
  }
  responseBody = { eventId: lookup.eventId, costUsd: cost.costUsd, pricingStatus: cost.pricingStatus };
}

const dirtyHours = normalizeHours((state && Array.isArray(state.dirtyHours) ? state.dirtyHours : []).concat(dirty));
fields.push(
  state
    ? updateField("state", "RollupState", filterString({ name: ROLLUP_STATE_NAME }), { dirtyHours: dirtyHours })
    : insertField("state", "RollupState", { name: ROLLUP_STATE_NAME, lastRunStartedAt: null, lastRunFinishedAt: null, dirtyHours: dirtyHours })
);
return { ok: true, hasWrites: true, statusCode: 200, responseBody: responseBody, writeMutation: buildMutation(fields) };
