import { enumerateBuckets, floorToUtcHour, groupByLocal, isInRange } from "../../lib/time/zoned";
import type { LocalRange, UtcRange } from "../../lib/time/zoned";
import type { Source, TeamHourly, UsageEvent, UserHourly } from "./data/types";

export type HourlyRow = UserHourly | TeamHourly;

/** "Tokens" shown in the portal: all input (cached included) + output (thinking is already inside output). */
export function tokensOf(row: { totalInputTokens: number; outputTokens: number }): number {
  return (row.totalInputTokens || 0) + (row.outputTokens || 0);
}

export type Totals = {
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** Sum of priced costs only. */
  costUsd: number;
  eventCount: number;
  promptCount: number;
  manualTokens: number;
  manualCostUsd: number;
  manualEventCount: number;
  /** Events in this slice that have no price (from raw UsageEvents). */
  unpricedCount: number;
};

export const emptyTotals = (): Totals => ({
  cacheReadTokens: 0,
  costUsd: 0,
  eventCount: 0,
  inputTokens: 0,
  manualCostUsd: 0,
  manualEventCount: 0,
  manualTokens: 0,
  outputTokens: 0,
  promptCount: 0,
  tokens: 0,
  unpricedCount: 0
});

function addRow(totals: Totals, row: HourlyRow): void {
  const tokens = tokensOf(row);
  totals.tokens += tokens;
  totals.inputTokens += row.totalInputTokens || 0;
  totals.outputTokens += row.outputTokens || 0;
  totals.cacheReadTokens += row.cacheReadTokens || 0;
  totals.costUsd += row.costUsd || 0;
  totals.eventCount += row.eventCount || 0;
  totals.promptCount += "promptCount" in row ? row.promptCount || 0 : 0;
  if (row.source === "manual") {
    totals.manualTokens += tokens;
    totals.manualCostUsd += row.costUsd || 0;
    totals.manualEventCount += row.eventCount || 0;
  }
}

/**
 * Unpriced events counted the same way as the hourly rows: by the UTC hour
 * the event falls in, and that hour's start must be inside the range.
 */
export function unpricedInRange(events: readonly UsageEvent[], range: UtcRange): UsageEvent[] {
  return events.filter((event) => event.pricingStatus === "unpriced" && isInRange(floorToUtcHour(event.occurredAt), range));
}

/** Hour-aligned superset of a range, for fetching events that pair with hourly rows. */
export function hourAlignedRange(range: UtcRange): UtcRange {
  const end = Date.parse(range.end);
  const ceil = Math.ceil(end / 3_600_000) * 3_600_000;
  return { end: new Date(ceil).toISOString(), start: floorToUtcHour(range.start) };
}

export function summarize(rows: readonly HourlyRow[], range: UtcRange, unpricedEvents: readonly UsageEvent[] = []): Totals {
  const totals = emptyTotals();
  for (const row of rows) if (isInRange(row.hourStart, range)) addRow(totals, row);
  totals.unpricedCount = unpricedInRange(unpricedEvents, range).length;
  return totals;
}

export type TrendPoint = {
  key: string;
  proxyTokens: number;
  manualTokens: number;
  proxyCostUsd: number;
  manualCostUsd: number;
  eventCount: number;
  unpricedCount: number;
};

/** One point per local day of `range` (zero-filled), split by source. */
export function trendByDay(rows: readonly HourlyRow[], unpricedEvents: readonly UsageEvent[], range: LocalRange, timeZone: string): TrendPoint[] {
  const inRange = rows.filter((row) => isInRange(row.hourStart, range));
  const groups = groupByLocal(inRange, (row) => row.hourStart, timeZone, "day");
  const unpricedGroups = groupByLocal(unpricedInRange(unpricedEvents, range), (event) => floorToUtcHour(event.occurredAt), timeZone, "day");
  return enumerateBuckets(range, "day").map((key) => {
    const point: TrendPoint = { eventCount: 0, key, manualCostUsd: 0, manualTokens: 0, proxyCostUsd: 0, proxyTokens: 0, unpricedCount: unpricedGroups.get(key)?.length ?? 0 };
    for (const row of groups.get(key) ?? []) {
      point.eventCount += row.eventCount || 0;
      if (row.source === "manual") {
        point.manualTokens += tokensOf(row);
        point.manualCostUsd += row.costUsd || 0;
      } else {
        point.proxyTokens += tokensOf(row);
        point.proxyCostUsd += row.costUsd || 0;
      }
    }
    return point;
  });
}

