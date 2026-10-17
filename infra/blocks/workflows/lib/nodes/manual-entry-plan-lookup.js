// Code node "Plan Manual Lookup" (manual-entry.json). Mode: each.
// Body: { "action": "create" | "update" | "delete", "eventId"?: "manual_...", ...entry fields }.
// create: eventId is generated here unless the portal sent its own manual_ id (safe retries).
// update/delete: eventId names the caller's own manual event.
// Helpers: workflow-io, graphql, ingest-key (secureRandomBytes), manual-entry.

const EVENT_FIELDS = ["ItemId", "eventId", "userId", "teamId", "source", "occurredAt", "receivedAt"];
const caller = nodeOutput($node, "Identify Caller");
const none = buildListQuery("UsageEvent", { eventId: { eq: "__none__" } }, EVENT_FIELDS, 1);
const bad = function (statusCode, error) { return { ok: false, statusCode: statusCode, responseBody: { error: error }, existingQuery: none }; };
if (!caller.ok) return Object.assign({ existingQuery: none }, caller);
const body = caller.body || {};
const action = body.action;
if (["create", "update", "delete"].indexOf(action) < 0) return bad(400, "invalid_action");
let eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
if (action === "create") {
  if (!eventId) eventId = newManualEventId();
  if (!MANUAL_EVENT_ID.test(eventId)) return bad(400, "invalid_event_id");
} else if (!MANUAL_EVENT_ID.test(eventId)) {
  return bad(400, "invalid_event_id");
}
return {
  ok: true,
  action: action,
  eventId: eventId,
  existingQuery: buildListQuery("UsageEvent", { eventId: { eq: eventId } }, EVENT_FIELDS, 1)
};
