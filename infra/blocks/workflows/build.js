#!/usr/bin/env node
// Generates the importable workflow files (ingest.json, rollup.json, issue-key.json,
// revoke-key.json, manual-entry.json) from the graph definitions below and the code-node
// scripts under lib/. Local only: writes files next to this script, calls nothing remote.
//
//   node infra/blocks/workflows/build.js          # write the JSON files
//   node infra/blocks/workflows/build.js --check  # exit 1 if a JSON file is out of date
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { composeScript, loadHelpers } = require("./lib/compose.js");

const OUT_DIR = __dirname;
// TODO(spike): confirm the API host the workflow engine should call for IAM, and whether an
// x-blocks-key header is needed on top of blocksAuthentication.
const API = "https://api.seliseblocks.com";
const ROLES_ANY_USER = { mode: "or", values: ["platform-admin", "team-admin", "member"] };

const gql = loadHelpers(["graphql", "rollup"]);

const PRICE_FIELDS = [
  "provider", "model", "modelAliases", "effectiveFrom",
  "inputPer1M", "outputPer1M", "cacheReadPer1M", "cacheWrite5mPer1M", "cacheWrite1hPer1M",
  "longContextThreshold", "longContextInputPer1M", "longContextOutputPer1M",
  "longContextCacheReadPer1M", "longContextCacheWrite5mPer1M", "longContextCacheWrite1hPer1M",
  "fastMultiplier", "webSearchPerRequest"
];
const PRICES_QUERY = gql.buildListQuery("ModelPrice", null, PRICE_FIELDS, 1000);
const STATE_QUERY = gql.buildListQuery(
  "RollupState",
  { name: { eq: gql.ROLLUP_STATE_NAME } },
  ["ItemId", "name", "lastRunStartedAt", "lastRunFinishedAt", "dirtyHours"],
  1
);

// ---------- node builders ----------
let column = 0;
function at(row = 0) {
  return { x: column * 260, y: row * 160 };
}
function next() {
  column += 1;
}
function base(id, name, category, type, parameters, row) {
  return { id, name, category, type, version: "v1", position: at(row), parameters, settings: {}, pinData: null };
}
const ref = (node, field) => `{{$node["${node}"].json.output.${field}}}`;

function webhook(id, name, pathSegment, authType) {
  const parameters = { httpMethod: "POST", authType, httpResponseMode: "last", httpResponseData: "all", path: pathSegment };
  if (authType === "blocksAuthorization") {
    parameters.authorizationMode = "RolesOnly";
    parameters.roles = ROLES_ANY_USER;
    parameters.permissions = { mode: "or", values: [] };
  }
  return base(id, name, "trigger", "webhook", parameters);
}
function code(id, name, nodeFile, helpers, consts, row) {
  return base(id, name, "transform", "code", { mode: "each", language: "js", script: composeScript(nodeFile, helpers, consts) }, row);
}
function ifNode(id, name, left, row) {
  return base(id, name, "logic", "if", {
    conditionType: "all",
    conditions: [{ left, operator: "is_true", right: "", type: "boolean" }]
  }, row);
}
function rawData(id, name, actionType, schemaName, rawQuery, row) {
  return base(id, name, "action", "dataAction", {
    actionType,
    collectionName: `${schemaName}s`,
    schemaName,
    rawQueryMode: true,
    rawQuery,
    authenticationType: "blocksAuthentication"
  }, row);
}
function updateData(id, name, schemaName, filter, fieldMapping, row) {
  return base(id, name, "action", "dataAction", {
    actionType: "updateData",
    collectionName: `${schemaName}s`,
    schemaName,
    filter,
    fieldMapping,
    rawQueryMode: false,
    authenticationType: "blocksAuthentication"
  }, row);
}
function httpGet(id, name, url, query, row) {
  const parameters = { httpMethod: "GET", url, authenticationType: "blocksAuthentication", haveHeaders: false, haveBody: false, haveQueryParameters: !!query };
  if (query) parameters.queryParameters = query;
  return base(id, name, "action", "httpRequest", parameters, row);
}
function edge(source, target, handle = "source") {
  const suffix = handle === "source" ? "" : `-${handle}`;
  return { id: `xy-edge__${source}${suffix}-${target}`, source, target, sourceHandle: handle, targetHandle: "target" };
}
function chain(ids) {
  const out = [];
  for (let i = 0; i + 1 < ids.length; i++) out.push(edge(ids[i], ids[i + 1]));
  return out;
}

