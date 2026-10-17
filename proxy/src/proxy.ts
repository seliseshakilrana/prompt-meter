/**
 * The transparent proxy.
 *
 *   /anthropic/*  -> upstreams.anthropic/*
 *   /openai/*     -> upstreams.openai/*
 *   /gemini/*     -> upstreams.gemini/*
 *
 * Method, path, query, headers and body are forwarded unchanged, except that
 * hop-by-hop headers and `X-Prompt-Meter-Key` are removed and `Host` is set to
 * the upstream. The request body is piped upstream immediately while a side copy
 * is kept for reading the preview. The response is piped back chunk by chunk,
 * byte for byte (compressed bodies stay compressed); a side copy is decompressed
 * and parsed only after the response has finished.
 */
import http from "node:http";
import https from "node:https";
import { ADAPTERS, type RouteName } from "./adapters/index.js";
import { type Config, previewEnabled } from "./config.js";
import { type Assignment, PromptTracker } from "./grouping.js";
import { isBackgroundCall } from "./heuristics/background.js";
import { inferTool } from "./heuristics/tool.js";
import { log } from "./log.js";
import { makePreview } from "./redact.js";
import type { EventSink } from "./sinks.js";
import type { Adapter, RequestInfo, UsageEvent } from "./types.js";
import { decodeBody, headerValue, sha256Hex } from "./util.js";

export const KEY_HEADER = "x-prompt-meter-key";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export interface ProxyOptions {
  config: Pick<Config, "upstreams" | "defaultKey" | "keys" | "sendPreview" | "sessionGapMinutes">;
  sink: EventSink;
  tracker?: PromptTracker;
  /** Side copies larger than this are not parsed (default 64 MB). */
  maxCaptureBytes?: number;
}

/** Filter a rawHeaders list: drop hop-by-hop headers (and those named in Connection) plus `extraDrop`. */
export function filterRawHeaders(raw: string[], extraDrop: Set<string>): string[] {
  const connectionListed = new Set<string>();
  for (let i = 0; i < raw.length; i += 2) {
    if (raw[i]!.toLowerCase() === "connection") {
      for (const t of raw[i + 1]!.split(",")) connectionListed.add(t.trim().toLowerCase());
    }
  }
  const out: string[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    const name = raw[i]!;
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || connectionListed.has(lower) || extraDrop.has(lower)) continue;
    out.push(name, raw[i + 1]!);
  }
  return out;
}

function rawToObject(raw: string[]): http.OutgoingHttpHeaders {
  const out: Record<string, string | string[]> = {};
  const canonical = new Map<string, string>();
  for (let i = 0; i < raw.length; i += 2) {
    const name = raw[i]!;
    const value = raw[i + 1]!;
    const lower = name.toLowerCase();
    const existing = canonical.get(lower);
    if (existing === undefined) {
      canonical.set(lower, name);
      out[name] = value;
    } else {
      const prev = out[existing]!;
      out[existing] = Array.isArray(prev) ? [...prev, value] : [prev, value];
    }
  }
  return out;
}

