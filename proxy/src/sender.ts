/**
 * Batch sender (docs/ingest-contract.md).
 *
 * - Batches are per ingest key. A key's batch is sent when it has >= 50 queued
 *   events, or when its oldest queued event has waited 10 s.
 * - At most 100 events and 256 KB per request.
 * - 200: remove every event of the batch (accepted, duplicates and rejected); log rejected.
 * - 400 / 413: split the batch in half and retry each half; a single event that
 *   still fails is logged and dropped.
 * - 401: keep the events and pause this key until the proxy restarts (or resume()).
 * - 429 / 5xx / other / network error: keep the events and back off
 *   (1 s doubling to 5 min, with jitter; 429 honors retryAfterSeconds).
 */
import { keyLabel, log } from "./log.js";
import type { EventQueue, QueuedEvent } from "./queue.js";

export const COLLECTOR = { name: "prompt-meter-proxy", version: "0.1.0" } as const;

export interface SenderOptions {
  ingestUrl: string | null;
  flushIntervalMs?: number;
  batchSize?: number;
  maxBatchEvents?: number;
  maxBatchBytes?: number;
  tickMs?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  random?: () => number;
  now?: () => number;
}

interface KeyState {
  paused: boolean;
  failures: number;
  nextAttemptAt: number;
}

type PostResult = "ok" | "paused" | "retry";

export class Sender {
  private readonly o: Required<Omit<SenderOptions, "ingestUrl">> & { ingestUrl: string | null };
  private state = new Map<string, KeyState>();
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private pendingTick = false;
  private pendingForce = false;

