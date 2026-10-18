// Code node "Authorize Unlink" (unlink-account.json). Mode: each.
// Input: "Load Link". Only the owner removes a link; anyone else gets the same 404 as a
// missing one.
// Helpers: workflow-io, graphql.

const caller = nodeOutput($node, "Identify Caller");
const plan = nodeOutput($node, "Plan Unlink");
if (!plan.ok) return plan;
const linkLookup = lookupItems($json);
if (!linkLookup.ok) {
  return { ok: false, statusCode: 503, responseBody: { error: "lookup_failed" } };
}
const items = linkLookup.items;
const link = items.length === 1 ? items[0] : null;
if (!link || (link.ItemId || link.itemId) !== plan.linkId || link.userId !== caller.callerId) {
  return { ok: false, statusCode: 404, responseBody: { error: "link_not_found" } };
}
return {
  ok: true,
  statusCode: 200,
  responseBody: { unlinked: true, tool: link.tool, email: link.email },
  deleteMutation: buildMutation([deleteField("link", "LinkedAccount", itemIdFilter(plan.linkId))])
};