// Helper sets per kind of node.
const H_PARSE = ["workflow-io", "ingest-key", "graphql"];
const H_IO = ["workflow-io"];
const H_PREPARE = ["workflow-io", "graphql", "validate-event", "redact", "cost"];
const H_ROLLUP = ["workflow-io", "graphql", "rollup"];
const H_KEY = ["workflow-io", "ingest-key", "graphql"];
const H_MANUAL = ["workflow-io", "graphql", "validate-event", "redact", "cost", "rollup", "ingest-key", "manual-entry"];

// ---------- ingest ----------
function ingest() {
  column = 0;
  const T = "Ingest Webhook";
  const nodes = [];
  nodes.push(webhook("i1", T, "ingest", "none")); next();
  nodes.push(code("i2", "Parse Request", "ingest-parse-request.js", H_PARSE, { TRIGGER_NODE: T })); next();
  nodes.push(ifNode("i3", "Request Valid", "{{$json.output.ok}}")); next();
  nodes.push(code("i4", "Respond Request Error", "respond.js", H_IO, { SOURCE_NODE: "Parse Request" }, 1));
  nodes.push(rawData("i5", "Find Ingest Key", "getData", "IngestKey", ref("Parse Request", "keyLookupQuery"))); next();
  nodes.push(code("i6", "Verify Key", "ingest-verify-key.js", ["workflow-io", "ingest-key"])); next();
  nodes.push(ifNode("i7", "Key Valid", "{{$json.output.ok}}")); next();
  nodes.push(code("i8", "Respond Key Error", "respond.js", H_IO, { SOURCE_NODE: "Verify Key" }, 1));
  nodes.push(httpGet("i9", "Check Team Membership", `${API}/iam/v4/iam/users/${ref("Verify Key", "userId")}`, { organizationId: ref("Verify Key", "teamId") })); next();
  nodes.push(code("i10", "Membership Result", "ingest-membership.js", H_IO)); next();
  nodes.push(ifNode("i11", "Owner Still In Team", "{{$json.output.ok}}")); next();
  nodes.push(code("i12", "Respond Membership Error", "respond.js", H_IO, { SOURCE_NODE: "Membership Result" }, 1));
  nodes.push(rawData("i13", "Load Model Prices", "getData", "ModelPrice", PRICES_QUERY)); next();
  nodes.push(rawData("i14", "Find Existing Events", "getData", "UsageEvent", ref("Parse Request", "existingEventsQuery"))); next();
  nodes.push(code("i15", "Prepare Events", "ingest-prepare-events.js", H_PREPARE)); next();
  nodes.push(updateData("i16", "Touch Ingest Key", "IngestKey",
    { ItemId: ref("Verify Key", "keyItemId") },
    { lastUsedAt: ref("Verify Key", "usedAt"), rateWindowStart: ref("Verify Key", "rateWindowStart"), rateWindowCount: ref("Verify Key", "rateWindowCount") })); next();
  nodes.push(ifNode("i17", "Has New Events", ref("Prepare Events", "hasInserts"))); next();
  nodes.push(code("i20", "Respond All Duplicates", "respond.js", H_IO, { SOURCE_NODE: "Prepare Events" }, 1));
  nodes.push(rawData("i18", "Insert Events", "insertData", "UsageEvent", ref("Prepare Events", "insertMutation"))); next();
  nodes.push(code("i19", "Respond Accepted", "respond-after-write.js", H_IO, { SOURCE_NODE: "Prepare Events", ERROR_CODE: "insert_failed" }));
  const edges = [
    edge("i1", "i2"), edge("i2", "i3"),
    edge("i3", "i5", "if-true"), edge("i3", "i4", "if-false"),
    edge("i5", "i6"), edge("i6", "i7"),
    edge("i7", "i9", "if-true"), edge("i7", "i8", "if-false"),
    edge("i9", "i10"), edge("i10", "i11"),
    edge("i11", "i13", "if-true"), edge("i11", "i12", "if-false"),
    ...chain(["i13", "i14", "i15", "i16", "i17"]),
    edge("i17", "i18", "if-true"), edge("i17", "i20", "if-false"),
    edge("i18", "i19")
  ];
  return { name: "prompt-meter ingest", settings: {}, nodes, edges };
}

