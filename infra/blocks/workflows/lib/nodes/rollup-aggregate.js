// Code node "Aggregate Hours" (rollup.json). Mode: each. Input: "Load Events For Hours".
// Rebuilds every UserHourly and TeamHourly row of the planned hours from scratch:
// one mutation deletes the old rows of those hours, then inserts the new ones
// (top-level mutation fields run in order).
// TODO(spike): delete filter format (Mongo-style JSON assumed; DateTime matching inside it).
// Helpers: workflow-io, graphql, rollup.

const hoursPlan = nodeOutput($node, "Plan Hours");
const events = extractItems($json);
const total = extractTotalCount($json);
if (typeof total === "number" && total > events.length) {
  throw new Error("rollup_events_truncated: " + total + " events for " + hoursPlan.hours.length + " hours");
}
const agg = aggregateHourly(events);
const hourFilter = filterString({ hourStart: { $in: hoursPlan.hours } });
const fields = [
  deleteManyField("deleteUserRows", "UserHourly", hourFilter),
  deleteManyField("deleteTeamRows", "TeamHourly", hourFilter)
];
if (agg.userRows.length) fields.push(insertManyField("insertUserRows", "UserHourly", agg.userRows));
if (agg.teamRows.length) fields.push(insertManyField("insertTeamRows", "TeamHourly", agg.teamRows));
return {
  hours: hoursPlan.hours,
  userRowCount: agg.userRows.length,
  teamRowCount: agg.teamRows.length,
  replaceMutation: buildMutation(fields)
};
