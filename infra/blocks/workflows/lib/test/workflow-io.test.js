"use strict";
// Tests for workflow-io helpers (resultErrors, lookupItems) and node-level
// tolerance for empty-errors / empty-error shapes across workflows.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadHelpers, runWorkflowNode, nodes } = require("./helpers.js");
const h = loadHelpers(["workflow-io", "account-link"]);

const wrapVariants = (raw) => [
  { prefix: "", input: raw },
  { prefix: "{ json: ... } ", input: { json: raw } },
  { prefix: "{ output: ... } ", input: { output: raw } },
  { prefix: "{ json: { output: ... } } ", input: { json: { output: raw } } }
];

test("resultErrors and lookupItems: table-driven rejection of error shapes", () => {
  const rawErrorShapes = [
    { name: '{ error: "x" }', input: { error: "x" } },
    { name: "{ success: false }", input: { success: false } },
    { name: "{ isSuccess: false }", input: { isSuccess: false } },
    { name: "{ acknowledged: false }", input: { acknowledged: false } },
    { name: "{ statusCode: 500 }", input: { statusCode: 500 } },
    { name: '{ statusCode: "500" }', input: { statusCode: "500" } },
    { name: "{ status: 500 }", input: { status: 500 } },
    { name: '{ status: "500" }', input: { status: "500" } },
    { name: "{ httpStatusCode: 500 }", input: { httpStatusCode: 500 } },
    { name: '{ httpStatusCode: "500" }', input: { httpStatusCode: "500" } },
    { name: "{ ok: false }", input: { ok: false } },
    { name: "{ error: true }", input: { error: true } },
    { name: "{ error: 1 }", input: { error: 1 } },
    { name: "{ error: 500 }", input: { error: 500 } },
    { name: '{ errors: "boom" }', input: { errors: "boom" } },
    { name: '{ errors: { message: "x" } }', input: { errors: { message: "x" } } },
    { name: '{ errors: [{ message: "x" }] }', input: { errors: [{ message: "x" }] } },
    { name: '{ isSuccess: false, errors: [] }', input: { isSuccess: false, errors: [] } },
    { name: '{ isSuccess: false, errors: {} }', input: { isSuccess: false, errors: {} } }
  ];

  for (const { name, input } of rawErrorShapes) {
    for (const { prefix, input: wrapped } of wrapVariants(input)) {
      const label = `${prefix}${name}`;
      const errors = h.resultErrors(wrapped);
      assert.ok(errors.length > 0, `expected ${label} to report errors, got ${JSON.stringify(errors)}`);
      const lookup = h.lookupItems(wrapped);
      assert.deepEqual(lookup, { ok: false }, `expected ${label} lookupItems to be { ok: false }`);
    }
  }
});

test("resultErrors and lookupItems: middle wrapper layer flags are detected as errors", () => {
  const middleLayerErrorShapes = [
    { name: '{ json: { error: "x", output: { items: [] } } }', input: { json: { error: "x", output: { items: [] } } } },
    { name: '{ json: { success: false, output: { items: [] } } }', input: { json: { success: false, output: { items: [] } } } },
    { name: '{ json: { ok: false, output: { items: [] } } }', input: { json: { ok: false, output: { items: [] } } } },
    { name: '{ json: { statusCode: "500", output: { items: [] } } }', input: { json: { statusCode: "500", output: { items: [] } } } },
    { name: '{ json: { status: 500, output: { items: [] } } }', input: { json: { status: 500, output: { items: [] } } } },
    { name: '{ json: { errors: "failed", output: { items: [] } } }', input: { json: { errors: "failed", output: { items: [] } } } }
  ];

  for (const { name, input } of middleLayerErrorShapes) {
    const errors = h.resultErrors(input);
    assert.ok(errors.length > 0, `expected ${name} to report errors, got ${JSON.stringify(errors)}`);
    const lookup = h.lookupItems(input);
    assert.deepEqual(lookup, { ok: false }, `expected ${name} lookupItems to be { ok: false }`);
  }
});

