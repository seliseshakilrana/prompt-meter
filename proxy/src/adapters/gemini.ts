/**
 * Gemini API adapter (`*:generateContent`, `*:streamGenerateContent`), used by
 * Antigravity CLI in Gemini-API-key mode.
 *
 * NOT YET VERIFIED AGAINST LIVE RESPONSES. Built from the public API reference;
 * to be checked against real `agy` traffic in Phase 4 (PLAN.md).
 *
 * Normalization (PLAN.md -> Token normalization):
 * - totalInput = promptTokenCount (already includes cached)
 * - uncached   = promptTokenCount - cachedContentTokenCount
 * - cacheRead  = cachedContentTokenCount
 * - output     = candidatesTokenCount + thoughtsTokenCount
 *                (Phase 4: confirm candidatesTokenCount does not already include thoughts)
 * - thinking   = thoughtsTokenCount (null when absent)
 * Streaming: the last chunk that carries usageMetadata. Both stream forms are handled:
 * SSE (`alt=sse`) and the default JSON-array stream.
 * eventId: `responseId` when present, else the contract's fallback hash.
 */
import type { Adapter, ExtractedUsage, RequestInfo } from "../types.js";
import { isObject, looksLikeSse, n, nOrNull, sseJson, str, tryJson } from "../util.js";
import { typedFromTexts } from "../heuristics/typed-text.js";

const GEN_PATH = /\/models\/([^/:]+):(generateContent|streamGenerateContent)$/;

function fromChunk(chunk: Record<string, unknown>, fallbackModel: string | null): ExtractedUsage | null {
  if (!isObject(chunk.usageMetadata)) return null;
  const u = chunk.usageMetadata;
  const prompt = n(u.promptTokenCount);
  const cached = Math.min(n(u.cachedContentTokenCount), prompt);
  const thoughts = nOrNull(u.thoughtsTokenCount);
  return {
    responseId: str(chunk.responseId),
    model: str(chunk.modelVersion) ?? fallbackModel,
    totalInputTokens: prompt,
    uncachedInputTokens: prompt - cached,
    cacheReadTokens: cached,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    outputTokens: n(u.candidatesTokenCount) + (thoughts ?? 0),
    thinkingTokens: thoughts,
    serverToolRequests: 0,
    speed: null,
  };
}

function lastWithUsage(chunks: unknown[], fallbackModel: string | null): ExtractedUsage | null {
  let found: ExtractedUsage | null = null;
  let responseId: string | null = null;
  let model: string | null = null;
  for (const c of chunks) {
    if (!isObject(c)) continue;
    responseId = str(c.responseId) ?? responseId;
    model = str(c.modelVersion) ?? model;
    found = fromChunk(c, fallbackModel) ?? found;
  }
  if (!found) return null;
  return { ...found, responseId: found.responseId ?? responseId, model: found.model ?? model ?? fallbackModel };
}

function modelFromPath(pathname: string): string | null {
  const m = GEN_PATH.exec(pathname);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

export const geminiAdapter: Adapter = {
  provider: "google",

  isGenerationCall(method, pathname) {
    return method === "POST" && GEN_PATH.test(pathname);
  },

  parseRequest(body, pathname): RequestInfo {
    const info: RequestInfo = {
      typedText: null,
      messageCount: 0,
      requestModel: modelFromPath(pathname),
      systemText: "",
      hasTools: false,
      sessionMarker: null,
    };
    if (!isObject(body)) return info;
    info.hasTools = Array.isArray(body.tools) && body.tools.length > 0;
    const sys = body.systemInstruction ?? body.system_instruction;
    if (isObject(sys) && Array.isArray(sys.parts)) {
      info.systemText = sys.parts.map((p) => (isObject(p) && typeof p.text === "string" ? p.text : "")).join("\n");
    }
    const contents = Array.isArray(body.contents) ? body.contents : [];
    info.messageCount = contents.length;
    for (let i = contents.length - 1; i >= 0; i--) {
      const c = contents[i];
      if (!isObject(c) || (c.role !== undefined && c.role !== "user")) continue;
      const parts = Array.isArray(c.parts) ? c.parts : [];
      const texts = parts
        .filter((p): p is Record<string, unknown> => isObject(p) && typeof p.text === "string" && p.thought !== true)
        .map((p) => p.text as string);
      info.typedText = typedFromTexts(texts);
      break;
    }
    return info;
  },

  parseResponse(body, contentType, pathname) {
    const fallbackModel = modelFromPath(pathname);
    const text = body.toString("utf8");
    if (looksLikeSse(contentType, text)) {
      return lastWithUsage(
        sseJson(text).map((e) => e.json),
        fallbackModel,
      );
    }
    const json = tryJson(text);
    if (Array.isArray(json)) return lastWithUsage(json, fallbackModel);
    if (isObject(json)) return lastWithUsage([json], fallbackModel);
    return null;
  },
};
