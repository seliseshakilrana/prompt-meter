/**
 * OpenAI adapter: Responses API (/v1/responses, used by Codex) and Chat Completions
 * (/v1/chat/completions).
 *
 * NOT YET VERIFIED AGAINST LIVE RESPONSES. Built from the public API reference;
 * to be checked against real Codex traffic in Phase 4 (PLAN.md).
 *
 * Normalization (PLAN.md -> Token normalization):
 * - totalInput = input_tokens                (chat: prompt_tokens)
 * - uncached   = input_tokens - cached_tokens
 * - cacheRead  = input_tokens_details.cached_tokens   (chat: prompt_tokens_details.cached_tokens)
 * - cacheWrite = 0 (not reported)
 * - output     = output_tokens (includes reasoning)   (chat: completion_tokens)
 * - thinking   = output_tokens_details.reasoning_tokens (chat: completion_tokens_details.reasoning_tokens)
 * - serverTools = 0, speed = null
 * Streaming: Responses -> `response.completed` (or `response.incomplete`) event's `response.usage`;
 * Chat -> the final chunk's `usage` (only present when the client asked for
 * `stream_options.include_usage`; otherwise nothing is recorded).
 */
import type { Adapter, ExtractedUsage, RequestInfo } from "../types.js";
import { headerValue, isObject, looksLikeSse, n, nOrNull, sseJson, str, tryJson } from "../util.js";
import { typedFromTexts } from "../heuristics/typed-text.js";

function responsesUsage(resp: Record<string, unknown>): ExtractedUsage | null {
  if (!isObject(resp.usage)) return null;
  const u = resp.usage;
  const total = n(u.input_tokens);
  const itd = isObject(u.input_tokens_details) ? u.input_tokens_details : {};
  const otd = isObject(u.output_tokens_details) ? u.output_tokens_details : {};
  const cached = Math.min(n(itd.cached_tokens), total);
  return {
    responseId: str(resp.id),
    model: str(resp.model),
    totalInputTokens: total,
    uncachedInputTokens: total - cached,
    cacheReadTokens: cached,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    outputTokens: n(u.output_tokens),
    thinkingTokens: nOrNull(otd.reasoning_tokens),
    serverToolRequests: 0,
    speed: null,
  };
}

function chatUsage(id: string | null, model: string | null, u: Record<string, unknown>): ExtractedUsage {
  const total = n(u.prompt_tokens);
  const ptd = isObject(u.prompt_tokens_details) ? u.prompt_tokens_details : {};
  const ctd = isObject(u.completion_tokens_details) ? u.completion_tokens_details : {};
  const cached = Math.min(n(ptd.cached_tokens), total);
  return {
    responseId: id,
    model,
    totalInputTokens: total,
    uncachedInputTokens: total - cached,
    cacheReadTokens: cached,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    outputTokens: n(u.completion_tokens),
    thinkingTokens: nOrNull(ctd.reasoning_tokens),
    serverToolRequests: 0,
    speed: null,
  };
}

function isResponsesPath(pathname: string): boolean {
  return /\/responses\/?$/.test(pathname);
}

function isChatPath(pathname: string): boolean {
  return /\/chat\/completions\/?$/.test(pathname);
}

function contentTexts(content: unknown): string[] {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  return content
    .filter(
      (p): p is Record<string, unknown> =>
        isObject(p) && (p.type === "input_text" || p.type === "text") && typeof p.text === "string",
    )
    .map((p) => p.text as string);
}

export const openaiAdapter: Adapter = {
  provider: "openai",

  isGenerationCall(method, pathname) {
    return method === "POST" && (isResponsesPath(pathname) || isChatPath(pathname));
  },

  parseRequest(body, pathname, headers): RequestInfo {
    const info: RequestInfo = {
      typedText: null,
      messageCount: 0,
      requestModel: null,
      systemText: "",
      hasTools: false,
      sessionMarker: null,
    };
    // Codex sends a conversation/session id header (unverified; Phase 4).
    info.sessionMarker =
      headerValue(headers, "session_id") ?? headerValue(headers, "conversation_id") ?? headerValue(headers, "x-session-id") ?? null;
    if (!isObject(body)) return info;
    info.requestModel = str(body.model);
    info.hasTools = Array.isArray(body.tools) && body.tools.length > 0;

    if (isResponsesPath(pathname)) {
      if (typeof body.instructions === "string") info.systemText = body.instructions;
      if (typeof body.input === "string") {
        info.messageCount = 1;
        info.typedText = typedFromTexts([body.input]);
        return info;
      }
      const items = Array.isArray(body.input) ? body.input : [];
      info.messageCount = items.length;
      // The newest item decides: a user message with text -> typed; a tool output -> follow-up.
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (!isObject(it)) continue;
        const type = it.type ?? "message";
        if (type === "message" && (it.role === "system" || it.role === "developer")) {
          continue;
        }
        if (type === "message" && it.role === "user") {
          const typed = typedFromTexts(contentTexts(it.content));
          if (typed === null) continue; // injected context (e.g. <environment_context>); keep looking
          info.typedText = typed;
          break;
        }
        break; // function_call_output, assistant message, reasoning, ... -> not a typed turn
      }
      return info;
    }

    // Chat Completions
    const messages = Array.isArray(body.messages) ? body.messages : [];
    info.messageCount = messages.length;
    info.systemText = messages
      .filter((m): m is Record<string, unknown> => isObject(m) && (m.role === "system" || m.role === "developer"))
      .flatMap((m) => contentTexts(m.content))
      .join("\n");
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (!isObject(m) || m.role === "system" || m.role === "developer") continue;
      if (m.role === "user") info.typedText = typedFromTexts(contentTexts(m.content));
      break; // tool / assistant newest -> not typed
    }
    return info;
  },

  parseResponse(body, contentType, pathname) {
    const text = body.toString("utf8");
    if (isResponsesPath(pathname)) {
      if (looksLikeSse(contentType, text)) {
        let found: ExtractedUsage | null = null;
        for (const { json } of sseJson(text)) {
          if (
            isObject(json) &&
            (json.type === "response.completed" || json.type === "response.incomplete") &&
            isObject(json.response)
          ) {
            found = responsesUsage(json.response) ?? found;
          }
        }
        return found;
      }
      const json = tryJson(text);
      if (!isObject(json) || json.object !== "response") return null;
      return responsesUsage(json);
    }
    // Chat Completions
    if (looksLikeSse(contentType, text)) {
      let id: string | null = null;
      let model: string | null = null;
      let usage: Record<string, unknown> | null = null;
      for (const { json } of sseJson(text)) {
        if (!isObject(json)) continue;
        id = str(json.id) ?? id;
        model = str(json.model) ?? model;
        if (isObject(json.usage)) usage = json.usage;
      }
      return usage ? chatUsage(id, model, usage) : null;
    }
    const json = tryJson(text);
    if (!isObject(json) || !isObject(json.usage)) return null;
    return chatUsage(str(json.id), str(json.model), json.usage);
  },
};
