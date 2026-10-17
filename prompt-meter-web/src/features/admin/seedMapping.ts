// Pure seed planning: turns the seed files into validated insert payloads.
// Rules (infra/blocks/README.md "Seed data"):
//  - ModelPrice rows with `model: null` or `needsPrice: true` are placeholders: never loaded.
//  - Fields listed in a row's `needsPrice` are unknown: never loaded as if known (left unset).
//  - `needsPrice` and `notes` are seed metadata, not schema fields: stripped.
//  - Null values are left out of the payload, so they stay unset in Blocks.

import { modelPriceKey, teamHourlyKey, usageEventKey, userHourlyKey } from "./keys";
import { PROVIDERS } from "./priceValidation";
import { isTopOfHour, parseIsoUtc } from "./timeShift";
import { INTEGER_RATE_FIELDS, MODEL_PRICE_RATE_FIELDS, USAGE_TOKEN_FIELDS } from "./types";
import type { ModelPriceRateField, ModelPriceSeedFile, ModelPriceSeedRow, TeamHourly, UsageEvent, UserHourly } from "./types";
import type { SampleUsageRows } from "./timeShift";

export type SeedCollection = "ModelPrice" | "UsageEvent" | "UserHourly" | "TeamHourly";

/** Insert order: prices first, then events, then the rollups (sample-usage.json "Load in order"). */
export const SEED_COLLECTIONS: SeedCollection[] = ["ModelPrice", "UsageEvent", "UserHourly", "TeamHourly"];

export type SeedPlanItem = {
  collection: SeedCollection;
  /** Short human label for the preview table. */
  label: string;
  /** Natural key (see keys.ts); empty for invalid/placeholder rows. */
  key: string;
  /** Insert payload; null when the row is skipped or invalid. */
  payload: Record<string, unknown> | null;
  status: "ready" | "skipped" | "invalid";
  reason?: string;
  warnings: string[];
};

const RATE_FIELD_SET: ReadonlySet<string> = new Set(MODEL_PRICE_RATE_FIELDS);

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInt(value: unknown): value is number {
  return isNonNegativeNumber(value) && Number.isInteger(value);
}

