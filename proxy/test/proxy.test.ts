import http from "node:http";
import zlib from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { anthropicMessage, anthropicStream, geminiJsonArrayStream, openaiResponse } from "./fixtures.js";
import { type MockServer, type TestProxy, postJson, send, sleep, startMock, startProxy } from "./helpers.js";

const KEY_A = "pm_aaaaaaaa_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const KEY_B = "pm_bbbbbbbb_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

let upstream: MockServer | null = null;
let proxy: TestProxy | null = null;

afterEach(async () => {
  await proxy?.close();
  await upstream?.close();
  proxy = null;
  upstream = null;
});

const userReq = (text: string) => ({ model: "claude-opus-5-5", max_tokens: 100, tools: [{ name: "Bash" }], messages: [{ role: "user", content: text }] });

describe("transparent passthrough", () => {
  it("forwards method, path, query, headers and body unchanged; returns status and body byte-identical", async () => {
    const respBody = Buffer.from([0, 1, 2, 250, 251, 252, 13, 10, 0x7b]);
    upstream = await startMock((_req, res) => {
      res.writeHead(418, { "content-type": "application/octet-stream", "x-upstream": "yes", "set-cookie": ["a=1", "b=2"] });
      res.end(respBody);
    });
    proxy = await startProxy(upstream.url);
    const reqBody = Buffer.from('{"weird": "bytes é☃", "n": 1}\n');
    const res = await send(`${proxy.url}/anthropic/v1/some/path?x=1&y=%20z`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-api-key": "sk-ant-test",
        authorization: "Bearer test-token",
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
        "x-goog-api-key": "g-key",
        "accept-encoding": "gzip, br",
        "X-Prompt-Meter-Key": KEY_A,
        "keep-alive": "timeout=5",
        connection: "keep-alive, x-hop",
        "x-hop": "drop-me",
      },
      body: reqBody,
    });
    expect(res.status).toBe(418);
    expect(res.body.equals(respBody)).toBe(true);
    expect(res.headers["x-upstream"]).toBe("yes");
    expect(res.headers["set-cookie"]).toEqual(["a=1", "b=2"]);

    const got = upstream.requests[0]!;
    expect(got.method).toBe("PUT");
    expect(got.url).toBe("/v1/some/path?x=1&y=%20z");
    expect(got.body.equals(reqBody)).toBe(true);
    expect(got.headers["x-api-key"]).toBe("sk-ant-test");
    expect(got.headers.authorization).toBe("Bearer test-token");
    expect(got.headers["anthropic-version"]).toBe("2023-06-01");
    expect(got.headers["anthropic-beta"]).toBe("prompt-caching-2024-07-31");
    expect(got.headers["x-goog-api-key"]).toBe("g-key");
    expect(got.headers["accept-encoding"]).toBe("gzip, br");
    expect(got.headers["x-prompt-meter-key"]).toBeUndefined();
    expect(got.headers["keep-alive"]).toBeUndefined();
    expect(got.headers["x-hop"]).toBeUndefined();
    expect(got.headers.host).toBe(new URL(upstream.url).host);
    expect(proxy.sink.events).toHaveLength(0); // not a generation call
  });

  it("routes each provider prefix and 404s unknown routes", async () => {
    upstream = await startMock((req, res) => res.end(req.url));
    proxy = await startProxy(upstream.url);
    expect((await send(`${proxy.url}/openai/v1/models`)).body.toString()).toBe("/v1/models");
    expect((await send(`${proxy.url}/gemini/v1beta/models?key=x`)).body.toString()).toBe("/v1beta/models?key=x");
    expect((await send(`${proxy.url}/nope/v1/models`)).status).toBe(404);
    expect((await send(`${proxy.url}/anthropicx/v1/models`)).status).toBe(404);
  });

  it("returns 502 when the upstream is unreachable", async () => {
    proxy = await startProxy("http://127.0.0.1:1");
    const res = await send(`${proxy.url}/anthropic/v1/messages`, { method: "POST", body: "{}" });
    expect(res.status).toBe(502);
  });

  it("streams without buffering: the client gets the first chunk before the upstream finishes", async () => {
    let releaseRest!: () => void;
    const rest = new Promise<void>((r) => (releaseRest = r));
    const full = anthropicStream();
    const cut = full.indexOf("event: content_block_start");
    upstream = await startMock(async (_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(full.slice(0, cut));
      await rest; // the upstream only finishes after the client has seen the first chunk
      res.end(full.slice(cut));
    });
    proxy = await startProxy(upstream.url, { defaultKey: KEY_A });

    const received: string[] = [];
    let firstChunkBeforeEnd = false;
    await new Promise<void>((resolve, reject) => {
      const req = http.request(`${proxy!.url}/anthropic/v1/messages`, { method: "POST", headers: { "content-type": "application/json" }, agent: false }, (res) => {
        res.on("data", (c: Buffer) => {
          if (received.length === 0) {
            firstChunkBeforeEnd = true;
            releaseRest();
          }
          received.push(c.toString());
        });
        res.on("end", resolve);
        res.on("error", reject);
      });
      req.on("error", reject);
      req.end(JSON.stringify({ ...userReq("hi"), stream: true }));
      setTimeout(() => reject(new Error("first chunk never arrived (buffered?)")), 3000).unref();
    });
    expect(firstChunkBeforeEnd).toBe(true);
    expect(received[0]).toBe(full.slice(0, cut));
    expect(received.join("")).toBe(full);
    await proxy.sink.waitFor(1);
    expect(proxy.sink.events[0]!.event.outputTokens).toBe(310);
  });

  it("passes a gzip response through byte-for-byte and reads usage from a decompressed copy", async () => {
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify(anthropicMessage)));
    upstream = await startMock((_req, res) => {
      res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip", "content-length": String(gz.length) });
      res.end(gz);
    });
    proxy = await startProxy(upstream.url, { defaultKey: KEY_A });
    const res = await postJson(`${proxy.url}/anthropic/v1/messages`, userReq("hello"), { "accept-encoding": "gzip" });
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("gzip");
    expect(res.body.equals(gz)).toBe(true);
    await proxy.sink.waitFor(1);
    const e = proxy.sink.events[0]!.event;
    expect(e.eventId).toBe(anthropicMessage.id);
    expect(e.cacheWrite5mTokens).toBe(1000);
    expect(e.cacheWrite1hTokens).toBe(2000);
    expect(e.totalInputTokens).toBe(23012);
  });

  it("passes a brotli-compressed Gemini JSON-array stream through and records it", async () => {
    const br = zlib.brotliCompressSync(Buffer.from(geminiJsonArrayStream()));
    upstream = await startMock((_req, res) => {
      res.writeHead(200, { "content-type": "application/json; charset=UTF-8", "content-encoding": "br" });
      res.end(br);
    });
    proxy = await startProxy(upstream.url, { defaultKey: KEY_A });
    const res = await postJson(
      `${proxy.url}/gemini/v1beta/models/gemini-2.5-pro:streamGenerateContent`,
      { contents: [{ role: "user", parts: [{ text: "hi gemini" }] }] },
      { "user-agent": "antigravity-cli/1.3.6", "x-goog-api-key": "AIzaFAKE" },
    );
    expect(res.body.equals(br)).toBe(true);
    await proxy.sink.waitFor(1);
    const e = proxy.sink.events[0]!.event;
    expect(e).toMatchObject({ provider: "google", tool: "antigravity-cli", eventId: "streamResp42", outputTokens: 1000, cacheReadTokens: 8000 });
  });
});

