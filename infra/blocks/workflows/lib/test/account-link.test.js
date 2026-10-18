"use strict";
// Account linking: the ID-token checks (signed with real RSA keys from node:crypto) and the
// composed code nodes of link-start / link-complete / unlink-account / ingest.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { loadHelpers, runWorkflowNode, nodes } = require("./helpers.js");
const h = loadHelpers(["account-link"]);

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = Object.assign(publicKey.export({ format: "jwk" }), { kid: "k1", alg: "RS256", use: "sig" });
const JWKS = { keys: [{ kid: "old", kty: "RSA", n: "AQAB", e: "AQAB" }, jwk] };
const GOOGLE_ID = "google-client.apps.googleusercontent.com";
const MS_ID = "11111111-2222-3333-4444-555555555555";
const NOW = Date.now();

const b64 = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
function signJwt(claims, opts = {}) {
  const header = b64({ alg: opts.alg || "RS256", kid: opts.kid || "k1", typ: "JWT" });
  const body = b64(claims);
  const sig = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${body}`), opts.key || privateKey).toString("base64url");
  return `${header}.${body}.${sig}`;
}
const googleClaims = (extra) => Object.assign({
  iss: "https://accounts.google.com", aud: GOOGLE_ID, sub: "g-123", email: "Dev@Example.com", email_verified: true,
  nonce: "n".repeat(32), iat: Math.floor(NOW / 1000) - 10, exp: Math.floor(NOW / 1000) + 3600
}, extra);
const verify = (token, extra) => h.verifyIdToken(token, JWKS, Object.assign({ provider: "google", clientId: GOOGLE_ID, nonce: "n".repeat(32), nowMs: NOW }, extra));

test("rsaSha256Verify matches node:crypto", () => {
  const sig = crypto.sign("RSA-SHA256", Buffer.from("hello.world"), privateKey);
  assert.equal(h.rsaSha256Verify("hello.world", [...sig], jwk.n, jwk.e), true);
  assert.equal(h.rsaSha256Verify("hello.worle", [...sig], jwk.n, jwk.e), false);
  const tampered = [...sig];
  tampered[10] ^= 1;
  assert.equal(h.rsaSha256Verify("hello.world", tampered, jwk.n, jwk.e), false);
});

test("verifyIdToken: google happy path and every rejection", () => {
  assert.deepEqual(verify(signJwt(googleClaims())), { ok: true, email: "dev@example.com", subject: "g-123" });
  assert.equal(verify(signJwt(googleClaims({ email_verified: "true" }))).ok, true);
  assert.equal(verify(signJwt(googleClaims(), { key: other.privateKey })).reason, "bad_signature");
  assert.equal(verify(signJwt(googleClaims(), { kid: "missing" })).reason, "unknown_signing_key");
  assert.equal(verify(signJwt(googleClaims(), { alg: "HS256" })).reason, "unsupported_algorithm");
  assert.equal(verify(signJwt(googleClaims({ iss: "https://evil.example" }))).reason, "wrong_issuer");
  assert.equal(verify(signJwt(googleClaims({ aud: "someone-else" }))).reason, "wrong_audience");
  assert.equal(verify(signJwt(googleClaims({ aud: [GOOGLE_ID, "x"], azp: "x" }))).reason, "wrong_audience");
  // Fix 6: azp checked when aud is a single string
  assert.equal(verify(signJwt(googleClaims({ aud: GOOGLE_ID, azp: "someone-else" }))).reason, "wrong_audience");
  assert.equal(verify(signJwt(googleClaims({ aud: GOOGLE_ID, azp: GOOGLE_ID }))).ok, true);
  assert.equal(verify(signJwt(googleClaims({ aud: GOOGLE_ID, azp: undefined }))).ok, true);
  assert.equal(verify(signJwt(googleClaims({ exp: Math.floor(NOW / 1000) - 3600 }))).reason, "token_expired");
  assert.equal(verify(signJwt(googleClaims({ nonce: "other" }))).reason, "wrong_nonce");
  assert.equal(verify(signJwt(googleClaims({ email_verified: false }))).reason, "email_not_verified");
  assert.equal(verify(signJwt(googleClaims({ email: undefined }))).reason, "no_email_in_token");
  assert.equal(verify("not.a.jwt").reason, "invalid_id_token");
  // A token whose payload was edited after signing.
  const [hd, , sg] = signJwt(googleClaims()).split(".");
  assert.equal(verify(`${hd}.${b64(googleClaims({ email: "victim@example.com" }))}.${sg}`).reason, "bad_signature");
  // JWKS wrapped the way an httpRequest node may return it.
  assert.equal(h.verifyIdToken(signJwt(googleClaims()), { output: { body: JSON.stringify(JWKS) } }, { provider: "google", clientId: GOOGLE_ID, nonce: "n".repeat(32), nowMs: NOW }).ok, true);
});

test("verifyIdToken: microsoft personal vs work accounts", () => {
  const personal = "9188040d-6c67-4c5b-b112-36a304b66dad";
  const work = "abcdefab-1234-5678-9abc-abcdefabcdef";
  const ms = (tid, extra) => signJwt(Object.assign({
    iss: `https://login.microsoftonline.com/${tid}/v2.0`, tid, aud: MS_ID, sub: "m-1", email: "me@outlook.com",
    nonce: "n".repeat(32), iat: Math.floor(NOW / 1000), exp: Math.floor(NOW / 1000) + 3600
  }, extra));
  const run = (token) => verify(token, { provider: "microsoft", clientId: MS_ID });
  assert.equal(run(ms(personal)).ok, true);
  // Fix 7: Microsoft personal account falls back to preferred_username when email is missing:
  assert.equal(run(ms(personal, { email: undefined, preferred_username: "user@outlook.com" })).ok, true);
  assert.equal(run(ms(personal, { email: undefined, preferred_username: "user@outlook.com" })).email, "user@outlook.com");
  // Work accounts never fall back to preferred_username:
  assert.equal(run(ms(work, { email: undefined, preferred_username: "user@work.com", xms_edov: true })).reason, "no_email_in_token");
  assert.equal(run(ms(work)).reason, "email_not_verified");
  assert.equal(run(ms(work, { xms_edov: true })).ok, true);
  assert.equal(run(ms(work, { iss: `https://login.microsoftonline.com/${personal}/v2.0` })).reason, "wrong_issuer");
});

