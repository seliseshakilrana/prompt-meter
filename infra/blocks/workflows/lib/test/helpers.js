"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { loadHelpers, composeScript, runScript } = require("../compose.js");

const BLOCKS_DIR = path.resolve(__dirname, "../../..");
function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(BLOCKS_DIR, rel), "utf8"));
}
function seedPrices() {
  return readJson("seed/model-prices.json").rows.filter((r) => r.model);
}
// Finds the composed script of a node in a generated workflow file and runs it.
function runWorkflowNode(workflowFile, nodeName, ctx) {
  const wf = readJson(`workflows/${workflowFile}`);
  const node = wf.nodes.find((n) => n.name === nodeName);
  if (!node) throw new Error(`no node ${nodeName} in ${workflowFile}`);
  return runScript(node.parameters.script, ctx);
}
// Shapes upstream outputs the way the skill's examples show them ({ json: ... }).
function nodes(map) {
  const out = {};
  for (const [k, v] of Object.entries(map)) out[k] = { json: v };
  return out;
}
module.exports = { loadHelpers, composeScript, runScript, readJson, seedPrices, runWorkflowNode, nodes, BLOCKS_DIR };
