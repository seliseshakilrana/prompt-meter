// Typed models matching infra/blocks/data/schemas/*.json (field names unchanged).
// Schema names are passed to the SDK; collections are the schema name + "s".
import type { UtcRange } from "../../../lib/time/zoned";

export type Source = "proxy" | "manual";
export type PricingStatus = "priced" | "unpriced";
export type Tool = "claude-code" | "codex" | "antigravity-cli" | "api" | "other" | (string & {});

export const SCHEMA = {
  TeamHourly: "TeamHourly",
  UsageEvent: "UsageEvent",
  UserHourly: "UserHourly"
} as const;

/** The 8 token fields shared by UsageEvent and the hourly rollups. */
export type TokenFields = {
  totalInputTokens: number;
  uncachedInputTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  outputTokens: number;
  thinkingTokens: number | null;
  serverToolRequests: number;
};

export const TOKEN_FIELDS = [
  "totalInputTokens",
  "uncachedInputTokens",
  "cacheReadTokens",
  "cacheWrite5mTokens",
  "cacheWrite1hTokens",
  "outputTokens",
  "thinkingTokens",
  "serverToolRequests"
] as const satisfies readonly (keyof TokenFields)[];

/** Schema `UsageEvent`. */
export type UsageEvent = TokenFields & {
  ItemId?: string;
  eventId: string;
  source: Source;
  userId: string;
  teamId: string;
  tool: Tool;
  provider: string;
  model: string;
  sessionId: string | null;
  promptId: string | null;
  callIndex: number | null;
  speed: string | null;
  costUsd: number | null;
  pricingStatus: PricingStatus;
  /** Owner-only column; null/absent when hidden or the key has previews off. */
  promptPreview?: string | null;
  projectTag: string | null;
  /** Tool account the proxy detected; verified when the user connected that account. */
  accountEmail?: string | null;
  accountVerified?: boolean | null;
  /** UTC ISO. */
  occurredAt: string;
  /** UTC ISO. */
  receivedAt: string;
};

/** Schema `UserHourly`. costUsd sums priced events only (unpriced add 0). */
export type UserHourly = TokenFields & {
  ItemId?: string;
  userId: string;
  teamId: string;
  /** UTC top of the hour, ISO. */
  hourStart: string;
  tool: Tool;
  model: string;
  source: Source;
  costUsd: number;
  eventCount: number;
  promptCount: number;
};

/** Schema `TeamHourly`. */
export type TeamHourly = Omit<UserHourly, "userId" | "promptCount">;

/** Dimension filters shared by every query. Undefined = all. */
export type UsageFilters = {
  teamId?: string;
  tool?: string;
  model?: string;
  source?: Source;
};

export type UserHourlyQuery = { userId: string; range: UtcRange; filters?: UsageFilters };
export type TeamHourlyQuery = { teamId: string; range: UtcRange; filters?: Omit<UsageFilters, "teamId"> };
export type UsageEventQuery = {
  userId: string;
  /** Filters on occurredAt. */
  range?: UtcRange;
  sessionId?: string;
  promptId?: string;
  pricingStatus?: PricingStatus;
  filters?: UsageFilters;
  /** Upper bound on rows returned, newest first. */
  limit?: number;
};

export type EventPage = { items: UsageEvent[]; truncated: boolean };

/** One implementation per backend; selected by VITE_PM_DATA_SOURCE. */
export interface UsageDataSource {
  readonly kind: "blocks" | "sample";
  listUserHourly(query: UserHourlyQuery): Promise<UserHourly[]>;
  listTeamHourly(query: TeamHourlyQuery): Promise<TeamHourly[]>;
  listEvents(query: UsageEventQuery): Promise<EventPage>;
}
