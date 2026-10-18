"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadHelpers, readJson, seedPrices, BLOCKS_DIR } = require("./helpers.js");
const h = loadHelpers(["cost", "rollup"]);

const schemaDir = path.join(BLOCKS_DIR, "data/schemas");
const schemas = Object.fromEntries(fs.readdirSync(schemaDir).filter((f) => f.endsWith(".json"))
  .map((f) => { const s = JSON.parse(fs.readFileSync(path.join(schemaDir, f), "utf8")); return [s.schemaName, s]; }));
const fieldNames = (s) => schemas[s].fields.map((f) => f.name);
const SYSTEM = ["ItemId", "CreatedDate", "CreatedBy", "LastUpdatedDate", "LastUpdatedBy", "Language", "OrganizationId", "Tags"];

test("schemas: all ten, scalar types, no system fields, file name = schemaName", () => {
  assert.deepEqual(Object.keys(schemas).sort(), ["Budget", "IngestKey", "LinkChallenge", "LinkedAccount", "ModelPrice", "QuotaSnapshot", "RollupState", "TeamHourly", "UsageEvent", "UserHourly"]);
  for (const s of Object.values(schemas)) {
    assert.ok(fs.existsSync(path.join(schemaDir, `${s.schemaName}.json`)));
    for (const f of s.fields) {
      assert.ok(["String", "Int", "Float", "Boolean", "DateTime", "ID", "GeoJson"].includes(f.type), `${s.schemaName}.${f.name}`);
      assert.ok(!SYSTEM.includes(f.name), `${s.schemaName}.${f.name} is a system field`);
    }
  }
});

test("every schema in infra/blocks/data/schemas is byte-identical to its copy in prompt-meter-web/blocks/data/schemas", () => {
  const webSchemaDir = path.resolve(BLOCKS_DIR, "../../prompt-meter-web/blocks/data/schemas");
  const infraFiles = fs.readdirSync(schemaDir).filter((f) => f.endsWith(".json")).sort();
  const webFiles = fs.readdirSync(webSchemaDir).filter((f) => f.endsWith(".json")).sort();
  assert.deepEqual(infraFiles, webFiles, "schema file lists match");
  for (const f of infraFiles) {
    const infraBytes = fs.readFileSync(path.join(schemaDir, f));
    const webBytes = fs.readFileSync(path.join(webSchemaDir, f));
    assert.deepEqual(infraBytes, webBytes, `${f} is byte-identical in both folders`);
  }
});

test("UsageEvent has every PLAN.md field, including source", () => {
  assert.deepEqual(fieldNames("UsageEvent"), ["eventId", "source", "userId", "teamId", "tool", "provider", "model", "sessionId", "promptId", "callIndex",
    "totalInputTokens", "uncachedInputTokens", "cacheReadTokens", "cacheWrite5mTokens", "cacheWrite1hTokens", "outputTokens", "thinkingTokens",
    "serverToolRequests", "speed", "costUsd", "pricingStatus", "promptPreview", "projectTag", "accountEmail", "accountVerified", "occurredAt", "receivedAt"]);
});

test("the CLI's own local validators accept the schemas and rules (when the CLI is installed)", async (t) => {
  let mod;
  try {
    const { execFileSync } = require("node:child_process");
    const bin = fs.realpathSync(execFileSync("which", ["blocks"]).toString().trim());
    mod = await import(path.join(path.dirname(bin), "../dist/lib/data-files.js"));
  } catch (e) {
    t.skip("blocks CLI not installed");
    return;
  }
  const files = Object.values(schemas).map((schema) => ({ file: schema.schemaName, schema }));
  assert.deepEqual(mod.validateSchemas(files), []);
  assert.deepEqual(mod.validateSecurityEntries(readJson("data/rules.json")), []);
});

test("rules: every schema has READ/WRITE/EDIT/DELETE security, policies target known schemas/fields", () => {
  const rules = readJson("data/rules.json");
  for (const s of Object.keys(schemas)) {
    for (const op of [0, 1, 2, 3]) assert.ok(rules.security.some((e) => e.schemaName === s && e.operation === op && e.policyType === 0), `${s} op ${op}`);
  }
  for (const p of rules.policies) {
    assert.ok(schemas[p.schemaName], p.policyName);
    for (const f of p.fieldNames || []) assert.ok(fieldNames(p.schemaName).includes(f), `${p.policyName}: ${f}`);
  }
  const cls = rules.security.filter((e) => e.policyType === 1).map((e) => `${e.schemaName}.${e.fieldNames.join(",")}`);
  assert.ok(cls.some((c) => c.startsWith("UsageEvent.promptPreview")));
  assert.ok(cls.some((c) => c.startsWith("IngestKey.keyHash")));
  assert.ok(!rules.policies.some((p) => p.schemaName === "IngestKey" && p.operation !== 0), "no browser write policy on IngestKey");
  assert.ok(!rules.policies.some((p) => p.schemaName === "UsageEvent" && p.operation !== 0), "no browser write policy on UsageEvent");
  assert.ok(!rules.policies.some((p) => p.schemaName === "LinkedAccount" && p.operation !== 0), "links are written by workflows only");
  assert.ok(!rules.policies.some((p) => p.schemaName === "LinkChallenge"), "challenges are workflow-only");
  assert.ok(cls.some((c) => c.startsWith("LinkChallenge.nonce,codeHash")));
});