// ---------- rollup ----------
function rollup() {
  column = 0;
  const nodes = [];
  nodes.push(base("r1", "Every 5 Minutes", "trigger", "schedule", { triggerInterval: "minutes", minutesBetweenTriggers: 5 })); next();
  nodes.push(rawData("r2", "Load Rollup State", "getData", "RollupState", STATE_QUERY)); next();
  nodes.push(code("r3", "Plan Rollup Run", "rollup-plan-run.js", H_ROLLUP)); next();
  nodes.push(rawData("r4", "Find Touched Hours", "getData", "UsageEvent", ref("Plan Rollup Run", "touchedQuery"))); next();
  nodes.push(code("r5", "Plan Hours", "rollup-plan-hours.js", H_ROLLUP)); next();
  nodes.push(ifNode("r6", "Has Hours To Rebuild", ref("Plan Hours", "hasHours"))); next();
  const branchColumn = column;
  nodes.push(rawData("r7", "Load Events For Hours", "getData", "UsageEvent", ref("Plan Hours", "eventsQuery"))); next();
  nodes.push(code("r8", "Aggregate Hours", "rollup-aggregate.js", H_ROLLUP)); next();
  nodes.push(rawData("r9", "Replace Hourly Rows", "updateData", "UserHourly", ref("Aggregate Hours", "replaceMutation"))); next();
  nodes.push(rawData("r10", "Reload Rollup State", "getData", "RollupState", STATE_QUERY)); next();
  nodes.push(code("r11", "Finalize Rollup State", "rollup-finalize-state.js", H_ROLLUP, { REPLACE_NODE: "Replace Hourly Rows", HOURS_NODE: "Plan Hours" })); next();
  nodes.push(rawData("r12", "Save Rollup State", "updateData", "RollupState", ref("Finalize Rollup State", "stateMutation")));
  column = branchColumn;
  nodes.push(rawData("r13", "Reload Rollup State (idle)", "getData", "RollupState", STATE_QUERY, 1)); next();
  nodes.push(code("r14", "Finalize Rollup State (idle)", "rollup-finalize-state.js", H_ROLLUP, { REPLACE_NODE: "", HOURS_NODE: "Plan Hours" }, 1)); next();
  nodes.push(rawData("r15", "Save Rollup State (idle)", "updateData", "RollupState", ref("Finalize Rollup State (idle)", "stateMutation"), 1));
  const edges = [
    ...chain(["r1", "r2", "r3", "r4", "r5", "r6"]),
    edge("r6", "r7", "if-true"), edge("r6", "r13", "if-false"),
    ...chain(["r7", "r8", "r9", "r10", "r11", "r12"]),
    ...chain(["r13", "r14", "r15"])
  ];
  return { name: "prompt-meter rollup", settings: {}, nodes, edges };
}

// ---------- issue-key ----------
function issueKey() {
  column = 0;
  const T = "Issue Key Webhook";
  const nodes = [];
  nodes.push(webhook("k1", T, "issue-key", "blocksAuthorization")); next();
  nodes.push(httpGet("k2", "Get Caller", `${API}/iam/v4/iam/me`)); next();
  nodes.push(code("k3", "Identify Caller", "identify-caller.js", H_IO, { TRIGGER_NODE: T })); next();
  nodes.push(httpGet("k4", "Get Caller Organizations", `${API}/iam/v4/iam/organizations/my`)); next();
  nodes.push(code("k5", "Generate Key", "issue-key-generate.js", H_KEY)); next();
  nodes.push(ifNode("k6", "Key Ready", "{{$json.output.ok}}")); next();
  nodes.push(code("k9", "Respond Error", "respond.js", H_IO, { SOURCE_NODE: "Generate Key" }, 1));
  nodes.push(rawData("k7", "Store Key", "insertData", "IngestKey", ref("Generate Key", "insertMutation"))); next();
  nodes.push(code("k8", "Respond Key", "respond-after-write.js", H_IO, { SOURCE_NODE: "Generate Key", ERROR_CODE: "key_store_failed" }));
  const edges = [
    ...chain(["k1", "k2", "k3", "k4", "k5", "k6"]),
    edge("k6", "k7", "if-true"), edge("k6", "k9", "if-false"),
    edge("k7", "k8")
  ];
  return { name: "prompt-meter issue-key", settings: {}, nodes, edges };
}

