import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventQueue } from "../src/queue.js";
import { COLLECTOR, Sender } from "../src/sender.js";
import type { UsageEvent } from "../src/types.js";
import { type MockServer, startMock } from "./helpers.js";

const KEY = "pm_aaaaaaaa_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const KEY2 = "pm_bbbbbbbb_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

function ev(i: number, extra: Partial<UsageEvent> = {}): UsageEvent {
  return {
    eventId: `msg_${i}`,
    tool: "claude-code",
    provider: "anthropic",
    model: "claude-opus-5-5",
    sessionId: "s",
    promptId: "p",
    callIndex: i,
    totalInputTokens: 10,
    uncachedInputTokens: 10,
    cacheReadTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    outputTokens: 5,
    thinkingTokens: null,
    serverToolRequests: 0,
    speed: null,
    promptPreview: null,
    projectTag: null,
    accountEmail: null,
    occurredAt: "2026-10-17T09:30:00.000Z",
    ...extra,
  };
}

let dir: string;
let ingest: MockServer | null = null;
let queue: EventQueue | null = null;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-queue-"));
});
afterEach(async () => {
  queue?.close();
  queue = null;
  await ingest?.close();
  ingest = null;
  fs.rmSync(dir, { recursive: true, force: true });
});

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };
async function startIngest(replies: Reply[] | ((n: number) => Reply)) {
  let n = 0;
  ingest = await startMock((_req, res) => {
    const r = typeof replies === "function" ? replies(n) : (replies[n] ?? { status: 200 });
    n++;
    res.writeHead(r.status, { "content-type": "application/json", ...(r.headers ?? {}) });
    res.end(JSON.stringify(r.body ?? { accepted: 0, duplicates: 0, rejected: [] }));
  });
  return ingest;
}

const bodyOf = (i: number) => JSON.parse(ingest!.requests[i]!.body.toString()) as { collector: unknown; events: UsageEvent[] };

describe("disk queue", () => {
  it("keeps events across a simulated restart and sends them afterwards", async () => {
    const file = path.join(dir, "q.db");
    const q1 = new EventQueue(file);
    q1.enqueue(KEY, ev(1));
    q1.enqueue(KEY, ev(2));
    q1.close(); // "crash"/restart before sending

    expect((fs.statSync(file).mode & 0o777).toString(8)).toBe("600");
    queue = new EventQueue(file);
    expect(queue.count(KEY)).toBe(2);
    await startIngest([{ status: 200 }]);
    const sender = new Sender(queue, { ingestUrl: ingest!.url });
    await sender.flush();
    expect(queue.count()).toBe(0);
    expect(bodyOf(0).events.map((e) => e.eventId)).toEqual(["msg_1", "msg_2"]);
  });

  it("ignores a duplicate (key, eventId) enqueue", () => {
    queue = new EventQueue(path.join(dir, "q.db"));
    expect(queue.enqueue(KEY, ev(1))).toBe(true);
    expect(queue.enqueue(KEY, ev(1))).toBe(false);
    expect(queue.enqueue(KEY2, ev(1))).toBe(true);
    expect(queue.count()).toBe(2);
  });
});

