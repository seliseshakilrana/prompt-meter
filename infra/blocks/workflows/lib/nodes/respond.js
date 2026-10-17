// Code node "Respond ..." (all workflows). Mode: each.
// Turns a decision object { statusCode, responseBody } into the webhook response.
// Injected constants: SOURCE_NODE ("" = use the incoming item).
// TODO(spike): how a webhook workflow sets the HTTP status. Assumed: with
// httpResponseMode "last" the last node's output is returned, and a top-level
// `statusCode` is honoured. If not, the status must be mapped another way (or the
// ingest moves to a small service, per PLAN.md).
// Helpers: workflow-io.

const src = SOURCE_NODE ? nodeOutput($node, SOURCE_NODE) : unwrapOutput($json);
return {
  statusCode: src && src.statusCode ? src.statusCode : 500,
  body: src && src.responseBody ? src.responseBody : { error: "internal_error" }
};
