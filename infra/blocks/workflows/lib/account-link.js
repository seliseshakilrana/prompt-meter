// Linking a Claude / Codex / Antigravity account email to the caller's portal login
// (PLAN.md "Connected accounts"). Ownership of the email is proven one of two ways:
//   - google / microsoft: an OpenID Connect ID token for that email, checked here
//     (RS256 signature against the provider's published keys, issuer, audience, expiry,
//     nonce, verified email);
//   - email-code: a 6-digit code mailed to the address, stored only as a hash.
// Proving the email says nothing about the tool's usage; numbers still come from the
// proxy or manual entry.
// Depends on: sha256.js, ingest-key.js (secureRandomBytes, randomString, constantTimeEqual)
//
// Shared helper: function declarations only. Inlined into code nodes by build.js.

const LINK_METHODS_BY_TOOL = {
  "claude-code": ["google", "email-code"],
  "codex": ["google", "microsoft", "email-code"],
  "antigravity-cli": ["google"]
};
const LINK_TOOL_NAMES = { "claude-code": "Claude Code", "codex": "Codex", "antigravity-cli": "Antigravity" };
const LINK_CHALLENGE_TTL_MS = 10 * 60 * 1000;
const LINK_START_WINDOW_MS = 15 * 60 * 1000;
const LINK_MAX_STARTS_PER_WINDOW = 5;
const LINK_ACCOUNT_WINDOW_MS = 24 * 60 * 60 * 1000;
const LINK_MAX_ACCOUNT_CODE_EMAILS_PER_DAY = 3;
const LINK_MAX_CODE_ATTEMPTS = 5;
const LINK_CLOCK_SKEW_MS = 5 * 60 * 1000;
const LINK_ID_PATTERN = /^[A-Za-z0-9]{24}$/;
const LINK_PROVIDERS = {
  google: { jwksUrl: "https://www.googleapis.com/oauth2/v3/certs" },
  microsoft: { jwksUrl: "https://login.microsoftonline.com/common/discovery/v2.0/keys" }
};
// Microsoft's tenant for personal accounts (outlook.com, hotmail.com, live.com).
const MICROSOFT_CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";
// DER prefix of DigestInfo for SHA-256 (RFC 8017 section 9.2, note 1).
const SHA256_DIGEST_INFO = [0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20];

// Lowercased, trimmed address, or null when it isn't a plausible single address.
function normalizeLinkEmail(raw) {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  if (!/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/.test(email)) return null;
  return email;
}

function linkMethodAllowed(tool, method) {
  const methods = LINK_METHODS_BY_TOOL[tool];
  return Array.isArray(methods) && methods.indexOf(method) >= 0;
}

// Body of a link-start request: { tool, email, method }.
function parseLinkStartRequest(body) {
  const b = body && typeof body === "object" ? body : {};
  if (!LINK_METHODS_BY_TOOL[b.tool]) return { ok: false, error: "invalid_tool" };
  const email = normalizeLinkEmail(b.email);
  if (!email) return { ok: false, error: "invalid_email" };
  if (!linkMethodAllowed(b.tool, b.method)) return { ok: false, error: "method_not_allowed" };
  return { ok: true, tool: b.tool, email: email, method: b.method };
}

function linkCodeHash(challengeId, code) {
  return sha256Hex("prompt-meter-link-code:" + challengeId + ":" + code);
}

// A new LinkChallenge row plus the secrets that leave this node once (nonce to the
// caller for OIDC, code to the mail node for email-code).
function newLinkChallenge(userId, request, nowMs, randomBytes, options) {
  const opts = options || {};
  const base62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const challengeId = randomString(24, base62, randomBytes);
  const isCode = request.method === "email-code";
  const shouldMail = isCode && !opts.linkedToOther;
  const code = shouldMail ? randomString(6, "0123456789", randomBytes) : null;
  const nonce = isCode ? null : randomString(32, base62, randomBytes);
  const row = {
    challengeId: challengeId,
    userId: userId,
    tool: request.tool,
    email: request.email,
    method: request.method,
    nonce: nonce,
    codeHash: shouldMail ? linkCodeHash(challengeId, code) : null,
    codeMailed: shouldMail,
    verified: false,
    attempts: 0,
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + LINK_CHALLENGE_TTL_MS).toISOString(),
    usedAt: null
  };
  return { row: row, code: code, nonce: nonce, codeMailed: shouldMail };
}

