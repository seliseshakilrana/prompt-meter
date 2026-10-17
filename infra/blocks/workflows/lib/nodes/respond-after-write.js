// Code node "Respond ..." after a write (ingest, issue-key, revoke-key, manual-entry). Mode: each.
// Input: the dataAction rawQuery result. On any reported error -> 500 so callers retry
// (the ingest proxy retries 5xx; resending a batch is safe because eventId is unique).
// Injected constants: SOURCE_NODE (the node holding responseBody), ERROR_CODE.
// Helpers: workflow-io.

const plan = nodeOutput($node, SOURCE_NODE);
const errors = resultErrors($json);
if (errors.length) {
  return { statusCode: 500, body: { error: ERROR_CODE } };
}
return { statusCode: plan.statusCode || 200, body: plan.responseBody };
