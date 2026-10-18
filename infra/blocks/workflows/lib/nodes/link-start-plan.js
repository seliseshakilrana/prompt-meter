// Code node "Plan Link Start" (link-start.json). Mode: each.
// Body: { "tool": "claude-code" | "codex" | "antigravity-cli", "email": "...",
//         "method": "google" | "microsoft" | "email-code" } (allowed methods depend on the tool).
// Builds the lookups for: is this tool account already linked, and how many attempts the
// caller started recently.
// Helpers: workflow-io, graphql, account-link.

const LINK_FIELDS = ["ItemId", "userId", "tool", "email"];
const CHALLENGE_FIELDS = ["challengeId", "userId", "tool", "email", "method", "attempts", "codeMailed", "verified", "codeHash", "createdAt"];
const none = {
  existingLinkQuery: buildListQuery("LinkedAccount", { email: { eq: "__none__" } }, LINK_FIELDS, 1),
  recentChallengesQuery: buildListQuery("LinkChallenge", { challengeId: { eq: "__none__" } }, CHALLENGE_FIELDS, 1)
};
const caller = nodeOutput($node, "Identify Caller");
if (!caller.ok) return Object.assign({}, none, caller);
const request = parseLinkStartRequest(caller.body);
if (!request.ok) return Object.assign({}, none, { ok: false, statusCode: 400, responseBody: { error: request.error } });
const nowMs = Date.now();
const sinceCaller = new Date(nowMs - LINK_START_WINDOW_MS).toISOString();
const sinceAccount = new Date(nowMs - LINK_ACCOUNT_WINDOW_MS).toISOString();
const recentFilter = {
  or: [
    { userId: { eq: caller.callerId }, createdAt: { gte: sinceCaller } },
    { tool: { eq: request.tool }, email: { eq: request.email }, method: { eq: "email-code" }, createdAt: { gte: sinceAccount } }
  ]
};
return {
  ok: true,
  tool: request.tool,
  email: request.email,
  method: request.method,
  existingLinkQuery: buildListQuery("LinkedAccount", { tool: { eq: request.tool }, email: { eq: request.email } }, LINK_FIELDS, 5),
  recentChallengesQuery: buildListQuery("LinkChallenge", recentFilter, CHALLENGE_FIELDS, 200, { createdAt: -1 })
};
