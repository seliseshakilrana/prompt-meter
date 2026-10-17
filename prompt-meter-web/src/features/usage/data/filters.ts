import type { UtcRange } from "../../../lib/time/zoned";
import type { UsageFilters } from "./types";

type Filterable = { teamId: string; tool: string; model: string; source: string };

export function matchesFilters(row: Filterable, filters: UsageFilters | undefined): boolean {
  if (!filters) return true;
  if (filters.teamId && row.teamId !== filters.teamId) return false;
  if (filters.tool && row.tool !== filters.tool) return false;
  if (filters.model && row.model !== filters.model) return false;
  if (filters.source && row.source !== filters.source) return false;
  return true;
}

export function inUtcRange(iso: string, range: UtcRange | undefined): boolean {
  if (!range) return true;
  const ms = Date.parse(iso);
  return ms >= Date.parse(range.start) && ms < Date.parse(range.end);
}

/** Drops undefined/empty values so query keys and gateway filters stay stable. */
export function cleanFilters(filters: UsageFilters | undefined): UsageFilters {
  const out: UsageFilters = {};
  if (filters?.teamId) out.teamId = filters.teamId;
  if (filters?.tool) out.tool = filters.tool;
  if (filters?.model) out.model = filters.model;
  if (filters?.source) out.source = filters.source;
  return out;
}
