// Composes a code-node script from shared helper files + one node body, exactly as
// build.js embeds it into the workflow JSON. Tests evaluate the same composed text.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const LIB_DIR = __dirname;

// Helper load order matters only for readability; all are function/const declarations.
const HELPER_DEPS = {
  "sha256": [],
  "ingest-key": ["sha256"],
  "redact": [],
  "cost": [],
  "validate-event": [],
  "graphql": [],
  "workflow-io": [],
  "rollup": ["workflow-io"],
  "manual-entry": ["validate-event", "redact", "ingest-key"],
  "account-link": ["sha256", "ingest-key", "workflow-io"]
};

function resolveHelpers(names) {
  const out = [];
  const visit = (name) => {
    if (out.includes(name)) return;
    if (!HELPER_DEPS[name]) throw new Error(`unknown helper ${name}`);
    HELPER_DEPS[name].forEach(visit);
    out.push(name);
  };
  names.forEach(visit);
  return out;
}

function readLib(relative) {
  return fs.readFileSync(path.join(LIB_DIR, relative), "utf8").trimEnd();
}

function constLines(consts) {
  return Object.entries(consts || {}).map(([k, v]) => `const ${k} = ${JSON.stringify(v)};`).join("\n");
}

function composeScript(nodeFile, helpers, consts) {
  const parts = [
    `// prompt-meter code node. Generated from infra/blocks/workflows/lib/nodes/${nodeFile} by build.js.`,
    "// Edit the lib files and re-run `node infra/blocks/workflows/build.js`; do not edit this string."
  ];
  const c = constLines(consts);
  if (c) parts.push(c);
  for (const name of resolveHelpers(helpers)) {
    parts.push(`// ---- helper: lib/${name}.js`);
    parts.push(readLib(`${name}.js`));
  }
  parts.push(`// ---- node: lib/nodes/${nodeFile}`);
  parts.push(readLib(path.join("nodes", nodeFile)));
  return parts.join("\n") + "\n";
}

// Names declared at the top level of helper files (function X / const X).
function declaredNames(source) {
  const names = new Set();
  for (const m of source.matchAll(/^(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  return [...names];
}

// Evaluates helper files in a plain function scope (like the sandbox) and returns their exports.
function loadHelpers(names) {
  const files = resolveHelpers(names);
  const source = files.map((n) => readLib(`${n}.js`)).join("\n");
  const exported = declaredNames(source);
  // eslint-disable-next-line no-new-func
  return new Function(`${source}\nreturn { ${exported.join(", ")} };`)();
}

// Runs a composed script with sandbox-like globals (no require, no module).
function runScript(script, { $json = {}, $node = {}, $items = [] } = {}) {
  // eslint-disable-next-line no-new-func
  const fn = new Function("$json", "$node", "$items", script);
  return fn($json, $node, $items);
}

module.exports = { composeScript, loadHelpers, runScript, resolveHelpers, LIB_DIR };