test("indexes reference real fields; unique eventId and keyPrefix; <= 15 per schema", () => {
  const { indexes } = readJson("data/indexes.json");
  const count = {};
  for (const ix of indexes) {
    count[ix.schemaName] = (count[ix.schemaName] || 0) + 1;
    for (const f of ix.fields) assert.ok(fieldNames(ix.schemaName).includes(f.fieldName), `${ix.name}: ${f.fieldName}`);
  }
  Object.values(count).forEach((n) => assert.ok(n <= 15));
  assert.ok(indexes.some((i) => i.schemaName === "UsageEvent" && i.isUnique && i.fields.length === 1 && i.fields[0].fieldName === "eventId"));
  assert.ok(indexes.some((i) => i.schemaName === "IngestKey" && i.isUnique && i.fields[0].fieldName === "keyPrefix"));
  assert.ok(indexes.some((i) => i.schemaName === "LinkedAccount" && i.isUnique && i.fields.map((f) => f.fieldName).join() === "tool,email"));
  assert.ok(indexes.some((i) => i.schemaName === "LinkChallenge" && i.isUnique && i.fields[0].fieldName === "challengeId"));
});

test("model-prices seed: only given rates, everything else null + needsPrice", () => {
  const doc = readJson("seed/model-prices.json");
  const byModel = Object.fromEntries(doc.rows.filter((r) => r.model).map((r) => [r.model, r]));
  const fields = fieldNames("ModelPrice");
  for (const r of doc.rows) {
    for (const k of Object.keys(r)) assert.ok(fields.includes(k) || ["needsPrice", "notes"].includes(k), k);
    assert.equal(r.effectiveFrom, "2026-10-17T00:00:00Z");
    for (const k of fields) if (r[k] === null && r.model && k !== "longContextThreshold" && k !== "fastMultiplier" && !(r.longContextThreshold === null && k.startsWith("longContext"))) {
      assert.ok(Array.isArray(r.needsPrice) && r.needsPrice.includes(k), `${r.model}.${k} null but not in needsPrice`);
    }
  }
  const o = byModel["claude-opus-5-5"];
  assert.deepEqual([o.inputPer1M, o.outputPer1M, o.cacheReadPer1M, o.cacheWrite5mPer1M, o.cacheWrite1hPer1M, o.fastMultiplier], [4, 20, 0.2, 5, 8, 2]);
  const s = byModel["claude-sonnet-5-5"];
  assert.deepEqual([s.inputPer1M, s.outputPer1M, s.cacheReadPer1M, s.cacheWrite5mPer1M, s.cacheWrite1hPer1M, s.fastMultiplier], [2, 10, 0.2, 2.5, 4, null]);
  const hk = byModel["claude-haiku-5-5"];
  assert.deepEqual([hk.inputPer1M, hk.outputPer1M, hk.cacheReadPer1M, hk.longContextThreshold, hk.longContextInputPer1M, hk.longContextOutputPer1M,
    hk.longContextCacheWrite5mPer1M, hk.longContextCacheWrite1hPer1M, hk.longContextCacheReadPer1M], [0.1, 0.5, null, 100000, 0.5, 2.5, 0.625, 1, null]);
  const f = byModel["claude-fable-5-1"];
  assert.deepEqual([f.inputPer1M, f.outputPer1M, f.cacheReadPer1M, f.cacheWrite5mPer1M, f.cacheWrite1hPer1M], [10, 50, 0.25, 12.5, 20]);
  for (const r of doc.rows) assert.equal(r.webSearchPerRequest, null);
  assert.ok(doc.rows.some((r) => r.provider === "openai" && r.model === null && r.needsPrice === true));
  assert.ok(doc.rows.some((r) => r.provider === "google" && r.model === null && r.needsPrice === true));
});

test("sample usage: costs follow the price rules and hourly rows equal the rollup of the events", () => {
  const doc = readJson("seed/sample-usage.json");
  const prices = seedPrices();
  for (const e of doc.usageEvents) {
    const c = h.priceEvent(prices, e);
    assert.equal(e.costUsd, c.costUsd, e.eventId);
    assert.equal(e.pricingStatus, c.pricingStatus, e.eventId);
    for (const k of Object.keys(e)) assert.ok(fieldNames("UsageEvent").includes(k), k);
    assert.equal(e.totalInputTokens, e.uncachedInputTokens + e.cacheReadTokens + e.cacheWrite5mTokens + e.cacheWrite1hTokens);
  }
  const agg = h.aggregateHourly(doc.usageEvents);
  assert.deepEqual(doc.userHourly, agg.userRows);
  assert.deepEqual(doc.teamHourly, agg.teamRows);
  const sum = (rows, k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  for (const k of ["outputTokens", "cacheReadTokens", "eventCount"]) assert.equal(sum(doc.userHourly, k), sum(doc.teamHourly, k), k);
  assert.ok(Math.abs(sum(doc.userHourly, "costUsd") - sum(doc.usageEvents, "costUsd")) < 1e-9);
  // crosses both local midnights: Dhaka 18:00Z and Kolkata 18:30Z
  const times = doc.usageEvents.map((e) => e.occurredAt);
  assert.ok(times.some((t) => t < "2026-10-17T18:00:00Z") && times.some((t) => t >= "2026-10-17T18:00:00Z" && t < "2026-10-17T18:30:00Z") && times.some((t) => t >= "2026-10-17T18:30:00Z"));
  assert.ok(doc.usageEvents.some((e) => e.source === "manual"));
  for (const r of doc.userHourly) for (const k of Object.keys(r)) assert.ok(fieldNames("UserHourly").includes(k), k);
  for (const r of doc.teamHourly) for (const k of Object.keys(r)) assert.ok(fieldNames("TeamHourly").includes(k), k);
});