describe("what gets recorded", () => {
  it("records a full contract-shaped event for a generation call", async () => {
    upstream = await startMock((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(anthropicMessage));
    });
    proxy = await startProxy(upstream.url, { defaultKey: KEY_A });
    await postJson(`${proxy.url}/anthropic/v1/messages`, userReq("please fix the login bug"), { "user-agent": "claude-cli/2.1.0 (external, cli)" });
    await proxy.sink.waitFor(1);
    const { key, event } = proxy.sink.events[0]!;
    expect(key).toBe(KEY_A);
    expect(Object.keys(event).sort()).toEqual(
      [
        "eventId", "tool", "provider", "model", "sessionId", "promptId", "callIndex", "totalInputTokens", "uncachedInputTokens",
        "cacheReadTokens", "cacheWrite5mTokens", "cacheWrite1hTokens", "outputTokens", "thinkingTokens", "serverToolRequests",
        "speed", "promptPreview", "projectTag", "occurredAt",
      ].sort(),
    );
    expect(event).toMatchObject({
      tool: "claude-code",
      provider: "anthropic",
      model: "claude-opus-5-5-20260901",
      callIndex: 0,
      serverToolRequests: 3,
      speed: "fast",
      promptPreview: "please fix the login bug",
      projectTag: null,
    });
    expect(new Date(event.occurredAt).toISOString()).toBe(event.occurredAt);
  });

  it("does not record count_tokens, models, or error responses", async () => {
    upstream = await startMock((req, res) => {
      if (req.url.includes("count_tokens")) return res.end(JSON.stringify({ input_tokens: 42 }));
      if (req.url.includes("models")) return res.end(JSON.stringify({ data: [] }));
      if (req.url.includes("chat/completions")) {
        res.writeHead(429, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: { message: "rate limited" }, usage: { prompt_tokens: 5 } }));
      }
      res.writeHead(529, { "content-type": "application/json" });
      res.end(JSON.stringify({ ...anthropicMessage }));
    });
    proxy = await startProxy(upstream.url, { defaultKey: KEY_A });
    await postJson(`${proxy.url}/anthropic/v1/messages/count_tokens`, userReq("x"));
    await send(`${proxy.url}/anthropic/v1/models`);
    await send(`${proxy.url}/openai/v1/models`);
    await send(`${proxy.url}/gemini/v1beta/models`);
    expect((await postJson(`${proxy.url}/anthropic/v1/messages`, userReq("x"))).status).toBe(529);
    expect((await postJson(`${proxy.url}/openai/v1/chat/completions`, { messages: [] })).status).toBe(429);
    await sleep(100);
    expect(proxy.sink.events).toHaveLength(0);
  });

  it("strips X-Prompt-Meter-Key upstream and uses it to choose the key (header first, then default)", async () => {
    upstream = await startMock((_req, res) => res.end(JSON.stringify(openaiResponse)));
    proxy = await startProxy(upstream.url, { defaultKey: KEY_A });
    await postJson(`${proxy.url}/openai/v1/responses`, { input: "one" }, { "x-PROMPT-meter-KEY": KEY_B });
    await postJson(`${proxy.url}/openai/v1/responses`, { input: "two" });
    await proxy.sink.waitFor(2);
    expect(upstream.requests.every((r) => r.headers["x-prompt-meter-key"] === undefined)).toBe(true);
    expect(upstream.requests.every((r) => !r.rawHeaders.some((h) => h.toLowerCase() === "x-prompt-meter-key"))).toBe(true);
    expect(proxy.sink.events.map((e) => e.key)).toEqual([KEY_B, KEY_A]);
  });

  it("sends a null preview when previews are off for the key", async () => {
    upstream = await startMock((_req, res) => res.end(JSON.stringify(anthropicMessage)));
    proxy = await startProxy(upstream.url, { defaultKey: KEY_A, keys: { bbbbbbbb: { sendPreview: false } } });
    await postJson(`${proxy.url}/anthropic/v1/messages`, userReq("secret plans"), { "x-prompt-meter-key": KEY_B });
    await postJson(`${proxy.url}/anthropic/v1/messages`, userReq("public plans"));
    await proxy.sink.waitFor(2);
    expect(proxy.sink.events[0]!.event.promptPreview).toBeNull();
    expect(proxy.sink.events[1]!.event.promptPreview).toBe("public plans");
  });

  it("redacts and truncates the preview", async () => {
    upstream = await startMock((_req, res) => res.end(JSON.stringify(anthropicMessage)));
    proxy = await startProxy(upstream.url, { defaultKey: KEY_A });
    const text = "deploy   with\nkey sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789 and " + "then more words ".repeat(20);
    await postJson(`${proxy.url}/anthropic/v1/messages`, userReq(text));
    await proxy.sink.waitFor(1);
    const p = proxy.sink.events[0]!.event.promptPreview!;
    expect(p.startsWith("deploy with key [REDACTED] and then")).toBe(true);
    expect(Array.from(p).length).toBe(100);
    expect(p).not.toContain("sk-ant");
  });

  it("builds the contract fallback eventId when the provider gives none", async () => {
    const { responseId: _r, ...noId } = JSON.parse(geminiJsonArrayStream(false))[2];
    upstream = await startMock((_req, res) => res.end(JSON.stringify(noId)));
    proxy = await startProxy(upstream.url, { defaultKey: KEY_A });
    await postJson(`${proxy.url}/gemini/v1beta/models/gemini-2.5-pro:generateContent`, { contents: [{ parts: [{ text: "hi" }] }] });
    await proxy.sink.waitFor(1);
    const e = proxy.sink.events[0]!.event;
    const { createHash } = await import("node:crypto");
    const expected = "pm_" + createHash("sha256").update(`google${e.model}${e.occurredAt}${e.totalInputTokens}${e.outputTokens}`).digest("hex");
    expect(e.eventId).toBe(expected);
  });
});