export type BreakdownRow = {
  /** Stable id: value + source, so manual entries never merge into proxy rows. */
  id: string;
  value: string;
  source: Source;
  tokens: number;
  costUsd: number;
  eventCount: number;
  unpricedCount: number;
};

export function breakdownBy(dimension: "tool" | "model", rows: readonly HourlyRow[], unpricedEvents: readonly UsageEvent[], range: UtcRange): BreakdownRow[] {
  const map = new Map<string, BreakdownRow>();
  const get = (value: string, source: Source) => {
    const id = `${value}\u0000${source}`;
    let entry = map.get(id);
    if (!entry) {
      entry = { costUsd: 0, eventCount: 0, id, source, tokens: 0, unpricedCount: 0, value };
      map.set(id, entry);
    }
    return entry;
  };
  for (const row of rows) {
    if (!isInRange(row.hourStart, range)) continue;
    const entry = get(row[dimension], row.source);
    entry.tokens += tokensOf(row);
    entry.costUsd += row.costUsd || 0;
    entry.eventCount += row.eventCount || 0;
  }
  for (const event of unpricedInRange(unpricedEvents, range)) get(event[dimension], event.source).unpricedCount += 1;
  return [...map.values()].sort((a, b) => b.tokens - a.tokens || a.value.localeCompare(b.value));
}

export type PromptGroup = {
  key: string;
  promptId: string | null;
  preview: string | null;
  calls: UsageEvent[];
  start: string;
  tokens: number;
  costUsd: number;
  unpricedCount: number;
};

export type SessionGroup = {
  key: string;
  sessionId: string | null;
  isManual: boolean;
  start: string;
  end: string;
  tools: string[];
  models: string[];
  prompts: PromptGroup[];
  tokens: number;
  costUsd: number;
  eventCount: number;
  unpricedCount: number;
};

function sumEvents(events: readonly UsageEvent[]) {
  let tokens = 0;
  let costUsd = 0;
  let unpricedCount = 0;
  for (const event of events) {
    tokens += tokensOf(event);
    if (event.pricingStatus === "unpriced" || event.costUsd === null) unpricedCount += 1;
    else costUsd += event.costUsd;
  }
  return { costUsd, tokens, unpricedCount };
}

const byOccurred = (a: UsageEvent, b: UsageEvent) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt);

/** Groups calls into prompts (promptId, else the event itself), ordered by time then callIndex. */
export function groupPrompts(events: readonly UsageEvent[]): PromptGroup[] {
  const map = new Map<string, UsageEvent[]>();
  for (const event of events) {
    const key = event.promptId ? `p:${event.promptId}` : `e:${event.eventId}`;
    const list = map.get(key);
    if (list) list.push(event);
    else map.set(key, [event]);
  }
  return [...map.entries()]
    .map(([key, calls]) => {
      const sorted = [...calls].sort((a, b) => (a.callIndex ?? 0) - (b.callIndex ?? 0) || byOccurred(a, b));
      const first = [...calls].sort(byOccurred)[0]!;
      return {
        ...sumEvents(sorted),
        calls: sorted,
        key,
        preview: sorted.find((call) => call.promptPreview)?.promptPreview ?? null,
        promptId: first.promptId,
        start: first.occurredAt
      };
    })
    .sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
}

/** Sessions (sessionId; events without one stand alone), newest first. */
export function groupSessions(events: readonly UsageEvent[]): SessionGroup[] {
  const map = new Map<string, UsageEvent[]>();
  for (const event of events) {
    const key = event.sessionId ? `s:${event.sessionId}` : event.promptId ? `p:${event.promptId}` : `e:${event.eventId}`;
    const list = map.get(key);
    if (list) list.push(event);
    else map.set(key, [event]);
  }
  return [...map.entries()]
    .map(([key, list]) => {
      const sorted = [...list].sort(byOccurred);
      return {
        ...sumEvents(sorted),
        end: sorted[sorted.length - 1]!.occurredAt,
        eventCount: sorted.length,
        isManual: sorted.every((event) => event.source === "manual"),
        key,
        models: [...new Set(sorted.map((event) => event.model))],
        prompts: groupPrompts(sorted),
        sessionId: sorted[0]!.sessionId,
        start: sorted[0]!.occurredAt,
        tools: [...new Set(sorted.map((event) => event.tool))]
      };
    })
    .sort((a, b) => Date.parse(b.end) - Date.parse(a.end));
}

/** Distinct values for filter dropdowns. */
export function distinctValues<T, K extends keyof T>(rows: readonly T[], key: K): string[] {
  return [...new Set(rows.map((row) => String(row[key] ?? "")).filter(Boolean))].sort();
}