test("link rules: emails, methods per tool, code hash", () => {
  assert.equal(h.normalizeLinkEmail("  A.B@Example.COM "), "a.b@example.com");
  assert.equal(h.normalizeLinkEmail("no-at-sign"), null);
  assert.equal(h.normalizeLinkEmail("a@b"), null);
  assert.deepEqual(h.parseLinkStartRequest({ tool: "antigravity-cli", email: "x@y.io", method: "email-code" }), { ok: false, error: "method_not_allowed" });
  assert.equal(h.parseLinkStartRequest({ tool: "codex", email: "x@y.io", method: "microsoft" }).ok, true);
  assert.equal(h.parseLinkStartRequest({ tool: "claude-code", email: "x@y.io", method: "microsoft" }).error, "method_not_allowed");
  assert.equal(h.parseLinkStartRequest({ tool: "vim", email: "x@y.io", method: "google" }).error, "invalid_tool");
  const c = h.newLinkChallenge("u1", { tool: "claude-code", email: "x@y.io", method: "email-code" }, NOW);
  assert.match(c.code, /^\d{6}$/);
  assert.equal(c.nonce, null);
  assert.equal(c.row.codeHash, h.linkCodeHash(c.row.challengeId, c.code));
  assert.equal(c.row.codeMailed, true);
  assert.equal(c.row.verified, false);
  assert.ok(!JSON.stringify(c.row).includes(`"${c.code}"`), "code itself is not stored");
  assert.match(c.row.challengeId, /^[A-Za-z0-9]{24}$/);
});

// ---------- workflow nodes ----------

const callerOut = (body) => ({ output: { ok: true, callerId: "u1", isPlatformAdmin: false, body } });