test("lookupItems: table-driven rejection of bad lookup shapes", () => {
  const badLookupShapes = [
    { name: "{ data: null }", input: { data: null } },
    { name: '"boom"', input: "boom" },
    { name: "null", input: null },
    { name: "undefined", input: undefined },
    { name: "42", input: 42 },
    { name: "{}", input: {} },
    { name: "{ data: { getX: null } }", input: { data: { getX: null } } },
    { name: "{ data: { getX: {} } }", input: { data: { getX: {} } } },
    { name: "{ data: { getX: { items: null } } }", input: { data: { getX: { items: null } } } }
  ];

  for (const { name, input } of badLookupShapes) {
    // Top-level
    assert.deepEqual(h.lookupItems(input), { ok: false }, `expected top-level ${name} lookup to be { ok: false }`);
    assert.equal(h.resultErrors(input).length, 0, `expected top-level ${name} resultErrors to be 0`);

    // Wrapped in json/output
    if (input !== undefined) {
      for (const { prefix, input: wrapped } of wrapVariants(input)) {
        const label = `${prefix}${name}`;
        assert.deepEqual(h.lookupItems(wrapped), { ok: false }, `expected ${label} lookup to be { ok: false }`);
        assert.equal(h.resultErrors(wrapped).length, 0, `expected ${label} resultErrors to be 0`);
      }
    }
  }
});

test("resultErrors and lookupItems: table-driven acceptance of good lookup shapes", () => {
  const goodLookupShapes = [
    { name: "{ items: [] }", input: { items: [] }, expected: [] },
    { name: '{ items: [{ id: "1" }] }', input: { items: [{ id: "1" }] }, expected: [{ id: "1" }] },
    { name: '{ items: [], statusCode: "200" }', input: { items: [], statusCode: "200" }, expected: [] },
    { name: "{ items: [], status: 200 }", input: { items: [], status: 200 }, expected: [] },
    { name: '{ items: [], status: "ok" }', input: { items: [], status: "ok" }, expected: [] },
    { name: '{ items: [], status: "success" }', input: { items: [], status: "success" }, expected: [] },
    { name: "{ items: [], ok: true }", input: { items: [], ok: true }, expected: [] },
    { name: "{ items: [], error: 0 }", input: { items: [], error: 0 }, expected: [] },
    { name: "{ data: { getX: { items: [] } } }", input: { data: { getX: { items: [] } } }, expected: [] },
    { name: '{ data: { getX: { items: [{ id: "1" }] } } }', input: { data: { getX: { items: [{ id: "1" }] } } }, expected: [{ id: "1" }] },
    { name: '{ data: { getX: { items: [] } }, statusCode: "200" }', input: { data: { getX: { items: [] } }, statusCode: "200" }, expected: [] },
    { name: "{ data: { getX: { items: [] } }, status: 200 }", input: { data: { getX: { items: [] } }, status: 200 }, expected: [] },
    { name: '{ data: { getX: { items: [] } }, status: "ok" }', input: { data: { getX: { items: [] } }, status: "ok" }, expected: [] },
    { name: '{ data: { getX: { items: [] } }, status: "success" }', input: { data: { getX: { items: [] } }, status: "success" }, expected: [] },
    { name: "{ data: { getX: { items: [] } }, ok: true }", input: { data: { getX: { items: [] } }, ok: true }, expected: [] },
    { name: "{ data: { getX: { items: [] } }, error: 0 }", input: { data: { getX: { items: [] } }, error: 0 }, expected: [] },
    { name: "{ data: { getX: { items: [] } }, errors: null }", input: { data: { getX: { items: [] } }, errors: null }, expected: [] },
    { name: "{ data: { getX: { items: [] } }, errors: [] }", input: { data: { getX: { items: [] } }, errors: [] }, expected: [] },
    { name: "{ data: { getX: { items: [] } }, errors: {} }", input: { data: { getX: { items: [] } }, errors: {} }, expected: [] },
    { name: "{ data: { getX: { items: [] } }, error: null }", input: { data: { getX: { items: [] } }, error: null }, expected: [] },
    { name: '{ data: { getX: { items: [] } }, error: "" }', input: { data: { getX: { items: [] } }, error: "" }, expected: [] },
    { name: "{ data: { getX: { items: [] } }, error: {} }", input: { data: { getX: { items: [] } }, error: {} }, expected: [] },
    { name: "{ data: { getX: { items: [] } }, error: [] }", input: { data: { getX: { items: [] } }, error: [] }, expected: [] },
    { name: "{ data: { getX: { items: [] } }, error: false }", input: { data: { getX: { items: [] } }, error: false }, expected: [] },
    { name: "{ data: { getX: { items: [] } }, extensions: {} }", input: { data: { getX: { items: [] } }, extensions: {} }, expected: [] },
    { name: "{ data: { getX: { items: [] } }, statusCode: 200 }", input: { data: { getX: { items: [] } }, statusCode: 200 }, expected: [] },
    { name: "{ items: [], errors: [] }", input: { items: [], errors: [] }, expected: [] },
    { name: "{ items: [], errors: {} }", input: { items: [], errors: {} }, expected: [] },
    { name: "{ items: [], error: null }", input: { items: [], error: null }, expected: [] },
    { name: '{ items: [], error: "" }', input: { items: [], error: "" }, expected: [] },
    { name: "{ items: [], error: {} }", input: { items: [], error: {} }, expected: [] },
    { name: "{ items: [], error: [] }", input: { items: [], error: [] }, expected: [] },
    { name: "{ items: [], error: false }", input: { items: [], error: false }, expected: [] },
    { name: "{ items: [], extensions: {} }", input: { items: [], extensions: {} }, expected: [] },
    { name: "{ items: [], statusCode: 200 }", input: { items: [], statusCode: 200 }, expected: [] }
  ];

  for (const { name, input, expected } of goodLookupShapes) {
    for (const { prefix, input: wrapped } of wrapVariants(input)) {
      const label = `${prefix}${name}`;
      const errors = h.resultErrors(wrapped);
      assert.deepEqual(errors, [], `expected ${label} resultErrors to be empty`);
      const lookup = h.lookupItems(wrapped);
      assert.deepEqual(lookup, { ok: true, items: expected }, `expected ${label} lookupItems to succeed`);
    }
  }
});