class Capture {
  private chunks: Buffer[] = [];
  private size = 0;
  overflow = false;
  constructor(private readonly max: number) {}
  push(chunk: Buffer): void {
    if (this.overflow) return;
    this.size += chunk.length;
    if (this.size > this.max) {
      this.overflow = true;
      this.chunks = [];
      return;
    }
    this.chunks.push(chunk);
  }
  get buffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

const EMPTY_INFO: RequestInfo = {
  typedText: null,
  messageCount: 0,
  requestModel: null,
  systemText: "",
  hasTools: false,
  sessionMarker: null,
};

export function createProxyServer(opts: ProxyOptions): http.Server {
  const tracker = opts.tracker ?? new PromptTracker(opts.config.sessionGapMinutes * 60 * 1000);
  const maxCapture = opts.maxCaptureBytes ?? 64 * 1024 * 1024;
  const httpAgent = new http.Agent({ keepAlive: true });
  const httpsAgent = new https.Agent({ keepAlive: true });

  const server = http.createServer((req, res) => {
    const rawUrl = req.url ?? "/";
    const qIdx = rawUrl.indexOf("?");
    const pathPart = qIdx === -1 ? rawUrl : rawUrl.slice(0, qIdx);
    const query = qIdx === -1 ? "" : rawUrl.slice(qIdx);

    if (pathPart === "/__prompt-meter/health") {
      res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
      return;
    }

    const m = /^\/(anthropic|openai|gemini)(\/.*)?$/.exec(pathPart);
    if (!m) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "prompt-meter-proxy: unknown route; use /anthropic, /openai or /gemini" }));
      return;
    }
    const route = m[1] as RouteName;
    const restPath = m[2] ?? "/";
    const adapter: Adapter = ADAPTERS[route];
    const base = new URL(opts.config.upstreams[route]);
    const upstreamPath = base.pathname.replace(/\/+$/, "") + restPath + query;
    const method = req.method ?? "GET";

    const headerKey = headerValue(req.headers, KEY_HEADER)?.trim();
    const ingestKey = headerKey || opts.config.defaultKey || null;

    const headers = rawToObject(filterRawHeaders(req.rawHeaders, new Set([KEY_HEADER, "host"])));
    headers.host = base.host;

    const record = adapter.isGenerationCall(method, restPath);
    const reqCapture = record ? new Capture(maxCapture) : null;
    const resCapture = record ? new Capture(maxCapture) : null;
    let assignment: Assignment | null = null;
    let reqInfo: RequestInfo = EMPTY_INFO;

    const classify = () => {
      if (assignment || !record) return;
      try {
        if (reqCapture && !reqCapture.overflow) {
          const decoded = decodeBody(reqCapture.buffer, headerValue(req.headers, "content-encoding"));
          const body: unknown = decoded.length ? JSON.parse(decoded.toString("utf8")) : undefined;
          reqInfo = adapter.parseRequest(body, restPath, req.headers);
        }
      } catch (err) {
        log.debug("could not parse request body", { error: String(err) });
      }
      assignment = tracker.classify({
        provider: adapter.provider,
        key: ingestKey,
        sessionMarker: reqInfo.sessionMarker,
        typedText: reqInfo.typedText,
        messageCount: reqInfo.messageCount,
        background: isBackgroundCall(adapter.provider, reqInfo),
      });
    };

    const isHttps = base.protocol === "https:";
    const upstreamReq = (isHttps ? https : http).request({
      protocol: base.protocol,
      hostname: base.hostname,
      port: base.port || (isHttps ? 443 : 80),
      method,
      path: upstreamPath,
      headers,
      agent: isHttps ? httpsAgent : httpAgent,
    });

    upstreamReq.on("response", (ures) => {
      const status = ures.statusCode ?? 502;
      res.writeHead(status, ures.statusMessage, filterRawHeaders(ures.rawHeaders, new Set()));
      res.flushHeaders();
      const capture = record && status >= 200 && status < 300 ? resCapture : null;
      if (capture) ures.on("data", (c: Buffer) => capture.push(c));
      ures.on("end", () => {
        if (!capture || capture.overflow) return;
        setImmediate(() => {
          try {
            classify();
            const decoded = decodeBody(capture.buffer, headerValue(ures.headers, "content-encoding"));
            const usage = adapter.parseResponse(decoded, headerValue(ures.headers, "content-type") ?? "", restPath);
            if (!usage || !assignment) return;
            const occurredAt = new Date().toISOString();
            const model = usage.model ?? reqInfo.requestModel ?? "unknown";
            const eventId =
              usage.responseId ??
              "pm_" + sha256Hex(adapter.provider + model + occurredAt + usage.totalInputTokens + usage.outputTokens);
            const event: UsageEvent = {
              eventId,
              tool: inferTool(adapter.provider, headerValue(req.headers, "user-agent")),
              provider: adapter.provider,
              model,
              sessionId: assignment.sessionId,
              promptId: assignment.prompt.promptId,
              callIndex: PromptTracker.nextCallIndex(assignment.prompt),
              totalInputTokens: usage.totalInputTokens,
              uncachedInputTokens: usage.uncachedInputTokens,
              cacheReadTokens: usage.cacheReadTokens,
              cacheWrite5mTokens: usage.cacheWrite5mTokens,
              cacheWrite1hTokens: usage.cacheWrite1hTokens,
              outputTokens: usage.outputTokens,
              thinkingTokens: usage.thinkingTokens,
              serverToolRequests: usage.serverToolRequests,
              speed: usage.speed,
              promptPreview: previewEnabled(opts.config, ingestKey) ? makePreview(assignment.prompt.text) : null,
              projectTag: null,
              occurredAt,
            };
            opts.sink.emit(ingestKey, event);
          } catch (err) {
            log.warn("could not record usage for a response", { route, path: restPath, error: String(err) });
          }
        });
      });
      ures.on("error", () => res.destroy());
      ures.pipe(res);
    });

    upstreamReq.on("error", (err) => {
      log.warn("upstream request failed", { route, error: String(err) });
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { type: "proxy_error", message: `prompt-meter-proxy: upstream error: ${err.message}` } }));
      } else {
        res.destroy();
      }
    });

    // Client went away before the response finished: stop the upstream request too.
    res.on("close", () => {
      if (!res.writableFinished) upstreamReq.destroy();
    });

    if (reqCapture) req.on("data", (c: Buffer) => reqCapture.push(c));
    req.on("end", () => setImmediate(classify));
    req.pipe(upstreamReq);
  });

  server.on("close", () => {
    httpAgent.destroy();
    httpsAgent.destroy();
  });
  return server;
}
