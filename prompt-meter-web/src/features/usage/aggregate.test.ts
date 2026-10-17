import { describe, expect, it } from "vitest";
import {
  breakdownBy,
  distinctValues,
  emptyTotals,
  groupPrompts,
  groupSessions,
  hourAlignedRange,
  summarize,
  tokensOf,
  trendByDay,
  unpricedInRange
} from "./aggregate";
import type { UsageEvent, UserHourly } from "./data/types";
import type { LocalRange, UtcRange } from "../../lib/time/zoned";

describe("aggregate usage logic", () => {
  const baseRange: UtcRange = {
    start: "2026-10-17T00:00:00.000Z",
    end: "2026-10-18T00:00:00.000Z"
  };

  const localDayRange: LocalRange = {
    start: "2026-10-16T18:00:00.000Z", // Dhaka midnight for 2026-10-17
    end: "2026-10-17T18:00:00.000Z",
    startDate: { year: 2026, month: 10, day: 17 },
    lastDate: { year: 2026, month: 10, day: 17 }
  };

  const sampleHourlyRows: UserHourly[] = [
    {
      userId: "u1",
      teamId: "team-a",
      hourStart: "2026-10-17T10:00:00.000Z",
      tool: "claude-code",
      model: "claude-opus-5-5",
      source: "proxy",
      totalInputTokens: 1000,
      uncachedInputTokens: 500,
      cacheReadTokens: 500,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      outputTokens: 200,
      thinkingTokens: null,
      serverToolRequests: 0,
      costUsd: 0.05,
      eventCount: 3,
      promptCount: 1
    },
    {
      userId: "u1",
      teamId: "team-a",
      hourStart: "2026-10-17T14:00:00.000Z",
      tool: "claude-code",
      model: "claude-opus-5-5",
      source: "proxy",
      totalInputTokens: 2000,
      uncachedInputTokens: 1000,
      cacheReadTokens: 1000,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      outputTokens: 300,
      thinkingTokens: null,
      serverToolRequests: 0,
      costUsd: 0.08,
      eventCount: 2,
      promptCount: 1
    },
    {
      userId: "u1",
      teamId: "team-b",
      hourStart: "2026-10-17T16:00:00.000Z",
      tool: "other",
      model: "claude-sonnet-5-5",
      source: "manual",
      totalInputTokens: 5000,
      uncachedInputTokens: 5000,
      cacheReadTokens: 0,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      outputTokens: 1000,
      thinkingTokens: null,
      serverToolRequests: 0,
      costUsd: 0.2,
      eventCount: 1,
      promptCount: 1
    },
    {
      userId: "u1",
      teamId: "team-a",
      hourStart: "2026-10-19T10:00:00.000Z", // Outside range
      tool: "claude-code",
      model: "claude-haiku-5-5",
      source: "proxy",
      totalInputTokens: 500,
      uncachedInputTokens: 500,
      cacheReadTokens: 0,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      outputTokens: 100,
      thinkingTokens: null,
      serverToolRequests: 0,
      costUsd: 0.01,
      eventCount: 1,
      promptCount: 1
    }
  ];

  const sampleEvents: UsageEvent[] = [
    {
      eventId: "e1",
      userId: "u1",
      teamId: "team-a",
      tool: "claude-code",
      provider: "anthropic",
      model: "claude-opus-5-5",
      source: "proxy",
      sessionId: "s1",
      promptId: "p1",
      callIndex: 0,
      speed: null,
      costUsd: 0.02,
      pricingStatus: "priced",
      promptPreview: "First prompt",
      projectTag: null,
      totalInputTokens: 600,
      uncachedInputTokens: 300,
      cacheReadTokens: 300,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      outputTokens: 100,
      thinkingTokens: null,
      serverToolRequests: 0,
      occurredAt: "2026-10-17T10:05:00.000Z",
      receivedAt: "2026-10-17T10:05:05.000Z"
    },
    {
      eventId: "e2",
      userId: "u1",
      teamId: "team-a",
      tool: "claude-code",
      provider: "anthropic",
      model: "claude-opus-5-5",
      source: "proxy",
      sessionId: "s1",
      promptId: "p1",
      callIndex: 1,
      speed: null,
      costUsd: null,
      pricingStatus: "unpriced",
      promptPreview: null,
      projectTag: null,
      totalInputTokens: 400,
      uncachedInputTokens: 200,
      cacheReadTokens: 200,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      outputTokens: 100,
      thinkingTokens: null,
      serverToolRequests: 1,
      occurredAt: "2026-10-17T10:06:00.000Z",
      receivedAt: "2026-10-17T10:06:05.000Z"
    }
  ];

  it("calculates tokensOf correctly", () => {
    expect(tokensOf({ totalInputTokens: 1500, outputTokens: 250 })).toBe(1750);
    expect(tokensOf({ totalInputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it("summarizes hourly rows and unpriced events within UTC range", () => {
    const totals = summarize(sampleHourlyRows, baseRange, sampleEvents);
    // Rows within range: 1200 (1000+200) + 2300 (2000+300) + 6000 (5000+1000) = 9500
    expect(totals.tokens).toBe(9500);
    expect(totals.inputTokens).toBe(8000);
    expect(totals.outputTokens).toBe(1500);
    expect(totals.costUsd).toBeCloseTo(0.33, 4);
    expect(totals.eventCount).toBe(6);
    expect(totals.promptCount).toBe(3);
    // Manual subset:
    expect(totals.manualTokens).toBe(6000);
    expect(totals.manualCostUsd).toBeCloseTo(0.2, 4);
    expect(totals.manualEventCount).toBe(1);
    // Unpriced count within range:
    expect(totals.unpricedCount).toBe(1);
  });

  it("filters unpriced events in range by UTC hour floor", () => {
    const unpriced = unpricedInRange(sampleEvents, baseRange);
    expect(unpriced.length).toBe(1);
    expect(unpriced[0]?.eventId).toBe("e2");
  });

  it("computes hourAlignedRange", () => {
    const aligned = hourAlignedRange({
      start: "2026-10-17T10:25:00.000Z",
      end: "2026-10-17T14:15:00.000Z"
    });
    expect(aligned.start).toBe("2026-10-17T10:00:00.000Z");
    expect(aligned.end).toBe("2026-10-17T15:00:00.000Z");
  });

  it("groups daily trend points with zero-fill and source split", () => {
    const points = trendByDay(sampleHourlyRows, sampleEvents, localDayRange, "Asia/Dhaka");
    expect(points.length).toBe(1);
    expect(points[0]?.key).toBe("2026-10-17");
    // All 3 in-range rows fall on Dhaka 2026-10-17 (local 16:00, 20:00, 22:00)
    expect(points[0]?.proxyTokens).toBe(3500);
    expect(points[0]?.manualTokens).toBe(6000);
    expect(points[0]?.unpricedCount).toBe(1);
  });

  it("builds breakdowns by tool and model", () => {
    const toolBreakdown = breakdownBy("tool", sampleHourlyRows, sampleEvents, baseRange);
    expect(toolBreakdown.length).toBe(2);
    // claude-code has 3500 tokens, other (manual) has 6000 tokens
    expect(toolBreakdown[0]?.value).toBe("other");
    expect(toolBreakdown[0]?.source).toBe("manual");
    expect(toolBreakdown[0]?.tokens).toBe(6000);

    expect(toolBreakdown[1]?.value).toBe("claude-code");
    expect(toolBreakdown[1]?.source).toBe("proxy");
    expect(toolBreakdown[1]?.tokens).toBe(3500);
    expect(toolBreakdown[1]?.unpricedCount).toBe(1);

    const modelBreakdown = breakdownBy("model", sampleHourlyRows, sampleEvents, baseRange);
    expect(modelBreakdown.length).toBe(2);
    expect(modelBreakdown[0]?.value).toBe("claude-sonnet-5-5");
    expect(modelBreakdown[1]?.value).toBe("claude-opus-5-5");
  });

  it("groups prompts and preserves preview and call sorting", () => {
    const prompts = groupPrompts(sampleEvents);
    expect(prompts.length).toBe(1);
    expect(prompts[0]?.promptId).toBe("p1");
    expect(prompts[0]?.preview).toBe("First prompt");
    expect(prompts[0]?.calls.length).toBe(2);
    expect(prompts[0]?.calls[0]?.callIndex).toBe(0);
    expect(prompts[0]?.calls[1]?.callIndex).toBe(1);
  });

  it("groups sessions and aggregates metadata", () => {
    const sessions = groupSessions(sampleEvents);
    expect(sessions.length).toBe(1);
    expect(sessions[0]?.sessionId).toBe("s1");
    expect(sessions[0]?.isManual).toBe(false);
    expect(sessions[0]?.tools).toEqual(["claude-code"]);
    expect(sessions[0]?.models).toEqual(["claude-opus-5-5"]);
    expect(sessions[0]?.eventCount).toBe(2);
    expect(sessions[0]?.unpricedCount).toBe(1);
  });

  it("extracts distinct sorted values for filters", () => {
    expect(distinctValues(sampleHourlyRows, "teamId")).toEqual(["team-a", "team-b"]);
    expect(distinctValues(sampleHourlyRows, "tool")).toEqual(["claude-code", "other"]);
  });
});
