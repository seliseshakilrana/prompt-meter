// Pure timestamp helpers for the sample-usage seed.
// Every timestamp is UTC (PLAN.md "Time and timezones"). Hourly rollup rows key on
// `hourStart` (top of a UTC hour), so a shift is always a whole number of hours:
// that keeps every event inside the same hourly row it was aggregated into.

import type { SampleUsageSeedFile, TeamHourly, UsageEvent, UserHourly } from "./types";

export const HOUR_MS = 60 * 60 * 1000;

const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/** Parses an ISO-8601 timestamp that carries an explicit zone (Z or ±hh:mm). */
export function parseIsoUtc(value: unknown): number | null {
  if (typeof value !== "string" || !ISO_UTC_RE.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function isTopOfHour(ms: number): boolean {
  return ms % HOUR_MS === 0;
}

export function floorToHour(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

/**
 * Largest whole-hour shift that moves `newestMs` to at or before `nowMs`.
 * The shifted newest timestamp lands within the last hour before now (never in the future).
 * Negative when the sample lies in the future relative to now.
 */
export function hourAlignedShift(newestMs: number, nowMs: number): number {
  return Math.floor((nowMs - newestMs) / HOUR_MS) * HOUR_MS;
}

export function shiftIso(value: string, deltaMs: number): string {
  const ms = parseIsoUtc(value);
  if (ms === null) throw new Error(`Not an ISO timestamp with a zone: ${value}`);
  return new Date(ms + deltaMs).toISOString();
}

/** Newest occurredAt/receivedAt across the events (receivedAt included so nothing lands after now). */
export function newestEventTime(events: Pick<UsageEvent, "occurredAt" | "receivedAt">[]): number | null {
  let newest: number | null = null;
  for (const event of events) {
    for (const value of [event.occurredAt, event.receivedAt]) {
      const ms = parseIsoUtc(value);
      if (ms !== null && (newest === null || ms > newest)) newest = ms;
    }
  }
  return newest;
}

export function oldestEventTime(events: Pick<UsageEvent, "occurredAt">[]): number | null {
  let oldest: number | null = null;
  for (const event of events) {
    const ms = parseIsoUtc(event.occurredAt);
    if (ms !== null && (oldest === null || ms < oldest)) oldest = ms;
  }
  return oldest;
}

export type SampleUsageRows = {
  usageEvents: UsageEvent[];
  userHourly: UserHourly[];
  teamHourly: TeamHourly[];
};

/**
 * Shifts UsageEvent occurredAt/receivedAt and UserHourly/TeamHourly hourStart by the same
 * whole-hour delta. Returns new arrays; the input is not mutated.
 */
export function shiftSampleUsage(rows: SampleUsageRows, deltaMs: number): SampleUsageRows {
  if (!Number.isInteger(deltaMs) || deltaMs % HOUR_MS !== 0) {
    throw new Error("The shift must be a whole number of hours so hourStart stays on the hour.");
  }
  return {
    usageEvents: rows.usageEvents.map((event) => ({
      ...event,
      occurredAt: shiftIso(event.occurredAt, deltaMs),
      receivedAt: shiftIso(event.receivedAt, deltaMs)
    })),
    userHourly: rows.userHourly.map((row) => ({ ...row, hourStart: shiftIso(row.hourStart, deltaMs) })),
    teamHourly: rows.teamHourly.map((row) => ({ ...row, hourStart: shiftIso(row.hourStart, deltaMs) }))
  };
}

/** Shift so the newest sample event is within the last hour before `nowMs`. */
export function shiftSampleToNow(seed: Pick<SampleUsageSeedFile, keyof SampleUsageRows>, nowMs: number) {
  const newest = newestEventTime(seed.usageEvents);
  if (newest === null) return { deltaMs: 0, rows: shiftSampleUsage(seed, 0) };
  const deltaMs = hourAlignedShift(newest, nowMs);
  return { deltaMs, rows: shiftSampleUsage(seed, deltaMs) };
}
