"use strict";
// Structural checks on the generated workflow files.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { render, OUT_DIR } = require("../../build.js");

const TYPES = {
  trigger: ["webhook", "dataGateway", "schedule", "email"],
  logic: ["if"],
  transform: ["code", "setfield"],
  action: ["httpRequest", "dataAction", "sendMail", "agent", "proxy"]
};
const rendered = render();

test("generated JSON files are up to date with build.js and lib/", () => {
  for (const [file, text] of Object.entries(rendered)) {
    assert.equal(fs.readFileSync(path.join(OUT_DIR, file), "utf8"), text, `${file} is stale: run node infra/blocks/workflows/build.js`);
  }
});

for (const [file, text] of Object.entries(rendered)) {
  test(`${file}: shape, node types, edges, scripts compile`, () => {
    const wf = JSON.parse(text);
    assert.deepEqual(Object.keys(wf), ["name", "settings", "nodes", "edges"]);
    const ids = new Set();
    const names = new Set();
    let triggers = 0;
    for (const n of wf.nodes) {
      assert.equal(n.version, "v1");
      assert.ok(TYPES[n.category] && TYPES[n.category].includes(n.type), `${n.name}: ${n.category}/${n.type}`);
      assert.ok(!ids.has(n.id) && !names.has(n.name), `duplicate ${n.id}/${n.name}`);
      ids.add(n.id);
      names.add(n.name);
      if (n.category === "trigger") triggers += 1;
      if (n.type === "code") {
        assert.equal(n.parameters.language, "js");
        // eslint-disable-next-line no-new-func
        assert.doesNotThrow(() => new Function("$json", "$node", "$items", n.parameters.script), n.name);
        assert.ok(!/\b(module\.exports|import |export )/.test(n.parameters.script), `${n.name} uses module syntax`);
      }
      if (n.type === "dataAction") {
        assert.ok(["getData", "insertData", "updateData", "deleteData"].includes(n.parameters.actionType));
        assert.ok(n.parameters.collectionName);
        assert.equal(n.parameters.authenticationType, "blocksAuthentication");
        if (n.parameters.rawQueryMode && !n.parameters.rawQuery.startsWith("{{")) {
          assert.equal(/\{\{|\}\}/.test(n.parameters.rawQuery), false, `${n.name}: literal query contains expression delimiters`);
        }
      }
      if (n.type === "httpRequest") {
        // Blocks calls use the delegated token; the only other call is the public
        // provider key-set fetch, which must carry no credentials at all.
        if (n.parameters.url.startsWith("https://api.seliseblocks.com")) {
          assert.equal(n.parameters.authenticationType, "blocksAuthentication");
        } else {
          assert.equal(n.name, "Fetch Provider Keys");
          assert.equal(n.parameters.authenticationType, "");
          assert.equal(n.parameters.haveHeaders, false);
        }
      }
      const serialized = JSON.stringify(n.parameters);
      assert.ok(!/clientSecret|__REDACTED__/.test(serialized), `${n.name} embeds a secret`);
      for (const m of serialized.matchAll(/\$node\[\\"([^"\\]+)\\"\]/g)) {
        assert.ok(wf.nodes.some((x) => x.name === m[1]), `${n.name} references unknown node ${m[1]}`);
      }
    }
    assert.equal(triggers, 1);
    const trigger = wf.nodes.find((n) => n.category === "trigger");
    for (const e of wf.edges) {
      assert.ok(ids.has(e.source) && ids.has(e.target), e.id);
      const src = wf.nodes.find((n) => n.id === e.source);
      assert.ok(src.type === "if" ? ["if-true", "if-false"].includes(e.sourceHandle) : e.sourceHandle === "source", e.id);
      assert.equal(e.targetHandle, "target");
    }
    // every node is reachable from the trigger
    const seen = new Set([trigger.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of wf.edges) if (seen.has(e.source) && !seen.has(e.target)) { seen.add(e.target); grew = true; }
    }
    assert.equal(seen.size, wf.nodes.length, "unreachable nodes");
  });
}

test("webhook auth: ingest is open (key-checked), portal workflows need a Blocks login", () => {
  const auth = (f) => JSON.parse(rendered[f]).nodes[0].parameters.authType;
  assert.equal(auth("ingest.json"), "none");
  for (const f of ["issue-key.json", "revoke-key.json", "manual-entry.json", "link-start.json", "link-complete.json", "unlink-account.json"]) {
    assert.equal(auth(f), "blocksAuthorization");
  }
  const sched = JSON.parse(rendered["rollup.json"]).nodes[0];
  assert.equal(sched.type, "schedule");
  assert.equal(sched.parameters.minutesBetweenTriggers, 5);
});

test("link-complete: email-code branch has no Fetch Provider Keys node on its path", () => {
  const wf = JSON.parse(rendered["link-complete.json"]);
  const isTokenNode = wf.nodes.find((n) => n.name === "Is Provider Token");
  assert.ok(isTokenNode, "Is Provider Token node exists");
  const falseEdge = wf.edges.find((e) => e.source === isTokenNode.id && e.sourceHandle === "if-false");
  assert.ok(falseEdge, "Is Provider Token if-false edge exists");

  const codeBranch = new Set([falseEdge.target]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of wf.edges) {
      if (codeBranch.has(e.source) && !codeBranch.has(e.target)) {
        codeBranch.add(e.target);
        grew = true;
      }
    }
  }

  const fetchKeysNode = wf.nodes.find((n) => n.name === "Fetch Provider Keys");
  assert.ok(fetchKeysNode, "Fetch Provider Keys node exists");
  assert.equal(codeBranch.has(fetchKeysNode.id), false, "email-code branch must not reach Fetch Provider Keys");
});
