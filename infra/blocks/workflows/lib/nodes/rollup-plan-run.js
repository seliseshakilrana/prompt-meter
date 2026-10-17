// Code node "Plan Rollup Run" (rollup.json). Mode: each. Input: "Load Rollup State".
// Watermark = previous run start - 2 minutes, never more than 48 hours back.
// Helpers: workflow-io, graphql, rollup.

const states = extractItems($json);
const state = states.length ? states[0] : null;
const plan = planRollupRun(state, Date.now());
return Object.assign({}, plan, {
  stateExists: !!state,
  touchedQuery: buildListQuery("UsageEvent", { receivedAt: { gte: plan.receivedSince } }, ["occurredAt"], MAX_PAGE_SIZE)
});
