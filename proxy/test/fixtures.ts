/** Realistic provider payloads (shapes from the public API references). */
import { sse } from "./helpers.js";

// ---------- Anthropic ----------

export const anthropicMessage = {
  id: "msg_01XFDUDYJgAACzvnptvVoYEL",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5-20260901",
  content: [{ type: "text", text: "Hello!" }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: {
    input_tokens: 12,
    cache_creation_input_tokens: 3000,
    cache_read_input_tokens: 20000,
    cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 2000 },
    output_tokens: 250,
    server_tool_use: { web_search_requests: 2, web_fetch_requests: 1 },
    service_tier: "standard",
    speed: "fast",
  },
};

export function anthropicStream(opts: { id?: string; deltas?: number[] } = {}): string {
  const id = opts.id ?? "msg_01StreamABC";
  const deltas = opts.deltas ?? [5, 120, 310];
  return sse([
    {
      event: "message_start",
      data: {
        type: "message_start",
        message: {
          id,
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-5-20250929",
          content: [],
          stop_reason: null,
          usage: {
            input_tokens: 8,
            cache_creation_input_tokens: 1500,
            cache_read_input_tokens: 40000,
            cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1500 },
            output_tokens: 1,
            service_tier: "standard",
          },
        },
      },
    },
    { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } },
    { event: "ping", data: { type: "ping" } },
    ...deltas.flatMap((out, i) => [
      { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: `part${i}` } } },
      {
        event: "message_delta",
        data: { type: "message_delta", delta: { stop_reason: i === deltas.length - 1 ? "end_turn" : null }, usage: { output_tokens: out } },
      },
    ]),
    { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
    { event: "message_stop", data: { type: "message_stop" } },
  ]);
}

// ---------- OpenAI ----------

export const openaiResponse = {
  id: "resp_67ccd2bed1ec8190b14f964abc0542670bb6a6b452d3795b",
  object: "response",
  created_at: 1741476542,
  status: "completed",
  model: "gpt-5.1-codex-2026-08-01",
  output: [{ type: "message", id: "msg_1", role: "assistant", content: [{ type: "output_text", text: "Hi" }] }],
  usage: {
    input_tokens: 5000,
    input_tokens_details: { cached_tokens: 4096 },
    output_tokens: 900,
    output_tokens_details: { reasoning_tokens: 640 },
    total_tokens: 5900,
  },
};

export function openaiResponsesStream(): string {
  return sse([
    { event: "response.created", data: { type: "response.created", sequence_number: 0, response: { ...openaiResponse, status: "in_progress", usage: null } } },
    { event: "response.output_text.delta", data: { type: "response.output_text.delta", sequence_number: 1, delta: "Hi" } },
    { event: "response.completed", data: { type: "response.completed", sequence_number: 2, response: openaiResponse } },
  ]);
}

export const openaiChat = {
  id: "chatcmpl-B9MHDbslfkBeAs8l4bebGdFOJ6PeG",
  object: "chat.completion",
  created: 1741570283,
  model: "gpt-4o-2024-08-06",
  choices: [{ index: 0, message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }],
  usage: {
    prompt_tokens: 1117,
    completion_tokens: 46,
    total_tokens: 1163,
    prompt_tokens_details: { cached_tokens: 1024, audio_tokens: 0 },
    completion_tokens_details: { reasoning_tokens: 0 },
  },
};

export function openaiChatStream(withUsage = true): string {
  const base = { id: openaiChat.id, object: "chat.completion.chunk", created: 1741570283, model: openaiChat.model };
  return sse([
    { data: { ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" } }], usage: null } },
    { data: { ...base, choices: [{ index: 0, delta: { content: "Hello" } }], usage: null } },
    { data: { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: null } },
    ...(withUsage ? [{ data: { ...base, choices: [], usage: openaiChat.usage } }] : []),
    { data: "[DONE]" },
  ]);
}

// ---------- Gemini ----------

export const geminiResponse = {
  candidates: [{ content: { role: "model", parts: [{ text: "Hello" }] }, finishReason: "STOP", index: 0 }],
  usageMetadata: {
    promptTokenCount: 10000,
    candidatesTokenCount: 300,
    thoughtsTokenCount: 700,
    cachedContentTokenCount: 8000,
    totalTokenCount: 11000,
  },
  modelVersion: "gemini-2.5-pro",
  responseId: "abc123GeminiResp",
};

function geminiChunks(withId = true) {
  const meta = (cand: number) => ({ promptTokenCount: 10000, candidatesTokenCount: cand, thoughtsTokenCount: 700, cachedContentTokenCount: 8000 });
  const id = withId ? { responseId: "streamResp42" } : {};
  return [
    { candidates: [{ content: { role: "model", parts: [{ text: "Hel" }] } }], usageMetadata: meta(10), modelVersion: "gemini-2.5-pro", ...id },
    { candidates: [{ content: { role: "model", parts: [{ text: "lo" }] } }], usageMetadata: meta(150), modelVersion: "gemini-2.5-pro", ...id },
    { candidates: [{ content: { role: "model", parts: [{ text: "!" }] }, finishReason: "STOP" }], usageMetadata: meta(300), modelVersion: "gemini-2.5-pro", ...id },
  ];
}

export function geminiSseStream(withId = true): string {
  return sse(geminiChunks(withId).map((d) => ({ data: d })));
}

export function geminiJsonArrayStream(withId = true): string {
  return "[" + geminiChunks(withId).map((c) => JSON.stringify(c, null, 2)).join(",\r\n") + "]";
}
