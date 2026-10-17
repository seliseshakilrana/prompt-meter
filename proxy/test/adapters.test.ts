import { describe, expect, it } from "vitest";
import { anthropicAdapter, geminiAdapter, openaiAdapter } from "../src/adapters/index.js";
import { claudeCodeSession } from "../src/adapters/anthropic.js";
import { inferTool } from "../src/heuristics/tool.js";
import { isBackgroundCall } from "../src/heuristics/background.js";
import {
  anthropicMessage,
  anthropicStream,
  geminiJsonArrayStream,
  geminiResponse,
  geminiSseStream,
  openaiChat,
  openaiChatStream,
  openaiResponse,
  openaiResponsesStream,
} from "./fixtures.js";

const buf = (v: unknown) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v));

describe("anthropic adapter", () => {
  it("normalizes a non-streaming message with the 5m/1h cache split", () => {
    const u = anthropicAdapter.parseResponse(buf(anthropicMessage), "application/json", "/v1/messages")!;
    expect(u).toEqual({
      responseId: "msg_01XFDUDYJgAACzvnptvVoYEL",
      model: "claude-opus-5-5-20260901",
      totalInputTokens: 12 + 3000 + 20000,
      uncachedInputTokens: 12,
      cacheReadTokens: 20000,
      cacheWrite5mTokens: 1000,
      cacheWrite1hTokens: 2000,
      outputTokens: 250,
      thinkingTokens: null,
      serverToolRequests: 3,
      speed: "fast",
    });
  });

  it("falls back to cache_creation_input_tokens as 5m when the breakdown is absent", () => {
    const usage = { input_tokens: 1, cache_creation_input_tokens: 700, cache_read_input_tokens: 0, output_tokens: 2 };
    const u = anthropicAdapter.parseResponse(buf({ ...anthropicMessage, usage }), "application/json", "/v1/messages")!;
    expect(u.cacheWrite5mTokens).toBe(700);
    expect(u.cacheWrite1hTokens).toBe(0);
    expect(u.totalInputTokens).toBe(701);
    expect(u.speed).toBeNull();
    expect(u.serverToolRequests).toBe(0);
  });

  it("reads thinking tokens only when output_tokens_details is present", () => {
    const usage = { ...anthropicMessage.usage, output_tokens_details: { thinking_tokens: 99 } };
    const u = anthropicAdapter.parseResponse(buf({ ...anthropicMessage, usage }), "application/json", "/v1/messages")!;
    expect(u.thinkingTokens).toBe(99);
  });

  it("streaming: message_start usage + LAST message_delta output (not summed)", () => {
    const u = anthropicAdapter.parseResponse(buf(anthropicStream({ deltas: [5, 120, 310] })), "text/event-stream", "/v1/messages")!;
    expect(u.outputTokens).toBe(310); // not 5+120+310
    expect(u.uncachedInputTokens).toBe(8);
    expect(u.cacheReadTokens).toBe(40000);
    expect(u.cacheWrite1hTokens).toBe(1500);
    expect(u.cacheWrite5mTokens).toBe(0);
    expect(u.totalInputTokens).toBe(8 + 1500 + 40000);
    expect(u.responseId).toBe("msg_01StreamABC");
    expect(u.model).toBe("claude-sonnet-4-5-20250929");
  });

  it("ignores non-message bodies (e.g. count_tokens result, errors)", () => {
    expect(anthropicAdapter.parseResponse(buf({ input_tokens: 10 }), "application/json", "/v1/messages")).toBeNull();
    expect(
      anthropicAdapter.parseResponse(buf({ type: "error", error: { type: "overloaded_error" } }), "application/json", "/v1/messages"),
    ).toBeNull();
  });

  it("only treats POST /v1/messages as a generation call", () => {
    expect(anthropicAdapter.isGenerationCall("POST", "/v1/messages")).toBe(true);
    expect(anthropicAdapter.isGenerationCall("POST", "/v1/messages/count_tokens")).toBe(false);
    expect(anthropicAdapter.isGenerationCall("GET", "/v1/models")).toBe(false);
    expect(anthropicAdapter.isGenerationCall("POST", "/v1/messages/batches")).toBe(false);
  });

  it("parses the request: typed text vs tool results, system-reminders, session marker", () => {
    const info = anthropicAdapter.parseRequest(
      {
        model: "claude-opus-5-5",
        system: [{ type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." }],
        tools: [{ name: "Bash" }],
        metadata: { user_id: "user_abc123_account_11111111-2222-3333-4444-555555555555_session_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
        messages: [
          { role: "user", content: "first" },
          { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] },
          {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "t1", content: "ok" },
              { type: "text", text: "<system-reminder>Do the thing</system-reminder>" },
            ],
          },
        ],
      },
      "/v1/messages",
      {},
    );
    expect(info.typedText).toBeNull();
    expect(info.hasTools).toBe(true);
    expect(info.messageCount).toBe(3);
    expect(info.sessionMarker).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  it("extracts the session from a JSON user_id too", () => {
    expect(claudeCodeSession(JSON.stringify({ device_id: "d", session_id: "s-123" }))).toBe("s-123");
    expect(claudeCodeSession("user_abc")).toBeNull();
  });
});

describe("openai adapter", () => {
  it("normalizes a Responses API response", () => {
    const u = openaiAdapter.parseResponse(buf(openaiResponse), "application/json", "/v1/responses")!;
    expect(u).toMatchObject({
      responseId: openaiResponse.id,
      model: "gpt-5.1-codex-2026-08-01",
      totalInputTokens: 5000,
      uncachedInputTokens: 904,
      cacheReadTokens: 4096,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      outputTokens: 900,
      thinkingTokens: 640,
      serverToolRequests: 0,
      speed: null,
    });
  });

  it("reads response.completed from a Responses stream", () => {
    const u = openaiAdapter.parseResponse(buf(openaiResponsesStream()), "text/event-stream", "/v1/responses")!;
    expect(u.totalInputTokens).toBe(5000);
    expect(u.outputTokens).toBe(900);
  });

  it("normalizes chat completions (JSON and final stream chunk)", () => {
    const j = openaiAdapter.parseResponse(buf(openaiChat), "application/json", "/v1/chat/completions")!;
    expect(j).toMatchObject({ responseId: openaiChat.id, totalInputTokens: 1117, uncachedInputTokens: 93, cacheReadTokens: 1024, outputTokens: 46, thinkingTokens: 0 });
    const s = openaiAdapter.parseResponse(buf(openaiChatStream()), "text/event-stream", "/v1/chat/completions")!;
    expect(s).toEqual(j);
    expect(openaiAdapter.parseResponse(buf(openaiChatStream(false)), "text/event-stream", "/v1/chat/completions")).toBeNull();
  });

  it("request parsing: typed input vs function_call_output, injected environment context", () => {
    const typed = openaiAdapter.parseRequest(
      {
        model: "gpt-5.1-codex",
        instructions: "You are Codex",
        input: [
          { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>cwd</environment_context>" }] },
          { type: "message", role: "user", content: [{ type: "input_text", text: "fix the bug" }] },
        ],
      },
      "/v1/responses",
      { session_id: "conv-1" },
    );
    expect(typed.typedText).toBe("fix the bug");
    expect(typed.sessionMarker).toBe("conv-1");
    const followUp = openaiAdapter.parseRequest(
      { input: [{ type: "message", role: "user", content: "fix" }, { type: "function_call", call_id: "c" }, { type: "function_call_output", call_id: "c", output: "x" }] },
      "/v1/responses",
      {},
    );
    expect(followUp.typedText).toBeNull();
    const chatTool = openaiAdapter.parseRequest(
      { messages: [{ role: "user", content: "hi" }, { role: "assistant", tool_calls: [] }, { role: "tool", content: "r" }] },
      "/v1/chat/completions",
      {},
    );
    expect(chatTool.typedText).toBeNull();
  });
});

describe("gemini adapter", () => {
  it("normalizes generateContent", () => {
    const u = geminiAdapter.parseResponse(buf(geminiResponse), "application/json", "/v1beta/models/gemini-2.5-pro:generateContent")!;
    expect(u).toEqual({
      responseId: "abc123GeminiResp",
      model: "gemini-2.5-pro",
      totalInputTokens: 10000,
      uncachedInputTokens: 2000,
      cacheReadTokens: 8000,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      outputTokens: 1000,
      thinkingTokens: 700,
      serverToolRequests: 0,
      speed: null,
    });
  });

  it("uses the last usageMetadata chunk for SSE and JSON-array streams", () => {
    const p = "/v1beta/models/gemini-2.5-pro:streamGenerateContent";
    const a = geminiAdapter.parseResponse(buf(geminiSseStream()), "text/event-stream", p)!;
    const b = geminiAdapter.parseResponse(buf(geminiJsonArrayStream()), "application/json", p)!;
    expect(a.outputTokens).toBe(300 + 700);
    expect(a.responseId).toBe("streamResp42");
    expect(b).toEqual(a);
  });

  it("falls back to the model from the path and null responseId", () => {
    const { modelVersion: _m, responseId: _r, ...rest } = geminiResponse;
    const u = geminiAdapter.parseResponse(buf(rest), "application/json", "/v1beta/models/gemini-2.5-flash:generateContent")!;
    expect(u.model).toBe("gemini-2.5-flash");
    expect(u.responseId).toBeNull();
  });

  it("matches only generation paths", () => {
    expect(geminiAdapter.isGenerationCall("POST", "/v1beta/models/gemini-2.5-pro:streamGenerateContent")).toBe(true);
    expect(geminiAdapter.isGenerationCall("POST", "/v1beta/models/gemini-2.5-pro:countTokens")).toBe(false);
    expect(geminiAdapter.isGenerationCall("GET", "/v1beta/models")).toBe(false);
  });

  it("request parsing: functionResponse-only turn is not typed", () => {
    const info = geminiAdapter.parseRequest(
      { contents: [{ role: "user", parts: [{ text: "hi" }] }, { role: "model", parts: [{ functionCall: {} }] }, { role: "user", parts: [{ functionResponse: {} }] }] },
      "/v1beta/models/gemini-2.5-pro:generateContent",
      {},
    );
    expect(info.typedText).toBeNull();
    expect(info.requestModel).toBe("gemini-2.5-pro");
  });
});

describe("heuristics", () => {
  it("infers the tool from the user agent", () => {
    expect(inferTool("anthropic", "claude-cli/2.1.3 (external, cli)")).toBe("claude-code");
    expect(inferTool("anthropic", "Anthropic/Python 0.40.0")).toBe("api");
    expect(inferTool("openai", "codex_cli_rs/0.50.0 (Mac OS 26.0.0; arm64)")).toBe("codex");
    expect(inferTool("openai", undefined)).toBe("api");
    expect(inferTool("google", "antigravity-cli/1.3.6")).toBe("antigravity-cli");
    expect(inferTool("google", "google-genai-sdk/1.0")).toBe("api");
  });

  it("detects background calls", () => {
    const base = { typedText: "x", messageCount: 1, requestModel: "claude-opus-5-5", systemText: "", hasTools: true, sessionMarker: null };
    expect(isBackgroundCall("anthropic", base)).toBe(false);
    expect(isBackgroundCall("anthropic", { ...base, systemText: "You are an agent for Claude Code, Anthropic's official CLI" })).toBe(true);
    expect(isBackgroundCall("anthropic", { ...base, requestModel: "claude-haiku-4-5", hasTools: false })).toBe(true);
    expect(isBackgroundCall("anthropic", { ...base, requestModel: "claude-haiku-4-5", hasTools: true })).toBe(false);
    expect(isBackgroundCall("anthropic", { ...base, typedText: "Your task is to create a detailed summary of the conversation so far" })).toBe(true);
  });
});
