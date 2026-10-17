// Code node "Parse Request" (ingest.json). Mode: each.
// Reads the webhook request, checks the key format, size and body shape, hashes the
// presented key (the raw key is not passed on), and builds the lookup queries.
// Injected constants: TRIGGER_NODE.
// Helpers: workflow-io, sha256, ingest-key, graphql.

const MAX_EVENTS = 100;
const MAX_BYTES = 256 * 1024;

const reject = function (statusCode, error) {
  return { ok: false, statusCode: statusCode, responseBody: { error: error } };
};

const trigger = $node[TRIGGER_NODE] ? $node[TRIGGER_NODE].json : $json;
const request = readWebhookRequest(trigger);

// 401 first: a missing or malformed key never gets further.
const parsedKey = parseIngestKey(headerValue(request.headers, "x-ingest-key"));
if (!parsedKey) return reject(401, "invalid_key");

if (requestBytes(request) > MAX_BYTES) return reject(413, "too_large");
if (request.parseError || !request.body) return reject(400, "body_not_json");
const events = request.body.events;
if (!Array.isArray(events)) return reject(400, "events_missing");
if (events.length > MAX_EVENTS) return reject(413, "too_large");

const ids = [];
const seen = {};
for (let i = 0; i < events.length; i++) {
  const e = events[i];
  const id = e && typeof e.eventId === "string" ? e.eventId.trim() : "";
  if (id && id.length <= 256 && !seen[id]) {
    seen[id] = true;
    ids.push(id);
  }
}

return {
  ok: true,
  statusCode: 200,
  keyPrefix: parsedKey.prefix,
  presentedKeyHash: hashIngestKey(parsedKey.key),
  events: events,
  keyLookupQuery: buildListQuery(
    "IngestKey",
    { keyPrefix: { eq: parsedKey.prefix } },
    ["ItemId", "userId", "teamId", "keyHash", "revoked", "sendPreview", "rateWindowStart", "rateWindowCount"],
    2
  ),
  existingEventsQuery: buildListQuery("UsageEvent", { eventId: { in: ids.length ? ids : ["__none__"] } }, ["eventId"], Math.max(ids.length, 1))
};
