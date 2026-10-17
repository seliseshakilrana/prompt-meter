import type { Adapter } from "../types.js";
import { anthropicAdapter } from "./anthropic.js";
import { geminiAdapter } from "./gemini.js";
import { openaiAdapter } from "./openai.js";

/** Route name (first path segment on the proxy) -> adapter. */
export type RouteName = "anthropic" | "openai" | "gemini";

export const ADAPTERS: Record<RouteName, Adapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  gemini: geminiAdapter,
};

export { anthropicAdapter, geminiAdapter, openaiAdapter };