  constructor(
    private readonly queue: EventQueue,
    opts: SenderOptions,
  ) {
    this.o = {
      ingestUrl: opts.ingestUrl,
      flushIntervalMs: opts.flushIntervalMs ?? 10_000,
      batchSize: opts.batchSize ?? 50,
      maxBatchEvents: opts.maxBatchEvents ?? 100,
      maxBatchBytes: opts.maxBatchBytes ?? 256 * 1024,
      tickMs: opts.tickMs ?? 1000,
      backoffBaseMs: opts.backoffBaseMs ?? 1000,
      backoffMaxMs: opts.backoffMaxMs ?? 5 * 60 * 1000,
      requestTimeoutMs: opts.requestTimeoutMs ?? 30_000,
      fetchImpl: opts.fetchImpl ?? fetch,
      random: opts.random ?? Math.random,
      now: opts.now ?? Date.now,
    };
    if (!this.o.ingestUrl) log.warn("no ingestUrl configured: events are queued on disk but not sent");
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.o.tickMs);
    this.timer.unref();
    void this.tick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.running) await this.running;
  }

  /** Called after an event is enqueued: sends right away when a key reaches the batch size. */
  notify(): void {
    void this.tick();
  }

  isPaused(key: string): boolean {
    return this.state.get(key)?.paused ?? false;
  }

  resume(key: string): void {
    const s = this.st(key);
    s.paused = false;
    s.failures = 0;
    s.nextAttemptAt = 0;
  }

  /** Run one pass. `force` sends whatever is queued regardless of the 10 s / 50-event thresholds. */
  async tick(force = false): Promise<void> {
    if (this.running) {
      this.pendingTick = true;
      this.pendingForce ||= force;
      return this.running;
    }
    const pass = (async () => {
      try {
        let forced = force;
        do {
          this.pendingTick = false;
          for (const key of this.queue.keys()) await this.drainKey(key, forced);
          forced = this.pendingForce;
          this.pendingForce = false;
        } while (this.pendingTick);
      } catch (err) {
        log.error("sender pass failed", { error: String(err) });
      }
    })();
    // Cleared after the assignment below even when the pass finished synchronously.
    this.running = pass.then(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Send everything now (still respecting 401 pauses and backoff). */
  flush(): Promise<void> {
    return this.tick(true);
  }

  private st(key: string): KeyState {
    let s = this.state.get(key);
    if (!s) {
      s = { paused: false, failures: 0, nextAttemptAt: 0 };
      this.state.set(key, s);
    }
    return s;
  }

  private due(key: string, force: boolean): boolean {
    const count = this.queue.count(key);
    if (count === 0) return false;
    if (force || count >= this.o.batchSize) return true;
    const oldest = this.queue.oldestEnqueuedAt(key);
    return oldest !== null && this.o.now() - oldest >= this.o.flushIntervalMs;
  }

  private async drainKey(key: string, force: boolean): Promise<void> {
    if (!this.o.ingestUrl) return;
    const s = this.st(key);
    while (!s.paused && this.o.now() >= s.nextAttemptAt && this.due(key, force)) {
      const rows = this.buildBatch(key);
      if (rows.length === 0) continue; // oversized single events were dropped; re-check
      const result = await this.post(key, rows);
      if (result !== "ok") return;
    }
  }

  private body(rows: QueuedEvent[]): string {
    return `{"collector":${JSON.stringify(COLLECTOR)},"events":[${rows.map((r) => r.payload).join(",")}]}`;
  }

  /** Up to 100 events and 256 KB. A single event over 256 KB can never be sent: it is dropped. */
  private buildBatch(key: string): QueuedEvent[] {
    const rows = this.queue.peek(key, this.o.maxBatchEvents);
    while (rows.length > 1 && Buffer.byteLength(this.body(rows)) > this.o.maxBatchBytes) rows.pop();
    if (rows.length === 1 && Buffer.byteLength(this.body(rows)) > this.o.maxBatchBytes) {
      log.error("dropping event larger than the batch size limit", { key: keyLabel(key), eventId: rows[0]!.eventId });
      this.queue.remove([rows[0]!.id]);
      return [];
    }
    return rows;
  }

  private backoff(key: string, minDelayMs = 0): void {
    const s = this.st(key);
    s.failures += 1;
    const base = Math.min(this.o.backoffBaseMs * 2 ** (s.failures - 1), this.o.backoffMaxMs);
    const jittered = Math.min(base * (0.8 + 0.4 * this.o.random()), this.o.backoffMaxMs);
    const delay = Math.max(jittered, minDelayMs);
    s.nextAttemptAt = this.o.now() + delay;
    log.warn("ingest send failed; backing off", { key: keyLabel(key), attempt: s.failures, delayMs: Math.round(delay) });
  }

  private async post(key: string, rows: QueuedEvent[]): Promise<PostResult> {
    const s = this.st(key);
    let res: Response;
    let text = "";
    try {
      res = await this.o.fetchImpl(this.o.ingestUrl!, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Ingest-Key": key },
        body: this.body(rows),
        signal: AbortSignal.timeout(this.o.requestTimeoutMs),
      });
      text = await res.text();
    } catch (err) {
      log.warn("ingest network error", { key: keyLabel(key), error: String(err) });
      this.backoff(key);
      return "retry";
    }

    if (res.status === 200) {
      s.failures = 0;
      s.nextAttemptAt = 0;
      this.queue.remove(rows.map((r) => r.id));
      let parsed: { accepted?: number; duplicates?: number; rejected?: { eventId?: string; reason?: string }[] } = {};
      try {
        parsed = JSON.parse(text);
      } catch {
        /* body is informational only */
      }
      for (const r of parsed.rejected ?? []) {
        log.warn("ingest rejected event", { key: keyLabel(key), eventId: r.eventId, reason: r.reason });
      }
      log.debug("batch sent", { key: keyLabel(key), events: rows.length, accepted: parsed.accepted, duplicates: parsed.duplicates });
      return "ok";
    }

    if (res.status === 400 || res.status === 413) {
      if (rows.length === 1) {
        log.error("ingest refused event; dropping it", { key: keyLabel(key), status: res.status, eventId: rows[0]!.eventId, body: text.slice(0, 200) });
        this.queue.remove([rows[0]!.id]);
        return "ok";
      }
      const mid = Math.ceil(rows.length / 2);
      for (const half of [rows.slice(0, mid), rows.slice(mid)]) {
        const r = await this.post(key, half);
        if (r !== "ok") return r;
      }
      return "ok";
    }

    if (res.status === 401) {
      s.paused = true;
      log.error("ingest key rejected (401); sending paused for this key until it is fixed and the proxy restarts", {
        key: keyLabel(key),
        queued: this.queue.count(key),
      });
      return "paused";
    }

    let retryAfterMs = 0;
    if (res.status === 429) {
      try {
        const j = JSON.parse(text) as { retryAfterSeconds?: unknown };
        if (typeof j.retryAfterSeconds === "number") retryAfterMs = j.retryAfterSeconds * 1000;
      } catch {
        /* ignore */
      }
      const ra = Number(res.headers.get("retry-after"));
      if (!retryAfterMs && Number.isFinite(ra) && ra > 0) retryAfterMs = ra * 1000;
    }
    this.backoff(key, retryAfterMs);
    return "retry";
  }
}
