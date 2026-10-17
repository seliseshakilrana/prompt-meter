// Validation and normalization of one collector event (docs/ingest-contract.md "Field rules").
// Client-sent userId, teamId, costUsd, source and pricingStatus are never read: the
// returned object is built only from the whitelisted fields below.
//
// Shared helper: function declarations only. Inlined into code nodes by build.js.

const ALLOWED_TOOLS = ["claude-code", "codex", "antigravity-cli", "api", "other"];
const ALLOWED_PROVIDERS = ["anthropic", "openai", "google"];
const ALLOWED_SPEEDS = ["standard", "fast"];
const TOKEN_FIELDS = [
  "totalInputTokens",
  "uncachedInputTokens",
  "cacheReadTokens",
  "cacheWrite5mTokens",
  "cacheWrite1hTokens",
  "outputTokens",
  "serverToolRequests"
];
const MAX_ID_LENGTH = 256;
const MAX_TAG_CHARS = 100;

function isWholeNumber(value) {
  return typeof value === "number" && isFinite(value) && Math.floor(value) === value && value >= 0;
}

function isIsoUtc(value) {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]00:?00)$/.test(value)) return false;
  return !isNaN(new Date(value).getTime());
}

function optionalString(value, maxChars) {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const chars = Array.from(value);
  return { ok: true, value: chars.length > maxChars ? chars.slice(0, maxChars).join("") : value };
}

// Returns { ok: true, event } or { ok: false, eventId, reason }.
function validateCollectorEvent(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, eventId: null, reason: "not_an_object" };
  }
  const eventId = typeof raw.eventId === "string" ? raw.eventId.trim() : "";
  const fail = function (reason) {
    return { ok: false, eventId: eventId || null, reason: reason };
  };
  if (!eventId) return fail("missing_event_id");
  if (eventId.length > MAX_ID_LENGTH) return fail("event_id_too_long");
  if (ALLOWED_TOOLS.indexOf(raw.tool) < 0) return fail("invalid_tool");
  if (ALLOWED_PROVIDERS.indexOf(raw.provider) < 0) return fail("invalid_provider");
  if (typeof raw.model !== "string" || !raw.model.trim() || raw.model.length > MAX_ID_LENGTH) return fail("invalid_model");
  if (typeof raw.promptId !== "string" || !raw.promptId || raw.promptId.length > MAX_ID_LENGTH) return fail("invalid_prompt_id");
  if (!isWholeNumber(raw.callIndex)) return fail("invalid_call_index");
  for (let i = 0; i < TOKEN_FIELDS.length; i++) {
    if (!isWholeNumber(raw[TOKEN_FIELDS[i]])) return fail("invalid_" + TOKEN_FIELDS[i]);
  }
  if (!(raw.thinkingTokens === null || raw.thinkingTokens === undefined || isWholeNumber(raw.thinkingTokens))) {
    return fail("invalid_thinkingTokens");
  }
  if (!(raw.speed === null || raw.speed === undefined || ALLOWED_SPEEDS.indexOf(raw.speed) >= 0)) return fail("invalid_speed");
  if (!isIsoUtc(raw.occurredAt)) return fail("invalid_occurred_at");
  const session = optionalString(raw.sessionId, MAX_ID_LENGTH);
  if (!session.ok) return fail("invalid_session_id");
  const tag = optionalString(raw.projectTag, MAX_TAG_CHARS);
  if (!tag.ok) return fail("invalid_project_tag");
  if (!(raw.promptPreview === null || raw.promptPreview === undefined || typeof raw.promptPreview === "string")) {
    return fail("invalid_prompt_preview");
  }
  return {
    ok: true,
    event: {
      eventId: eventId,
      tool: raw.tool,
      provider: raw.provider,
      model: raw.model.trim(),
      sessionId: session.value,
      promptId: raw.promptId,
      callIndex: raw.callIndex,
      totalInputTokens: raw.totalInputTokens,
      uncachedInputTokens: raw.uncachedInputTokens,
      cacheReadTokens: raw.cacheReadTokens,
      cacheWrite5mTokens: raw.cacheWrite5mTokens,
      cacheWrite1hTokens: raw.cacheWrite1hTokens,
      outputTokens: raw.outputTokens,
      thinkingTokens: raw.thinkingTokens === undefined ? null : raw.thinkingTokens,
      serverToolRequests: raw.serverToolRequests,
      speed: raw.speed === undefined ? null : raw.speed,
      promptPreview: typeof raw.promptPreview === "string" ? raw.promptPreview : null,
      projectTag: tag.value,
      occurredAt: new Date(raw.occurredAt).toISOString()
    }
  };
}
