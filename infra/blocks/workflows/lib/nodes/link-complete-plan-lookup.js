// Code node "Plan Link Lookup" (link-complete.json). Mode: each.
// Body: { "challengeId": "...", "idToken": "..." }   (google / microsoft)
//    or { "challengeId": "...", "code": "123456" }   (email-code)
// Helpers: workflow-io, graphql, account-link.

const CHALLENGE_FIELDS = ["ItemId", "challengeId", "userId", "tool", "email", "method", "nonce", "codeHash", "attempts", "codeMailed", "verified", "expiresAt", "usedAt"];
const caller = nodeOutput($node, "Identify Caller");
const none = buildListQuery("LinkChallenge", { challengeId: { eq: "__none__" } }, CHALLENGE_FIELDS, 1);
if (!caller.ok) return Object.assign({ challengeQuery: none }, caller);
const body = caller.body || {};
const challengeId = typeof body.challengeId === "string" ? body.challengeId.trim() : "";
if (!LINK_ID_PATTERN.test(challengeId)) {
  return { ok: false, statusCode: 400, responseBody: { error: "invalid_challenge_id" }, challengeQuery: none };
}
return { ok: true, challengeId: challengeId, challengeQuery: buildListQuery("LinkChallenge", { challengeId: { eq: challengeId } }, CHALLENGE_FIELDS, 1) };
