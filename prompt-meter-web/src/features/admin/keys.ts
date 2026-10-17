// Natural keys used for idempotent seeding and duplicate checks.
// DateTimes are compared as epoch milliseconds, so "2026-10-17T00:00:00Z" and
// "2026-10-17T00:00:00.000Z" (the gateway may echo either) are the same key.

import { parseIsoUtc } from "./timeShift";
import type { ModelPrice, TeamHourly, UsageEvent, UserHourly } from "./types";

function timeKey(value: unknown): string {
  const ms = parseIsoUtc(value);
  return ms === null ? `invalid:${String(value)}` : String(ms);
}

function join(parts: unknown[]): string {
  return JSON.stringify(parts.map((part) => (part === null || part === undefined ? null : String(part))));
}

export function modelPriceKey(row: Pick<ModelPrice, "provider" | "model" | "effectiveFrom">): string {
  return join([row.provider, row.model, timeKey(row.effectiveFrom)]);
}

export function usageEventKey(row: Pick<UsageEvent, "eventId">): string {
  return join([row.eventId]);
}

/** Matches the UserHourly unique index: userId, teamId, hourStart, tool, model, source. */
export function userHourlyKey(row: Pick<UserHourly, "userId" | "teamId" | "hourStart" | "tool" | "model" | "source">): string {
  return join([row.userId, row.teamId, timeKey(row.hourStart), row.tool, row.model, row.source]);
}

/** Matches the TeamHourly unique index: teamId, hourStart, tool, model, source. */
export function teamHourlyKey(row: Pick<TeamHourly, "teamId" | "hourStart" | "tool" | "model" | "source">): string {
  return join([row.teamId, timeKey(row.hourStart), row.tool, row.model, row.source]);
}
