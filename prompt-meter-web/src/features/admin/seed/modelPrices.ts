// Copied verbatim from infra/blocks/seed/model-prices.json so the app build never reaches outside
// prompt-meter-web. If the infra seed changes, copy it again (JSON body unchanged).
import type { ModelPriceSeedFile } from "../types";

export const modelPricesSeed: ModelPriceSeedFile = {
  "about": "Seed rows for the ModelPrice schema. USD per 1M tokens; webSearchPerRequest is USD per request. Only first-party rates given to this project are filled; every other value is null and listed in needsPrice. `needsPrice` and `notes` are seed metadata, not schema fields: strip them when loading. Rows with model null are placeholders and must not be loaded.",
  "effectiveFrom": "2026-10-17T00:00:00Z",
  "rows": [
    {
      "provider": "anthropic",
      "model": "claude-opus-5-5",
      "modelAliases": [
        "claude-opus-5-5-*"
      ],
      "effectiveFrom": "2026-10-17T00:00:00Z",
      "inputPer1M": 4,
      "outputPer1M": 20,
      "cacheReadPer1M": 0.2,
      "cacheWrite5mPer1M": 5.0,
      "cacheWrite1hPer1M": 8,
      "longContextThreshold": null,
      "longContextInputPer1M": null,
      "longContextOutputPer1M": null,
      "longContextCacheReadPer1M": null,
      "longContextCacheWrite5mPer1M": null,
      "longContextCacheWrite1hPer1M": null,
      "fastMultiplier": 2,
      "webSearchPerRequest": null,
      "needsPrice": [
        "longContextThreshold",
        "webSearchPerRequest"
      ],
      "notes": "Given: $4/$20, cache read $0.20, fast multiplier 2. Cache writes = 1.25x / 2x input. No long-context tier was given: longContextThreshold left null (confirm before relying on it)."
    },
    {
      "provider": "anthropic",
      "model": "claude-sonnet-5-5",
      "modelAliases": [
        "claude-sonnet-5-5-*"
      ],
      "effectiveFrom": "2026-10-17T00:00:00Z",
      "inputPer1M": 2,
      "outputPer1M": 10,
      "cacheReadPer1M": 0.2,
      "cacheWrite5mPer1M": 2.5,
      "cacheWrite1hPer1M": 4,
      "longContextThreshold": null,
      "longContextInputPer1M": null,
      "longContextOutputPer1M": null,
      "longContextCacheReadPer1M": null,
      "longContextCacheWrite5mPer1M": null,
      "longContextCacheWrite1hPer1M": null,
      "fastMultiplier": null,
      "webSearchPerRequest": null,
      "needsPrice": [
        "fastMultiplier",
        "longContextThreshold",
        "webSearchPerRequest"
      ],
      "notes": "Given: $2/$10, cache read $0.20. Cache writes = 1.25x / 2x input. No long-context tier or fast multiplier was given: left null (fast-speed events are stored unpriced)."
    },
    {
      "provider": "anthropic",
      "model": "claude-haiku-5-5",
      "modelAliases": [
        "claude-haiku-5-5-*"
      ],
      "effectiveFrom": "2026-10-17T00:00:00Z",
      "inputPer1M": 0.1,
      "outputPer1M": 0.5,
      "cacheReadPer1M": null,
      "cacheWrite5mPer1M": 0.125,
      "cacheWrite1hPer1M": 0.2,
      "longContextThreshold": 100000,
      "longContextInputPer1M": 0.5,
      "longContextOutputPer1M": 2.5,
      "longContextCacheReadPer1M": null,
      "longContextCacheWrite5mPer1M": 0.625,
      "longContextCacheWrite1hPer1M": 1.0,
      "fastMultiplier": null,
      "webSearchPerRequest": null,
      "needsPrice": [
        "cacheReadPer1M",
        "fastMultiplier",
        "longContextCacheReadPer1M",
        "webSearchPerRequest"
      ],
      "notes": "Given: $0.10/$0.50, long context above 100K total input at $0.50/$2.50. Cache writes = 1.25x / 2x of the matching input rate (long-context ones derived from the long-context input rate). Cache read rates were not given: null, so events with cache reads are stored unpriced."
    },
    {
      "provider": "anthropic",
      "model": "claude-fable-5-1",
      "modelAliases": [
        "claude-fable-5-1-*"
      ],
      "effectiveFrom": "2026-10-17T00:00:00Z",
      "inputPer1M": 10,
      "outputPer1M": 50,
      "cacheReadPer1M": 0.25,
      "cacheWrite5mPer1M": 12.5,
      "cacheWrite1hPer1M": 20,
      "longContextThreshold": null,
      "longContextInputPer1M": null,
      "longContextOutputPer1M": null,
      "longContextCacheReadPer1M": null,
      "longContextCacheWrite5mPer1M": null,
      "longContextCacheWrite1hPer1M": null,
      "fastMultiplier": null,
      "webSearchPerRequest": null,
      "needsPrice": [
        "fastMultiplier",
        "longContextThreshold",
        "webSearchPerRequest"
      ],
      "notes": "Given: $10/$50, cache read $0.25. Cache writes = 1.25x / 2x input. No long-context tier or fast multiplier was given."
    },
    {
      "provider": "openai",
      "model": null,
      "modelAliases": [],
      "effectiveFrom": "2026-10-17T00:00:00Z",
      "inputPer1M": null,
      "outputPer1M": null,
      "cacheReadPer1M": null,
      "cacheWrite5mPer1M": null,
      "cacheWrite1hPer1M": null,
      "longContextThreshold": null,
      "longContextInputPer1M": null,
      "longContextOutputPer1M": null,
      "longContextCacheReadPer1M": null,
      "longContextCacheWrite5mPer1M": null,
      "longContextCacheWrite1hPer1M": null,
      "fastMultiplier": null,
      "webSearchPerRequest": null,
      "needsPrice": true,
      "notes": "Placeholder: model ids and every rate for the Codex/OpenAI models must be filled from the provider's published prices (Phase 4). Do not load this row until filled; until then OpenAI events are stored unpriced."
    },
    {
      "provider": "google",
      "model": null,
      "modelAliases": [],
      "effectiveFrom": "2026-10-17T00:00:00Z",
      "inputPer1M": null,
      "outputPer1M": null,
      "cacheReadPer1M": null,
      "cacheWrite5mPer1M": null,
      "cacheWrite1hPer1M": null,
      "longContextThreshold": null,
      "longContextInputPer1M": null,
      "longContextOutputPer1M": null,
      "longContextCacheReadPer1M": null,
      "longContextCacheWrite5mPer1M": null,
      "longContextCacheWrite1hPer1M": null,
      "fastMultiplier": null,
      "webSearchPerRequest": null,
      "needsPrice": true,
      "notes": "Placeholder: model ids and every rate for the Gemini models used by Antigravity CLI must be filled from the provider's published prices (Phase 4). Do not load this row until filled; until then Gemini events are stored unpriced."
    }
  ]
};
