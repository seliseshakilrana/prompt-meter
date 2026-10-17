/** Where finished events go: the durable queue (normal) or stdout (local testing). */
import { keyLabel, log } from "./log.js";
import type { EventQueue } from "./queue.js";
import type { Sender } from "./sender.js";
import type { UsageEvent } from "./types.js";

export interface EventSink {
  emit(key: string | null, event: UsageEvent): void;
}

export class QueueSink implements EventSink {
  constructor(
    private readonly queue: EventQueue,
    private readonly sender: Sender | null,
  ) {}

  emit(key: string | null, event: UsageEvent): void {
    if (!key) {
      log.warn("no ingest key for this request (no X-Prompt-Meter-Key header and no defaultKey); event dropped", {
        eventId: event.eventId,
      });
      return;
    }
    this.queue.enqueue(key, event);
    this.sender?.notify();
  }
}

export class StdoutSink implements EventSink {
  constructor(private readonly out: NodeJS.WritableStream = process.stdout) {}

  emit(key: string | null, event: UsageEvent): void {
    this.out.write(JSON.stringify({ ingestKey: keyLabel(key), event }) + "\n");
  }
}

/** Collects events in memory (tests). */
export class MemorySink implements EventSink {
  events: { key: string | null; event: UsageEvent }[] = [];
  private waiters: (() => void)[] = [];

  emit(key: string | null, event: UsageEvent): void {
    this.events.push({ key, event });
    for (const w of this.waiters.splice(0)) w();
  }

  async waitFor(count: number, timeoutMs = 3000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.events.length < count) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timed out waiting for ${count} events (have ${this.events.length})`);
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
    }
  }
}
