import { blocksClient } from "../../../lib/blocks/client";
import { cleanFilters } from "./filters";
import { SCHEMA, TOKEN_FIELDS } from "./types";
import type { EventPage, TeamHourly, UsageDataSource, UsageEvent, UsageFilters, UserHourly } from "./types";
import type { UtcRange } from "../../../lib/time/zoned";

// Real reads through the single blocksClient, via data.collection(schemaName)
// (the SDK sends `query get<Schema>s($input: DynamicQueryInput)`). Nothing
// here has run against live schemas yet: they are not pushed. Every
// assumption about the gateway is marked TODO(live).

// TODO(live): confirm the largest pageSize the gateway accepts.
const PAGE_SIZE = 500;
// Safety stop for a runaway range (PAGE_SIZE * MAX_PAGES rows).
const MAX_PAGES = 40;

const HOURLY_FIELDS = ["userId", "teamId", "hourStart", "tool", "model", "source", ...TOKEN_FIELDS, "costUsd", "eventCount", "promptCount"];
const TEAM_HOURLY_FIELDS = HOURLY_FIELDS.filter((field) => field !== "userId" && field !== "promptCount");
const EVENT_FIELDS = [
  "eventId", "source", "userId", "teamId", "tool", "provider", "model", "sessionId", "promptId", "callIndex",
  ...TOKEN_FIELDS, "speed", "costUsd", "pricingStatus", "promptPreview", "projectTag", "accountEmail", "accountVerified", "occurredAt", "receivedAt"
];

const userHourly = blocksClient.data.collection<UserHourly>(SCHEMA.UserHourly, { fields: HOURLY_FIELDS });
const teamHourly = blocksClient.data.collection<TeamHourly>(SCHEMA.TeamHourly, { fields: TEAM_HOURLY_FIELDS });
const usageEvents = blocksClient.data.collection<UsageEvent>(SCHEMA.UsageEvent, { fields: EVENT_FIELDS });
// TODO(live): if the promptPreview column rule makes the whole query fail for
// a non-owner instead of nulling the field, drop it from EVENT_FIELDS and read
// previews from the UsagePreview fallback schema (infra/blocks/README.md).

type Collection = { list(options: Record<string, unknown>): Promise<unknown> };

type GatewayPage<T> = { items: T[]; hasNextPage: boolean; totalCount?: number };

function normalizePage<T>(response: unknown): GatewayPage<T> {
  // TODO(live): the SDK's list() returns the raw GraphQL envelope; confirm
  // the exact nesting ({ data: { getUserHourlys: {...} } }) and error shape.
  const record = response as {
    data?: Record<string, { items?: T[]; hasNextPage?: boolean; totalCount?: number } | undefined> & { items?: T[] };
    errors?: { message?: string }[];
  };
  if (record?.errors?.length) throw new Error(record.errors.map((error) => error.message ?? "GraphQL error").join("; "));
  const gateway = Object.values(record?.data ?? {}).find((value) => value && typeof value === "object" && "items" in value) as
    | { items?: T[]; hasNextPage?: boolean; totalCount?: number }
    | undefined;
  const items = gateway?.items ?? record?.data?.items ?? [];
  return { hasNextPage: Boolean(gateway?.hasNextPage), items, totalCount: gateway?.totalCount };
}

/**
 * Mongo-style filter JSON for DynamicQueryInput.filter.
 * TODO(live): confirm the filter dialect -- operator names ($gte/$lt) and
 * whether DateTime values must be ISO strings, {$date: ...}, or ISODate.
 */
function rangeFilter(field: string, range: UtcRange | undefined): Record<string, unknown> {
  return range ? { [field]: { $gte: range.start, $lt: range.end } } : {};
}

function dimensionFilter(filters: UsageFilters | undefined): Record<string, unknown> {
  return { ...cleanFilters(filters) };
}

async function listAll<T>(collection: Collection, filter: Record<string, unknown>, sort: Record<string, 1 | -1>, limit = Infinity): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo += 1) {
    const page = normalizePage<T>(await collection.list({ filter, pageNo, pageSize: PAGE_SIZE, sort }));
    items.push(...page.items);
    if (items.length >= limit) return { items: items.slice(0, limit), truncated: items.length > limit || page.hasNextPage };
    if (!page.hasNextPage || page.items.length === 0) return { items, truncated: false };
  }
  return { items, truncated: true };
}

const nullableNumber = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const number = (value: unknown) => Number(value ?? 0) || 0;

function normalizeTokens<T extends Record<string, unknown>>(row: T) {
  return {
    cacheReadTokens: number(row.cacheReadTokens),
    cacheWrite1hTokens: number(row.cacheWrite1hTokens),
    cacheWrite5mTokens: number(row.cacheWrite5mTokens),
    outputTokens: number(row.outputTokens),
    serverToolRequests: number(row.serverToolRequests),
    thinkingTokens: nullableNumber(row.thinkingTokens),
    totalInputTokens: number(row.totalInputTokens),
    uncachedInputTokens: number(row.uncachedInputTokens)
  };
}

const toIso = (value: unknown) => new Date(String(value)).toISOString();

export function createBlocksSource(): UsageDataSource {
  return {
    kind: "blocks",

    async listUserHourly({ filters, range, userId }) {
      // Row rules also restrict this server-side; the userId filter keeps an
      // admin's own page to their own rows.
      const { items } = await listAll<UserHourly>(userHourly, { userId, ...dimensionFilter(filters), ...rangeFilter("hourStart", range) }, { hourStart: 1 });
      return items.map((row) => ({ ...row, ...normalizeTokens(row), costUsd: number(row.costUsd), hourStart: toIso(row.hourStart) }));
    },

    async listTeamHourly({ filters, range, teamId }) {
      const { items } = await listAll<TeamHourly>(teamHourly, { teamId, ...dimensionFilter(filters), ...rangeFilter("hourStart", range) }, { hourStart: 1 });
      return items.map((row) => ({ ...row, ...normalizeTokens(row), costUsd: number(row.costUsd), hourStart: toIso(row.hourStart) }));
    },

    async listEvents(query): Promise<EventPage> {
      const filter: Record<string, unknown> = {
        userId: query.userId,
        ...dimensionFilter(query.filters),
        ...rangeFilter("occurredAt", query.range)
      };
      if (query.sessionId !== undefined) filter.sessionId = query.sessionId;
      if (query.promptId !== undefined) filter.promptId = query.promptId;
      if (query.pricingStatus !== undefined) filter.pricingStatus = query.pricingStatus;
      const page = await listAll<UsageEvent>(usageEvents, filter, { occurredAt: -1 }, query.limit);
      return {
        items: page.items.map((event) => ({
          ...event,
          ...normalizeTokens(event),
          costUsd: nullableNumber(event.costUsd),
          occurredAt: toIso(event.occurredAt),
          receivedAt: toIso(event.receivedAt)
        })),
        truncated: page.truncated
      };
    }
  };
}
