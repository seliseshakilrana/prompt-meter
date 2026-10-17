"use strict";
// Runs the exact composed code-node scripts from the generated workflow JSON files
// against mocked upstream node outputs.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { runWorkflowNode, nodes, seedPrices } = require("./helpers.js");

const KEY = "pm_a1b2c3d4_" + "Q".repeat(16) + "r".repeat(16);
const KEY_HASH = crypto.createHash("sha256").update(KEY).digest("hex");
const event = (id, extra) => Object.assign({
  eventId: id, tool: "claude-code", provider: "anthropic", model: "claude-opus-5-5", sessionId: "s", promptId: "p",
  callIndex: 0, totalInputTokens: 1000, uncachedInputTokens: 1000, cacheReadTokens: 0, cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0, outputTokens: 1000, thinkingTokens: null, serverToolRequests: 0, speed: "standard",
  promptPreview: "fix it password=hunter2hunter2", projectTag: null, occurredAt: "2026-10-17T09:30:00.000Z"
}, extra);
const trigger = (headers, body) => nodes({ "Ingest Webhook": { headers, output: body } });
const parse = (headers, body) => runWorkflowNode("ingest.json", "Parse Request", { $node: trigger(headers, body) });

test("ingest Parse Request: 401 / 413 / 400 / ok", () => {
  assert.equal(parse({}, { events: [] }).statusCode, 401);
  assert.equal(parse({ "X-Ingest-Key": "pm_bad" }, { events: [] }).statusCode, 401);
  assert.equal(parse({ "x-ingest-key": KEY }, { collector: {} }).statusCode, 400);
  assert.equal(parse({ "X-INGEST-KEY": KEY }, { events: Array.from({ length: 101 }, (_, i) => event("m" + i)) }).statusCode, 413);
  assert.equal(parse({ "x-ingest-key": KEY, "content-length": String(300 * 1024) }, { events: [] }).statusCode, 413);
  const ok = parse({ "X-Ingest-Key": KEY }, { events: [event("msg_1"), event("msg_1"), event("msg_2")] });
  assert.equal(ok.ok, true);
  assert.equal(ok.keyPrefix, "a1b2c3d4");
  assert.equal(ok.presentedKeyHash, KEY_HASH);
  assert.equal(JSON.stringify(ok).includes(KEY), false, "raw key must not be passed on");
  assert.match(ok.keyLookupQuery, /getIngestKeys\(input: \{ pageNo: 1, pageSize: 2 \}, where: \{ keyPrefix: \{ eq: "a1b2c3d4" \} \}\)/);
  assert.match(ok.existingEventsQuery, /eventId: \{ in: \["msg_1", "msg_2"\] \}/);
  assert.equal(/\{\{|\}\}/.test(ok.existingEventsQuery), false);
});

test("ingest Parse Request: raw string body that is not JSON -> 400", () => {
  const r = runWorkflowNode("ingest.json", "Parse Request", { $node: nodes({ "Ingest Webhook": { headers: { "x-ingest-key": KEY }, body: "{not json" } }) });
  assert.equal(r.statusCode, 400);
});

function verify(keyRow, nowWindow) {
  const parsed = parse({ "x-ingest-key": KEY }, { events: [event("msg_1")] });
  return runWorkflowNode("ingest.json", "Verify Key", {
    $json: { output: { items: keyRow ? [keyRow] : [] } },
    $node: nodes({ "Parse Request": { output: parsed } })
  });
}

