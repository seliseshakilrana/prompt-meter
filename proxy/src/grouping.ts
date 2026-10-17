/**
 * Grouping calls into sessions and prompts.
 *
 * - sessionId: the tool's own session marker when it sends one (Claude Code
 *   `metadata.user_id`), otherwise a new id after an inactivity gap
 *   (default 30 min) per provider + ingest key.
 * - promptId: a new prompt starts when the newest user message contains typed
 *   text and the call is not a background call. Tool-result follow-ups and
 *   background calls attach to the current prompt of the same session.
 *   A retry of the same request (same typed text, same message count) keeps the
 *   same prompt.
 * - callIndex: 0, 1, 2… over the recorded calls of a prompt.
 */
import { randomUUID } from "node:crypto";
import type { Provider } from "./types.js";
import { sha256Hex } from "./util.js";

export interface PromptState {
  promptId: string;
  /** Raw typed text that started the prompt (cleaned into a preview later). */
  text: string | null;
  fingerprint: string | null;
  nextCallIndex: number;
}

export interface Assignment {
  sessionId: string;
  prompt: PromptState;
}

interface Lane {
  current: PromptState | null;
  lastSeen: number;
}

interface GapSession {
  sessionId: string;
  lastSeen: number;
}

export interface ClassifyInput {
  provider: Provider;
  key: string | null;
  sessionMarker: string | null;
  typedText: string | null;
  messageCount: number;
  background: boolean;
  now?: number;
}

const LANE_TTL_MS = 24 * 60 * 60 * 1000;

export class PromptTracker {
  private lanes = new Map<string, Lane>();
  private gapSessions = new Map<string, GapSession>();
  private lastGc = 0;

  constructor(private readonly sessionGapMs: number = 30 * 60 * 1000) {}

  classify(input: ClassifyInput): Assignment {
    const now = input.now ?? Date.now();
    this.gc(now);
    const owner = `${input.provider}|${input.key ?? ""}`;
    const sessionId = input.sessionMarker ?? this.gapSession(owner, now);
    const laneId = `${owner}|${sessionId}`;
    let lane = this.lanes.get(laneId);
    if (!lane) {
      lane = { current: null, lastSeen: now };
      this.lanes.set(laneId, lane);
    }
    lane.lastSeen = now;

    if (input.typedText && !input.background) {
      const fp = sha256Hex(`${input.messageCount}|${input.typedText}`);
      if (!lane.current || lane.current.fingerprint !== fp) {
        lane.current = { promptId: randomUUID(), text: input.typedText, fingerprint: fp, nextCallIndex: 0 };
      }
    } else if (!lane.current) {
      // A follow-up or background call with no prompt to attach to (e.g. proxy restarted mid-session).
      lane.current = { promptId: randomUUID(), text: input.typedText, fingerprint: null, nextCallIndex: 0 };
    }
    return { sessionId, prompt: lane.current };
  }

  /** Reserve the next callIndex of a prompt (called when an event is actually recorded). */
  static nextCallIndex(prompt: PromptState): number {
    return prompt.nextCallIndex++;
  }

  private gapSession(owner: string, now: number): string {
    const s = this.gapSessions.get(owner);
    if (s && now - s.lastSeen <= this.sessionGapMs) {
      s.lastSeen = now;
      return s.sessionId;
    }
    const fresh = { sessionId: randomUUID(), lastSeen: now };
    this.gapSessions.set(owner, fresh);
    return fresh.sessionId;
  }

  private gc(now: number): void {
    if (now - this.lastGc < 60_000) return;
    this.lastGc = now;
    for (const [id, lane] of this.lanes) if (now - lane.lastSeen > LANE_TTL_MS) this.lanes.delete(id);
    for (const [id, s] of this.gapSessions) if (now - s.lastSeen > LANE_TTL_MS) this.gapSessions.delete(id);
  }
}
