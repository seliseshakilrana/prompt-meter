/** Shared types. The event shape mirrors docs/ingest-contract.md exactly. */

export type Provider = "anthropic" | "openai" | "google";
export type Tool = "claude-code" | "codex" | "antigravity-cli" | "api" | "other";
export type Speed = "standard" | "fast" | null;

/** One normalized usage event, exactly as sent to the ingest webhook. */
export interface UsageEvent {
  eventId: string;
  tool: Tool;
  provider: Provider;
  model: string;
  sessionId: string | null;
  promptId: string;
  callIndex: number;
  totalInputTokens: number;
  uncachedInputTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  outputTokens: number;
  thinkingTokens: number | null;
  serverToolRequests: number;
  speed: Speed;
  promptPreview: string | null;
  projectTag: string | null;
  /** Account the tool is signed in with on this machine (see accounts.ts), or null. */
  accountEmail: string | null;
  occurredAt: string;
}

/** What an adapter extracts from a completed provider response. */
export interface ExtractedUsage {
  /** Provider response id, or null when the provider gave none. */
  responseId: string | null;
  /** Model named in the response (falls back to request model only when the response has none). */
  model: string | null;
  totalInputTokens: number;
  uncachedInputTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  outputTokens: number;
  thinkingTokens: number | null;
  serverToolRequests: number;
  speed: Speed;
}

/** What an adapter extracts from the request body (read from a side copy). */
export interface RequestInfo {
  /** Newest typed user text (not tool results / injected context), or null. */
  typedText: string | null;
  /** Number of conversation messages/items; used to tell retries from repeated prompts. */
  messageCount: number;
  /** Model named in the request (used only for heuristics and as a last-resort fallback). */
  requestModel: string | null;
  /** Concatenated system prompt / instructions text (for background-call heuristics). */
  systemText: string;
  /** Whether the request declares tools. */
  hasTools: boolean;
  /** Tool-provided session marker, when present. */
  sessionMarker: string | null;
}

export interface Adapter {
  provider: Provider;
  /** True when this method+path is a real generation call that should be recorded. */
  isGenerationCall(method: string, pathname: string): boolean;
  /** Parse the request body (JSON). Must never throw. */
  parseRequest(body: unknown, pathname: string, headers: Record<string, string | string[] | undefined>): RequestInfo;
  /** Parse a completed, decompressed response body. Returns null when nothing should be recorded. */
  parseResponse(body: Buffer, contentType: string, pathname: string): ExtractedUsage | null;
}