test("ingest Verify Key: hash, revoked, missing, rate limit", () => {
  const row = { ItemId: "k1", userId: "u1", teamId: "t1", keyHash: KEY_HASH, revoked: false, sendPreview: true };
  const ok = verify(row);
  assert.equal(ok.ok, true);
  assert.equal(ok.userId, "u1");
  assert.equal(ok.rateWindowCount, 1);
  assert.equal(verify(Object.assign({}, row, { keyHash: "0".repeat(64) })).statusCode, 401);
  assert.equal(verify(Object.assign({}, row, { revoked: true })).statusCode, 401);
  assert.equal(verify(null).statusCode, 401);
  const limited = verify(Object.assign({}, row, { rateWindowStart: new Date(Date.now() - 10000).toISOString(), rateWindowCount: 60 }));
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.responseBody.error, "rate_limited");
  assert.ok(limited.responseBody.retryAfterSeconds >= 49 && limited.responseBody.retryAfterSeconds <= 51);
  const fresh = verify(Object.assign({}, row, { rateWindowStart: new Date(Date.now() - 61000).toISOString(), rateWindowCount: 60 }));
  assert.equal(fresh.ok, true);
});

test("ingest Membership Result fails closed", () => {
  const key = { output: { userId: "u1", teamId: "t1" } };
  const run = (resp) => runWorkflowNode("ingest.json", "Membership Result", { $json: resp, $node: nodes({ "Verify Key": key }) });
  assert.equal(run({ itemId: "u1", organizationId: "t1", roles: ["member"] }).ok, true);
  assert.equal(run({ itemId: "u1", organizations: [{ organizationId: "t1" }] }).ok, true);
  assert.equal(run({ itemId: "u1", organizations: [{ organizationId: "t2" }] }).statusCode, 401);
  assert.equal(run({}).statusCode, 401);
});

