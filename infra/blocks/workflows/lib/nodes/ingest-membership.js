// Code node "Membership Result" (ingest.json). Mode: each.
// Input: "Check Team Membership" (IAM user record fetched with ?organizationId=<teamId>).
// A key whose owner left the team is rejected exactly like a bad key (401).
// TODO(spike): response shape of GET /iam/v4/iam/users/{id}?organizationId=...; fails closed.
// Also builds the lookup of the owner's linked tool accounts (Prepare Events marks
// accountEmail verified against it).
// Helpers: workflow-io, graphql.

const key = nodeOutput($node, "Verify Key");
if (!membershipIn($json, key.teamId)) {
  return { ok: false, statusCode: 401, responseBody: { error: "invalid_key" } };
}
return {
  ok: true,
  linkedAccountsQuery: buildListQuery("LinkedAccount", { userId: { eq: key.userId } }, ["tool", "email"], 100)
};
