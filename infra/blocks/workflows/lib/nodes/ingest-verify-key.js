// Code node "Verify Key" (ingest.json). Mode: each. Input: "Find Ingest Key" result.
// Constant-time hash compare, revoked check, per-key rate limit.
// TODO(spike): the workflow identity must be able to read IngestKey.keyHash even though
// rules.json hides that column from every browser user.
// Helpers: workflow-io, sha256, ingest-key.

const RATE_LIMIT_PER_MINUTE = 60;
const invalid = { ok: false, statusCode: 401, responseBody: { error: "invalid_key" } };

const parsed = nodeOutput($node, "Parse Request");
let keys = extractItems($json);
const self = unwrapOutput($json);
if (!keys.length && self && self.keyHash) keys = [self];
if (keys.length !== 1) return invalid;

const key = keys[0];
if (!constantTimeEqual(String(key.keyHash || "").toLowerCase(), parsed.presentedKeyHash)) return invalid;
if (key.revoked === true) return invalid;
if (!key.userId || !key.teamId) return invalid;

const nowMs = Date.now();
const rate = rateLimitDecision(key.rateWindowStart, key.rateWindowCount, nowMs, RATE_LIMIT_PER_MINUTE);
if (!rate.allowed) {
  return {
    ok: false,
    statusCode: 429,
    responseBody: { error: "rate_limited", retryAfterSeconds: rate.retryAfterSeconds }
  };
}

return {
  ok: true,
  keyItemId: key.ItemId || key.itemId || null,
  userId: key.userId,
  teamId: key.teamId,
  sendPreview: key.sendPreview === true,
  usedAt: new Date(nowMs).toISOString(),
  rateWindowStart: rate.windowStart,
  rateWindowCount: rate.windowCount
};
