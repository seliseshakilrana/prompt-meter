"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadHelpers } = require("./helpers.js");
const r = loadHelpers(["rollup"]);

const NOW = Date.parse("2026-10-17T12:00:00.000Z");

test("watermark: previous start minus 2 minutes", () => {
  const p = r.planRollupRun({ lastRunStartedAt: "2026-10-17T11:55:00.000Z", dirtyHours: ["2026-10-01T03:20:00Z"] }, NOW);
  assert.equal(p.receivedSince, "2026-10-17T11:53:00.000Z");
  assert.equal(p.runStartedAt, "2026-10-17T12:00:00.000Z");
  assert.deepEqual(p.dirtyHours, ["2026-10-01T03:00:00.000Z"]);
});

test("watermark never goes back more than 48 hours (and starts there with no state)", () => {
  assert.equal(r.planRollupRun({ lastRunStartedAt: "2026-10-01T00:00:00Z" }, NOW).receivedSince, "2026-10-15T12:00:00.000Z");
  assert.equal(r.planRollupRun(null, NOW).receivedSince, "2026-10-15T12:00:00.000Z");
});

test("hours to rebuild = touched occurredAt hours + dirty hours, deduplicated and sorted", () => {
  const hours = r.hoursToRebuild(
    [{ occurredAt: "2026-10-17T11:59:59Z" }, { occurredAt: "2026-10-17T11:00:00Z" }, { occurredAt: "2026-10-14T05:10:00Z" }],
    ["2026-10-17T11:00:00.000Z", "2026-10-10T00:00:00.000Z"]
  );
  assert.deepEqual(hours, ["2026-10-10T00:00:00.000Z", "2026-10-14T05:00:00.000Z", "2026-10-17T11:00:00.000Z"]);
  assert.deepEqual(r.hoursWhere(["2026-10-17T11:00:00.000Z"]), { occurredAt: { gte: "2026-10-17T11:00:00.000Z", lt: "2026-10-17T12:00:00.000Z" } });
  assert.equal(r.hoursWhere(hours).or.length, 3);
});

test("aggregateHourly groups by UTC hour, tool, model, source; counts prompts per user row", () => {
  const base = { teamId: "t", tool: "claude-code", model: "m", source: "proxy", totalInputTokens: 10, uncachedInputTokens: 10, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, outputTokens: 1, thinkingTokens: null, serverToolRequests: 0 };
  const events = [
    Object.assign({}, base, { eventId: "1", userId: "a", promptId: "p1", occurredAt: "2026-10-17T10:05:00Z", costUsd: 0.1 }),
    Object.assign({}, base, { eventId: "2", userId: "a", promptId: "p1", occurredAt: "2026-10-17T10:59:59Z", costUsd: 0.2 }),
    Object.assign({}, base, { eventId: "3", userId: "b", promptId: "p2", occurredAt: "2026-10-17T10:30:00Z", costUsd: null }),
    Object.assign({}, base, { eventId: "4", userId: "a", promptId: null, source: "manual", occurredAt: "2026-10-17T10:10:00Z", costUsd: 1 }),
    Object.assign({}, base, { eventId: "5", userId: "a", promptId: "p3", occurredAt: "2026-10-17T11:00:00Z", costUsd: 0.3 })
  ];
  const { userRows, teamRows } = r.aggregateHourly(events);
  const a10 = userRows.find((x) => x.userId === "a" && x.hourStart === "2026-10-17T10:00:00.000Z" && x.source === "proxy");
  assert.equal(a10.eventCount, 2);
  assert.equal(a10.promptCount, 1);
  assert.equal(a10.totalInputTokens, 20);
  assert.ok(Math.abs(a10.costUsd - 0.3) < 1e-12);
  const t10 = teamRows.find((x) => x.hourStart === "2026-10-17T10:00:00.000Z" && x.source === "proxy");
  assert.equal(t10.eventCount, 3);
  assert.ok(Math.abs(t10.costUsd - 0.3) < 1e-12); // unpriced adds 0
  assert.equal("promptCount" in t10, false);
  assert.equal(userRows.length, 4);
  assert.equal(teamRows.length, 3);
});

test("remainingDirtyHours keeps hours marked during the run", () => {
  assert.deepEqual(r.remainingDirtyHours(["2026-10-17T10:00:00Z", "2026-10-17T11:00:00Z"], ["2026-10-17T10:00:00.000Z"]), ["2026-10-17T11:00:00.000Z"]);
});
