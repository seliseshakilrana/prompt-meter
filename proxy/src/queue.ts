/**
 * Durable disk queue (SQLite via better-sqlite3, WAL, synchronous=FULL).
 * Every event is written before anything is sent, so events survive restarts.
 * (ingest_key, event_id) is unique: re-enqueuing the same event is a no-op.
 *
 * The full ingest key is stored so events can be sent after a restart even if
 * the key came from a request header. The file is created with mode 0600.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { UsageEvent } from "./types.js";

export interface QueuedEvent {
  id: number;
  key: string;
  eventId: string;
  payload: string;
  enqueuedAt: number;
}

export class EventQueue {
  private db: Database.Database;

  constructor(file: string) {
    if (file !== ":memory:") {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      if (!fs.existsSync(file)) fs.writeFileSync(file, "", { mode: 0o600 });
    }
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = FULL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ingest_key TEXT NOT NULL,
        event_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        enqueued_at INTEGER NOT NULL,
        UNIQUE (ingest_key, event_id)
      );
      CREATE INDEX IF NOT EXISTS events_key_id ON events (ingest_key, id);
    `);
  }

  /** Returns true when inserted, false when the same (key, eventId) is already queued. */
  enqueue(key: string, event: UsageEvent, now: number = Date.now()): boolean {
    const r = this.db
      .prepare("INSERT OR IGNORE INTO events (ingest_key, event_id, payload, enqueued_at) VALUES (?, ?, ?, ?)")
      .run(key, event.eventId, JSON.stringify(event), now);
    return r.changes > 0;
  }

  keys(): string[] {
    return (this.db.prepare("SELECT DISTINCT ingest_key AS k FROM events").all() as { k: string }[]).map((r) => r.k);
  }

  count(key?: string): number {
    const row = key
      ? (this.db.prepare("SELECT COUNT(*) AS c FROM events WHERE ingest_key = ?").get(key) as { c: number })
      : (this.db.prepare("SELECT COUNT(*) AS c FROM events").get() as { c: number });
    return row.c;
  }

  oldestEnqueuedAt(key: string): number | null {
    const row = this.db.prepare("SELECT MIN(enqueued_at) AS t FROM events WHERE ingest_key = ?").get(key) as {
      t: number | null;
    };
    return row.t;
  }

  peek(key: string, limit: number): QueuedEvent[] {
    return (
      this.db
        .prepare(
          "SELECT id, ingest_key AS key, event_id AS eventId, payload, enqueued_at AS enqueuedAt FROM events WHERE ingest_key = ? ORDER BY id LIMIT ?",
        )
        .all(key, limit) as QueuedEvent[]
    );
  }

  remove(ids: number[]): void {
    if (ids.length === 0) return;
    const stmt = this.db.prepare("DELETE FROM events WHERE id = ?");
    this.db.transaction((list: number[]) => {
      for (const id of list) stmt.run(id);
    })(ids);
  }

  close(): void {
    this.db.close();
  }
}
