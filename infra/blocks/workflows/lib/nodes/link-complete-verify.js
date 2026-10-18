// Code node "Verify Link" (link-complete.json). Mode: each.
// Input: "Load Existing Link"; also reads "Fetch Provider Keys".
// Every outcome writes: success inserts the LinkedAccount and uses up the challenge;
// a failed sign-in uses up the challenge; a wrong code counts an attempt (the last allowed
// attempt uses it up). The unique (tool, email) index rejects a parallel second link (-> 500).
// Injected constants: GOOGLE_CLIENT_ID, MICROSOFT_CLIENT_ID (public OAuth client ids).
// Helpers: workflow-io, graphql, account-link.

const CLIENT_IDS = { google: GOOGLE_CLIENT_ID, microsoft: MICROSOFT_CLIENT_ID };
const caller = nodeOutput($node, "Identify Caller");
const plan = nodeOutput($node, "Plan Link Verify");
const challenge = plan.challenge;
const body = caller.body || {};
const nowMs = Date.now();
const now = new Date(nowMs).toISOString();
const filter = itemIdFilter(challenge.ItemId || challenge.itemId);
const result = function (statusCode, responseBody, fields) {
  const hasWrites = Array.isArray(fields) && fields.length > 0;
  return {
    ok: statusCode === 200,
    hasWrites: hasWrites,
    statusCode: statusCode,
    responseBody: responseBody,
    writeMutation: hasWrites ? buildMutation(fields) : ""
  };
};

const existingLookup = lookupItems($json);
if (!existingLookup.ok) return result(503, { error: "lookup_failed" });

let subject = null;
if (challenge.method === "email-code") {
  const matches = constantTimeEqual(linkCodeHash(challenge.challengeId, body.code.trim()), challenge.codeHash);
  if (!matches) {
    const attempts = (challenge.attempts || 0) + 1;
    return result(400, { error: "wrong_code", attemptsLeft: Math.max(0, LINK_MAX_CODE_ATTEMPTS - attempts) });
  }
} else {
  const clientId = CLIENT_IDS[challenge.method];
  if (!clientId || /^__/.test(clientId)) return result(503, { error: "provider_not_configured" });
  const keys = $node["Fetch Provider Keys"] ? $node["Fetch Provider Keys"].json : null;
  const verified = verifyIdToken(body.idToken, keys, { provider: challenge.method, clientId: clientId, nonce: challenge.nonce, nowMs: nowMs });
  if (!verified.ok) return result(401, { error: verified.reason });
  if (verified.email !== challenge.email) return result(403, { error: "email_mismatch", signedInAs: verified.email });
  subject = verified.subject;
}

const existing = existingLookup.items;
for (let i = 0; i < existing.length; i++) {
  const link = existing[i];
  if (!link || link.tool !== challenge.tool || String(link.email).toLowerCase() !== challenge.email) continue;
  if (link.userId !== caller.callerId) {
    return result(409, { error: "linked_to_another_user" }, [updateField("challenge", "LinkChallenge", filter, { usedAt: now })]);
  }
  return result(200, { linked: true, alreadyLinked: true, tool: challenge.tool, email: challenge.email },
    [updateField("challenge", "LinkChallenge", filter, { usedAt: now, verified: true })]);
}

const row = {
  userId: caller.callerId,
  tool: challenge.tool,
  email: challenge.email,
  method: challenge.method,
  providerSubject: subject,
  verifiedAt: now
};
return result(200, { linked: true, tool: challenge.tool, email: challenge.email, method: challenge.method, verifiedAt: now },
  [insertField("link", "LinkedAccount", row), updateField("challenge", "LinkChallenge", filter, { usedAt: now, verified: true })]);
