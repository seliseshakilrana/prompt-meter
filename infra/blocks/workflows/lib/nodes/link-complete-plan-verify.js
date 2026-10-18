// Code node "Plan Link Verify" (link-complete.json). Mode: each.
// Input: "Load Challenge". The challenge must belong to the caller, be unused, unexpired,
// and the request must carry the proof its method needs. Picks the provider key set to
// fetch and builds the lookup of existing links for that tool account.
// email-code needs no provider keys; link-complete branches so only token verification
// (Google / Microsoft) fetches provider keys (Fix 8).
// Injected constants: GOOGLE_CLIENT_ID, MICROSOFT_CLIENT_ID (public OAuth client ids).
// Helpers: workflow-io, graphql, account-link.

const CLIENT_IDS = { google: GOOGLE_CLIENT_ID, microsoft: MICROSOFT_CLIENT_ID };
const LINK_FIELDS = ["ItemId", "userId", "tool", "email"];
const fallback = {
  isToken: false,
  claimMutation: "",
  jwksUrl: "",
  existingLinkQuery: buildListQuery("LinkedAccount", { email: { eq: "__none__" } }, LINK_FIELDS, 1)
};
const bad = function (statusCode, error) { return Object.assign({ ok: false, statusCode: statusCode, responseBody: { error: error } }, fallback); };
const caller = nodeOutput($node, "Identify Caller");
const lookup = nodeOutput($node, "Plan Link Lookup");
if (!lookup.ok) return Object.assign({}, fallback, lookup);
const challengeLookup = lookupItems($json);
if (!challengeLookup.ok) return bad(503, "lookup_failed");
const items = challengeLookup.items;
const challenge = items.length === 1 && items[0].challengeId === lookup.challengeId ? items[0] : null;
const problem = linkChallengeProblem(challenge, caller.callerId, Date.now());
if (problem) return bad(problem.statusCode, problem.error);

const body = caller.body || {};
if (challenge.method === "email-code") {
  if (typeof body.code !== "string" || !/^\d{6}$/.test(body.code.trim())) return bad(400, "code_required");
} else if (LINK_PROVIDERS[challenge.method]) {
  if (typeof body.idToken !== "string" || !body.idToken) return bad(400, "id_token_required");
  const clientId = CLIENT_IDS[challenge.method];
  if (!clientId || /^__/.test(clientId)) return bad(503, "provider_not_configured");
} else {
  return bad(400, "unknown_method");
}

const nowMs = Date.now();
const now = new Date(nowMs).toISOString();
const isToken = challenge.method === "google" || challenge.method === "microsoft";
const attempts = typeof challenge.attempts === "number" ? challenge.attempts : 0;
const nextAttempts = attempts + 1;
const setUsedAt = isToken || nextAttempts >= LINK_MAX_CODE_ATTEMPTS;
const claimFilter = challengeClaimFilter(challenge.challengeId, attempts, challenge.ItemId || challenge.itemId);
const claimInput = setUsedAt ? { attempts: nextAttempts, usedAt: now } : { attempts: nextAttempts };
const claimMutation = buildMutation([updateField("claim", "LinkChallenge", claimFilter, claimInput)]);

return {
  ok: true,
  isToken: isToken,
  challenge: challenge,
  claimMutation: claimMutation,
  jwksUrl: isToken && LINK_PROVIDERS[challenge.method] ? LINK_PROVIDERS[challenge.method].jwksUrl : "",
  existingLinkQuery: buildListQuery("LinkedAccount", { tool: { eq: challenge.tool }, email: { eq: challenge.email } }, LINK_FIELDS, 5)
};
