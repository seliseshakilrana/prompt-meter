// Code node "Plan Revoke" (revoke-key.json). Mode: each.
// Two modes:
//   { "mode": "own", "keyId": "<IngestKey ItemId>" }            owner revokes one of their keys
//   { "mode": "memberRemoved", "userId": "...", "teamId": "..." } team admin revokes all keys
//                                                                  of a member removed from the team
// Helpers: workflow-io, graphql.

const KEY_FIELDS = ["ItemId", "userId", "teamId", "keyPrefix", "revoked"];
const bad = function (statusCode, error) { return { ok: false, statusCode: statusCode, responseBody: { error: error } }; };
const caller = nodeOutput($node, "Identify Caller");
if (!caller.ok) return Object.assign({ teamId: "", loadQuery: buildListQuery("IngestKey", { keyPrefix: { eq: "__none__" } }, KEY_FIELDS, 1) }, caller);
const body = caller.body || {};
const none = buildListQuery("IngestKey", { keyPrefix: { eq: "__none__" } }, KEY_FIELDS, 1);
if (body.mode === "own") {
  const keyId = typeof body.keyId === "string" ? body.keyId.trim() : "";
  if (!keyId) return Object.assign(bad(400, "key_id_required"), { teamId: "", loadQuery: none });
  return { ok: true, mode: "own", teamId: "", loadQuery: buildListQuery("IngestKey", { ItemId: { eq: keyId } }, KEY_FIELDS, 1) };
}
if (body.mode === "memberRemoved") {
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const teamId = typeof body.teamId === "string" ? body.teamId.trim() : "";
  if (!userId || !teamId) return Object.assign(bad(400, "user_id_and_team_id_required"), { teamId: "", loadQuery: none });
  return {
    ok: true,
    mode: "memberRemoved",
    userId: userId,
    teamId: teamId,
    loadQuery: buildListQuery("IngestKey", { userId: { eq: userId }, teamId: { eq: teamId }, revoked: { eq: false } }, KEY_FIELDS, 1000)
  };
}
return Object.assign(bad(400, "invalid_mode"), { teamId: "", loadQuery: none });