// Why a stored challenge can't be completed now, or null when it can.
function linkChallengeProblem(challenge, callerId, nowMs) {
  if (!challenge || challenge.userId !== callerId) return { statusCode: 404, error: "challenge_not_found" };
  if (challenge.usedAt) return { statusCode: 410, error: "challenge_used" };
  const expires = new Date(challenge.expiresAt).getTime();
  if (isNaN(expires) || expires <= nowMs) return { statusCode: 410, error: "challenge_expired" };
  if ((challenge.attempts || 0) >= LINK_MAX_CODE_ATTEMPTS) return { statusCode: 429, error: "too_many_attempts" };
  return null;
}

// ---------- base64url / bytes / RSA ----------

function base64UrlBytes(text) {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const out = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < text.length; i++) {
    buffer = (buffer << 6) | alphabet.indexOf(text[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return out;
}

function utf8Text(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    let code;
    if (b < 0x80) code = b;
    else if (b >= 0xf0) { code = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f); i += 3; }
    else if (b >= 0xe0) { code = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f); i += 2; }
    else { code = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f); i += 1; }
    out += String.fromCodePoint(code);
  }
  return out;
}

function base64UrlJson(text) {
  const bytes = base64UrlBytes(text);
  if (!bytes) return null;
  try {
    const value = JSON.parse(utf8Text(bytes));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch (error) {
    return null;
  }
}

function bytesToBigInt(bytes) {
  let n = BigInt(0);
  const eight = BigInt(8);
  for (let i = 0; i < bytes.length; i++) n = (n << eight) | BigInt(bytes[i]);
  return n;
}

function bigIntToBytes(n, length) {
  const out = new Array(length).fill(0);
  let v = n;
  const mask = BigInt(255);
  const eight = BigInt(8);
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(v & mask);
    v = v >> eight;
  }
  return v === BigInt(0) ? out : null;
}

function modPow(base, exponent, modulus) {
  const zero = BigInt(0);
  const one = BigInt(1);
  let result = one;
  let b = base % modulus;
  let e = exponent;
  while (e > zero) {
    if ((e & one) === one) result = (result * b) % modulus;
    e = e >> one;
    b = (b * b) % modulus;
  }
  return result;
}

