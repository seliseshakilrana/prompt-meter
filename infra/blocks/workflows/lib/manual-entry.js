// Validation of a manual usage entry sent by the portal (PLAN.md "Trusted writes" -> manual-entry).
// userId is never read from the body. teamId is read but must be checked against the
// caller's memberships by the calling node. source is always "manual".
// Depends on: validate-event.js (ALLOWED_TOOLS, ALLOWED_PROVIDERS, ALLOWED_SPEEDS, isWholeNumber,
//             isIsoUtc, optionalString), redact.js (cleanPreview)
//
// Shared helper: function declarations only. Inlined into code nodes by build.js.

const MANUAL_EVENT_ID = /^manual_[A-Za-z0-9_-]{8,64}$/;
const MANUAL_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

function newManualEventId(randomBytes) {
  const bytes = (randomBytes || secureRandomBytes)(16);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
  return "manual_" + hex;
}

// Returns { ok: true, entry } or { ok: false, reason }.
function validateManualEntry(body, nowMs) {
  const b = body && typeof body === "object" ? body : {};
  const fail = function (reason) { return { ok: false, reason: reason }; };
  const teamId = typeof b.teamId === "string" ? b.teamId.trim() : "";
  if (!teamId) return fail("team_id_required");
  if (ALLOWED_TOOLS.indexOf(b.tool) < 0) return fail("invalid_tool");
  if (ALLOWED_PROVIDERS.indexOf(b.provider) < 0) return fail("invalid_provider");
  if (typeof b.model !== "string" || !b.model.trim() || b.model.length > 256) return fail("invalid_model");
  if (!isIsoUtc(b.occurredAt)) return fail("invalid_occurred_at");
  const occurredMs = new Date(b.occurredAt).getTime();
  if (occurredMs > (nowMs || Date.now()) + MANUAL_FUTURE_TOLERANCE_MS) return fail("occurred_at_in_future");
  const counts = {};
  const names = ["uncachedInputTokens", "cacheReadTokens", "cacheWrite5mTokens", "cacheWrite1hTokens", "outputTokens", "serverToolRequests"];
  for (let i = 0; i < names.length; i++) {
    const v = b[names[i]] === undefined || b[names[i]] === null ? 0 : b[names[i]];
    if (!isWholeNumber(v)) return fail("invalid_" + names[i]);
    counts[names[i]] = v;
  }
  const inputSum = counts.uncachedInputTokens + counts.cacheReadTokens + counts.cacheWrite5mTokens + counts.cacheWrite1hTokens;
  let totalInputTokens = inputSum;
  if (b.totalInputTokens !== undefined && b.totalInputTokens !== null) {
    if (!isWholeNumber(b.totalInputTokens) || b.totalInputTokens < inputSum) return fail("invalid_totalInputTokens");
    totalInputTokens = b.totalInputTokens;
  }
  if (!(b.thinkingTokens === undefined || b.thinkingTokens === null || isWholeNumber(b.thinkingTokens))) return fail("invalid_thinkingTokens");
  if (!(b.speed === undefined || b.speed === null || ALLOWED_SPEEDS.indexOf(b.speed) >= 0)) return fail("invalid_speed");
  const tag = optionalString(b.projectTag, MAX_TAG_CHARS);
  if (!tag.ok) return fail("invalid_project_tag");
  const prompt = optionalString(b.promptId, MAX_ID_LENGTH);
  if (!prompt.ok) return fail("invalid_prompt_id");
  if (!(b.promptPreview === undefined || b.promptPreview === null || typeof b.promptPreview === "string")) return fail("invalid_prompt_preview");
  return {
    ok: true,
    entry: {
      teamId: teamId,
      tool: b.tool,
      provider: b.provider,
      model: b.model.trim(),
      sessionId: null,
      promptId: prompt.value,
      callIndex: 0,
      totalInputTokens: totalInputTokens,
      uncachedInputTokens: counts.uncachedInputTokens,
      cacheReadTokens: counts.cacheReadTokens,
      cacheWrite5mTokens: counts.cacheWrite5mTokens,
      cacheWrite1hTokens: counts.cacheWrite1hTokens,
      outputTokens: counts.outputTokens,
      thinkingTokens: b.thinkingTokens === undefined ? null : b.thinkingTokens,
      serverToolRequests: counts.serverToolRequests,
      speed: b.speed === undefined ? null : b.speed,
      promptPreview: cleanPreview(b.promptPreview, true),
      projectTag: tag.value,
      occurredAt: new Date(b.occurredAt).toISOString()
    }
  };
}