test("link-start: validation, already linked, rate limit, code vs nonce", () => {
  const plan = (body) => runWorkflowNode("link-start.json", "Plan Link Start", { $node: nodes({ "Identify Caller": callerOut(body) }) });
  const create = (body, existing, recent) => runWorkflowNode("link-start.json", "Create Challenge", {
    $json: { items: recent || [] },
    $node: nodes({ "Identify Caller": callerOut(body), "Plan Link Start": { output: plan(body) }, "Load Existing Link": { items: existing || [] } })
  });
  assert.equal(plan({ tool: "codex", email: "bad", method: "google" }).statusCode, 400);
  const p = plan({ tool: "codex", email: "Me@Example.com", method: "google" });
  assert.match(p.existingLinkQuery, /getLinkedAccounts\(.*tool: \{ eq: "codex" \}, email: \{ eq: "me@example.com" \}/);
  assert.match(p.recentChallengesQuery, /userId: \{ eq: "u1" \}/);
  assert.match(p.recentChallengesQuery, /method: \{ eq: "email-code" \}/);
  assert.match(p.recentChallengesQuery, /pageSize: (?:[2-9]\d\d|\d{4,})/);
  assert.match(p.recentChallengesQuery, /sort: \{ createdAt: -1 \}/);

  const oidc = create({ tool: "codex", email: "me@example.com", method: "google" });
  assert.equal(oidc.ok, true);
  assert.match(oidc.responseBody.nonce, /^[A-Za-z0-9]{32}$/);
  assert.equal(oidc.sendCode, false);
  assert.ok(oidc.insertMutation.includes(`nonce: "${oidc.responseBody.nonce}"`));

  const mail = create({ tool: "claude-code", email: "me@example.com", method: "email-code" });
  assert.equal(mail.sendCode, true);
  assert.equal(mail.mailTo, "me@example.com");
  assert.match(mail.code, /^\d{6}$/);
  assert.equal(mail.responseBody.nonce, undefined);
  assert.ok(!JSON.stringify(mail.responseBody).includes(mail.code), "code never goes back to the browser");
  assert.ok(!mail.insertMutation.includes(`"${mail.code}"`));

  const body = { tool: "codex", email: "me@example.com", method: "google" };
  assert.equal(create(body, [{ userId: "u1", tool: "codex", email: "me@example.com" }]).responseBody.error, "already_linked");
  // Fix 3: linked to another user does NOT fail at link-start; it creates a challenge normally:
  const otherLink = create(body, [{ userId: "u2", tool: "codex", email: "me@example.com" }]);
  assert.equal(otherLink.ok, true);
  assert.equal(otherLink.responseBody.error, undefined);
  assert.match(otherLink.responseBody.challengeId, /^[A-Za-z0-9]{24}$/);

  // Fix 9: when linked to another user, email-code sends no code email:
  const mailToOther = create({ tool: "claude-code", email: "me@example.com", method: "email-code" }, [{ userId: "u2", tool: "claude-code", email: "me@example.com" }]);
  assert.equal(mailToOther.ok, true);
  assert.equal(mailToOther.sendCode, false, "no code email sent when linked to someone else");
  assert.equal(mailToOther.code, "");
  assert.equal(mailToOther.mailTo, "");
  assert.equal(mailToOther.responseBody.error, undefined);

  assert.equal(create(body, [{ userId: "u2", tool: "claude-code", email: "me@example.com" }]).ok, true, "other tool doesn't block");
  // Caller limit: 5 starts per 15 min:
  assert.equal(create(body, [], Array.from({ length: 5 }, (_, i) => ({ challengeId: String(i), userId: "u1", createdAt: new Date(NOW).toISOString() }))).statusCode, 429);

  const stored = (result, createOut) => runWorkflowNode("link-start.json", "Challenge Stored", { $json: result, $node: nodes({ "Create Challenge": { output: createOut } }) });
  assert.equal(stored({ data: { challenge: { acknowledged: true } } }, mail).sendCode, true);
  assert.equal(stored({ data: { challenge: { acknowledged: true } } }, mailToOther).sendCode, false);
  assert.deepEqual(stored({ errors: [{ message: "x" }] }, mail), { statusCode: 500, responseBody: { error: "challenge_store_failed" }, sendCode: false });
});

test("link-start: per tool-account limits (3 code emails per day)", () => {
  const plan = (body) => runWorkflowNode("link-start.json", "Plan Link Start", { $node: nodes({ "Identify Caller": callerOut(body) }) });
  const create = (body, recent) => runWorkflowNode("link-start.json", "Create Challenge", {
    $json: { items: recent || [] },
    $node: nodes({ "Identify Caller": callerOut(body), "Plan Link Start": { output: plan(body) }, "Load Existing Link": { items: [] } })
  });
  const body = { tool: "codex", email: "target@example.com", method: "google" };
  const mailBody = { tool: "codex", email: "target@example.com", method: "email-code" };

  // 2 email-code starts -> 3rd allowed (status 200, ok: true):
  const twoStarts = [
    { challengeId: "c-0", userId: "other-0", tool: "codex", email: "target@example.com", method: "email-code", createdAt: new Date(NOW - 1000).toISOString() },
    { challengeId: "c-1", userId: "other-1", tool: "codex", email: "target@example.com", method: "email-code", createdAt: new Date(NOW - 2000).toISOString() }
  ];
  const third = create(mailBody, twoStarts);
  assert.equal(third.statusCode, 200);
  assert.equal(third.ok, true);

  // 3 email-code starts -> 4th refused (429, error: "too_many_attempts"):
  const threeStarts = [
    ...twoStarts,
    { challengeId: "c-2", userId: "other-2", tool: "codex", email: "target@example.com", method: "email-code", createdAt: new Date(NOW - 3000).toISOString() }
  ];
  const fourth = create(mailBody, threeStarts);
  assert.equal(fourth.statusCode, 429);
  assert.equal(fourth.responseBody.error, "too_many_attempts");

  // 3 email-code starts for an address must not block a Google start for it:
  assert.equal(create(body, threeStarts).ok, true);

  // Starts for a different tool don't count toward codex starts:
  const differentTool = Array.from({ length: 3 }, (_, i) => ({
    challengeId: `d-${i}`, userId: `other-${i}`, tool: "claude-code", email: "target@example.com", method: "email-code", createdAt: new Date(NOW - i * 1000).toISOString()
  }));
  assert.equal(create(mailBody, differentTool).ok, true);

  // 3 Google starts for the address don't count towards email-code limit (next email-code start allowed):
  const threeGoogleStarts = [
    { challengeId: "g-0", userId: "other-0", tool: "codex", email: "target@example.com", method: "google", createdAt: new Date(NOW - 1000).toISOString() },
    { challengeId: "g-1", userId: "other-1", tool: "codex", email: "target@example.com", method: "google", createdAt: new Date(NOW - 2000).toISOString() },
    { challengeId: "g-2", userId: "other-2", tool: "codex", email: "target@example.com", method: "google", createdAt: new Date(NOW - 3000).toISOString() }
  ];
  assert.equal(create(mailBody, threeGoogleStarts).ok, true);

  // Rows older than 24 h don't count towards the 24h limit:
  const threeOldStarts = [
    { challengeId: "o-0", userId: "other-0", tool: "codex", email: "target@example.com", method: "email-code", createdAt: new Date(NOW - 25 * 60 * 60 * 1000).toISOString() },
    { challengeId: "o-1", userId: "other-1", tool: "codex", email: "target@example.com", method: "email-code", createdAt: new Date(NOW - 26 * 60 * 60 * 1000).toISOString() },
    { challengeId: "o-2", userId: "other-2", tool: "codex", email: "target@example.com", method: "email-code", createdAt: new Date(NOW - 27 * 60 * 60 * 1000).toISOString() }
  ];
  assert.equal(create(mailBody, threeOldStarts).ok, true);
  assert.equal(create(mailBody, threeOldStarts).statusCode, 200);

  // Rows from different callers count (starts by other callers count toward the 3-per-day limit for that address):
  const byOtherCallers = [
    { challengeId: "diff-0", userId: "user-alpha", tool: "codex", email: "target@example.com", method: "email-code", createdAt: new Date(NOW - 1000).toISOString() },
    { challengeId: "diff-1", userId: "user-beta", tool: "codex", email: "target@example.com", method: "email-code", createdAt: new Date(NOW - 2000).toISOString() },
    { challengeId: "diff-2", userId: "user-gamma", tool: "codex", email: "target@example.com", method: "email-code", createdAt: new Date(NOW - 3000).toISOString() }
  ];
  const refusedByOthers = create(mailBody, byOtherCallers);
  assert.equal(refusedByOthers.statusCode, 429);
  assert.equal(refusedByOthers.responseBody.error, "too_many_attempts");
});

test("link-start: 4 email-code starts for free address and linked-to-other address produce identical statuses and response shapes", () => {
  const plan = (body) => runWorkflowNode("link-start.json", "Plan Link Start", { $node: nodes({ "Identify Caller": callerOut(body) }) });
  const create = (body, existing, recent) => runWorkflowNode("link-start.json", "Create Challenge", {
    $json: { items: recent || [] },
    $node: nodes({ "Identify Caller": callerOut(body), "Plan Link Start": { output: plan(body) }, "Load Existing Link": { items: existing || [] } })
  });
  const mailBody = { tool: "codex", email: "target@example.com", method: "email-code" };
  const freeExisting = [];
  const linkedExisting = [{ userId: "other-user", tool: "codex", email: "target@example.com" }];

  let freeRecent = [];
  let linkedRecent = [];
  for (let i = 0; i < 4; i++) {
    const freeRes = create(mailBody, freeExisting, freeRecent);
    const linkedRes = create(mailBody, linkedExisting, linkedRecent);

    // Identical status code: 200 for starts 1-3, 429 for start 4:
    assert.equal(freeRes.statusCode, linkedRes.statusCode, `start ${i + 1} status code matches`);
    if (freeRes.ok) {
      assert.equal(freeRes.statusCode, 200);
      assert.deepEqual(Object.keys(freeRes.responseBody).sort(), Object.keys(linkedRes.responseBody).sort());
      assert.equal(freeRes.responseBody.tool, linkedRes.responseBody.tool);
      assert.equal(freeRes.responseBody.email, linkedRes.responseBody.email);
      assert.equal(freeRes.responseBody.method, linkedRes.responseBody.method);
      assert.match(freeRes.responseBody.challengeId, /^[A-Za-z0-9]{24}$/);
      assert.match(linkedRes.responseBody.challengeId, /^[A-Za-z0-9]{24}$/);
      // Free address sends mail; linked-to-other sends no mail:
      assert.equal(freeRes.sendCode, true);
      assert.equal(linkedRes.sendCode, false);
      assert.equal(linkedRes.mailTo, "");
      assert.equal(linkedRes.code, "");
      freeRecent.push({ challengeId: freeRes.responseBody.challengeId, userId: `user-${i}`, tool: "codex", email: "target@example.com", method: "email-code", codeMailed: true, createdAt: new Date(NOW - (3 - i) * 1000).toISOString() });
      linkedRecent.push({ challengeId: linkedRes.responseBody.challengeId, userId: `user-${i}`, tool: "codex", email: "target@example.com", method: "email-code", codeMailed: false, createdAt: new Date(NOW - (3 - i) * 1000).toISOString() });
    } else {
      assert.equal(freeRes.statusCode, 429);
      assert.equal(linkedRes.statusCode, 429);
      assert.deepEqual(freeRes.responseBody, linkedRes.responseBody);
      assert.equal(freeRes.responseBody.error, "too_many_attempts");
    }
  }
});

function challengeRow(extra) {
  return Object.assign({
    ItemId: "c-item", challengeId: "A".repeat(24), userId: "u1", tool: "codex", email: "dev@example.com", method: "google",
    nonce: "n".repeat(32), codeHash: null, attempts: 0, expiresAt: new Date(NOW + 600000).toISOString(), usedAt: null
  }, extra);
}

function runComplete(body, challenge, existing, jwks, claimResult, clientIds) {
  const ctx = (extra) => Object.assign({ "Identify Caller": callerOut(body) }, extra);
  const lookup = runWorkflowNode("link-complete.json", "Plan Link Lookup", { $node: nodes(ctx({})) });
  let planVerify;
  const challengeJson = challenge && challenge.errors ? challenge : { items: challenge ? [challenge] : [] };
  if (clientIds) {
    const { composeScript, runScript } = require("../compose.js");
    const script = composeScript("link-complete-plan-verify.js", ["workflow-io", "graphql", "account-link"], clientIds);
    planVerify = runScript(script, {
      $json: challengeJson,
      $node: nodes(ctx({ "Plan Link Lookup": { output: lookup } }))
    });
  } else {
    planVerify = runWorkflowNode("link-complete.json", "Plan Link Verify", {
      $json: challengeJson,
      $node: nodes(ctx({ "Plan Link Lookup": { output: lookup } }))
    });
  }
  if (!planVerify.ok) return { stage: "plan", out: planVerify };

  const defaultClaimResult = { claim: { acknowledged: true, totalImpactedData: 1 } };
  const checkClaim = runWorkflowNode("link-complete.json", "Check Claim", {
    $json: claimResult !== undefined ? claimResult : defaultClaimResult,
    $node: nodes(ctx({ "Plan Link Verify": { output: planVerify } }))
  });
  if (!checkClaim.ok) return { stage: "claim", plan: planVerify, out: checkClaim };

  const isToken = planVerify.isToken;
  const verifyNode = isToken ? "Verify Token Link" : "Verify Code Link";
  const existingNode = isToken ? "Load Existing Link" : "Load Existing Link (code)";
  const existingJson = existing && existing.errors ? existing : { items: existing || [] };
  const nodeInputs = {
    "Plan Link Lookup": { output: lookup },
    "Plan Link Verify": { output: planVerify },
    "Check Claim": { output: checkClaim }
  };
  if (isToken) {
    nodeInputs["Fetch Provider Keys"] = jwks || JWKS;
  }
  nodeInputs[existingNode] = existingJson;

  let out;
  if (clientIds && isToken) {
    const { composeScript, runScript } = require("../compose.js");
    const script = composeScript("link-complete-verify.js", ["workflow-io", "graphql", "account-link"], clientIds);
    out = runScript(script, {
      $json: existingJson,
      $node: nodes(ctx(nodeInputs))
    });
  } else {
    out = runWorkflowNode("link-complete.json", verifyNode, {
      $json: existingJson,
      $node: nodes(ctx(nodeInputs))
    });
  }
  return { stage: "verify", plan: planVerify, checkClaim, out };
}

test("link-complete: challenge checks before any provider call", () => {
  const body = { challengeId: "A".repeat(24), idToken: "x" };
  assert.equal(runComplete({ challengeId: "short" }, challengeRow()).out.responseBody.error, "invalid_challenge_id");
  assert.equal(runComplete(body, null).out.statusCode, 404);
  assert.equal(runComplete(body, challengeRow({ userId: "u2" })).out.statusCode, 404, "someone else's challenge");
  assert.equal(runComplete(body, challengeRow({ usedAt: new Date(NOW).toISOString() })).out.responseBody.error, "challenge_used");
  assert.equal(runComplete(body, challengeRow({ expiresAt: new Date(NOW - 1000).toISOString() })).out.responseBody.error, "challenge_expired");
  assert.equal(runComplete({ challengeId: "A".repeat(24) }, challengeRow()).out.responseBody.error, "id_token_required");
  const plan = runComplete(body, challengeRow({ method: "microsoft" }), undefined, undefined, undefined, { GOOGLE_CLIENT_ID: GOOGLE_ID, MICROSOFT_CLIENT_ID: MS_ID }).plan;
  assert.equal(plan.jwksUrl, "https://login.microsoftonline.com/common/discovery/v2.0/keys");
  assert.match(plan.claimMutation, /updateLinkChallenge\(.*attempts: 1/);
});

test("link-complete: parallel claim refused when conditional update changed nothing", () => {
  const body = { challengeId: "A".repeat(24), idToken: signJwt(googleClaims()) };
  const clients = { GOOGLE_CLIENT_ID: GOOGLE_ID, MICROSOFT_CLIENT_ID: MS_ID };
  const busy = runComplete(body, challengeRow(), [], JWKS, { claim: { acknowledged: true, totalImpactedData: 0 } }, clients);
  assert.equal(busy.stage, "claim");
  assert.equal(busy.out.statusCode, 409);
  assert.equal(busy.out.responseBody.error, "challenge_busy");

  const err = runComplete(body, challengeRow(), [], JWKS, { errors: [{ message: "write conflict" }] }, clients);
  assert.equal(err.stage, "claim");
  assert.equal(err.out.statusCode, 409);
  assert.equal(err.out.responseBody.error, "challenge_busy");
});

test("link-complete: provider not configured until link-config.json has the client ids", () => {
  // The committed link-config.json keeps placeholders, so Plan Link Verify refuses OIDC before claim without claiming.
  const r = runComplete({ challengeId: "A".repeat(24), idToken: signJwt(googleClaims({ email: "dev@example.com" })) }, challengeRow());
  assert.equal(r.stage, "plan");
  assert.equal(r.out.statusCode, 503);
  assert.equal(r.out.responseBody.error, "provider_not_configured");
  assert.equal(r.out.claimMutation, "", "no claim mutation is produced when provider is unconfigured");
});

test("link-complete: OIDC success, mismatch and conflicts (with configured client ids)", () => {
  // Same scripts as the workflow nodes, with real client ids injected instead of the placeholders.
  const { composeScript, runScript } = require("../compose.js");
  const planScript = composeScript("link-complete-plan-verify.js", ["workflow-io", "graphql", "account-link"], { GOOGLE_CLIENT_ID: GOOGLE_ID, MICROSOFT_CLIENT_ID: MS_ID });
  const script = composeScript("link-complete-verify.js", ["workflow-io", "graphql", "account-link"], { GOOGLE_CLIENT_ID: GOOGLE_ID, MICROSOFT_CLIENT_ID: MS_ID });
  const run = (token, existing, challenge) => {
    const body = { challengeId: "A".repeat(24), idToken: token };
    const c = challenge || challengeRow();
    const planVerify = runScript(planScript, {
      $json: { items: [c] },
      $node: nodes({ "Identify Caller": callerOut(body), "Plan Link Lookup": { output: { ok: true, challengeId: c.challengeId } } })
    });
    return runScript(script, {
      $json: { items: existing || [] },
      $node: nodes({ "Identify Caller": callerOut(body), "Plan Link Verify": { output: planVerify }, "Fetch Provider Keys": JWKS })
    });
  };
  const good = signJwt(googleClaims({ email: "dev@example.com" }));
  const ok = run(good);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.responseBody.linked, true);
  assert.match(ok.writeMutation, /insertLinkedAccount\(input: \{ userId: "u1", tool: "codex", email: "dev@example.com", method: "google", providerSubject: "g-123"/);
  assert.match(ok.writeMutation, /updateLinkChallenge/);

  const mismatch = run(signJwt(googleClaims({ email: "someone@else.com" })));
  assert.equal(mismatch.statusCode, 403);
  assert.equal(mismatch.hasWrites, false);

  assert.equal(run(signJwt(googleClaims({ nonce: "z".repeat(32) }))).responseBody.error, "wrong_nonce");
  const otherUser = run(good, [{ userId: "u2", tool: "codex", email: "dev@example.com" }]);
  assert.equal(otherUser.responseBody.error, "linked_to_another_user");
  assert.equal(otherUser.statusCode, 409);
  assert.match(otherUser.writeMutation, /updateLinkChallenge\(.*usedAt: "/, "sets usedAt on conflict");

  const again = run(good, [{ userId: "u1", tool: "codex", email: "dev@example.com" }]);
  assert.equal(again.responseBody.alreadyLinked, true);
  assert.ok(!again.writeMutation.includes("insertLinkedAccount"));
});

test("link-complete: email code right, wrong, and the last attempt", () => {
  const code = "123456";
  const c = challengeRow({ method: "email-code", tool: "claude-code", nonce: null, codeHash: h.linkCodeHash("A".repeat(24), code) });
  const right = runComplete({ challengeId: "A".repeat(24), code }, c);
  assert.equal(right.out.statusCode, 200);
  assert.match(right.out.writeMutation, /insertLinkedAccount\(input: \{ userId: "u1", tool: "claude-code", email: "dev@example.com", method: "email-code", providerSubject: null/);
  assert.match(right.out.writeMutation, /verified: true/);

  const wrong = runComplete({ challengeId: "A".repeat(24), code: "000000" }, c);
  assert.equal(wrong.out.statusCode, 400);
  assert.equal(wrong.out.responseBody.attemptsLeft, 4);
  assert.equal(wrong.out.hasWrites, false, "Claim Challenge already counted the attempt");
  assert.match(wrong.plan.claimMutation, /attempts: 1/);

  const last = runComplete({ challengeId: "A".repeat(24), code: "000000" }, Object.assign({}, c, { attempts: 4 }));
  assert.equal(last.out.statusCode, 400);
  assert.equal(last.out.responseBody.attemptsLeft, 0);
  assert.match(last.plan.claimMutation, /attempts: 5, usedAt: "/, "Claim Challenge used up the challenge on 5th attempt");

  assert.equal(runComplete({ challengeId: "A".repeat(24), code: "000000" }, Object.assign({}, c, { attempts: 5 })).out.statusCode, 429);
  assert.equal(runComplete({ challengeId: "A".repeat(24), code: "12" }, c).out.responseBody.error, "code_required");
});

test("unlink-account: owner only", () => {
  const plan = (body) => runWorkflowNode("unlink-account.json", "Plan Unlink", { $node: nodes({ "Identify Caller": callerOut(body) }) });
  const authorize = (body, items) => runWorkflowNode("unlink-account.json", "Authorize Unlink", {
    $json: { items },
    $node: nodes({ "Identify Caller": callerOut(body), "Plan Unlink": { output: plan(body) } })
  });
  assert.equal(plan({}).statusCode, 400);
  const ok = authorize({ linkId: "l1" }, [{ ItemId: "l1", userId: "u1", tool: "codex", email: "a@b.io" }]);
  assert.equal(ok.ok, true);
  assert.match(ok.deleteMutation, /deleteLinkedAccount\(filter: "\{\\"_id\\":\\"l1\\"\}"\)/);
  assert.equal(authorize({ linkId: "l1" }, [{ ItemId: "l1", userId: "u2" }]).statusCode, 404);
  assert.equal(authorize({ linkId: "l1" }, []).statusCode, 404);
});

test("ingest: accountEmail is kept, verified only against the key owner's links", () => {
  const KEY = "pm_a1b2c3d4_" + "Q".repeat(16) + "r".repeat(16);
  const event = (id, extra) => Object.assign({
    eventId: id, tool: "claude-code", provider: "anthropic", model: "claude-opus-5-5", sessionId: "s", promptId: "p", callIndex: 0,
    totalInputTokens: 10, uncachedInputTokens: 10, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, outputTokens: 1,
    thinkingTokens: null, serverToolRequests: 0, speed: "standard", promptPreview: null, projectTag: null, occurredAt: new Date(NOW).toISOString()
  }, extra);
  const body = { events: [event("e1", { accountEmail: "Dev@Example.com" }), event("e2", { accountEmail: "other@example.com" }), event("e3", { accountEmail: "nope" }), event("e4")] };
  const parsed = runWorkflowNode("ingest.json", "Parse Request", { $node: nodes({ "Ingest Webhook": { headers: { "x-ingest-key": KEY }, output: body } }) });
  const membership = runWorkflowNode("ingest.json", "Membership Result", {
    $json: { itemId: "u1", organizationId: "t1", roles: ["member"] },
    $node: nodes({ "Verify Key": { output: { userId: "u1", teamId: "t1" } } })
  });
  assert.match(membership.linkedAccountsQuery, /getLinkedAccounts\(.*userId: \{ eq: "u1" \}/);
  const out = runWorkflowNode("ingest.json", "Prepare Events", {
    $node: nodes({
      "Parse Request": { output: parsed },
      "Verify Key": { output: { userId: "u1", teamId: "t1", sendPreview: false } },
      "Load Linked Accounts": { items: [{ tool: "claude-code", email: "dev@example.com" }, { tool: "codex", email: "other@example.com" }] },
      "Load Model Prices": { items: [] },
      "Find Existing Events": { items: [] }
    })
  });
  assert.equal(out.responseBody.accepted, 4);
  const m = out.insertMutation;
  assert.ok(m.includes('eventId: "e1"') && /eventId: "e1"[^}]*accountEmail: "dev@example.com", accountVerified: true/.test(m), m);
  assert.ok(/eventId: "e2"[^}]*accountEmail: "other@example.com", accountVerified: false/.test(m), "a link for another tool doesn't count");
  assert.ok(/eventId: "e3"[^}]*accountEmail: null, accountVerified: false/.test(m));
  assert.ok(/eventId: "e4"[^}]*accountEmail: null, accountVerified: false/.test(m));
});

test("link-start lookup failure: Load Recent Challenges error returns 503 limits_unavailable", () => {
  const plan = (body) => runWorkflowNode("link-start.json", "Plan Link Start", { $node: nodes({ "Identify Caller": callerOut(body) }) });
  const body = { tool: "codex", email: "dev@example.com", method: "google" };
  const out = runWorkflowNode("link-start.json", "Create Challenge", {
    $json: { errors: [{ message: "sort rejected" }] },
    $node: nodes({
      "Identify Caller": callerOut(body),
      "Plan Link Start": { output: plan(body) },
      "Load Existing Link": { items: [] }
    })
  });
  assert.equal(out.ok, false);
  assert.equal(out.statusCode, 503);
  assert.equal(out.responseBody.error, "limits_unavailable");
  assert.equal(out.insertMutation, undefined);
});

test("link-start lookup failure: Load Existing Link error returns 503 limits_unavailable", () => {
  const plan = (body) => runWorkflowNode("link-start.json", "Plan Link Start", { $node: nodes({ "Identify Caller": callerOut(body) }) });
  const body = { tool: "codex", email: "dev@example.com", method: "google" };
  const out = runWorkflowNode("link-start.json", "Create Challenge", {
    $json: { items: [] },
    $node: nodes({
      "Identify Caller": callerOut(body),
      "Plan Link Start": { output: plan(body) },
      "Load Existing Link": { errors: [{ message: "gateway error" }] }
    })
  });
  assert.equal(out.ok, false);
  assert.equal(out.statusCode, 503);
  assert.equal(out.responseBody.error, "limits_unavailable");
  assert.equal(out.insertMutation, undefined);
});

test("link-complete lookup failure: Load Challenge error returns 503 lookup_failed and no claim mutation", () => {
  const body = { challengeId: "A".repeat(24), idToken: signJwt(googleClaims()) };
  const res = runComplete(body, { errors: [{ message: "gateway error" }] });
  assert.equal(res.stage, "plan");
  assert.equal(res.out.ok, false);
  assert.equal(res.out.statusCode, 503);
  assert.equal(res.out.responseBody.error, "lookup_failed");
  assert.equal(res.out.claimMutation, "");
});

test("link-complete lookup failure: Load Existing Link (token branch) error returns 503 and no write mutation", () => {
  const body = { challengeId: "A".repeat(24), idToken: signJwt(googleClaims({ email: "dev@example.com" })) };
  const clients = { GOOGLE_CLIENT_ID: GOOGLE_ID, MICROSOFT_CLIENT_ID: MS_ID };
  const res = runComplete(body, challengeRow(), { errors: [{ message: "gateway error" }] }, JWKS, undefined, clients);
  assert.equal(res.stage, "verify");
  assert.equal(res.out.ok, false);
  assert.equal(res.out.statusCode, 503);
  assert.equal(res.out.responseBody.error, "lookup_failed");
  assert.equal(res.out.writeMutation, "");
  assert.equal(res.out.hasWrites, false);
});

test("link-complete lookup failure: Load Existing Link (code branch) error returns 503 and no write mutation", () => {
  const code = "123456";
  const c = challengeRow({ method: "email-code", tool: "claude-code", nonce: null, codeHash: h.linkCodeHash("A".repeat(24), code) });
  const body = { challengeId: "A".repeat(24), code };
  const res = runComplete(body, c, { errors: [{ message: "gateway error" }] });
  assert.equal(res.stage, "verify");
  assert.equal(res.out.ok, false);
  assert.equal(res.out.statusCode, 503);
  assert.equal(res.out.responseBody.error, "lookup_failed");
  assert.equal(res.out.writeMutation, "");
  assert.equal(res.out.hasWrites, false);
});

test("unlink-account lookup failure: Load Link error returns 503 and no delete mutation", () => {
  const plan = (body) => runWorkflowNode("unlink-account.json", "Plan Unlink", { $node: nodes({ "Identify Caller": callerOut(body) }) });
  const authorize = (body, json) => runWorkflowNode("unlink-account.json", "Authorize Unlink", {
    $json: json,
    $node: nodes({ "Identify Caller": callerOut(body), "Plan Unlink": { output: plan(body) } })
  });
  const res = authorize({ linkId: "l1" }, { errors: [{ message: "gateway error" }] });
  assert.equal(res.ok, false);
  assert.equal(res.statusCode, 503);
  assert.equal(res.responseBody.error, "lookup_failed");
  assert.equal(res.deleteMutation, undefined);
});

test("ingest lookup failure: Load Linked Accounts error accepts batch with accountVerified false", () => {
  const KEY = "pm_a1b2c3d4_" + "Q".repeat(16) + "r".repeat(16);
  const event = (id, extra) => Object.assign({
    eventId: id, tool: "claude-code", provider: "anthropic", model: "claude-opus-5-5", sessionId: "s", promptId: "p", callIndex: 0,
    totalInputTokens: 10, uncachedInputTokens: 10, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, outputTokens: 1,
    thinkingTokens: null, serverToolRequests: 0, speed: "standard", promptPreview: null, projectTag: null, occurredAt: new Date(NOW).toISOString()
  }, extra);
  const body = { events: [event("e1", { accountEmail: "Dev@Example.com" }), event("e2", { accountEmail: "other@example.com" })] };
  const parsed = runWorkflowNode("ingest.json", "Parse Request", { $node: nodes({ "Ingest Webhook": { headers: { "x-ingest-key": KEY }, output: body } }) });
  const out = runWorkflowNode("ingest.json", "Prepare Events", {
    $node: nodes({
      "Parse Request": { output: parsed },
      "Verify Key": { output: { userId: "u1", teamId: "t1", sendPreview: false } },
      "Load Linked Accounts": { errors: [{ message: "gateway error" }] },
      "Load Model Prices": { items: [] },
      "Find Existing Events": { items: [] }
    })
  });
  assert.equal(out.responseBody.accepted, 2);
  assert.equal(out.hasInserts, true);
  const m = out.insertMutation;
  assert.ok(m.includes('eventId: "e1"') && /eventId: "e1"[^}]*accountVerified: false/.test(m));
  assert.ok(m.includes('eventId: "e2"') && /eventId: "e2"[^}]*accountVerified: false/.test(m));
  assert.ok(!m.includes("accountVerified: true"));
});

test("lookupItems: strict acceptance and rejection of response shapes", () => {
  const badShapes = [
    { name: '{"data":null}', input: { data: null } },
    { name: '{"error":"x"}', input: { error: "x" } },
    { name: '{"success":false}', input: { success: false } },
    { name: '{"statusCode":500}', input: { statusCode: 500 } },
    { name: '{"errors":{"message":"x"}}', input: { errors: { message: "x" } } },
    { name: '"boom"', input: "boom" },
    { name: "null", input: null },
    { name: '{"data":{"getLinkChallenges":null}}', input: { data: { getLinkChallenges: null } } },
    // and { json: ... }-wrapped forms:
    { name: '{ json: {"data":null} }', input: { json: { data: null } } },
    { name: '{ json: {"error":"x"} }', input: { json: { error: "x" } } },
    { name: '{ json: {"success":false} }', input: { json: { success: false } } },
    { name: '{ json: {"statusCode":500} }', input: { json: { statusCode: 500 } } },
    { name: '{ json: {"errors":{"message":"x"}} }', input: { json: { errors: { message: "x" } } } },
    { name: '{ json: "boom" }', input: { json: "boom" } },
    { name: "{ json: null }", input: { json: null } },
    { name: '{ json: {"data":{"getLinkChallenges":null}} }', input: { json: { data: { getLinkChallenges: null } } } },
    // additional error shapes:
    { name: "{ isSuccess: false }", input: { isSuccess: false } },
    { name: "{ json: { isSuccess: false } }", input: { json: { isSuccess: false } } },
    { name: "{ acknowledged: false }", input: { acknowledged: false } },
    { name: "{ json: { acknowledged: false } }", input: { json: { acknowledged: false } } },
    { name: '{ errors: [{ message: "x" }] }', input: { errors: [{ message: "x" }] } },
    { name: '{ json: { errors: [{ message: "x" }] } }', input: { json: { errors: [{ message: "x" }] } } }
  ];

  for (const { name, input } of badShapes) {
    const res = h.lookupItems(input);
    assert.deepEqual(res, { ok: false }, `expected ${name} to be rejected with { ok: false }`);
  }

  const goodShapes = [
    {
      name: "{ data: { getLinkChallenges: { items: [], totalCount: 0 } } }",
      input: { data: { getLinkChallenges: { items: [], totalCount: 0 } } },
      expected: { ok: true, items: [] }
    },
    {
      name: "{ json: { data: { getLinkChallenges: { items: [], totalCount: 0 } } } }",
      input: { json: { data: { getLinkChallenges: { items: [], totalCount: 0 } } } },
      expected: { ok: true, items: [] }
    },
    {
      name: "{ items: [] }",
      input: { items: [] },
      expected: { ok: true, items: [] }
    },
    {
      name: "{ json: { items: [] } }",
      input: { json: { items: [] } },
      expected: { ok: true, items: [] }
    },
    {
      name: "{ output: { items: [] } }",
      input: { output: { items: [] } },
      expected: { ok: true, items: [] }
    },
    {
      name: "Result with actual items array: { ok: true, items: [...] }",
      input: { items: [{ id: "c-1", tool: "codex" }] },
      expected: { ok: true, items: [{ id: "c-1", tool: "codex" }] }
    },
    {
      name: "{ data: { getLinkChallenges: { items: [{ challengeId: 'c1' }], totalCount: 1 } } }",
      input: { data: { getLinkChallenges: { items: [{ challengeId: "c1" }], totalCount: 1 } } },
      expected: { ok: true, items: [{ challengeId: "c1" }] }
    },
    {
      name: "{ json: { data: { getLinkChallenges: { items: [{ challengeId: 'c2' }], totalCount: 1 } } } }",
      input: { json: { data: { getLinkChallenges: { items: [{ challengeId: "c2" }], totalCount: 1 } } } },
      expected: { ok: true, items: [{ challengeId: "c2" }] }
    },
    {
      name: "{ data: { getLinkChallenges: { items: [], totalCount: 0 } }, errors: [] }",
      input: { data: { getLinkChallenges: { items: [], totalCount: 0 } }, errors: [] },
      expected: { ok: true, items: [] }
    },
    {
      name: "{ data: { getLinkChallenges: { items: [], totalCount: 0 } }, errors: {} }",
      input: { data: { getLinkChallenges: { items: [], totalCount: 0 } }, errors: {} },
      expected: { ok: true, items: [] }
    },
    {
      name: "{ data: { getLinkChallenges: { items: [], totalCount: 0 } }, error: null }",
      input: { data: { getLinkChallenges: { items: [], totalCount: 0 } }, error: null },
      expected: { ok: true, items: [] }
    },
    {
      name: "{ data: { getLinkChallenges: { items: [], totalCount: 0 } }, extensions: {} }",
      input: { data: { getLinkChallenges: { items: [], totalCount: 0 } }, extensions: {} },
      expected: { ok: true, items: [] }
    },
    {
      name: "{ items: [], errors: [] }",
      input: { items: [], errors: [] },
      expected: { ok: true, items: [] }
    },
    {
      name: "{ items: [], errors: {} }",
      input: { items: [], errors: {} },
      expected: { ok: true, items: [] }
    },
    {
      name: "{ items: [], error: null }",
      input: { items: [], error: null },
      expected: { ok: true, items: [] }
    },
    {
      name: "{ items: [], extensions: {} }",
      input: { items: [], extensions: {} },
      expected: { ok: true, items: [] }
    },
    {
      name: "{ json: { items: [], errors: [] } }",
      input: { json: { items: [], errors: [] } },
      expected: { ok: true, items: [] }
    },
    {
      name: "{ output: { items: [], errors: {} } }",
      input: { output: { items: [], errors: {} } },
      expected: { ok: true, items: [] }
    }
  ];

  for (const { name, input, expected } of goodShapes) {
    const res = h.lookupItems(input);
    assert.deepEqual(res, expected, `expected ${name} to be accepted`);
  }
});

test("link-start fails closed with 503 for every unexpected shape", () => {
  const plan = (body) => runWorkflowNode("link-start.json", "Plan Link Start", { $node: nodes({ "Identify Caller": callerOut(body) }) });
  const body = { tool: "codex", email: "target@example.com", method: "email-code" };

  const badShapes = [
    { name: '{"data":null}', input: { data: null } },
    { name: '{"error":"x"}', input: { error: "x" } },
    { name: '{"success":false}', input: { success: false } },
    { name: '{"statusCode":500}', input: { statusCode: 500 } },
    { name: '{"errors":{"message":"x"}}', input: { errors: { message: "x" } } },
    { name: '"boom"', input: "boom" },
    { name: "null", input: null },
    { name: '{"data":{"getLinkChallenges":null}}', input: { data: { getLinkChallenges: null } } },
    // and { json: ... }-wrapped forms:
    { name: '{ json: {"data":null} }', input: { json: { data: null } } },
    { name: '{ json: {"error":"x"} }', input: { json: { error: "x" } } },
    { name: '{ json: {"success":false} }', input: { json: { success: false } } },
    { name: '{ json: {"statusCode":500} }', input: { json: { statusCode: 500 } } },
    { name: '{ json: {"errors":{"message":"x"}} }', input: { json: { errors: { message: "x" } } } },
    { name: '{ json: "boom" }', input: { json: "boom" } },
    { name: "{ json: null }", input: { json: null } },
    { name: '{ json: {"data":{"getLinkChallenges":null}} }', input: { json: { data: { getLinkChallenges: null } } } }
  ];

  for (const { name, input } of badShapes) {
    // Bad shape in Load Recent Challenges ($json):
    const outRecent = runWorkflowNode("link-start.json", "Create Challenge", {
      $json: input,
      $node: nodes({
        "Identify Caller": callerOut(body),
        "Plan Link Start": { output: plan(body) },
        "Load Existing Link": { items: [] }
      })
    });
    assert.equal(outRecent.ok, false, `${name} in Recent Challenges should return ok: false`);
    assert.equal(outRecent.statusCode, 503, `${name} in Recent Challenges should return statusCode: 503`);
    assert.equal(outRecent.responseBody?.error, "limits_unavailable");
    assert.equal(outRecent.insertMutation, undefined, `${name} in Recent Challenges should have no insertMutation`);
    assert.ok(!outRecent.sendCode, `${name} in Recent Challenges should not send code`);

    // Bad shape in Load Existing Link:
    const outExisting = runWorkflowNode("link-start.json", "Create Challenge", {
      $json: { items: [] },
      $node: nodes({
        "Identify Caller": callerOut(body),
        "Plan Link Start": { output: plan(body) },
        "Load Existing Link": input
      })
    });
    assert.equal(outExisting.ok, false, `${name} in Existing Link should return ok: false`);
    assert.equal(outExisting.statusCode, 503, `${name} in Existing Link should return statusCode: 503`);
    assert.equal(outExisting.responseBody?.error, "limits_unavailable");
    assert.equal(outExisting.insertMutation, undefined, `${name} in Existing Link should have no insertMutation`);
    assert.ok(!outExisting.sendCode, `${name} in Existing Link should not send code`);
  }

  // Well-formed empty result { data: { getLinkChallenges: { items: [], totalCount: 0 } } } still works:
  const wellFormed = runWorkflowNode("link-start.json", "Create Challenge", {
    $json: { data: { getLinkChallenges: { items: [], totalCount: 0 } } },
    $node: nodes({
      "Identify Caller": callerOut(body),
      "Plan Link Start": { output: plan(body) },
      "Load Existing Link": { data: { getLinkedAccounts: { items: [], totalCount: 0 } } }
    })
  });
  assert.equal(wellFormed.ok, true);
  assert.equal(wellFormed.statusCode, 200);
  assert.match(wellFormed.responseBody.challengeId, /^[A-Za-z0-9]{24}$/);
  assert.equal(wellFormed.sendCode, true);
  assert.match(wellFormed.code, /^\d{6}$/);
  assert.ok(wellFormed.insertMutation.includes("insertLinkChallenge"));
});