test("resultErrors: table-driven acceptance of good write results", () => {
  const goodWriteResults = [
    { name: "{ acknowledged: true }", input: { acknowledged: true } },
    { name: '{ itemId: "item-123" }', input: { itemId: "item-123" } },
    { name: "{ totalImpactedData: 0 }", input: { totalImpactedData: 0 } },
    { name: "{ totalImpactedData: 1 }", input: { totalImpactedData: 1 } },
    { name: "{ statusCode: 200 }", input: { statusCode: 200 } },
    { name: '{ statusCode: "200" }', input: { statusCode: "200" } },
    { name: "{ status: 200 }", input: { status: 200 } },
    { name: '{ status: "ok" }', input: { status: "ok" } },
    { name: '{ status: "success" }', input: { status: "success" } },
    { name: "{ ok: true }", input: { ok: true } },
    { name: '{ message: "done" }', input: { message: "done" } },
    { name: "{ error: 0 }", input: { error: 0 } },
    { name: "{ error: null }", input: { error: null } },
    { name: '{ error: "" }', input: { error: "" } },
    { name: "{ error: {} }", input: { error: {} } },
    { name: "{ error: [] }", input: { error: [] } },
    { name: "{ error: false }", input: { error: false } },
    { name: "{ errors: null }", input: { errors: null } },
    { name: "{ success: true }", input: { success: true } },
    { name: "{ isSuccess: true }", input: { isSuccess: true } },
    { name: "{ isSuccess: true, errors: [] }", input: { isSuccess: true, errors: [] } },
    { name: "{ isSuccess: true, errors: {} }", input: { isSuccess: true, errors: {} } },
    { name: "{ acknowledged: true, insertedIds: ['a', 'b'] }", input: { acknowledged: true, insertedIds: ["a", "b"] } },
    { name: "{ acknowledged: true, deletedCount: 1 }", input: { acknowledged: true, deletedCount: 1 } }
  ];

  for (const { name, input } of goodWriteResults) {
    for (const { prefix, input: wrapped } of wrapVariants(input)) {
      const label = `${prefix}${name}`;
      const errors = h.resultErrors(wrapped);
      assert.deepEqual(errors, [], `expected ${label} resultErrors to be empty`);
    }
  }
});

test("node-level: link-complete 'Check Claim' accepts totalImpactedData: 1 with empty errors", () => {
  const inputs = [
    { totalImpactedData: 1, errors: [] },
    { totalImpactedData: 1, errors: {} },
    { totalImpactedData: 1, errors: null },
    { json: { totalImpactedData: 1, errors: [] } },
    { output: { totalImpactedData: 1, errors: {} } }
  ];

  for (const json of inputs) {
    const res = runWorkflowNode("link-complete.json", "Check Claim", {
      $json: json,
      $node: nodes({
        "Plan Link Verify": { isToken: true }
      })
    });
    assert.deepEqual(res, { ok: true, isToken: true });
  }

  // Still refuses when impacted is 0
  const zeroImpacted = runWorkflowNode("link-complete.json", "Check Claim", {
    $json: { totalImpactedData: 0, errors: [] },
    $node: nodes({
      "Plan Link Verify": { isToken: true }
    })
  });
  assert.equal(zeroImpacted.ok, false);
  assert.equal(zeroImpacted.statusCode, 409);
});

