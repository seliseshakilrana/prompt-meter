"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadHelpers } = require("./helpers.js");
const { validateCollectorEvent } = loadHelpers(["validate-event"]);

const good = {
  eventId: "msg_01ABC", tool: "claude-code", provider: "anthropic", model: "claude-opus-5-5", sessionId: null,
  promptId: "p1", callIndex: 0, totalInputTokens: 10, uncachedInputTokens: 10, cacheReadTokens: 0, cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0, outputTokens: 5, thinkingTokens: null, serverToolRequests: 0, speed: "standard",
  promptPreview: "hi", projectTag: null, occurredAt: "2026-10-17T09:30:00.000Z"
};

test("accepts the contract example and drops client-sent ownership/cost fields", () => {
  const r = validateCollectorEvent(Object.assign({}, good, { userId: "evil", teamId: "evil", costUsd: 0, source: "manual", pricingStatus: "priced" }));
  assert.equal(r.ok, true);
  for (const f of ["userId", "teamId", "costUsd", "source", "pricingStatus"]) assert.equal(f in r.event, false, f);
});

test("rejects bad fields with a reason", () => {
  const cases = [
    [{ eventId: "" }, "missing_event_id"], [{ tool: "vim" }, "invalid_tool"], [{ provider: "x" }, "invalid_provider"],
    [{ model: "" }, "invalid_model"], [{ callIndex: -1 }, "invalid_call_index"], [{ outputTokens: 1.5 }, "invalid_outputTokens"],
    [{ cacheReadTokens: "3" }, "invalid_cacheReadTokens"], [{ thinkingTokens: -2 }, "invalid_thinkingTokens"],
    [{ speed: "turbo" }, "invalid_speed"], [{ occurredAt: "2026-10-17 09:30" }, "invalid_occurred_at"],
    [{ occurredAt: "2026-10-17T15:30:00+06:00" }, "invalid_occurred_at"], [{ promptId: null }, "invalid_prompt_id"]
  ];
  for (const [patch, reason] of cases) {
    const r = validateCollectorEvent(Object.assign({}, good, patch));
    assert.equal(r.ok, false, JSON.stringify(patch));
    assert.equal(r.reason, reason, JSON.stringify(patch));
  }
  assert.equal(validateCollectorEvent(null).reason, "not_an_object");
});

test("speed and thinkingTokens may be null or missing", () => {
  const e = Object.assign({}, good);
  delete e.speed; delete e.thinkingTokens;
  const r = validateCollectorEvent(e);
  assert.equal(r.ok, true);
  assert.equal(r.event.speed, null);
  assert.equal(r.event.thinkingTokens, null);
});
