"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadHelpers } = require("./helpers.js");
const { cleanPreview, redactSecrets } = loadHelpers(["redact"]);

test("removes common secret shapes", () => {
  const cases = [
    "use sk-ant-api03-abcdefghijklmnopqrstuv now",
    "OPENAI sk-proj-abcdefghijklmnopqrstuvwxyz123",
    "key AIzaSyA1234567890abcdefghijklmnopqrstu",
    "aws AKIAIOSFODNN7EXAMPLE",
    "gh ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    "Authorization: Bearer abcdefghijklmnop1234",
    "password=hunter22hunter",
    "connect postgres://admin:s3cretpw@db.example.com/x",
    "prompt-meter key pm_a1b2c3d4_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
    "digest 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----"
  ];
  const secrets = ["sk-ant-api03", "sk-proj-abc", "AIzaSy", "AKIAIOSFODNN7EXAMPLE", "ghp_", "eyJhbGci", "abcdefghijklmnop1234",
    "hunter22", "s3cretpw", "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef", "9f86d081884c", "MIIEvQIBADANBg"];
  cases.forEach((text, i) => {
    const out = redactSecrets(text);
    assert.ok(!out.includes(secrets[i]), `${text} -> ${out}`);
    assert.ok(out.includes("[redacted]"), out);
  });
});

test("keeps ordinary text, including token counts", () => {
  assert.equal(redactSecrets("Fix the failing test in src/app.ts"), "Fix the failing test in src/app.ts");
  assert.equal(redactSecrets("we used tokens: 5000 today"), "we used tokens: 5000 today");
  assert.equal(redactSecrets("author: Rana"), "author: Rana");
});

test("cleanPreview cuts to 100 characters AFTER redaction and collapses whitespace", () => {
  const secret = "sk-ant-api03-" + "x".repeat(40);
  const text = "a".repeat(90) + " " + secret + " tail";
  const out = cleanPreview(text, true);
  assert.ok(Array.from(out).length <= 100);
  assert.ok(!out.includes("sk-ant"));
  assert.ok(!out.includes("xxxxx"));
  assert.equal(cleanPreview("  many\n\n  spaces\t here ", true), "many spaces here");
  assert.equal(Array.from(cleanPreview("é".repeat(150), true)).length, 100);
});

test("cleanPreview returns null when previews are off or empty", () => {
  assert.equal(cleanPreview("hello", false), null);
  assert.equal(cleanPreview(null, true), null);
  assert.equal(cleanPreview("   ", true), null);
  assert.equal(cleanPreview(42, true), null);
});
