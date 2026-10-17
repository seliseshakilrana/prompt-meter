// Price lookup and cost calculation (PLAN.md "Data model" -> ModelPrice, and the pricing notes).
//
// Rules implemented:
//  1. Price row lookup by provider + model: exact `model` match beats an exact alias in
//     `modelAliases`, which beats a prefix alias (an alias ending in "*"; longest prefix wins).
//     Only rows with effectiveFrom <= occurredAt count; the newest such row wins at the
//     best match level.
//  2. Token cost (per 1M tokens):
//       uncachedInputTokens * input + cacheReadTokens * cacheRead
//     + cacheWrite5mTokens * cacheWrite5m + cacheWrite1hTokens * cacheWrite1h
//     + outputTokens * output
//     thinkingTokens are NOT added: providers already count thinking inside outputTokens.
//  3. Long context: when longContextThreshold is set and totalInputTokens (cached tokens
//     included) is ABOVE it, every token rate switches to its longContext* column.
//  4. Fast mode: speed === "fast" multiplies the token cost by fastMultiplier.
//  5. Web search: serverToolRequests * webSearchPerRequest, added after the fast multiplier.
//  6. Unpriced: no matching row, or a needed rate is null (a token kind with count > 0 whose
//     rate is missing, fast speed without a multiplier, server tool requests without a
//     per-request price) -> costUsd null, pricingStatus "unpriced". Never guessed.
//
// Shared helper: function declarations only. Inlined into code nodes by build.js.

function toTime(value) {
  if (value === null || value === undefined || value === "") return NaN;
  const t = new Date(value).getTime();
  return typeof t === "number" ? t : NaN;
}

function matchPriceRow(row, model) {
  if (!row || typeof row.model !== "string" || !row.model) return null;
  if (row.model === model) return { rank: 3, prefixLength: model.length };
  const aliases = Array.isArray(row.modelAliases) ? row.modelAliases : [];
  let best = null;
  for (let i = 0; i < aliases.length; i++) {
    const alias = aliases[i];
    if (typeof alias !== "string" || !alias) continue;
    if (alias.charAt(alias.length - 1) === "*") {
      const prefix = alias.slice(0, -1);
      if (prefix && model.indexOf(prefix) === 0) {
        if (!best || (best.rank === 1 && prefix.length > best.prefixLength)) {
          best = { rank: 1, prefixLength: prefix.length };
        }
      }
    } else if (alias === model) {
      return { rank: 2, prefixLength: model.length };
    }
  }
  return best;
}

function findPrice(prices, event) {
  const model = event && typeof event.model === "string" ? event.model : "";
  if (!model) return null;
  const at = toTime(event.occurredAt);
  let best = null;
  let bestKey = null;
  const rows = Array.isArray(prices) ? prices : [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    if (row.provider && event.provider && row.provider !== event.provider) continue;
    const from = toTime(row.effectiveFrom);
    if (isNaN(from) || isNaN(at) || from > at) continue;
    const match = matchPriceRow(row, model);
    if (!match) continue;
    const key = [match.rank, match.prefixLength, from];
    if (
      !bestKey ||
      key[0] > bestKey[0] ||
      (key[0] === bestKey[0] && key[1] > bestKey[1]) ||
      (key[0] === bestKey[0] && key[1] === bestKey[1] && key[2] > bestKey[2])
    ) {
      best = row;
      bestKey = key;
    }
  }
  return best;
}

function isRate(value) {
  return typeof value === "number" && isFinite(value) && value >= 0;
}

function countOf(value) {
  return typeof value === "number" && isFinite(value) && value > 0 ? value : 0;
}

function roundUsd(value) {
  return Math.round(value * 1e8) / 1e8;
}

// Returns { costUsd, pricingStatus, longContext, missing: [rate names], priceModel }.
function computeCost(event, price) {
  if (!price) {
    return { costUsd: null, pricingStatus: "unpriced", longContext: false, missing: ["price_row"], priceModel: null };
  }
  const threshold = price.longContextThreshold;
  const longContext = isRate(threshold) && countOf(event.totalInputTokens) > threshold;
  const col = function (base) {
    if (!longContext) return price[base + "Per1M"];
    return price["longContext" + base.charAt(0).toUpperCase() + base.slice(1) + "Per1M"];
  };
  const parts = [
    { tokens: countOf(event.uncachedInputTokens), rate: col("input"), name: longContext ? "longContextInputPer1M" : "inputPer1M" },
    { tokens: countOf(event.cacheReadTokens), rate: col("cacheRead"), name: longContext ? "longContextCacheReadPer1M" : "cacheReadPer1M" },
    { tokens: countOf(event.cacheWrite5mTokens), rate: col("cacheWrite5m"), name: longContext ? "longContextCacheWrite5mPer1M" : "cacheWrite5mPer1M" },
    { tokens: countOf(event.cacheWrite1hTokens), rate: col("cacheWrite1h"), name: longContext ? "longContextCacheWrite1hPer1M" : "cacheWrite1hPer1M" },
    { tokens: countOf(event.outputTokens), rate: col("output"), name: longContext ? "longContextOutputPer1M" : "outputPer1M" }
  ];
  const missing = [];
  let tokenCost = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.tokens === 0) continue;
    if (!isRate(p.rate)) {
      missing.push(p.name);
      continue;
    }
    tokenCost += (p.tokens * p.rate) / 1e6;
  }
  if (event.speed === "fast") {
    if (isRate(price.fastMultiplier)) tokenCost *= price.fastMultiplier;
    else missing.push("fastMultiplier");
  }
  let toolCost = 0;
  const requests = countOf(event.serverToolRequests);
  if (requests > 0) {
    if (isRate(price.webSearchPerRequest)) toolCost = requests * price.webSearchPerRequest;
    else missing.push("webSearchPerRequest");
  }
  if (missing.length) {
    return { costUsd: null, pricingStatus: "unpriced", longContext: longContext, missing: missing, priceModel: price.model };
  }
  return {
    costUsd: roundUsd(tokenCost + toolCost),
    pricingStatus: "priced",
    longContext: longContext,
    missing: [],
    priceModel: price.model
  };
}

function priceEvent(prices, event) {
  return computeCost(event, findPrice(prices, event));
}
