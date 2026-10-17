// Code node "Membership Result" (ingest.json). Mode: each.
// Input: "Check Team Membership" (IAM user record fetched with ?organizationId=<teamId>).
// A key whose owner left the team is rejected exactly like a bad key (401).
// TODO(spike): response shape of GET /iam/v4/iam/users/{id}?organizationId=...; fails closed.
// Helpers: workflow-io.

const key = nodeOutput($node, "Verify Key");
if (!membershipIn($json, key.teamId)) {
  return { ok: false, statusCode: 401, responseBody: { error: "invalid_key" } };
}
return { ok: true };
