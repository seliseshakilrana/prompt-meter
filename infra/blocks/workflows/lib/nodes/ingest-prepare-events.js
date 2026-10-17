// Code node "Prepare Events" (ingest.json). Mode: each.
// For every event: validate, skip duplicates (already stored or repeated in the batch),
// set userId/teamId from the key (never from the client), re-clean the preview (or drop
// it when sendPreview is off), price it, and build one insertMany mutation.
// Helpers: workflow-io, graphql, validate-event, redact, cost.

const parsed = nodeOutput($node, "Parse Request");
const key = nodeOutput($node, "Verify Key");
const prices = extractItems($node["Load Model Prices"] ? $node["Load Model Prices"].json : null);
const existing = extractItems($node["Find Existing Events"] ? $node["Find Existing Events"].json : null);

const stored = {};
for (let i = 0; i < existing.length; i++) if (existing[i] && existing[i].eventId) stored[existing[i].eventId] = true;

const receivedAt = new Date().toISOString();
const rows = [];
const rejected = [];
const inBatch = {};
let duplicates = 0;
const events = Array.isArray(parsed.events) ? parsed.events : [];

for (let i = 0; i < events.length; i++) {
  const v = validateCollectorEvent(events[i]);
  if (!v.ok) {
    rejected.push({ eventId: v.eventId, reason: v.reason });
    continue;
  }
  const e = v.event;
  if (stored[e.eventId] || inBatch[e.eventId]) {
    duplicates += 1;
    continue;
  }
  inBatch[e.eventId] = true;
  const cost = priceEvent(prices, e);
  rows.push({
    eventId: e.eventId,
    source: "proxy",
    userId: key.userId,
    teamId: key.teamId,
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
    promptPreview: cleanPreview(e.promptPreview, key.sendPreview === true),
    projectTag: e.projectTag,
    occurredAt: e.occurredAt,
    receivedAt: receivedAt
  });
}

return {
  ok: true,
  statusCode: 200,
  hasInserts: rows.length > 0,
  insertMutation: rows.length ? buildMutation([insertManyField("events", "UsageEvent", rows)]) : "",
  responseBody: { accepted: rows.length, duplicates: duplicates, rejected: rejected }
};
