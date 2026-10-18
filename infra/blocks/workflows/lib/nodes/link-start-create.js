// Code node "Create Challenge" (link-start.json). Mode: each.
// Input: "Load Recent Challenges". Refuses a tool account that is already linked
// (to anyone) and more than LINK_MAX_STARTS_PER_WINDOW starts per window, then creates
// the one-time challenge. google / microsoft: the nonce goes back to the caller, who puts
// it in the sign-in request. email-code: the code goes only to the mail node.
// TODO(spike): the code is in this node's output (read by Send Code Mail); check whether
// workflow execution history keeps node outputs, and who can read it.
// Helpers: workflow-io, graphql, account-link.

const bad = function (statusCode, error) { return { ok: false, statusCode: statusCode, responseBody: { error: error } }; };
const caller = nodeOutput($node, "Identify Caller");
const plan = nodeOutput($node, "Plan Link Start");
if (!plan.ok) return plan;

const recentLookup = lookupItems($json);
if (!recentLookup.ok) return bad(503, "limits_unavailable");

const existingLookup = lookupItems($node && $node["Load Existing Link"]);
if (!existingLookup.ok) return bad(503, "limits_unavailable");

const existing = existingLookup.items;
let linkedToOther = false;
for (let i = 0; i < existing.length; i++) {
  const link = existing[i];
  if (!link || link.tool !== plan.tool || String(link.email).toLowerCase() !== plan.email) continue;
  if (link.userId === caller.callerId) return bad(409, "already_linked");
  linkedToOther = true;
}

const nowMs = Date.now();
const callerCutoff = nowMs - LINK_START_WINDOW_MS;
const accountCutoff = nowMs - LINK_ACCOUNT_WINDOW_MS;

const challenges = recentLookup.items;
let callerStarts = 0;
let accountCodeEmails = 0;

for (let i = 0; i < challenges.length; i++) {
  const c = challenges[i];
  if (!c) continue;
  const createdAtMs = c.createdAt ? new Date(c.createdAt).getTime() : NaN;
  const isCallerRecent = isNaN(createdAtMs) || createdAtMs >= callerCutoff;
  const isAccountRecent = isNaN(createdAtMs) || createdAtMs >= accountCutoff;

  if (c.userId === caller.callerId && isCallerRecent) {
    callerStarts++;
  }

  if (c.tool === plan.tool && String(c.email).toLowerCase() === plan.email && isAccountRecent && c.method === "email-code") {
    accountCodeEmails++;
  }
}

if (callerStarts >= LINK_MAX_STARTS_PER_WINDOW) return bad(429, "too_many_attempts");
if (plan.method === "email-code" && accountCodeEmails >= LINK_MAX_ACCOUNT_CODE_EMAILS_PER_DAY) {
  return bad(429, "too_many_attempts");
}

const shouldMail = plan.method === "email-code" && !linkedToOther;
const created = newLinkChallenge(caller.callerId, plan, nowMs, undefined, { linkedToOther: linkedToOther });
const responseBody = {
  challengeId: created.row.challengeId,
  tool: plan.tool,
  email: plan.email,
  method: plan.method,
  expiresAt: created.row.expiresAt
};
if (created.nonce) responseBody.nonce = created.nonce;
return {
  ok: true,
  statusCode: 200,
  insertMutation: buildMutation([insertField("challenge", "LinkChallenge", created.row)]),
  responseBody: responseBody,
  sendCode: shouldMail,
  mailTo: shouldMail ? plan.email : "",
  code: shouldMail ? (created.code || "") : "",
  toolName: LINK_TOOL_NAMES[plan.tool]
};