function hexBytes(hex) {
  const out = [];
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

// RSASSA-PKCS1-v1_5 with SHA-256 (JWT "RS256"). n and e are base64url, as in a JWK.
// TODO(spike): needs BigInt in the code-node sandbox; fails closed (throws -> caught) if missing.
function rsaSha256Verify(signingInput, signatureBytes, nB64, eB64) {
  const nBytes = base64UrlBytes(nB64);
  const eBytes = base64UrlBytes(eB64);
  if (!nBytes || !eBytes || !signatureBytes) return false;
  let start = 0;
  while (start < nBytes.length && nBytes[start] === 0) start++;
  const k = nBytes.length - start;
  if (k < 256 || signatureBytes.length !== k) return false; // RSA-2048 or larger only
  const n = bytesToBigInt(nBytes.slice(start));
  const s = bytesToBigInt(signatureBytes);
  if (s >= n) return false;
  const em = bigIntToBytes(modPow(s, bytesToBigInt(eBytes), n), k);
  if (!em) return false;
  const t = SHA256_DIGEST_INFO.concat(hexBytes(sha256Hex(signingInput)));
  const expected = [0x00, 0x01];
  for (let i = 0; i < k - t.length - 3; i++) expected.push(0xff);
  expected.push(0x00);
  for (let i = 0; i < t.length; i++) expected.push(t[i]);
  let diff = 0;
  for (let i = 0; i < k; i++) diff |= em[i] ^ expected[i];
  return diff === 0;
}

// The `keys` array of a JWKS response, whatever the httpRequest wrapper.
function jwksKeys(response) {
  let v = unwrapOutput(response);
  for (let depth = 0; depth < 4 && isPlainObject(v); depth++) {
    if (Array.isArray(v.keys)) return v.keys;
    v = v.body !== undefined ? v.body : v.data !== undefined ? v.data : v.output;
    if (typeof v === "string") {
      try { v = JSON.parse(v); } catch (error) { return []; }
    }
  }
  return [];
}

function audienceMatches(claims, clientId) {
  const azpMatches = claims.azp === undefined || claims.azp === clientId;
  if (typeof claims.aud === "string") return claims.aud === clientId && azpMatches;
  if (!Array.isArray(claims.aud) || claims.aud.indexOf(clientId) < 0) return false;
  return azpMatches;
}

function claimTrue(value) {
  return value === true || value === "true";
}

// Checks an ID token for `expected.provider` ("google" | "microsoft").
// Returns { ok: true, email, subject } or { ok: false, reason }.
function verifyIdToken(idToken, jwksResponse, expected) {
  const fail = function (reason) { return { ok: false, reason: reason }; };
  if (typeof idToken !== "string" || idToken.length > 16384) return fail("invalid_id_token");
  const parts = idToken.split(".");
  if (parts.length !== 3) return fail("invalid_id_token");
  const header = base64UrlJson(parts[0]);
  const claims = base64UrlJson(parts[1]);
  const signature = base64UrlBytes(parts[2]);
  if (!header || !claims || !signature) return fail("invalid_id_token");
  if (header.alg !== "RS256" || typeof header.kid !== "string") return fail("unsupported_algorithm");
  const keys = jwksKeys(jwksResponse);
  let jwk = null;
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] && keys[i].kid === header.kid && keys[i].kty === "RSA") { jwk = keys[i]; break; }
  }
  if (!jwk) return fail("unknown_signing_key");
  let valid = false;
  try {
    valid = rsaSha256Verify(parts[0] + "." + parts[1], signature, jwk.n, jwk.e);
  } catch (error) {
    return fail("signature_check_unavailable");
  }
  if (!valid) return fail("bad_signature");

  if (expected.provider === "google") {
    if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") return fail("wrong_issuer");
  } else if (expected.provider === "microsoft") {
    if (typeof claims.tid !== "string" || !/^[0-9a-f-]{36}$/.test(claims.tid)) return fail("wrong_issuer");
    if (claims.iss !== "https://login.microsoftonline.com/" + claims.tid + "/v2.0") return fail("wrong_issuer");
  } else {
    return fail("unknown_provider");
  }
  if (!expected.clientId || !audienceMatches(claims, expected.clientId)) return fail("wrong_audience");
  const nowMs = expected.nowMs;
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= nowMs - LINK_CLOCK_SKEW_MS) return fail("token_expired");
  if (typeof claims.iat === "number" && claims.iat * 1000 > nowMs + LINK_CLOCK_SKEW_MS) return fail("token_not_yet_valid");
  if (!expected.nonce || claims.nonce !== expected.nonce) return fail("wrong_nonce");
  if (typeof claims.sub !== "string" || !claims.sub) return fail("invalid_id_token");

  let email = normalizeLinkEmail(claims.email);
  if (!email && expected.provider === "microsoft" && claims.tid === MICROSOFT_CONSUMER_TENANT) {
    email = normalizeLinkEmail(claims.preferred_username);
  }
  if (!email) return fail("no_email_in_token");
  if (expected.provider === "google" && !claimTrue(claims.email_verified)) return fail("email_not_verified");
  // Work/school accounts carry an admin-set email; trust it only when Microsoft says the
  // tenant owns that domain (optional claim xms_edov). Personal accounts verify their email.
  if (expected.provider === "microsoft" && claims.tid !== MICROSOFT_CONSUMER_TENANT && !claimTrue(claims.xms_edov)) {
    return fail("email_not_verified");
  }
  return { ok: true, email: email, subject: claims.sub };
}
