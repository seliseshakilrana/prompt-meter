"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { loadHelpers } = require("./helpers.js");
const { sha256Hex } = loadHelpers(["sha256"]);

test("sha256Hex matches node:crypto across padding boundaries and unicode", () => {
  const inputs = ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(63), "a".repeat(64), "a".repeat(1000),
    "pm_a1b2c3d4_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef", "ünïcødé ✓ 🚀 日本語"];
  for (const s of inputs) {
    assert.equal(sha256Hex(s), crypto.createHash("sha256").update(s, "utf8").digest("hex"), JSON.stringify(s));
  }
});

test("sha256Hex known vector", () => {
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
