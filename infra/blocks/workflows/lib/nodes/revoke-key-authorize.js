// Code node "Authorize Revoke" (revoke-key.json). Mode: each.
// Input: "Get Caller Team Access" (IAM user record of the caller with ?organizationId=<teamId>).
// own: every loaded key must belong to the caller. memberRemoved: caller must be
// team-admin in that team (or platform-admin).
// TODO(spike): per-organization roles - does the IAM record carry the caller's role in
// that organization? Fails closed if not.
// Helpers: workflow-io, graphql.

const bad = function (statusCode, error) { return { ok: false, statusCode: statusCode, responseBody: { error: error } }; };
const caller = nodeOutput($node, "Identify Caller");
const plan = nodeOutput($node, "Plan Revoke");
if (!plan.ok) return plan;
const keys = extractItems($node["Load Target Keys"] ? $node["Load Target Keys"].json : null);

if (plan.mode === "own") {
  if (keys.length !== 1 || keys[0].userId !== caller.callerId) return bad(404, "key_not_found");
} else {
  const membership = membershipIn($json, plan.teamId);
  const isTeamAdmin = !!membership && hasRole(membership, "team-admin");
  if (!isTeamAdmin && !caller.isPlatformAdmin) return bad(403, "not_team_admin");
}

const targets = keys.filter(function (k) { return k && k.revoked !== true; });
if (!targets.length) {
  return { ok: true, hasWrites: false, statusCode: 200, responseBody: { revoked: 0 }, revokeMutation: "" };
}
const fields = targets.map(function (k, i) {
  return updateField("k" + i, "IngestKey", itemIdFilter(k.ItemId || k.itemId), { revoked: true });
});
return {
  ok: true,
  hasWrites: true,
  statusCode: 200,
  responseBody: { revoked: targets.length, keyPrefixes: targets.map(function (k) { return k.keyPrefix; }) },
  revokeMutation: buildMutation(fields)
};
