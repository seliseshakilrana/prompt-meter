import http from "node:http";
import type { AddressInfo } from "node:net";
import { createProxyServer } from "../src/proxy.js";
import { MemorySink } from "../src/sinks.js";
import { PromptTracker } from "../src/grouping.js";
import type { Config } from "../src/config.js";
import { setLogLevel } from "../src/log.js";

setLogLevel((process.env.PM_TEST_LOG as never) ?? "silent");

export interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  rawHeaders: string[];
  body: Buffer;
}

export interface MockServer {
  url: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

export type MockHandler = (req: RecordedRequest, res: http.ServerResponse) => void | Promise<void>;

/** A local HTTP server standing in for a provider API or the ingest webhook. */
export async function startMock(handler: MockHandler): Promise<MockServer> {
  const requests: RecordedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const rec: RecordedRequest = {
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        rawHeaders: req.rawHeaders,
        body: Buffer.concat(chunks),
      };
      requests.push(rec);
      void handler(rec, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections();
      }),
  };
}

export interface TestProxy {
  url: string;
  sink: MemorySink;
  tracker: PromptTracker;
  close(): Promise<void>;
}

export async function startProxy(
  upstreamUrl: string,
  config: Partial<Pick<Config, "defaultKey" | "keys" | "sendPreview" | "sessionGapMinutes">> = {},
): Promise<TestProxy> {
  const sink = new MemorySink();
  const tracker = new PromptTracker((config.sessionGapMinutes ?? 30) * 60_000);
  const server = createProxyServer({
    config: {
      upstreams: { anthropic: upstreamUrl, openai: upstreamUrl, gemini: upstreamUrl },
      defaultKey: config.defaultKey ?? null,
      keys: config.keys ?? {},
      sendPreview: config.sendPreview ?? true,
      sessionGapMinutes: config.sessionGapMinutes ?? 30,
    },
    sink,
    tracker,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    sink,
    tracker,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections();
      }),
  };
}

export interface ClientResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

/** Raw HTTP client (no automatic decompression). */
export function send(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string | Buffer } = {},
): Promise<ClientResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: opts.method ?? "GET", headers: opts.headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

export function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<ClientResponse> {
  return send(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

export function sse(events: { event?: string; data: unknown }[]): string {
  return events
    .map((e) => `${e.event ? `event: ${e.event}\n` : ""}data: ${typeof e.data === "string" ? e.data : JSON.stringify(e.data)}\n\n`)
    .join("");
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
