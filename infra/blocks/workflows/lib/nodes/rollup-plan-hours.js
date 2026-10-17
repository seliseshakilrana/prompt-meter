// Code node "Plan Hours" (rollup.json). Mode: each. Input: "Find Touched Hours".
// Hours to rebuild = UTC hours of recently received events + dirty hours.
// TODO(spike): no paging inside a workflow. If more events arrived than one page holds,
// `truncated` is set and the watermark is not advanced, so the next run tries again.
// Helpers: workflow-io, graphql, rollup.

const EVENT_FIELDS = [
  "eventId", "userId", "teamId", "tool", "model", "source", "promptId", "occurredAt",
  "totalInputTokens", "uncachedInputTokens", "cacheReadTokens", "cacheWrite5mTokens",
  "cacheWrite1hTokens", "outputTokens", "thinkingTokens", "serverToolRequests", "costUsd"
];
const plan = nodeOutput($node, "Plan Rollup Run");
const touched = extractItems($json);
const total = extractTotalCount($json);
const hours = hoursToRebuild(touched, plan.dirtyHours);
return {
  hasHours: hours.length > 0,
  hours: hours,
  truncated: typeof total === "number" && total > touched.length,
  eventsQuery: hours.length ? buildListQuery("UsageEvent", hoursWhere(hours), EVENT_FIELDS, MAX_PAGE_SIZE) : ""
};
