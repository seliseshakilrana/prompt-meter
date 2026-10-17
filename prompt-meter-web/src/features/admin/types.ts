// Record shapes for the admin pages, mirroring infra/blocks/data/schemas/*.json.
// Field names are the schema field names unchanged (PLAN.md "Data model").

export const MODEL_PRICE_RATE_FIELDS = [
  "inputPer1M",
  "outputPer1M",
  "cacheReadPer1M",
  "cacheWrite5mPer1M",
  "cacheWrite1hPer1M",
  "longContextThreshold",
  "longContextInputPer1M",
  "longContextOutputPer1M",
  "longContextCacheReadPer1M",
  "longContextCacheWrite5mPer1M",
  "longContextCacheWrite1hPer1M",
  "fastMultiplier",
  "webSearchPerRequest"
] as const;

export type ModelPriceRateField = (typeof MODEL_PRICE_RATE_FIELDS)[number];

export const MODEL_PRICE_RATE_LABELS: Record<ModelPriceRateField, string> = {
  inputPer1M: "Input / 1M",
  outputPer1M: "Output / 1M",
  cacheReadPer1M: "Cache read / 1M",
  cacheWrite5mPer1M: "Cache write 5m / 1M",
  cacheWrite1hPer1M: "Cache write 1h / 1M",
  longContextThreshold: "Long-context threshold (tokens)",
  longContextInputPer1M: "LC input / 1M",
  longContextOutputPer1M: "LC output / 1M",
  longContextCacheReadPer1M: "LC cache read / 1M",
  longContextCacheWrite5mPer1M: "LC cache write 5m / 1M",
  longContextCacheWrite1hPer1M: "LC cache write 1h / 1M",
  fastMultiplier: "Fast multiplier",
  webSearchPerRequest: "Web search / request"
};

/** `longContextThreshold` is an Int in the schema; every other rate is a Float. */
export const INTEGER_RATE_FIELDS: ReadonlySet<ModelPriceRateField> = new Set(["longContextThreshold"]);

export type ModelPriceRates = Record<ModelPriceRateField, number | null>;

export type ModelPrice = ModelPriceRates & {
  ItemId?: string;
  provider: string;
  model: string;
  modelAliases: string[];
  effectiveFrom: string;
};

export const USAGE_TOKEN_FIELDS = [
  "totalInputTokens",
  "uncachedInputTokens",
  "cacheReadTokens",
  "cacheWrite5mTokens",
  "cacheWrite1hTokens",
  "outputTokens",
  "thinkingTokens",
  "serverToolRequests"
] as const;

export type UsageTokenField = (typeof USAGE_TOKEN_FIELDS)[number];

export type UsageEvent = Record<UsageTokenField, number | null> & {
  eventId: string;
  source: string;
  userId: string;
  teamId: string;
  tool: string;
  provider: string;
  model: string;
  sessionId: string | null;
  promptId: string | null;
  callIndex: number | null;
  speed: string | null;
  costUsd: number | null;
  pricingStatus: string;
  promptPreview: string | null;
  projectTag: string | null;
  occurredAt: string;
  receivedAt: string;
};

export type TeamHourly = Record<UsageTokenField, number> & {
  teamId: string;
  hourStart: string;
  tool: string;
  model: string;
  source: string;
  costUsd: number;
  eventCount: number;
};

export type UserHourly = TeamHourly & {
  userId: string;
  promptCount: number;
};

// ---- Seed file shapes (infra/blocks/seed/*.json) ----

export type ModelPriceSeedRow = {
  provider: string | null;
  model: string | null;
  modelAliases: string[];
  effectiveFrom: string;
  /** Seed metadata: `true` = whole row is a placeholder; a list = these fields are unknown. */
  needsPrice?: boolean | string[];
  notes?: string;
} & Record<ModelPriceRateField, number | null>;

export type ModelPriceSeedFile = {
  about: string;
  effectiveFrom: string;
  rows: ModelPriceSeedRow[];
};

export type SampleUsageSeedFile = {
  about: string;
  users: Array<{ userId: string; timezone: string; utcOffset: string }>;
  teams: Array<{ teamId: string; members: string[] }>;
  usageEvents: UsageEvent[];
  userHourly: UserHourly[];
  teamHourly: TeamHourly[];
};
