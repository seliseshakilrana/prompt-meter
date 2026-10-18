// Code node "Challenge Stored" (link-start.json). Mode: each.
// Input: the "Store Challenge" insert result. Decides the response and whether a code
// mail goes out; nothing is mailed when the challenge could not be stored.
// Helpers: workflow-io.

const plan = nodeOutput($node, "Create Challenge");
if (resultErrors($json).length) {
  return { statusCode: 500, responseBody: { error: "challenge_store_failed" }, sendCode: false };
}
return { statusCode: 200, responseBody: plan.responseBody, sendCode: plan.sendCode === true };
