"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadHelpers, seedPrices } = require("./helpers.js");
const { findPrice, computeCost, priceEvent } = loadHelpers(["cost"]);

const prices = seedPrices();
const AT = "2026-10-17T12:00:00.000Z";
function ev(o) {
  const e = Object.assign({ provider: "anthropic", occurredAt: AT, uncachedInputTokens: 0, cacheReadTokens: 0,
    cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, outputTokens: 0, serverToolRequests: 0, speed: "standard" }, o);
  if (e.totalInputTokens === undefined) e.totalInputTokens = e.uncachedInputTokens + e.cacheReadTokens + e.cacheWrite5mTokens + e.cacheWrite1hTokens;
  return e;
}
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("opus: input, output, cache read, 5m and 1h cache writes", () => {
  const r = priceEvent(prices, ev({ model: "claude-opus-5-5", uncachedInputTokens: 1e6, outputTokens: 1e6, cacheReadTokens: 1e6, cacheWrite5mTokens: 1e6, cacheWrite1hTokens: 1e6 }));
  assert.equal(r.pricingStatus, "priced");
  close(r.costUsd, 4 + 20 + 0.20 + 5 + 8);
});

test("1h cache writes cost 2x input, 5m writes 1.25x", () => {
  close(priceEvent(prices, ev({ model: "claude-sonnet-5-5", cacheWrite1hTokens: 1e6 })).costUsd, 4);
  close(priceEvent(prices, ev({ model: "claude-sonnet-5-5", cacheWrite5mTokens: 1e6 })).costUsd, 2.5);
  close(priceEvent(prices, ev({ model: "claude-fable-5-1", cacheWrite5mTokens: 1e6, cacheReadTokens: 1e6 })).costUsd, 12.5 + 0.25);
});

test("thinkingTokens are not added (already inside outputTokens)", () => {
  close(priceEvent(prices, ev({ model: "claude-opus-5-5", outputTokens: 1000, thinkingTokens: 800 })).costUsd, 0.02);
});

test("haiku long context is decided on TOTAL input, cached included", () => {
  // 1,000 uncached + 150,000 total (cache writes) -> above 100K -> long-context rates.
  const r = priceEvent(prices, ev({ model: "claude-haiku-5-5", uncachedInputTokens: 1000, cacheWrite5mTokens: 149000, outputTokens: 1000 }));
  assert.equal(r.longContext, true);
  close(r.costUsd, (1000 * 0.5 + 149000 * 0.625 + 1000 * 2.5) / 1e6);
  // exactly at the threshold is NOT above it
  const s = priceEvent(prices, ev({ model: "claude-haiku-5-5", uncachedInputTokens: 100000, outputTokens: 1000 }));
  assert.equal(s.longContext, false);
  close(s.costUsd, (100000 * 0.10 + 1000 * 0.50) / 1e6);
  const t = priceEvent(prices, ev({ model: "claude-haiku-5-5", uncachedInputTokens: 100001 }));
  assert.equal(t.longContext, true);
  close(t.costUsd, 100001 * 0.5 / 1e6);
});

test("missing rate for a used token kind -> unpriced, never guessed", () => {
  const r = priceEvent(prices, ev({ model: "claude-haiku-5-5", uncachedInputTokens: 10, cacheReadTokens: 10 }));
  assert.equal(r.pricingStatus, "unpriced");
  assert.equal(r.costUsd, null);
  assert.deepEqual(r.missing, ["cacheReadPer1M"]);
  // ...but a zero count of that kind is fine
  assert.equal(priceEvent(prices, ev({ model: "claude-haiku-5-5", uncachedInputTokens: 10 })).pricingStatus, "priced");
});

test("fast speed multiplies token cost; fast without a multiplier is unpriced", () => {
  close(priceEvent(prices, ev({ model: "claude-opus-5-5", uncachedInputTokens: 1e6, outputTokens: 1e6, speed: "fast" })).costUsd, 48);
  const r = priceEvent(prices, ev({ model: "claude-sonnet-5-5", uncachedInputTokens: 1e6, speed: "fast" }));
  assert.equal(r.pricingStatus, "unpriced");
  assert.deepEqual(r.missing, ["fastMultiplier"]);
});

test("web search is per request, outside the fast multiplier; unknown price -> unpriced", () => {
  const price = Object.assign({}, findPrice(prices, ev({ model: "claude-opus-5-5" })), { webSearchPerRequest: 0.5 });
  close(computeCost(ev({ model: "claude-opus-5-5", outputTokens: 1e6, serverToolRequests: 3, speed: "fast" }), price).costUsd, 40 + 1.5);
  const r = priceEvent(prices, ev({ model: "claude-opus-5-5", outputTokens: 10, serverToolRequests: 1 }));
  assert.equal(r.pricingStatus, "unpriced");
  assert.deepEqual(r.missing, ["webSearchPerRequest"]);
});

test("unknown model or provider mismatch -> unpriced", () => {
  assert.equal(priceEvent(prices, ev({ model: "gpt-unknown", provider: "openai", outputTokens: 5 })).pricingStatus, "unpriced");
  assert.equal(priceEvent(prices, ev({ model: "claude-opus-5-5", provider: "google", outputTokens: 5 })).pricingStatus, "unpriced");
});

test("lookup: exact model > exact alias > longest prefix alias; effectiveFrom picks newest not after occurredAt", () => {
  const rows = [
    { provider: "anthropic", model: "m-base", modelAliases: ["m-*"], effectiveFrom: "2026-01-01T00:00:00Z", inputPer1M: 1 },
    { provider: "anthropic", model: "m-long", modelAliases: ["m-long-*", "m-dated-20260101"], effectiveFrom: "2026-01-01T00:00:00Z", inputPer1M: 2 },
    { provider: "anthropic", model: "m-long", modelAliases: ["m-long-*"], effectiveFrom: "2026-06-01T00:00:00Z", inputPer1M: 3 },
    { provider: "anthropic", model: "future-model", modelAliases: [], effectiveFrom: "2027-01-01T00:00:00Z", inputPer1M: 9 }
  ];
  const at = (model, when) => findPrice(rows, { provider: "anthropic", model, occurredAt: when || "2026-07-01T00:00:00Z" });
  assert.equal(at("m-long").inputPer1M, 3);                         // exact, newest
  assert.equal(at("m-long", "2026-03-01T00:00:00Z").inputPer1M, 2); // exact, older date
  assert.equal(at("m-dated-20260101").inputPer1M, 2);               // exact alias
  assert.equal(at("m-long-20260701").inputPer1M, 3);                // longest prefix wins over "m-*"
  assert.equal(at("m-other").inputPer1M, 1);                        // shorter prefix
  assert.equal(at("future-model"), null);                           // not yet effective
  assert.equal(at("zzz"), null);
});

test("seed effectiveFrom applies: event before 2026-10-17 is unpriced", () => {
  assert.equal(priceEvent(prices, ev({ model: "claude-opus-5-5", outputTokens: 1, occurredAt: "2026-10-16T23:59:59Z" })).pricingStatus, "unpriced");
  assert.equal(priceEvent(prices, ev({ model: "claude-opus-5-5-20261017", outputTokens: 1e6 })).costUsd, 20);
});
