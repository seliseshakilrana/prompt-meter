// Ingest key format, hashing, comparison and generation (docs/ingest-contract.md "Ingest key").
// Format: pm_<8 lowercase alphanumeric prefix>_<32 base62 secret>.
// keyHash = lowercase hex SHA-256 of the FULL key string.
// Depends on: sha256.js
//
// Shared helper: function declarations only. Inlined into code nodes by build.js.

const KEY_PATTERN = /^pm_([a-z0-9]{8})_([A-Za-z0-9]{32})$/;

function parseIngestKey(raw) {
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  const match = KEY_PATTERN.exec(key);
  if (!match) return null;
  return { key: key, prefix: match[1], secret: match[2] };
}

function hashIngestKey(fullKey) {
  return sha256Hex(fullKey);
}

// Compares two hex strings without returning early on the first difference.
function constantTimeEqual(a, b) {
  const x = String(a == null ? "" : a);
  const y = String(b == null ? "" : b);
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) {
    diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  }
  return diff === 0;
}

// Secure random bytes from whatever the sandbox offers. Never falls back to Math.random.
// TODO(spike): confirm which source the code-node sandbox exposes (Web Crypto or Node crypto).
function secureRandomBytes(count) {
  const g = typeof globalThis !== "undefined" ? globalThis : {};
  if (g.crypto && typeof g.crypto.getRandomValues === "function") {
    return Array.from(g.crypto.getRandomValues(new Uint8Array(count)));
  }
  if (typeof require === "function") {
    try {
      const nodeCrypto = require("crypto");
      if (nodeCrypto && typeof nodeCrypto.randomBytes === "function") {
        return Array.from(nodeCrypto.randomBytes(count));
      }
    } catch (error) {
      // fall through
    }
  }
  throw new Error("no_secure_random_source");
}

// Unbiased random string over `alphabet` using rejection sampling.
function randomString(length, alphabet, randomBytes) {
  const source = randomBytes || secureRandomBytes;
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < length) {
    const bytes = source(length * 2);
    for (let i = 0; i < bytes.length && out.length < length; i++) {
      if (bytes[i] < limit) out += alphabet[bytes[i] % alphabet.length];
    }
  }
  return out;
}

function generateIngestKey(randomBytes) {
  const lowerAlnum = "abcdefghijklmnopqrstuvwxyz0123456789";
  const base62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const prefix = randomString(8, lowerAlnum, randomBytes);
  const secret = randomString(32, base62, randomBytes);
  const key = "pm_" + prefix + "_" + secret;
  return { key: key, keyPrefix: prefix, keyHash: hashIngestKey(key) };
}
