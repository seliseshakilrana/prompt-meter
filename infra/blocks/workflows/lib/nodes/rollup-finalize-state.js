// Code node "Finalize Rollup State" (rollup.json). Mode: each. Input: "Reload Rollup State".
// Re-reads RollupState just before saving, so dirty hours marked by manual entries
// during this run are kept. Advances lastRunStartedAt only when nothing was truncated.
// Fails the run (no state saved, next run retries) if the hourly replace reported errors.
// Injected constants: REPLACE_NODE ("" when no hours were rebuilt), HOURS_NODE.
// Helpers: workflow-io, graphql, rollup.

const plan = nodeOutput($node, "Plan Rollup Run");
const hoursPlan = nodeOutput($node, HOURS_NODE);
if (REPLACE_NODE) {
  const replaced = $node[REPLACE_NODE] ? $node[REPLACE_NODE].json : null;
  const errors = resultErrors(replaced);
  if (errors.length) throw new Error("rollup_replace_failed: " + JSON.stringify(errors).slice(0, 500));
}
const latest = extractItems($json)[0] || null;
const processed = REPLACE_NODE ? hoursPlan.hours || [] : [];
const input = {
  lastRunFinishedAt: new Date().toISOString(),
  dirtyHours: remainingDirtyHours(latest ? latest.dirtyHours : [], processed)
};
if (!hoursPlan.truncated) input.lastRunStartedAt = plan.runStartedAt;
const field = latest
  ? updateField("state", "RollupState", filterString({ name: ROLLUP_STATE_NAME }), input)
  : insertField("state", "RollupState", Object.assign({ name: ROLLUP_STATE_NAME, lastRunStartedAt: null }, input));
return { stateMutation: buildMutation([field]) };