describe("sender", () => {
  it("posts the contract body with X-Ingest-Key, grouped per key", async () => {
    queue = new EventQueue(path.join(dir, "q.db"));
    queue.enqueue(KEY, ev(1));
    queue.enqueue(KEY2, ev(2));
    queue.enqueue(KEY, ev(3));
    await startIngest(() => ({ status: 200 }));
    await new Sender(queue, { ingestUrl: ingest!.url }).flush();
    expect(ingest!.requests).toHaveLength(2);
    const byKey = Object.fromEntries(ingest!.requests.map((r) => [r.headers["x-ingest-key"], JSON.parse(r.body.toString())]));
    expect(byKey[KEY].events.map((e: UsageEvent) => e.eventId)).toEqual(["msg_1", "msg_3"]);
    expect(byKey[KEY2].events.map((e: UsageEvent) => e.eventId)).toEqual(["msg_2"]);
    expect(byKey[KEY].collector).toEqual(COLLECTOR);
    expect(ingest!.requests[0]!.headers["content-type"]).toBe("application/json");
  });

  it("batching: waits for 10 s or 50 events; sends at most 100 events per request", async () => {
    queue = new EventQueue(path.join(dir, "q.db"));
    await startIngest(() => ({ status: 200 }));
    let now = 1_000_000;
    const sender = new Sender(queue, { ingestUrl: ingest!.url, now: () => now });
    for (let i = 0; i < 49; i++) queue.enqueue(KEY, ev(i), now);
    await sender.tick();
    expect(ingest!.requests).toHaveLength(0); // 49 events, 0 s old: not due

    now += 9_999;
    await sender.tick();
    expect(ingest!.requests).toHaveLength(0);

    queue.enqueue(KEY, ev(49), now); // 50th event -> due immediately
    await sender.tick();
    expect(ingest!.requests).toHaveLength(1);
    expect(bodyOf(0).events).toHaveLength(50);

    queue.enqueue(KEY, ev(100), now);
    await sender.tick();
    expect(ingest!.requests).toHaveLength(1);
    now += 10_000; // oldest has waited 10 s
    await sender.tick();
    expect(ingest!.requests).toHaveLength(2);
    expect(bodyOf(1).events).toHaveLength(1);

    for (let i = 0; i < 230; i++) queue.enqueue(KEY, ev(1000 + i), now);
    await sender.tick();
    // 230 queued: 100 + 100, then 30 left (< 50 and fresh) wait
    expect(ingest!.requests.slice(2).map((_, i) => bodyOf(2 + i).events.length)).toEqual([100, 100]);
    expect(queue.count(KEY)).toBe(30);
  });

  it("keeps each request under 256 KB", async () => {
    queue = new EventQueue(path.join(dir, "q.db"));
    await startIngest(() => ({ status: 200 }));
    const big = "x".repeat(10_000);
    for (let i = 0; i < 60; i++) queue.enqueue(KEY, ev(i, { promptPreview: big }));
    await new Sender(queue, { ingestUrl: ingest!.url }).flush();
    expect(queue.count()).toBe(0);
    for (const r of ingest!.requests) expect(r.body.length).toBeLessThanOrEqual(256 * 1024);
    expect(ingest!.requests.length).toBeGreaterThan(1);
  });

  it("401 keeps the events and pauses only that key", async () => {
    queue = new EventQueue(path.join(dir, "q.db"));
    queue.enqueue(KEY, ev(1));
    queue.enqueue(KEY2, ev(2));
    ingest = await startMock((req, res) => {
      const bad = req.headers["x-ingest-key"] === KEY;
      res.writeHead(bad ? 401 : 200, { "content-type": "application/json" });
      res.end(JSON.stringify(bad ? { error: "invalid_key" } : { accepted: 1, duplicates: 0, rejected: [] }));
    });
    const sender = new Sender(queue, { ingestUrl: ingest.url });
    await sender.flush();
    expect(sender.isPaused(KEY)).toBe(true);
    expect(sender.isPaused(KEY2)).toBe(false);
    expect(queue.count(KEY)).toBe(1);
    expect(queue.count(KEY2)).toBe(0);
    const before = ingest.requests.length;
    await sender.flush();
    await sender.flush();
    expect(ingest.requests.length).toBe(before); // no more attempts while paused
    sender.resume(KEY);
    expect(sender.isPaused(KEY)).toBe(false);
  });

  it("429 and 5xx keep events and retry with exponential backoff; resent eventIds are the same", async () => {
    queue = new EventQueue(path.join(dir, "q.db"));
    queue.enqueue(KEY, ev(1));
    queue.enqueue(KEY, ev(2));
    await startIngest([
      { status: 503 },
      { status: 500 },
      { status: 429, body: { error: "rate_limited", retryAfterSeconds: 7 } },
      // the server had in fact stored msg_1 before failing: it reports it as a duplicate
      { status: 200, body: { accepted: 1, duplicates: 1, rejected: [] } },
    ]);
    let now = 0;
    const sender = new Sender(queue, { ingestUrl: ingest!.url, now: () => now, random: () => 0.5 });

    await sender.flush();
    expect(ingest!.requests).toHaveLength(1);
    expect(queue.count()).toBe(2);
    await sender.flush(); // still backing off (1 s)
    expect(ingest!.requests).toHaveLength(1);

    now += 1_000;
    await sender.flush(); // 500 -> backoff 2 s
    expect(ingest!.requests).toHaveLength(2);
    now += 1_999;
    await sender.flush();
    expect(ingest!.requests).toHaveLength(2);
    now += 1;
    await sender.flush(); // 429 with retryAfterSeconds 7 (> 4 s backoff)
    expect(ingest!.requests).toHaveLength(3);
    now += 6_999;
    await sender.flush();
    expect(ingest!.requests).toHaveLength(3);
    now += 1;
    await sender.flush(); // 200
    expect(ingest!.requests).toHaveLength(4);
    expect(queue.count()).toBe(0);

    const ids = [0, 1, 2, 3].map((i) => bodyOf(i).events.map((e) => e.eventId));
    expect(new Set(ids.map((x) => x.join(",")))).toEqual(new Set(["msg_1,msg_2"]));
  });

  it("backoff caps at 5 minutes", async () => {
    queue = new EventQueue(path.join(dir, "q.db"));
    queue.enqueue(KEY, ev(1));
    await startIngest(() => ({ status: 502 }));
    let now = 0;
    const sender = new Sender(queue, { ingestUrl: ingest!.url, now: () => now, random: () => 1 });
    for (let i = 0; i < 12; i++) {
      await sender.flush();
      now += 5 * 60_000;
    }
    expect(ingest!.requests).toHaveLength(12); // every 5-min step is enough once capped
  });

  it("network errors are retried", async () => {
    queue = new EventQueue(path.join(dir, "q.db"));
    queue.enqueue(KEY, ev(1));
    let now = 0;
    const sender = new Sender(queue, { ingestUrl: "http://127.0.0.1:1/ingest", now: () => now });
    await sender.flush();
    expect(queue.count()).toBe(1);
  });

  it("400/413 split the batch; a single refused event is dropped; 200 removes rejected events too", async () => {
    queue = new EventQueue(path.join(dir, "q.db"));
    for (let i = 1; i <= 4; i++) queue.enqueue(KEY, ev(i));
    ingest = await startMock((req, res) => {
      const events = (JSON.parse(req.body.toString()) as { events: UsageEvent[] }).events;
      const hasBad = events.some((e) => e.eventId === "msg_3");
      if (events.length > 2) {
        res.writeHead(413).end(JSON.stringify({ error: "too_large" }));
      } else if (hasBad) {
        res.writeHead(400).end(JSON.stringify({ error: "bad" }));
      } else {
        res.writeHead(200).end(JSON.stringify({ accepted: events.length - 1, duplicates: 0, rejected: [{ eventId: events[0]!.eventId, reason: "unknown model" }] }));
      }
    });
    await new Sender(queue, { ingestUrl: ingest.url }).flush();
    expect(queue.count()).toBe(0);
    const sizes = ingest.requests.map((r) => (JSON.parse(r.body.toString()) as { events: unknown[] }).events.length);
    expect(sizes).toEqual([4, 2, 2, 1, 1]);
  });
});