function withoutNulls(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------- ModelPrice

export function isPlaceholderPriceRow(row: ModelPriceSeedRow): boolean {
  return row.needsPrice === true || !nonEmptyString(row.model) || !nonEmptyString(row.provider);
}

export function planModelPriceRow(row: ModelPriceSeedRow): SeedPlanItem {
  const label = `${row.provider ?? "?"} / ${row.model ?? "(placeholder)"}`;
  const base = { collection: "ModelPrice" as const, label, key: "", payload: null, warnings: [] as string[] };

  if (isPlaceholderPriceRow(row)) {
    return { ...base, status: "skipped", reason: "Placeholder row (model or prices not filled yet): not loaded." };
  }

  const warnings: string[] = [];
  const unknownFields = new Set<string>(Array.isArray(row.needsPrice) ? row.needsPrice : []);
  for (const field of unknownFields) {
    if (!RATE_FIELD_SET.has(field)) warnings.push(`needsPrice lists "${field}", which is not a rate field.`);
  }

  const errors: string[] = [];
  const provider = (row.provider as string).trim().toLowerCase();
  if (!(PROVIDERS as readonly string[]).includes(provider)) errors.push(`Unknown provider "${row.provider}".`);
  const model = (row.model as string).trim();
  const effectiveMs = parseIsoUtc(row.effectiveFrom);
  if (effectiveMs === null) errors.push(`effectiveFrom "${row.effectiveFrom}" is not an ISO timestamp with a zone.`);
  const aliases = Array.isArray(row.modelAliases) ? row.modelAliases : [];
  if (!aliases.every(nonEmptyString)) errors.push("modelAliases must be non-empty strings.");

  const rates: Partial<Record<ModelPriceRateField, number>> = {};
  for (const field of MODEL_PRICE_RATE_FIELDS) {
    const value = row[field];
    if (unknownFields.has(field)) {
      if (value !== null && value !== undefined) {
        warnings.push(`${field} is listed in needsPrice but has a value (${String(value)}); left unset.`);
      }
      continue;
    }
    if (value === null || value === undefined) continue;
    if (!isNonNegativeNumber(value)) {
      errors.push(`${field} must be a non-negative number.`);
      continue;
    }
    if (INTEGER_RATE_FIELDS.has(field) && !Number.isInteger(value)) {
      errors.push(`${field} must be a whole number.`);
      continue;
    }
    rates[field] = value;
  }

  if (errors.length > 0) return { ...base, status: "invalid", reason: errors.join(" "), warnings };

  const effectiveFrom = new Date(effectiveMs as number).toISOString();
  const payload = { provider, model, modelAliases: aliases.map((alias) => alias.trim()), effectiveFrom, ...rates };
  return {
    ...base,
    key: modelPriceKey({ provider, model, effectiveFrom }),
    payload,
    status: "ready",
    warnings: unknownFields.size > 0 ? [...warnings, `Not set (unknown): ${[...unknownFields].join(", ")}.`] : warnings
  };
}

// ---------------------------------------------------------------- Usage rows

const SOURCES = ["proxy", "manual"];
const PRICING_STATUSES = ["priced", "unpriced"];

export function validateUsageEvent(event: UsageEvent): string[] {
  const errors: string[] = [];
  if (!nonEmptyString(event.eventId)) errors.push("eventId is required.");
  if (!SOURCES.includes(event.source)) errors.push(`source must be ${SOURCES.join(" | ")}.`);
  for (const field of ["userId", "teamId", "tool", "provider", "model"] as const) {
    if (!nonEmptyString(event[field])) errors.push(`${field} is required.`);
  }
  if (parseIsoUtc(event.occurredAt) === null) errors.push("occurredAt is not an ISO timestamp.");
  if (parseIsoUtc(event.receivedAt) === null) errors.push("receivedAt is not an ISO timestamp.");
  for (const field of USAGE_TOKEN_FIELDS) {
    const value = event[field];
    if (value !== null && value !== undefined && !isNonNegativeInt(value)) errors.push(`${field} must be a non-negative integer or null.`);
  }
  if (event.callIndex !== null && event.callIndex !== undefined && !isNonNegativeInt(event.callIndex)) errors.push("callIndex must be a non-negative integer.");
  if (!PRICING_STATUSES.includes(event.pricingStatus)) errors.push(`pricingStatus must be ${PRICING_STATUSES.join(" | ")}.`);
  if (event.pricingStatus === "priced" && !isNonNegativeNumber(event.costUsd)) errors.push("A priced event needs a non-negative costUsd.");
  if (event.pricingStatus === "unpriced" && event.costUsd !== null && event.costUsd !== undefined) errors.push("An unpriced event must have costUsd null.");
  return errors;
}

function validateHourlyCommon(row: TeamHourly): string[] {
  const errors: string[] = [];
  for (const field of ["teamId", "tool", "model"] as const) {
    if (!nonEmptyString(row[field])) errors.push(`${field} is required.`);
  }
  if (!SOURCES.includes(row.source)) errors.push(`source must be ${SOURCES.join(" | ")}.`);
  const hour = parseIsoUtc(row.hourStart);
  if (hour === null) errors.push("hourStart is not an ISO timestamp.");
  else if (!isTopOfHour(hour)) errors.push("hourStart is not at the top of a UTC hour.");
  for (const field of USAGE_TOKEN_FIELDS) {
    if (!isNonNegativeNumber(row[field])) errors.push(`${field} must be a non-negative number.`);
  }
  if (!isNonNegativeNumber(row.costUsd)) errors.push("costUsd must be a non-negative number.");
  if (!isNonNegativeInt(row.eventCount)) errors.push("eventCount must be a non-negative integer.");
  return errors;
}

export function validateTeamHourly(row: TeamHourly): string[] {
  return validateHourlyCommon(row);
}

export function validateUserHourly(row: UserHourly): string[] {
  const errors = validateHourlyCommon(row);
  if (!nonEmptyString(row.userId)) errors.push("userId is required.");
  if (!isNonNegativeInt(row.promptCount)) errors.push("promptCount must be a non-negative integer.");
  return errors;
}

/** Canonical ISO form for DateTime fields so stored values are uniform. */
function isoOrSame(value: string): string {
  const ms = parseIsoUtc(value);
  return ms === null ? value : new Date(ms).toISOString();
}

export function planUsageEvent(event: UsageEvent): SeedPlanItem {
  const label = `${event.eventId} (${event.model}, ${event.pricingStatus})`;
  const errors = validateUsageEvent(event);
  if (errors.length > 0) return { collection: "UsageEvent", label, key: "", payload: null, status: "invalid", reason: errors.join(" "), warnings: [] };
  const payload = withoutNulls({ ...event, occurredAt: isoOrSame(event.occurredAt), receivedAt: isoOrSame(event.receivedAt) });
  return { collection: "UsageEvent", label, key: usageEventKey(event), payload, status: "ready", warnings: [] };
}

export function planUserHourly(row: UserHourly): SeedPlanItem {
  const label = `${row.userId} ${row.hourStart} ${row.tool}/${row.model}/${row.source}`;
  const errors = validateUserHourly(row);
  if (errors.length > 0) return { collection: "UserHourly", label, key: "", payload: null, status: "invalid", reason: errors.join(" "), warnings: [] };
  return { collection: "UserHourly", label, key: userHourlyKey(row), payload: withoutNulls({ ...row, hourStart: isoOrSame(row.hourStart) }), status: "ready", warnings: [] };
}

export function planTeamHourly(row: TeamHourly): SeedPlanItem {
  const label = `${row.teamId} ${row.hourStart} ${row.tool}/${row.model}/${row.source}`;
  const errors = validateTeamHourly(row);
  if (errors.length > 0) return { collection: "TeamHourly", label, key: "", payload: null, status: "invalid", reason: errors.join(" "), warnings: [] };
  return { collection: "TeamHourly", label, key: teamHourlyKey(row), payload: withoutNulls({ ...row, hourStart: isoOrSame(row.hourStart) }), status: "ready", warnings: [] };
}

/** Marks the second and later rows with the same natural key as skipped. */
export function markDuplicateKeys(items: SeedPlanItem[]): SeedPlanItem[] {
  const seen = new Set<string>();
  return items.map((item) => {
    if (item.status !== "ready") return item;
    const scoped = `${item.collection}|${item.key}`;
    if (seen.has(scoped)) return { ...item, status: "skipped", payload: null, reason: "Duplicate of an earlier row in the seed file." };
    seen.add(scoped);
    return item;
  });
}

// ---------------------------------------------------------------- Id remapping

export type IdRemap = { users: Record<string, string>; teams: Record<string, string> };

/** Replaces sample userId/teamId values (e.g. so the signed-in admin can see sample rows). */
export function remapSampleIds(rows: SampleUsageRows, remap: IdRemap): SampleUsageRows {
  const user = (id: string) => (nonEmptyString(remap.users[id]) ? (remap.users[id] as string).trim() : id);
  const team = (id: string) => (nonEmptyString(remap.teams[id]) ? (remap.teams[id] as string).trim() : id);
  return {
    usageEvents: rows.usageEvents.map((event) => ({ ...event, userId: user(event.userId), teamId: team(event.teamId) })),
    userHourly: rows.userHourly.map((row) => ({ ...row, userId: user(row.userId), teamId: team(row.teamId) })),
    teamHourly: rows.teamHourly.map((row) => ({ ...row, teamId: team(row.teamId) }))
  };
}

// ---------------------------------------------------------------- Whole plan

export function planSeed(prices: ModelPriceSeedFile, usage: SampleUsageRows): SeedPlanItem[] {
  return markDuplicateKeys([
    ...prices.rows.map(planModelPriceRow),
    ...usage.usageEvents.map(planUsageEvent),
    ...usage.userHourly.map(planUserHourly),
    ...usage.teamHourly.map(planTeamHourly)
  ]);
}

/**
 * Sample costs were computed with prices effective from the seed's effectiveFrom.
 * Returns a warning when the (shifted) oldest event falls before the earliest loaded price row.
 */
export function priceCoverageWarning(prices: ModelPriceSeedFile, usage: Pick<SampleUsageRows, "usageEvents">): string | null {
  let earliestPrice: number | null = null;
  for (const row of prices.rows) {
    if (isPlaceholderPriceRow(row)) continue;
    const ms = parseIsoUtc(row.effectiveFrom);
    if (ms !== null && (earliestPrice === null || ms < earliestPrice)) earliestPrice = ms;
  }
  if (earliestPrice === null) return null;
  for (const event of usage.usageEvents) {
    const ms = parseIsoUtc(event.occurredAt);
    if (ms !== null && ms < earliestPrice) {
      return `Some sample events occur before ${new Date(earliestPrice).toISOString()}, the earliest price row. Their stored costs would not match any price row (a later re-pricing job would see no price).`;
    }
  }
  return null;
}

export function countByStatus(items: SeedPlanItem[]) {
  const counts: Record<SeedCollection, { ready: number; skipped: number; invalid: number }> = {
    ModelPrice: { ready: 0, skipped: 0, invalid: 0 },
    UsageEvent: { ready: 0, skipped: 0, invalid: 0 },
    UserHourly: { ready: 0, skipped: 0, invalid: 0 },
    TeamHourly: { ready: 0, skipped: 0, invalid: 0 }
  };
  for (const item of items) counts[item.collection][item.status] += 1;
  return counts;
}
