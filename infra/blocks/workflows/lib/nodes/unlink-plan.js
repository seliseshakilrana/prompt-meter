// Code node "Plan Unlink" (unlink-account.json). Mode: each.
// Body: { "linkId": "<LinkedAccount ItemId>" }
// Helpers: workflow-io, graphql.

const LINK_FIELDS = ["ItemId", "userId", "tool", "email"];
const caller = nodeOutput($node, "Identify Caller");
const none = buildListQuery("LinkedAccount", { email: { eq: "__none__" } }, LINK_FIELDS, 1);
if (!caller.ok) return Object.assign({ linkQuery: none }, caller);
const linkId = typeof (caller.body || {}).linkId === "string" ? caller.body.linkId.trim() : "";
if (!linkId || linkId.length > 64) return { ok: false, statusCode: 400, responseBody: { error: "link_id_required" }, linkQuery: none };
return { ok: true, linkId: linkId, linkQuery: buildListQuery("LinkedAccount", { ItemId: { eq: linkId } }, LINK_FIELDS, 1) };