test("ingest Prepare Events: dedupe, ownership from key, preview, cost, rejections", () => {
  const body = { events: [
    event("msg_new", { userId: "attacker", teamId: "other", costUsd: 0, source: "manual" }),
    event("msg_new"),
    event("msg_old"),
    event("msg_bad", { tool: "vim" }),
    event("msg_nopreview", { model: "claude-sonnet-5-5" })
  ] };
  const parsed = parse({ "x-ingest-key": KEY }, body);
  const run = (sendPreview) => runWorkflowNode("ingest.json", "Prepare Events", {
    $node: nodes({
      "Parse Request": { output: parsed },
      "Verify Key": { output: { userId: "u1", teamId: "t1", sendPreview } },
      "Load Model Prices": { data: { getModelPrices: { items: seedPrices(), totalCount: 6 } } },
      "Find Existing Events": { data: { getUsageEvents: { items: [{ eventId: "msg_old" }], totalCount: 1 } } }
    })
  });
  const out = run(true);
  assert.deepEqual(out.responseBody, { accepted: 2, duplicates: 2, rejected: [{ eventId: "msg_bad", reason: "invalid_tool" }] });
  assert.equal(out.hasInserts, true);
  assert.match(out.insertMutation, /^mutation \{ events: insertManyUsageEvent\(input: \[/);
  assert.ok(!out.insertMutation.includes("attacker"));
  assert.ok(out.insertMutation.includes('userId: "u1", teamId: "t1"'));
  assert.ok(out.insertMutation.includes('source: "proxy"'));
  assert.ok(out.insertMutation.includes("costUsd: 0.024")); // 1000*4 + 1000*20 per 1M
  assert.ok(out.insertMutation.includes("costUsd: 0.012")); // sonnet 1000*2 + 1000*10 per 1M
  assert.ok(out.insertMutation.includes('promptPreview: "fix it password=[redacted]"'));
  assert.ok(!out.insertMutation.includes("hunter2"));
  const off = run(false);
  assert.ok(off.insertMutation.includes("promptPreview: null"));
  assert.ok(!off.insertMutation.includes("fix it"));
});

test("respond nodes turn decisions into { statusCode, body }", () => {
  const dec = { output: { ok: false, statusCode: 401, responseBody: { error: "invalid_key" } } };
  assert.deepEqual(runWorkflowNode("ingest.json", "Respond Key Error", { $node: nodes({ "Verify Key": dec }) }), { statusCode: 401, body: { error: "invalid_key" } });
  const prep = { output: { statusCode: 200, responseBody: { accepted: 1, duplicates: 0, rejected: [] } } };
  assert.deepEqual(runWorkflowNode("ingest.json", "Respond Accepted", { $json: { data: { events: { acknowledged: true } } }, $node: nodes({ "Prepare Events": prep }) }),
    { statusCode: 200, body: { accepted: 1, duplicates: 0, rejected: [] } });
  assert.deepEqual(runWorkflowNode("ingest.json", "Respond Accepted", { $json: { errors: [{ message: "E11000 duplicate key" }] }, $node: nodes({ "Prepare Events": prep }) }),
    { statusCode: 500, body: { error: "insert_failed" } });
});

test("rollup: plan -> hours -> aggregate -> finalize", () => {
  const run = (name, ctx) => runWorkflowNode("rollup.json", name, ctx);
  const plan = run("Plan Rollup Run", { $json: { data: { getRollupStates: { items: [{ name: "hourly", lastRunStartedAt: new Date(Date.now() - 300000).toISOString(), dirtyHours: ["2026-10-10T07:00:00.000Z"] }] } } } });
  assert.match(plan.touchedQuery, /receivedAt: \{ gte: "/);
  const hours = run("Plan Hours", { $json: { items: [{ occurredAt: "2026-10-17T10:20:00.000Z" }], totalCount: 1 }, $node: nodes({ "Plan Rollup Run": { output: plan } }) });
  assert.deepEqual(hours.hours, ["2026-10-10T07:00:00.000Z", "2026-10-17T10:00:00.000Z"]);
  assert.equal(hours.truncated, false);
  assert.match(hours.eventsQuery, /or: \[/);
  const events = [{ eventId: "e1", userId: "u", teamId: "t", tool: "claude-code", model: "m", source: "proxy", promptId: "p", occurredAt: "2026-10-17T10:20:00.000Z", totalInputTokens: 5, uncachedInputTokens: 5, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, outputTokens: 2, thinkingTokens: null, serverToolRequests: 0, costUsd: 0.5 }];
  const agg = run("Aggregate Hours", { $json: { items: events, totalCount: 1 }, $node: nodes({ "Plan Hours": { output: hours } }) });
  assert.equal(agg.userRowCount, 1);
  assert.equal(agg.teamRowCount, 1);
  const m = agg.replaceMutation;
  assert.ok(m.indexOf("deleteManyUserHourly") < m.indexOf("insertManyUserHourly"), "delete before insert");
  assert.ok(m.indexOf("deleteManyTeamHourly") < m.indexOf("insertManyTeamHourly"));
  assert.throws(() => run("Aggregate Hours", { $json: { items: events, totalCount: 2 }, $node: nodes({ "Plan Hours": { output: hours } }) }), /truncated/);

  const fin = run("Finalize Rollup State", {
    $json: { items: [{ name: "hourly", dirtyHours: ["2026-10-10T07:00:00.000Z", "2026-10-12T01:00:00.000Z"] }] },
    $node: nodes({ "Plan Rollup Run": { output: plan }, "Plan Hours": { output: hours }, "Replace Hourly Rows": { data: { ok: { acknowledged: true } } } })
  });
  assert.match(fin.stateMutation, /updateRollupState/);
  assert.ok(fin.stateMutation.includes('dirtyHours: ["2026-10-12T01:00:00.000Z"]'), fin.stateMutation);
  assert.ok(fin.stateMutation.includes(`lastRunStartedAt: "${plan.runStartedAt}"`));
  assert.throws(() => run("Finalize Rollup State", {
    $json: { items: [] },
    $node: nodes({ "Plan Rollup Run": { output: plan }, "Plan Hours": { output: hours }, "Replace Hourly Rows": { errors: [{ message: "x" }] } })
  }), /rollup_replace_failed/);
  const idle = run("Finalize Rollup State (idle)", { $json: { items: [] }, $node: nodes({ "Plan Rollup Run": { output: plan }, "Plan Hours": { output: { hours: [], hasHours: false, truncated: false } } }) });
  assert.match(idle.stateMutation, /insertRollupState/);
});

test("issue-key: caller from login, membership check, key returned once, hash stored", () => {
  const caller = runWorkflowNode("issue-key.json", "Identify Caller", {
    $json: { itemId: "u1", roles: [] },
    $node: nodes({ "Issue Key Webhook": { output: { teamId: "t1", label: "laptop", sendPreview: true, userId: "attacker" } } })
  });
  assert.equal(caller.callerId, "u1");
  const run = (orgs, callerOut) => runWorkflowNode("issue-key.json", "Generate Key", { $json: orgs, $node: nodes({ "Identify Caller": { output: callerOut || caller } }) });
  const out = run({ items: [{ itemId: "t1", name: "Team" }] });
  assert.equal(out.ok, true);
  const key = out.responseBody.key;
  assert.match(key, /^pm_[a-z0-9]{8}_[A-Za-z0-9]{32}$/);
  const hash = crypto.createHash("sha256").update(key).digest("hex");
  assert.ok(out.insertMutation.includes(`keyHash: "${hash}"`));
  assert.ok(out.insertMutation.includes('userId: "u1"'));
  assert.ok(!out.insertMutation.includes(key), "full key is never stored");
  assert.equal(run({ items: [{ itemId: "t2" }] }).statusCode, 403);
  assert.equal(run({ items: [] }, Object.assign({}, caller, { body: {} })).statusCode, 400);
  const anon = runWorkflowNode("issue-key.json", "Identify Caller", { $json: {}, $node: nodes({ "Issue Key Webhook": { output: { teamId: "t1" } } }) });
  assert.equal(anon.statusCode, 401);
});

test("revoke-key: owner only for own keys; team-admin for member removal", () => {
  const callerOut = (body, extra) => ({ output: Object.assign({ ok: true, callerId: "u1", isPlatformAdmin: false, body }, extra) });
  const plan = (body) => runWorkflowNode("revoke-key.json", "Plan Revoke", { $node: nodes({ "Identify Caller": callerOut(body) }) });
  const authorize = (body, keys, access, extra) => runWorkflowNode("revoke-key.json", "Authorize Revoke", {
    $json: access || {},
    $node: nodes({ "Identify Caller": callerOut(body, extra), "Plan Revoke": { output: plan(body) }, "Load Target Keys": { items: keys } })
  });
  const own = { mode: "own", keyId: "k1" };
  const r1 = authorize(own, [{ ItemId: "k1", userId: "u1", keyPrefix: "aaaaaaaa", revoked: false }]);
  assert.equal(r1.ok, true);
  assert.match(r1.revokeMutation, /updateIngestKey\(filter: "\{\\"_id\\":\\"k1\\"\}", input: \{ revoked: true \}\)/);
  assert.equal(authorize(own, [{ ItemId: "k1", userId: "u2", revoked: false }]).statusCode, 404);
  assert.equal(authorize(own, [{ ItemId: "k1", userId: "u1", revoked: true }]).hasWrites, false);
  const removal = { mode: "memberRemoved", userId: "u9", teamId: "t1" };
  const keys = [{ ItemId: "k8", userId: "u9", keyPrefix: "bbbbbbbb" }, { ItemId: "k9", userId: "u9", keyPrefix: "cccccccc" }];
  assert.equal(authorize(removal, keys, { organizationId: "t1", roles: ["member"] }).statusCode, 403);
  const ok = authorize(removal, keys, { organizationId: "t1", roles: ["team-admin"] });
  assert.equal(ok.responseBody.revoked, 2);
  assert.equal(authorize(removal, keys, {}, { isPlatformAdmin: true }).ok, true);
  assert.equal(plan({ mode: "x" }).statusCode, 400);
});

test("manual-entry: create, update and delete rules", () => {
  // Times relative to the real clock: manual entries in the future are rejected.
  const hourAgo = new Date(Date.now() - 3600000);
  hourAgo.setUTCMinutes(30, 0, 0);
  const T1 = hourAgo.toISOString();
  const H1 = new Date(hourAgo.getTime() - 30 * 60000).toISOString();
  const T2 = new Date(hourAgo.getTime() - 2 * 3600000).toISOString();
  const H2 = new Date(hourAgo.getTime() - 2 * 3600000 - 30 * 60000).toISOString();
  const caller = (body) => ({ output: { ok: true, callerId: "u1", isPlatformAdmin: false, body } });
  const run = (body, existing, state) => {
    const lookup = runWorkflowNode("manual-entry.json", "Plan Manual Lookup", { $node: nodes({ "Identify Caller": caller(body) }) });
    return { lookup, out: runWorkflowNode("manual-entry.json", "Plan Manual Write", {
      $node: nodes({
        "Identify Caller": caller(body),
        "Plan Manual Lookup": { output: lookup },
        "Get Caller Organizations": { items: [{ itemId: "t1" }] },
        "Load Existing Event": { items: existing ? [existing] : [] },
        "Load Model Prices": { items: seedPrices() },
        "Load Rollup State": { items: state === undefined ? [{ name: "hourly", dirtyHours: [] }] : state }
      })
    }) };
  };
  const entry = { action: "create", teamId: "t1", userId: "attacker", source: "proxy", tool: "other", provider: "anthropic", model: "claude-sonnet-5-5",
    occurredAt: T1, uncachedInputTokens: 1000, outputTokens: 1000, promptPreview: "my api_key: abcdef123456" };
  const { lookup, out } = run(entry);
  assert.match(lookup.eventId, /^manual_[0-9a-f]{32}$/);
  assert.equal(out.ok, true);
  assert.equal(out.responseBody.costUsd, 0.012);
  const m = out.writeMutation;
  assert.ok(m.includes('source: "manual"') && m.includes('userId: "u1"') && !m.includes("attacker"));
  assert.ok(m.includes("[redacted]") && !m.includes("abcdef123456"));
  assert.ok(m.includes(`dirtyHours: ["${H1}"]`), m);
  assert.ok(m.indexOf("insertUsageEvent") < m.indexOf("updateRollupState"));

  assert.equal(run(Object.assign({}, entry, { teamId: "t-not-mine" })).out.statusCode, 403);
  assert.equal(run(Object.assign({}, entry, { occurredAt: "2999-01-01T00:00:00.000Z" })).out.responseBody.error, "occurred_at_in_future");

  const mine = { ItemId: "x1", eventId: "manual_abcdefgh", userId: "u1", source: "manual", occurredAt: T2 };
  const upd = run(Object.assign({}, entry, { action: "update", eventId: "manual_abcdefgh", occurredAt: T1 }), mine).out;
  assert.ok(upd.writeMutation.includes("updateUsageEvent"));
  assert.ok(upd.writeMutation.includes(`dirtyHours: ["${H2}", "${H1}"]`), upd.writeMutation);
  const del = run({ action: "delete", eventId: "manual_abcdefgh" }, mine, []).out;
  assert.ok(del.writeMutation.includes("deleteUsageEvent") && del.writeMutation.includes("insertRollupState"));
  assert.equal(run({ action: "delete", eventId: "manual_abcdefgh" }, Object.assign({}, mine, { userId: "u2" })).out.statusCode, 404);
  assert.equal(run({ action: "delete", eventId: "manual_abcdefgh" }, Object.assign({}, mine, { source: "proxy" })).out.statusCode, 403);
  assert.equal(run({ action: "delete", eventId: "msg_proxy1" }).lookup.statusCode, 400);
});
