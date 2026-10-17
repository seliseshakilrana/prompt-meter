import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { startApp } from "../src/app.js";
import { defaultConfig } from "../src/config.js";
import { createProxyServer } from "../src/proxy.js";
import { MemorySink } from "../src/sinks.js";
import type { UsageEvent } from "../src/types.js";
import { openaiResponsesStream } from "./fixtures.js";
import { postJson, sleep, startMock } from "./helpers.js";

const KEY = "pm_aaaaaaaa_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("end to end", () => {
  it("proxy -> disk queue -> sender -> mock ingest webhook", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-e2e-"));
    const upstream = await startMock((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(openaiResponsesStream());
    });
    const ingest = await startMock((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ accepted: 1, duplicates: 0, rejected: [] }));
    });
    const app = await startApp({
      ...defaultConfig(),
      port: 0,
      upstreams: { anthropic: upstream.url, openai: upstream.url, gemini: upstream.url },
      ingestUrl: ingest.url + "/ingest",
      defaultKey: KEY,
      queuePath: path.join(dir, "queue.db"),
      flushIntervalMs: 50,
    });
    try {
      const res = await postJson(`http://127.0.0.1:${app.port}/openai/v1/responses`, { model: "gpt-5.1-codex", input: "write a haiku", stream: true }, {
        "user-agent": "codex_cli_rs/0.50.0",
      });
      expect(res.status).toBe(200);
      for (let i = 0; i < 60 && ingest.requests.length === 0; i++) await sleep(50);
      expect(ingest.requests).toHaveLength(1);
      const r = ingest.requests[0]!;
      expect(r.url).toBe("/ingest");
      expect(r.headers["x-ingest-key"]).toBe(KEY);
      const body = JSON.parse(r.body.toString()) as { events: UsageEvent[] };
      expect(body.events[0]).toMatchObject({ tool: "codex", provider: "openai", promptPreview: "write a haiku", totalInputTokens: 5000 });
      for (let i = 0; i < 20 && app.queue!.count() > 0; i++) await sleep(20);
      expect(app.queue!.count()).toBe(0);
    } finally {
      await app.stop();
      await upstream.close();
      await ingest.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never delays the request: upstream sees the request before the client finishes the body", async () => {
    let sawRequestEarly = false;
    let releaseClient!: () => void;
    const clientMayFinish = new Promise<void>((r) => (releaseClient = r));
    const upstream = http.createServer((req, res) => {
      // Called on headers. Wait for the first body chunk, then let the client send the rest.
      req.once("data", () => {
        sawRequestEarly = true;
        releaseClient();
      });
      req.on("end", () => res.end("{}"));
      req.resume();
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", () => r()));
    const up = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    const proxy = createProxyServer({
      config: { upstreams: { anthropic: up, openai: up, gemini: up }, defaultKey: null, keys: {}, sendPreview: true, sessionGapMinutes: 30 },
      sink: new MemorySink(),
    });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", () => r()));
    const port = (proxy.address() as AddressInfo).port;
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.request({ port, host: "127.0.0.1", method: "POST", path: "/anthropic/v1/messages", agent: false }, (res) => {
          res.resume();
          res.on("end", resolve);
        });
        req.on("error", reject);
        req.write('{"messages":[{"role":"user","content":"part one');
        void clientMayFinish.then(() => req.end(' part two"}]}'));
        setTimeout(() => reject(new Error("upstream never saw the first chunk")), 3000).unref();
      });
      expect(sawRequestEarly).toBe(true);
    } finally {
      await new Promise<void>((r) => {
        proxy.close(() => r());
        proxy.closeAllConnections();
      });
      await new Promise<void>((r) => {
        upstream.close(() => r());
        upstream.closeAllConnections();
      });
    }
  });
});
