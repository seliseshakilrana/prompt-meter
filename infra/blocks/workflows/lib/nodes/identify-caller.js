// Code node "Identify Caller" (issue-key, revoke-key, manual-entry). Mode: each.
// Input: "Get Caller" (GET /iam/v4/iam/me through blocksAuthentication).
// The caller's userId comes ONLY from their Blocks login, never from the body.
// TODO(spike): with authType blocksAuthorization, does httpRequest + blocksAuthentication
// act as the CALLER (so /me returns them)? If it acts as a workflow/service identity,
// the caller id must come from the trigger's own auth context instead.
// Injected constants: TRIGGER_NODE.
// Helpers: workflow-io.

const request = readWebhookRequest($node[TRIGGER_NODE] ? $node[TRIGGER_NODE].json : null);
const callerId = extractUserId($json);
if (!callerId) {
  return { ok: false, statusCode: 401, responseBody: { error: "unauthenticated" } };
}
return {
  ok: true,
  callerId: callerId,
  isPlatformAdmin: hasRole($json, "platform-admin"),
  body: request.body && typeof request.body === "object" ? request.body : {}
};