test("node-level: link-start 'Challenge Stored' answers success with empty errors", () => {
  const emptyErrorVariants = [
    { itemId: "c1", errors: [] },
    { itemId: "c1", errors: {} },
    { json: { itemId: "c1", errors: [] } },
    { output: { itemId: "c1", errors: {} } }
  ];

  for (const json of emptyErrorVariants) {
    // sendCode: true branch
    const resTrue = runWorkflowNode("link-start.json", "Challenge Stored", {
      $json: json,
      $node: nodes({
        "Create Challenge": { responseBody: { challengeId: "c1" }, sendCode: true }
      })
    });
    assert.equal(resTrue.statusCode, 200);
    assert.equal(resTrue.sendCode, true);
    assert.deepEqual(resTrue.responseBody, { challengeId: "c1" });

    // sendCode: false branch
    const resFalse = runWorkflowNode("link-start.json", "Challenge Stored", {
      $json: json,
      $node: nodes({
        "Create Challenge": { responseBody: { challengeId: "c1" }, sendCode: false }
      })
    });
    assert.equal(resFalse.statusCode, 200);
    assert.equal(resFalse.sendCode, false);
    assert.deepEqual(resFalse.responseBody, { challengeId: "c1" });
  }
});

test("node-level: link-start 'Respond Code Sent' answers 200 with empty errors", () => {
  const sendMailResults = [
    { isSuccess: true, errors: {} },
    { isSuccess: true, errors: [] },
    { json: { isSuccess: true, errors: {} } },
    { output: { isSuccess: true, errors: [] } }
  ];

  for (const json of sendMailResults) {
    const res = runWorkflowNode("link-start.json", "Respond Code Sent", {
      $json: json,
      $node: nodes({
        "Challenge Stored": { statusCode: 200, responseBody: { challengeId: "c1" } }
      })
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { challengeId: "c1" });
  }
});

test("node-level: ingest 'Respond Accepted' answers 200 with empty errors", () => {
  const writeResults = [
    { acknowledged: true, errors: [] },
    { acknowledged: true, errors: {} },
    { json: { acknowledged: true, errors: [] } },
    { output: { acknowledged: true, errors: {} } }
  ];

  for (const json of writeResults) {
    const res = runWorkflowNode("ingest.json", "Respond Accepted", {
      $json: json,
      $node: nodes({
        "Prepare Events": { statusCode: 200, responseBody: { accepted: 2, duplicates: 0, rejected: [] } }
      })
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { accepted: 2, duplicates: 0, rejected: [] });
  }
});

test("node-level: link-start 'Respond Code Sent' answers 500 mail_failed for a failed mail result", () => {
  const failedMailShapes = [
    { isSuccess: false, errors: { Email: "bad" } },
    { statusCode: 500 },
    { errors: [{ message: "x" }] }
  ];

  for (const raw of failedMailShapes) {
    for (const { prefix, input } of wrapVariants(raw)) {
      const res = runWorkflowNode("link-start.json", "Respond Code Sent", {
        $json: input,
        $node: nodes({
          "Challenge Stored": { statusCode: 200, responseBody: { challengeId: "c1" } }
        })
      });
      assert.deepEqual(
        res,
        { statusCode: 500, body: { error: "mail_failed" } },
        `expected ${prefix}${JSON.stringify(raw)} to answer 500 mail_failed`
      );
    }
  }

  const successMailShapes = [
    { isSuccess: true },
    { isSuccess: true, errors: {} },
    { isSuccess: true, errors: [] },
    { statusCode: 200 }
  ];

  for (const raw of successMailShapes) {
    for (const { prefix, input } of wrapVariants(raw)) {
      const res = runWorkflowNode("link-start.json", "Respond Code Sent", {
        $json: input,
        $node: nodes({
          "Challenge Stored": { statusCode: 200, responseBody: { challengeId: "c1" } }
        })
      });
      assert.deepEqual(
        res,
        { statusCode: 200, body: { challengeId: "c1" } },
        `expected ${prefix}${JSON.stringify(raw)} to answer 200 with challengeId`
      );
    }
  }
});

test("node-level: ingest 'Respond Accepted' answers 500 insert_failed for a failed insert", () => {
  const failedInsertShapes = [
    { errors: [{ message: "E11000" }] },
    { data: { events: { acknowledged: false } } },
    { statusCode: 500 },
    { acknowledged: false }
  ];

  for (const raw of failedInsertShapes) {
    for (const { prefix, input } of wrapVariants(raw)) {
      const res = runWorkflowNode("ingest.json", "Respond Accepted", {
        $json: input,
        $node: nodes({
          "Prepare Events": { statusCode: 200, responseBody: { accepted: 2, duplicates: 0, rejected: [] } }
        })
      });
      assert.deepEqual(
        res,
        { statusCode: 500, body: { error: "insert_failed" } },
        `expected ${prefix}${JSON.stringify(raw)} to answer 500 insert_failed`
      );
    }
  }

  const successInsertShapes = [
    { acknowledged: true },
    { data: { events: { acknowledged: true } } },
    { acknowledged: true, errors: [] },
    { acknowledged: true, errors: {} },
    { statusCode: 200 }
  ];

  for (const raw of successInsertShapes) {
    for (const { prefix, input } of wrapVariants(raw)) {
      const res = runWorkflowNode("ingest.json", "Respond Accepted", {
        $json: input,
        $node: nodes({
          "Prepare Events": { statusCode: 200, responseBody: { accepted: 2, duplicates: 0, rejected: [] } }
        })
      });
      assert.deepEqual(
        res,
        { statusCode: 200, body: { accepted: 2, duplicates: 0, rejected: [] } },
        `expected ${prefix}${JSON.stringify(raw)} to answer 200 accepted`
      );
    }
  }
});

test("node-level: rollup 'Finalize Rollup State' does not throw with empty errors in replacement node", () => {
  const replaceOutputs = [
    { acknowledged: true, errors: [] },
    { acknowledged: true, errors: {} },
    { json: { acknowledged: true, errors: [] } },
    { output: { acknowledged: true, errors: {} } }
  ];

  for (const rep of replaceOutputs) {
    assert.doesNotThrow(() => {
      const res = runWorkflowNode("rollup.json", "Finalize Rollup State", {
        $json: { data: { getRollupStates: { items: [{ name: "hourly", lastRunStartedAt: "2026-10-18T10:00:00Z", dirtyHours: [] }] } } },
        $node: nodes({
          "Plan Rollup Run": { runStartedAt: "2026-10-18T11:00:00Z" },
          "Plan Hours": { hours: ["2026-10-18T10:00:00.000Z"], truncated: false },
          "Replace Hourly Rows": rep
        })
      });
      assert.ok(res.stateMutation && res.stateMutation.includes("updateRollupState"));
    });
  }
});

test("node-level: link-start Load Recent Challenges & Load Existing Link accepts errors: [] and {}", () => {
  const emptyErrorShapes = [
    { items: [], errors: [] },
    { items: [], errors: {} },
    { data: { getLinkChallenges: { items: [] } }, errors: [] },
    { data: { getLinkChallenges: { items: [] } }, errors: {} }
  ];

  for (const shape of emptyErrorShapes) {
    const res = runWorkflowNode("link-start.json", "Create Challenge", {
      $json: shape,
      $node: nodes({
        "Identify Caller": { callerId: "user-1", body: {} },
        "Plan Link Start": { ok: true, tool: "codex", email: "target@example.com", method: "email-code" },
        "Load Existing Link": shape
      })
    });
    assert.equal(res.ok, true);
    assert.equal(res.statusCode, 200);
    assert.equal(res.sendCode, true);
    assert.match(res.responseBody.challengeId, /^[A-Za-z0-9]{24}$/);
    assert.ok(res.insertMutation.includes("insertLinkChallenge"));
  }
});

test("node-level: link-complete Load Challenge & Load Existing Link accepts errors: [] and {}", () => {
  const challengeId = "c1c1c1c1c1c1c1c1c1c1c1c1";
  const code = "654321";
  const codeHash = h.linkCodeHash(challengeId, code);
  const challengeRow = {
    ItemId: "ch-item-1",
    challengeId,
    userId: "user-1",
    tool: "codex",
    email: "user@example.com",
    method: "email-code",
    codeHash,
    attempts: 0,
    expiresAt: new Date(Date.now() + 60000).toISOString()
  };

  const emptyErrorShapes = [
    (items) => ({ items, errors: [] }),
    (items) => ({ items, errors: {} }),
    (items) => ({ data: { getItems: { items } }, errors: [] }),
    (items) => ({ data: { getItems: { items } }, errors: {} })
  ];

  for (const makeShape of emptyErrorShapes) {
    // 1. Plan Link Verify (reads Load Challenge via $json)
    const planVerifyRes = runWorkflowNode("link-complete.json", "Plan Link Verify", {
      $json: makeShape([challengeRow]),
      $node: nodes({
        "Identify Caller": { callerId: "user-1", body: { code } },
        "Plan Link Lookup": { ok: true, challengeId }
      })
    });
    assert.equal(planVerifyRes.ok, true);
    assert.ok(planVerifyRes.claimMutation.includes("updateLinkChallenge"));

    // 2. Verify Code Link (reads Load Existing Link (code) via $json)
    const verifyCodeRes = runWorkflowNode("link-complete.json", "Verify Code Link", {
      $json: makeShape([]),
      $node: nodes({
        "Identify Caller": { callerId: "user-1", body: { code } },
        "Plan Link Verify": planVerifyRes
      })
    });
    assert.equal(verifyCodeRes.ok, true);
    assert.equal(verifyCodeRes.statusCode, 200);
    assert.equal(verifyCodeRes.hasWrites, true);
    assert.equal(verifyCodeRes.responseBody.linked, true);
    assert.ok(verifyCodeRes.writeMutation.includes("insertLinkedAccount"));
  }
});

test("node-level: unlink Load Link authorizes delete with errors: [] and {}", () => {
  const linkRow = { ItemId: "link-item-1", userId: "user-1", tool: "codex", email: "user@example.com" };
  const emptyErrorShapes = [
    { items: [linkRow], errors: [] },
    { items: [linkRow], errors: {} },
    { data: { getLinkedAccounts: { items: [linkRow] } }, errors: [] },
    { data: { getLinkedAccounts: { items: [linkRow] } }, errors: {} }
  ];

  for (const shape of emptyErrorShapes) {
    const res = runWorkflowNode("unlink-account.json", "Authorize Unlink", {
      $json: shape,
      $node: nodes({
        "Identify Caller": { callerId: "user-1" },
        "Plan Unlink": { ok: true, linkId: "link-item-1" }
      })
    });
    assert.equal(res.ok, true);
    assert.equal(res.statusCode, 200);
    assert.equal(res.responseBody.unlinked, true);
    assert.ok(res.deleteMutation.includes("deleteLinkedAccount"));
  }
});

test("node-level: ingest Load Linked Accounts accepts errors: [] and {} and marks accountVerified: true", () => {
  const KEY = "pm_a1b2c3d4_" + "Q".repeat(16) + "r".repeat(16);
  const event = (id, email) => ({
    eventId: id, tool: "claude-code", provider: "anthropic", model: "claude-opus-5-5", sessionId: "s", promptId: "p", callIndex: 0,
    totalInputTokens: 10, uncachedInputTokens: 10, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, outputTokens: 1,
    thinkingTokens: null, serverToolRequests: 0, speed: "standard", promptPreview: null, projectTag: null, occurredAt: new Date().toISOString(),
    accountEmail: email
  });

  const parsed = runWorkflowNode("ingest.json", "Parse Request", {
    $node: nodes({ "Ingest Webhook": { headers: { "x-ingest-key": KEY }, output: { events: [event("e1", "dev@example.com")] } } })
  });

  const emptyErrorShapes = [
    { items: [{ tool: "claude-code", email: "dev@example.com" }], errors: [] },
    { items: [{ tool: "claude-code", email: "dev@example.com" }], errors: {} },
    { data: { getLinkedAccounts: { items: [{ tool: "claude-code", email: "dev@example.com" }] } }, errors: [] },
    { data: { getLinkedAccounts: { items: [{ tool: "claude-code", email: "dev@example.com" }] } }, errors: {} }
  ];

  for (const shape of emptyErrorShapes) {
    const out = runWorkflowNode("ingest.json", "Prepare Events", {
      $node: nodes({
        "Parse Request": { output: parsed },
        "Verify Key": { output: { userId: "user-1", teamId: "team-1", sendPreview: false } },
        "Load Linked Accounts": shape,
        "Load Model Prices": { items: [] },
        "Find Existing Events": { items: [] }
      })
    });
    assert.equal(out.responseBody.accepted, 1);
    assert.equal(out.hasInserts, true);
    assert.ok(out.insertMutation.includes('eventId: "e1"'));
    assert.ok(/eventId: "e1"[^}]*accountVerified: true/.test(out.insertMutation), "expected accountVerified: true");
  }
});
