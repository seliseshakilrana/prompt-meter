// Data Gateway access for the admin pages. Every call goes through the app's single
// `blocksClient` (blocks-data-gateway-crud skill): `data.collection(schemaName)` with the
// schema name (not the collection name).
//
// TODO(live): schemas are not pushed yet. Once they are, confirm against
// `blocks data schema get <id>`:
//   - query names are get<SchemaName>s (UsageEvents, UserHourlys, TeamHourlys, ModelPrices);
//   - the DynamicQueryInput `filter` accepts a Mongo-style equality JSON such as {"eventId":"msg_1"};
//   - the max pageSize the gateway accepts (PAGE_SIZE below);
//   - the list/mutation response envelope (normalizeList / assertMutationOk read several shapes).
// Results are always re-checked client-side, so a filter the gateway ignores can make a
// lookup slower but never makes it wrong (except when FETCH_ALL_MAX_PAGES truncates).

import { BlocksApiError } from "@seliseblocks/client";
import { blocksClient } from "../../lib/blocks/client";
import { modelPriceKey, teamHourlyKey, userHourlyKey } from "./keys";
import type { SeedCollection, SeedPlanItem } from "./seedMapping";
import { MODEL_PRICE_RATE_FIELDS } from "./types";
import type { ModelPrice, TeamHourly, UsageEvent, UserHourly } from "./types";

const PAGE_SIZE = 200;
const FETCH_ALL_MAX_PAGES = 50;

const FIELDS: Record<SeedCollection, string[]> = {
  ModelPrice: ["provider", "model", "modelAliases", "effectiveFrom", ...MODEL_PRICE_RATE_FIELDS],
  UsageEvent: ["eventId"],
  UserHourly: ["userId", "teamId", "hourStart", "tool", "model", "source"],
  TeamHourly: ["teamId", "hourStart", "tool", "model", "source"]
};

type ListResult<T> = { items: T[]; totalCount: number | null; hasNextPage: boolean | null };

export function normalizeList<T>(response: unknown, schemaName: string): ListResult<T> {
  throwGraphqlErrors(response);
  const record = response as {
    data?: Record<string, { items?: T[]; totalCount?: number; hasNextPage?: boolean } | undefined> & { items?: T[]; totalCount?: number };
    items?: T[];
    totalCount?: number;
  };
  const gateway = record.data?.[`get${schemaName}s`] as { items?: T[]; totalCount?: number; hasNextPage?: boolean } | undefined;
  const items = gateway?.items ?? record.data?.items ?? record.items ?? [];
  return {
    items: Array.isArray(items) ? items : [],
    totalCount: gateway?.totalCount ?? record.data?.totalCount ?? record.totalCount ?? null,
    hasNextPage: typeof gateway?.hasNextPage === "boolean" ? gateway.hasNextPage : null
  };
}

function throwGraphqlErrors(response: unknown) {
  const errors = (response as { errors?: unknown } | null)?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const message = errors
      .map((error) => (typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : JSON.stringify(error)))
      .join("; ");
    throw new Error(message || "GraphQL error");
  }
}

/** Throws unless the insert mutation reports success. Returns the new ItemId when present. */
export function assertMutationOk(response: unknown, mutationName: string): string | undefined {
  throwGraphqlErrors(response);
  const result = (response as { data?: Record<string, unknown> } | null)?.data?.[mutationName] as
    | { acknowledged?: boolean; itemId?: string; message?: string | null }
    | undefined;
  if (!result) throw new Error(`No ${mutationName} result in the response.`);
  if (result.acknowledged === false) throw new Error(result.message || `${mutationName} was not acknowledged.`);
  return result.itemId ?? undefined;
}

export function describeError(error: unknown): string {
  if (error instanceof BlocksApiError) {
    const body = error.body as { message?: string; errors?: unknown } | undefined;
    const detail = body?.message ?? (body ? JSON.stringify(body).slice(0, 300) : "");
    return `${error.status} ${error.statusText}${detail ? `: ${detail}` : ""}`;
  }
  return error instanceof Error ? error.message : String(error);
}

async function fetchAll<T>(schemaName: SeedCollection, fields: string[], filter?: Record<string, unknown>) {
  const collection = blocksClient.data.collection<T>(schemaName, { fields });
  const items: T[] = [];
  for (let pageNo = 1; pageNo <= FETCH_ALL_MAX_PAGES; pageNo++) {
    const page = normalizeList<T>(await collection.list({ pageNo, pageSize: PAGE_SIZE, ...(filter ? { filter } : {}) }), schemaName);
    items.push(...page.items);
    const done =
      page.items.length < PAGE_SIZE ||
      page.hasNextPage === false ||
      (page.totalCount !== null && items.length >= page.totalCount);
    if (done) return { items, truncated: false };
  }
  return { items, truncated: true };
}

// ---------------------------------------------------------------- ModelPrice

export async function listModelPrices(): Promise<{ items: ModelPrice[]; truncated: boolean }> {
  const result = await fetchAll<Record<string, unknown>>("ModelPrice", FIELDS.ModelPrice);
  const items = result.items.map(toModelPrice);
  items.sort((a, b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model) || b.effectiveFrom.localeCompare(a.effectiveFrom));
  return { items, truncated: result.truncated };
}

