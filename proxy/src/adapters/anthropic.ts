/**
 * Anthropic Messages API adapter.
 *
 * Normalization (PLAN.md -> Token normalization):
 * - totalInput   = input_tokens + cache_creation_input_tokens + cache_read_input_tokens
 * - uncached     = input_tokens
 * - cacheRead    = cache_read_input_tokens
 * - cacheWrite5m = usage.cache_creation.ephemeral_5m_input_tokens
 *                  (falls back to cache_creation_input_tokens when the breakdown is absent)
 * - cacheWrite1h = usage.cache_creation.ephemeral_1h_input_tokens
 * - output       = output_tokens (includes thinking)
 * - thinking     = output_tokens_details.thinking_tokens, else null
 * - serverTools  = server_tool_use.web_search_requests + web_fetch_requests
 * - speed        = usage.speed
 * Streaming: message_start.message.usage, then fields overwritten by the LAST
 * message_delta.usage (its output_tokens is a running total; never summed).
 */
import type { Adapter, ExtractedUsage, RequestInfo, Speed } from "../types.js";
import { isObject, looksLikeSse, n, nOrNull, sseJson, str, tryJson } from "../util.js";
import { typedFromTexts } from "../heuristics/typed-text.js";

export function anthropicUsageToEvent(
  usage: Record<string, unknown>,
  responseId: string | null,
  model: string | null,
): ExtractedUsage {
  const input = n(usage.input_tokens);
  const cacheRead = n(usage.cache_read_input_tokens);
  const cc = isObject(usage.cache_creation) ? usage.cache_creation : null;
  let write5m: number;
  let write1h: number;
  if (cc && (cc.ephemeral_5m_input_tokens !== undefined || cc.ephemeral_1h_input_tokens !== undefined)) {
    write5m = n(cc.ephemeral_5m_input_tokens);
    write1h = n(cc.ephemeral_1h_input_tokens);
  } else {
    write5m = n(usage.cache_creation_input_tokens);
    write1h = 0;
  }
  const cacheCreation =
    usage.cache_creation_input_tokens !== undefined && usage.cache_creation_input_tokens !== null
      ? n(usage.cache_creation_input_tokens)
      : write5m + write1h;
  const stu = isObject(usage.server_tool_use) ? usage.server_tool_use : {};
  const otd = isObject(usage.output_tokens_details) ? usage.output_tokens_details : {};
  const speed: Speed = usage.speed === "fast" || usage.speed === "standard" ? usage.speed : null;
  return {
    responseId,
    model,
    totalInputTokens: input + cacheCreation + cacheRead,
    uncachedInputTokens: input,
    cacheReadTokens: cacheRead,
    cacheWrite5mTokens: write5m,
    cacheWrite1hTokens: write1h,
    outputTokens: n(usage.output_tokens),
    thinkingTokens: nOrNull(otd.thinking_tokens),
    serverToolRequests: n(stu.web_search_requests) + n(stu.web_fetch_requests),
    speed,
  };
}

function parseStream(text: string): ExtractedUsage | null {
  let id: string | null = null;
  let model: string | null = null;
  let usage: Record<string, unknown> | null = null;
  let lastDelta: Record<string, unknown> | null = null;
  let sawError = false;
  for (const { json } of sseJson(text)) {
    if (!isObject(json)) continue;
    if (json.type === "message_start" && isObject(json.message)) {
      id = str(json.message.id);
      model = str(json.message.model);
      usage = isObject(json.message.usage) ? { ...json.message.usage } : {};
    } else if (json.type === "message_delta" && isObject(json.usage)) {
      lastDelta = json.usage; // keep only the LAST one
    } else if (json.type === "error") {
      sawError = true;
    }
  }
  if (!usage) return null;
  if (sawError && !lastDelta) return null;
  if (lastDelta) {
    for (const [k, v] of Object.entries(lastDelta)) {
      if (v !== null && v !== undefined) usage[k] = v;
    }
  }
  return anthropicUsageToEvent(usage, id, model);
}

export const anthropicAdapter: Adapter = {
  provider: "anthropic",

  isGenerationCall(method, pathname) {
    return method === "POST" && /\/v1\/messages\/?$/.test(pathname);
  },

  parseRequest(body): RequestInfo {
    const info: RequestInfo = {
      typedText: null,
      messageCount: 0,
      requestModel: null,
      systemText: "",
      hasTools: false,
      sessionMarker: null,
    };
    if (!isObject(body)) return info;
    info.requestModel = str(body.model);
    info.hasTools = Array.isArray(body.tools) && body.tools.length > 0;
    if (typeof body.system === "string") info.systemText = body.system;
    else if (Array.isArray(body.system)) {
      info.systemText = body.system
        .map((b) => (isObject(b) && typeof b.text === "string" ? b.text : ""))
        .join("\n");
    }
    if (isObject(body.metadata) && typeof body.metadata.user_id === "string") {
      info.sessionMarker = claudeCodeSession(body.metadata.user_id);
    }
    const messages = Array.isArray(body.messages) ? body.messages : [];
    info.messageCount = messages.length;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (!isObject(m) || m.role !== "user") continue;
      if (typeof m.content === "string") info.typedText = typedFromTexts([m.content]);
      else if (Array.isArray(m.content)) {
        const texts = m.content
          .filter((b): b is Record<string, unknown> => isObject(b) && b.type === "text" && typeof b.text === "string")
          .map((b) => b.text as string);
        info.typedText = typedFromTexts(texts);
      }
      break; // only the newest user message counts
    }
    return info;
  },

  parseResponse(body, contentType) {
    const text = body.toString("utf8");
    if (looksLikeSse(contentType, text)) return parseStream(text);
    const json = tryJson(text);
    if (!isObject(json) || json.type !== "message" || !isObject(json.usage)) return null;
    return anthropicUsageToEvent(json.usage, str(json.id), str(json.model));
  },
};

/**
 * Claude Code puts a session marker in `metadata.user_id`. Seen formats:
 * `user_<hash>_account_<uuid>_session_<uuid>`, or a JSON string with `session_id`.
 * Returns the session part, or null when there is none (to be confirmed in Phase 3).
 */
export function claudeCodeSession(userId: string): string | null {
  const m = /session_([0-9a-zA-Z-]{8,})/.exec(userId);
  if (m) return m[1] ?? null;
  const j = tryJson(userId);
  if (isObject(j)) return str(j.session_id) ?? str(j.sessionId);
  return null;
}
