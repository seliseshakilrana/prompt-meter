"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { loadHelpers } = require("./helpers.js");
const k = loadHelpers(["ingest-key"]);

const KEY = "pm_a1b2c3d4_" + "Ab3".repeat(10) + "Zz";

test("parseIngestKey accepts the contract format only", () => {
  assert.deepEqual(k.parseIngestKey(KEY), { key: KEY, prefix: "a1b2c3d4", secret: "Ab3".repeat(10) + "Zz" });
  assert.equal(k.parseIngestKey("  " + KEY + " ").key, KEY);
  for (const bad of [null, "", "pm_A1B2C3D4_" + "a".repeat(32), "pm_a1b2c3d_" + "a".repeat(32), "pm_a1b2c3d4_" + "a".repeat(31),
    "pm_a1b2c3d4_" + "a".repeat(33), "xx_a1b2c3d4_" + "a".repeat(32), "pm_a1b2c3d4_" + "a".repeat(31) + "-"]) {
    assert.equal(k.parseIngestKey(bad), null, String(bad));
  }
});

test("keyHash is lowercase hex SHA-256 of the FULL key", () => {
  assert.equal(k.hashIngestKey(KEY), crypto.createHash("sha256").update(KEY).digest("hex"));
  assert.match(k.hashIngestKey(KEY), /^[0-9a-f]{64}$/);
});

test("constantTimeEqual", () => {
  assert.equal(k.constantTimeEqual("abcd", "abcd"), true);
  assert.equal(k.constantTimeEqual("abcd", "abce"), false);
  assert.equal(k.constantTimeEqual("abcd", "abc"), false);
  assert.equal(k.constantTimeEqual(null, ""), true);
  assert.equal(k.constantTimeEqual(undefined, "a"), false);
});

test("generateIngestKey produces a parseable key whose hash matches", () => {
  for (let i = 0; i < 50; i++) {
    const g = k.generateIngestKey();
    const parsed = k.parseIngestKey(g.key);
    assert.ok(parsed, g.key);
    assert.equal(parsed.prefix, g.keyPrefix);
    assert.equal(g.keyHash, crypto.createHash("sha256").update(g.key).digest("hex"));
  }
});

test("generateIngestKey uses rejection sampling over the injected byte source", () => {
  let call = 0;
  const bytes = (n) => { call++; return Array.from({ length: n }, (_, i) => (i % 2 ? 255 : 1)); }; // 255 is rejected
  const g = k.generateIngestKey(bytes);
  assert.equal(g.keyPrefix, "bbbbbbbb");
  assert.equal(g.key, "pm_bbbbbbbb_" + "B".repeat(32));
  assert.ok(call >= 2);
});
