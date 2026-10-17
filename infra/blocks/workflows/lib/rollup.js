// Hourly rollup planning and aggregation (PLAN.md "Ingest design" -> Rollup).
//  - Watermark: events with receivedAt >= previous run start - 2 minutes.
//  - Never scan further back than 48 hours by receivedAt.
//  - Hours to rebuild = UTC hours (by occurredAt) of those events + RollupState.dirtyHours.
//  - Each rebuilt hour is recomputed from scratch from UsageEvent, so rebuilding twice is harmless.
// Depends on: workflow-io.js (hourStartOf)
//
// Shared helper: function declarations only. Inlined into code nodes by build.js.

const ROLLUP_STATE_NAME = "hourly";
const WATERMARK_OVERLAP_MS = 2 * 60 * 1000;
const SCAN_WINDOW_MS = 48 * 60 * 60 * 1000;
const SUM_FIELDS = [
  "totalInputTokens",
  "uncachedInputTokens",
  "cacheReadTokens",
  "cacheWrite5mTokens",
  "cacheWrite1hTokens",
  "outputTokens",
  "thinkingTokens",
  "serverToolRequests"
];

function normalizeHours(list) {
  const seen = {};
  const out = [];
  const items = Array.isArray(list) ? list : [];
  for (let i = 0; i < items.length; i++) {
    const t = new Date(items[i]).getTime();
    if (isNaN(t)) continue;
    const h = hourStartOf(items[i]);
    if (!seen[h]) { seen[h] = true; out.push(h); }
  }
  return out.sort();
}

function planRollupRun(state, nowMs) {
  const floor = nowMs - SCAN_WINDOW_MS;
  const last = state && state.lastRunStartedAt ? new Date(state.lastRunStartedAt).getTime() : NaN;
  const since = isNaN(last) ? floor : Math.max(last - WATERMARK_OVERLAP_MS, floor);
  return {
    runStartedAt: new Date(nowMs).toISOString(),
    receivedSince: new Date(since).toISOString(),
    dirtyHours: normalizeHours(state && state.dirtyHours)
  };
}

function hoursToRebuild(touchedEvents, dirtyHours) {
  const list = [];
  const events = Array.isArray(touchedEvents) ? touchedEvents : [];
  for (let i = 0; i < events.length; i++) if (events[i] && events[i].occurredAt) list.push(events[i].occurredAt);
  return normalizeHours(list.concat(dirtyHours || []));
}

// `where` filter selecting every event whose occurredAt falls inside one of `hours`.
function hoursWhere(hours) {
  const ranges = hours.map(function (h) {
    const start = new Date(h).getTime();
    return { occurredAt: { gte: new Date(start).toISOString(), lt: new Date(start + 3600000).toISOString() } };
  });
  return ranges.length === 1 ? ranges[0] : { or: ranges };
}

function num(value) {
  return typeof value === "number" && isFinite(value) ? value : 0;
}

function round8(value) {
  return Math.round(value * 1e8) / 1e8;
}

// Builds UserHourly and TeamHourly rows for the given events.
function aggregateHourly(events) {
  const users = {};
  const teams = {};
  const list = Array.isArray(events) ? events : [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e || !e.userId || !e.teamId || !e.occurredAt) continue;
    const hourStart = hourStartOf(e.occurredAt);
    const tool = e.tool || "other";
    const model = e.model || "unknown";
    const source = e.source || "proxy";
    const uKey = [e.userId, e.teamId, hourStart, tool, model, source].join("|");
    const tKey = [e.teamId, hourStart, tool, model, source].join("|");
    if (!users[uKey]) {
      users[uKey] = { userId: e.userId, teamId: e.teamId, hourStart: hourStart, tool: tool, model: model, source: source, costUsd: 0, eventCount: 0, promptCount: 0, _prompts: {} };
      SUM_FIELDS.forEach(function (f) { users[uKey][f] = 0; });
    }
    if (!teams[tKey]) {
      teams[tKey] = { teamId: e.teamId, hourStart: hourStart, tool: tool, model: model, source: source, costUsd: 0, eventCount: 0 };
      SUM_FIELDS.forEach(function (f) { teams[tKey][f] = 0; });
    }
    const u = users[uKey];
    const t = teams[tKey];
    SUM_FIELDS.forEach(function (f) { u[f] += num(e[f]); t[f] += num(e[f]); });
    u.costUsd += num(e.costUsd);
    t.costUsd += num(e.costUsd);
    u.eventCount += 1;
    t.eventCount += 1;
    const promptKey = e.promptId || e.eventId;
    if (promptKey && !u._prompts[promptKey]) { u._prompts[promptKey] = true; u.promptCount += 1; }
  }
  const sortKey = function (r) { return [r.hourStart, r.teamId, r.userId || "", r.tool, r.model, r.source].join("|"); };
  const userRows = Object.keys(users).map(function (k) {
    const r = users[k];
    delete r._prompts;
    r.costUsd = round8(r.costUsd);
    return r;
  }).sort(function (a, b) { return sortKey(a) < sortKey(b) ? -1 : 1; });
  const teamRows = Object.keys(teams).map(function (k) {
    teams[k].costUsd = round8(teams[k].costUsd);
    return teams[k];
  }).sort(function (a, b) { return sortKey(a) < sortKey(b) ? -1 : 1; });
  return { userRows: userRows, teamRows: teamRows };
}

// Dirty hours still pending after this run: hours marked since the run started stay.
function remainingDirtyHours(latestDirty, processedHours) {
  const done = {};
  (processedHours || []).forEach(function (h) { done[h] = true; });
  return normalizeHours(latestDirty).filter(function (h) { return !done[h]; });
}
