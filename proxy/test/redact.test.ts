import { describe, expect, it } from "vitest";
import { makePreview, redactSecrets } from "../src/redact.js";

describe("preview redaction", () => {
  const secrets = [
    "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
    "sk-proj-AbCdEfGhIjKlMnOpQrStUvWx",
    "AIzaSyD-1234567890abcdefghijklmnopqrstu",
    "ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    "pm_a1b2c3d4_AbCdEfGhIjKlMnOpQrStUvWxYz012345",
    "0123456789abcdef0123456789abcdef0123",
  ];

  for (const s of secrets) {
    it(`redacts ${s.slice(0, 10)}…`, () => {
      const out = redactSecrets(`use ${s} please`);
      expect(out).not.toContain(s);
      expect(out).toContain("[REDACTED]");
    });
  }

  it("redacts Bearer tokens, password= and private keys", () => {
    expect(redactSecrets("Authorization: Bearer abc.def-ghi_jkl")).toBe("Authorization: Bearer [REDACTED]");
    expect(redactSecrets("login with password=hunter2!")).toBe("login with password=[REDACTED]");
    expect(redactSecrets('{"api_key": "xyz"}')).not.toContain("xyz");
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY-----";
    expect(redactSecrets(`key: ${pem} end`)).not.toContain("MIIEow");
  });

  it("collapses whitespace and cuts to 100 characters", () => {
    const p = makePreview("  fix   the\n\n bug\tin   main.ts  ");
    expect(p).toBe("fix the bug in main.ts");
    const long = makePreview("word ".repeat(60))!;
    expect(Array.from(long).length).toBe(100);
    expect(long.endsWith("…")).toBe(true);
  });

  it("redacts before cutting, so a secret straddling the cut never leaks", () => {
    const text = "word ".repeat(18) + "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
    const p = makePreview(text)!;
    expect(p).not.toContain("sk-ant");
    expect(Array.from(p).length).toBeLessThanOrEqual(100);
  });

  it("returns null for empty input", () => {
    expect(makePreview(null)).toBeNull();
    expect(makePreview("   ")).toBeNull();
  });
});
