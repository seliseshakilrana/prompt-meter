import { inUtcRange, matchesFilters } from "./filters";
import type { EventPage, TeamHourly, UsageDataSource, UsageEvent, UserHourly } from "./types";

// Bundled copy of infra/blocks/seed/sample-usage.json (sampleSource.test.ts
// fails if the two drift apart). Loaded lazily so the blocks build never
// ships it in the main chunk.
type SampleFile = {
  users: { userId: string; timezone: string; utcOffset: string }[];
  teams: { teamId: string; members: string[] }[];
  usageEvents: UsageEvent[];
  userHourly: UserHourly[];
  teamHourly: TeamHourly[];
};

export type SampleDataset = Omit<SampleFile, "teams"> & { teams: SampleFile["teams"]; shiftDays: number };

const DAY_MS = 86_400_000;
/** UTC day the sample was recorded on (and the price effectiveFrom day). */
export const SAMPLE_BASE_DAY = Date.UTC(2026, 9, 17);

export { SAMPLE_USERS } from "./sampleUsers";

function shiftIso(iso: string | null | undefined, ms: number): string {
  return new Date(Date.parse(iso ?? "") + ms).toISOString();
}

/**
 * Moves the sample forward by whole UTC days so it lands on the current UTC
 * date (the sample stays on 2026-10-17 when that is today or later). Whole
 * days keep every local-midnight crossing in the data intact.
 */
export function sampleShiftDays(now: number): number {
  return Math.max(0, Math.floor((now - SAMPLE_BASE_DAY) / DAY_MS));
}

export function shiftSample(file: SampleFile, days: number): SampleDataset {
  const ms = days * DAY_MS;
  return {
    ...file,
    shiftDays: days,
    teamHourly: file.teamHourly.map((row) => ({ ...row, hourStart: shiftIso(row.hourStart, ms) })),
    usageEvents: file.usageEvents.map((event) => ({
      ...event,
      occurredAt: shiftIso(event.occurredAt, ms),
      receivedAt: shiftIso(event.receivedAt, ms)
    })),
    userHourly: file.userHourly.map((row) => ({ ...row, hourStart: shiftIso(row.hourStart, ms) }))
  };
}

let datasetPromise: Promise<SampleDataset> | undefined;

export function loadSampleDataset(now: number = Date.now()): Promise<SampleDataset> {
  datasetPromise ??= import("./sample-usage.json").then((module) => {
    const file = (module as { default: unknown }).default as SampleFile;
    return shiftSample(file, sampleShiftDays(now));
  });
  return datasetPromise;
}

const byTime = (a: string, b: string) => Date.parse(a) - Date.parse(b);

export function createSampleSource(load: () => Promise<SampleDataset> = () => loadSampleDataset()): UsageDataSource {
  return {
    kind: "sample",

    async listUserHourly({ filters, range, userId }) {
      const data = await load();
      return data.userHourly
        .filter((row) => row.userId === userId && inUtcRange(row.hourStart, range) && matchesFilters(row, filters))
        .sort((a, b) => byTime(a.hourStart, b.hourStart));
    },

    async listTeamHourly({ filters, range, teamId }) {
      const data = await load();
      return data.teamHourly
        .filter((row) => row.teamId === teamId && inUtcRange(row.hourStart, range) && matchesFilters(row, filters))
        .sort((a, b) => byTime(a.hourStart, b.hourStart));
    },

    async listEvents(query): Promise<EventPage> {
      const data = await load();
      const matching = data.usageEvents
        .filter((event) =>
          event.userId === query.userId &&
          inUtcRange(event.occurredAt, query.range) &&
          (query.sessionId === undefined || event.sessionId === query.sessionId) &&
          (query.promptId === undefined || event.promptId === query.promptId) &&
          (query.pricingStatus === undefined || event.pricingStatus === query.pricingStatus) &&
          matchesFilters(event, query.filters))
        .sort((a, b) => byTime(b.occurredAt, a.occurredAt));
      const limit = query.limit ?? Infinity;
      return { items: matching.slice(0, limit), truncated: matching.length > limit };
    }
  };
}
