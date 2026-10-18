// Code node "Check Claim" (link-complete.json). Mode: each.
// Input: "Claim Challenge" (dataAction updateData result).
// Refuse when the conditional update changed no row (parallel request beat us, or already used).
// Helpers: workflow-io.

const plan = nodeOutput($node, "Plan Link Verify");
const errors = resultErrors($json);
const impacted = extractTotalImpactedData($json);

if (errors.length || impacted !== 1) {
  return {
    ok: false,
    statusCode: 409,
    responseBody: { error: "challenge_busy" }
  };
}

return {
  ok: true,
  isToken: plan.isToken === true
};