function toModelPrice(raw: Record<string, unknown>): ModelPrice {
  const row = {
    ItemId: typeof raw.ItemId === "string" ? raw.ItemId : undefined,
    provider: typeof raw.provider === "string" ? raw.provider : "",
    model: typeof raw.model === "string" ? raw.model : "",
    modelAliases: Array.isArray(raw.modelAliases) ? raw.modelAliases.filter((a): a is string => typeof a === "string") : [],
    effectiveFrom: typeof raw.effectiveFrom === "string" ? raw.effectiveFrom : ""
  } as ModelPrice;
  for (const field of MODEL_PRICE_RATE_FIELDS) {
    const value = raw[field];
    row[field] = typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  return row;
}

/** Creates a new dated row. History rows are never updated (PLAN.md: price changes don't rewrite history). */
export async function createModelPrice(payload: Record<string, unknown>): Promise<string | undefined> {
  const response = await blocksClient.data.collection("ModelPrice").create(payload);
  return assertMutationOk(response, "insertModelPrice");
}

// ---------------------------------------------------------------- Unpriced models

export type UnpricedModel = { provider: string; model: string; eventCount: number; lastSeen: string | null };

/**
 * Models on events stored as `unpriced`. Best effort: RLS limits UsageEvent reads to what the
 * viewer may see (own rows for members), and the scan stops after FETCH_ALL_MAX_PAGES pages.
 */
export async function listUnpricedModels(): Promise<{ items: UnpricedModel[]; truncated: boolean; scanned: number }> {
  const result = await fetchAll<Partial<UsageEvent>>("UsageEvent", ["provider", "model", "occurredAt", "pricingStatus"], { pricingStatus: "unpriced" });
  const byModel = new Map<string, UnpricedModel>();
  for (const event of result.items) {
    if (event.pricingStatus !== "unpriced") continue; // re-check in case the filter was ignored
    const provider = event.provider ?? "unknown";
    const model = event.model ?? "unknown";
    const key = JSON.stringify([provider, model]);
    const entry = byModel.get(key) ?? { provider, model, eventCount: 0, lastSeen: null };
    entry.eventCount += 1;
    if (event.occurredAt && (!entry.lastSeen || event.occurredAt > entry.lastSeen)) entry.lastSeen = event.occurredAt;
    byModel.set(key, entry);
  }
  const items = [...byModel.values()].sort((a, b) => b.eventCount - a.eventCount || a.model.localeCompare(b.model));
  return { items, truncated: result.truncated, scanned: result.items.length };
}

// ---------------------------------------------------------------- Seeding

export type ExistingKeys = { keys: Set<string>; truncated: boolean };

/** Loads the natural keys already stored for the rows a seed plan wants to insert. */
export async function findExistingKeys(collection: SeedCollection, items: SeedPlanItem[]): Promise<ExistingKeys> {
  const ready = items.filter((item) => item.collection === collection && item.status === "ready" && item.payload);
  const keys = new Set<string>();
  let truncated = false;
  if (ready.length === 0) return { keys, truncated };

  if (collection === "ModelPrice") {
    // Small table: read it all and compare provider+model+effectiveFrom client-side.
    const result = await fetchAll<ModelPrice>("ModelPrice", FIELDS.ModelPrice);
    result.items.forEach((row) => keys.add(modelPriceKey(row)));
    return { keys, truncated: result.truncated };
  }

  if (collection === "UsageEvent") {
    // One equality lookup per eventId (the field has a unique index).
    const events = blocksClient.data.collection<Pick<UsageEvent, "eventId">>("UsageEvent", { fields: FIELDS.UsageEvent });
    for (const item of ready) {
      const eventId = String(item.payload?.eventId);
      const page = normalizeList<Pick<UsageEvent, "eventId">>(await events.list({ pageNo: 1, pageSize: 5, filter: { eventId } }), "UsageEvent");
      if (page.items.some((row) => row.eventId === eventId)) keys.add(item.key);
    }
    return { keys, truncated };
  }

  if (collection === "UserHourly") {
    const pairs = new Map<string, { userId: string; teamId: string }>();
    for (const item of ready) {
      const userId = String(item.payload?.userId);
      const teamId = String(item.payload?.teamId);
      pairs.set(JSON.stringify([userId, teamId]), { userId, teamId });
    }
    for (const filter of pairs.values()) {
      const result = await fetchAll<UserHourly>("UserHourly", FIELDS.UserHourly, filter);
      result.items.forEach((row) => keys.add(userHourlyKey(row)));
      truncated ||= result.truncated;
    }
    return { keys, truncated };
  }

  const teams = new Set(ready.map((item) => String(item.payload?.teamId)));
  for (const teamId of teams) {
    const result = await fetchAll<TeamHourly>("TeamHourly", FIELDS.TeamHourly, { teamId });
    result.items.forEach((row) => keys.add(teamHourlyKey(row)));
    truncated ||= result.truncated;
  }
  return { keys, truncated };
}

/** Inserts one seed row. Float rollup fields are sent as numbers; JSON keeps integers as integers. */
export async function insertSeedRow(collection: SeedCollection, payload: Record<string, unknown>): Promise<string | undefined> {
  const response = await blocksClient.data.collection(collection).create(payload);
  return assertMutationOk(response, `insert${collection}`);
}

