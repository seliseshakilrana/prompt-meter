import { createHash } from "node:crypto";
import zlib from "node:zlib";

/** A whole number >= 0, or 0 for anything else. */
export function n(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

/** A whole number >= 0, or null when absent/invalid. */
export function nOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export interface SseEvent {
  event: string | null;
  data: string;
}

/** Parse a complete SSE body into events (per the WHATWG event-stream format). */
export function parseSse(text: string): SseEvent[] {
  const events: SseEvent[] = [];
  let event: string | null = null;
  let data: string[] = [];
  const flush = () => {
    if (data.length > 0) events.push({ event, data: data.join("\n") });
    event = null;
    data = [];
  };
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    if (rawLine === "") {
      flush();
      continue;
    }
    if (rawLine.startsWith(":")) continue;
    const idx = rawLine.indexOf(":");
    const field = idx === -1 ? rawLine : rawLine.slice(0, idx);
    let value = idx === -1 ? "" : rawLine.slice(idx + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  flush();
  return events;
}

/** Parse each SSE data payload as JSON, skipping non-JSON payloads such as `[DONE]`. */
export function sseJson(text: string): { event: string | null; json: unknown }[] {
  const out: { event: string | null; json: unknown }[] = [];
  for (const e of parseSse(text)) {
    try {
      out.push({ event: e.event, json: JSON.parse(e.data) });
    } catch {
      // not JSON (e.g. "[DONE]")
    }
  }
  return out;
}

export function looksLikeSse(contentType: string, text: string): boolean {
  if (contentType.toLowerCase().includes("text/event-stream")) return true;
  const head = text.trimStart().slice(0, 16);
  return head.startsWith("event:") || head.startsWith("data:");
}

export function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Decode a side copy of a response body according to Content-Encoding.
 * Tolerant of truncated streams. Throws on unknown encodings.
 */
export function decodeBody(buf: Buffer, contentEncoding: string | undefined): Buffer {
  if (!contentEncoding) return buf;
  const encodings = contentEncoding
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e && e !== "identity");
  let out = buf;
  for (const enc of encodings.reverse()) {
    const flush = { finishFlush: zlib.constants.Z_SYNC_FLUSH };
    if (enc === "gzip" || enc === "x-gzip") out = zlib.gunzipSync(out, flush);
    else if (enc === "deflate") {
      try {
        out = zlib.inflateSync(out, flush);
      } catch {
        out = zlib.inflateRawSync(out, flush);
      }
    } else if (enc === "br") out = zlib.brotliDecompressSync(out);
    else if (enc === "zstd") {
      const z = zlib as unknown as { zstdDecompressSync?: (b: Buffer) => Buffer };
      if (!z.zstdDecompressSync) throw new Error("zstd not supported by this Node version");
      out = z.zstdDecompressSync(out);
    } else throw new Error(`unsupported content-encoding: ${enc}`);
  }
  return out;
}

export function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const v = headers[name.toLowerCase()];
  if (Array.isArray(v)) return v.join(", ");
  return v;
}
