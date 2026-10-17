/**
 * Background-call detection: calls a tool makes on its own (subagent/Task calls,
 * title generation, topic detection, compaction, quota probes). They attach to the
 * prompt that is already running instead of starting a new prompt.
 *
 * These are heuristics. They are checked against real traffic in Phase 3 (Claude)
 * and Phase 4 (Codex, agy) and are kept here so they are easy to adjust.
 */
import type { Provider, RequestInfo } from "../types.js";

/** System-prompt / instruction fragments that mark a background call. */
const BACKGROUND_SYSTEM_PATTERNS: RegExp[] = [
  // Claude Code subagents (Task tool) and Agent SDK agents
  /You are an agent for Claude Code/i,
  // Title / topic generation
  /new conversation topic/i,
  /generate a (concise|short|brief)[^.]{0,60}\btitle\b/i,
  /\bisNewTopic\b/,
  // Compaction / summarization
  /summariz(e|ing) (the |this )?conversation/i,
  /tasked with summarizing/i,
  /create a detailed summary of the conversation/i,
];

/** Typed-text fragments that mark a background call (e.g. compaction requests sent as a user message). */
const BACKGROUND_USER_PATTERNS: RegExp[] = [
  /^Your task is to create a detailed summary of the conversation/i,
  /^Please write a 5-10 word title/i,
];

/** Small, fast side models typically used for background calls. */
const SMALL_MODEL: Record<Provider, RegExp> = {
  anthropic: /haiku/i,
  openai: /(-mini|-nano)\b/i,
  google: /flash-lite/i,
};

export function isBackgroundCall(provider: Provider, req: RequestInfo): boolean {
  if (BACKGROUND_SYSTEM_PATTERNS.some((re) => re.test(req.systemText))) return true;
  if (req.typedText && BACKGROUND_USER_PATTERNS.some((re) => re.test(req.typedText!.trim()))) return true;
  // A small side model with no tools is almost always a helper call
  // (a main agent loop declares tools). A user who picks a small model as
  // their main model still declares tools, so they are not caught by this.
  if (req.requestModel && SMALL_MODEL[provider].test(req.requestModel) && !req.hasTools) return true;
  return false;
}