// ---------- revoke-key ----------
function revokeKey() {
  column = 0;
  const T = "Revoke Key Webhook";
  const nodes = [];
  nodes.push(webhook("v1", T, "revoke-key", "blocksAuthorization")); next();
  nodes.push(httpGet("v2", "Get Caller", `${API}/iam/v4/iam/me`)); next();
  nodes.push(code("v3", "Identify Caller", "identify-caller.js", H_IO, { TRIGGER_NODE: T })); next();
  nodes.push(code("v4", "Plan Revoke", "revoke-key-plan.js", ["workflow-io", "graphql"])); next();
  nodes.push(rawData("v5", "Load Target Keys", "getData", "IngestKey", ref("Plan Revoke", "loadQuery"))); next();
  nodes.push(httpGet("v6", "Get Caller Team Access", `${API}/iam/v4/iam/users/${ref("Identify Caller", "callerId")}`, { organizationId: ref("Plan Revoke", "teamId") })); next();
  nodes.push(code("v7", "Authorize Revoke", "revoke-key-authorize.js", ["workflow-io", "graphql"])); next();
  nodes.push(ifNode("v8", "Revoke Allowed", "{{$json.output.ok}}")); next();
  nodes.push(code("v13", "Respond Error", "respond.js", H_IO, { SOURCE_NODE: "Authorize Revoke" }, 1));
  nodes.push(ifNode("v9", "Has Keys To Revoke", ref("Authorize Revoke", "hasWrites"))); next();
  nodes.push(code("v12", "Respond Nothing To Revoke", "respond.js", H_IO, { SOURCE_NODE: "Authorize Revoke" }, 1));
  nodes.push(rawData("v10", "Revoke Keys", "updateData", "IngestKey", ref("Authorize Revoke", "revokeMutation"))); next();
  nodes.push(code("v11", "Respond Revoked", "respond-after-write.js", H_IO, { SOURCE_NODE: "Authorize Revoke", ERROR_CODE: "revoke_failed" }));
  const edges = [
    ...chain(["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8"]),
    edge("v8", "v9", "if-true"), edge("v8", "v13", "if-false"),
    edge("v9", "v10", "if-true"), edge("v9", "v12", "if-false"),
    edge("v10", "v11")
  ];
  return { name: "prompt-meter revoke-key", settings: {}, nodes, edges };
}

// ---------- manual-entry ----------
function manualEntry() {
  column = 0;
  const T = "Manual Entry Webhook";
  const nodes = [];
  nodes.push(webhook("m1", T, "manual-entry", "blocksAuthorization")); next();
  nodes.push(httpGet("m2", "Get Caller", `${API}/iam/v4/iam/me`)); next();
  nodes.push(code("m3", "Identify Caller", "identify-caller.js", H_IO, { TRIGGER_NODE: T })); next();
  nodes.push(code("m4", "Plan Manual Lookup", "manual-entry-plan-lookup.js", H_MANUAL)); next();
  nodes.push(httpGet("m5", "Get Caller Organizations", `${API}/iam/v4/iam/organizations/my`)); next();
  nodes.push(rawData("m6", "Load Existing Event", "getData", "UsageEvent", ref("Plan Manual Lookup", "existingQuery"))); next();
  nodes.push(rawData("m7", "Load Model Prices", "getData", "ModelPrice", PRICES_QUERY)); next();
  nodes.push(rawData("m8", "Load Rollup State", "getData", "RollupState", STATE_QUERY)); next();
  nodes.push(code("m9", "Plan Manual Write", "manual-entry-plan-write.js", H_MANUAL)); next();
  nodes.push(ifNode("m10", "Write Allowed", "{{$json.output.ok}}")); next();
  nodes.push(code("m15", "Respond Error", "respond.js", H_IO, { SOURCE_NODE: "Plan Manual Write" }, 1));
  nodes.push(ifNode("m11", "Has Writes", ref("Plan Manual Write", "hasWrites"))); next();
  nodes.push(code("m14", "Respond Unchanged", "respond.js", H_IO, { SOURCE_NODE: "Plan Manual Write" }, 1));
  nodes.push(rawData("m12", "Write Manual Event", "updateData", "UsageEvent", ref("Plan Manual Write", "writeMutation"))); next();
  nodes.push(code("m13", "Respond Saved", "respond-after-write.js", H_IO, { SOURCE_NODE: "Plan Manual Write", ERROR_CODE: "write_failed" }));
  const edges = [
    ...chain(["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10"]),
    edge("m10", "m11", "if-true"), edge("m10", "m15", "if-false"),
    edge("m11", "m12", "if-true"), edge("m11", "m14", "if-false"),
    edge("m12", "m13")
  ];
  return { name: "prompt-meter manual-entry", settings: {}, nodes, edges };
}

const WORKFLOWS = {
  "ingest.json": ingest,
  "rollup.json": rollup,
  "issue-key.json": issueKey,
  "revoke-key.json": revokeKey,
  "manual-entry.json": manualEntry
};

function render() {
  const out = {};
  for (const [file, make] of Object.entries(WORKFLOWS)) out[file] = `${JSON.stringify(make(), null, 2)}\n`;
  return out;
}

module.exports = { render, WORKFLOWS, OUT_DIR };

if (require.main === module) {
  const check = process.argv.includes("--check");
  const rendered = render();
  let stale = 0;
  for (const [file, text] of Object.entries(rendered)) {
    const target = path.join(OUT_DIR, file);
    if (check) {
      const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
      if (current !== text) {
        stale += 1;
        console.error(`out of date: ${file}`);
      }
    } else {
      fs.writeFileSync(target, text);
      console.log(`wrote ${path.relative(process.cwd(), target)}`);
    }
  }
  if (stale) process.exit(1);
}
