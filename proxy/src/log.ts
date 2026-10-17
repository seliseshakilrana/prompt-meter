/** Minimal stderr logger. Never pass full keys here; use keyLabel(). */
export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

let level: LogLevel = (process.env.PROMPT_METER_LOG_LEVEL as LogLevel) || "info";

export function setLogLevel(l: LogLevel): void {
  level = l;
}

function emit(l: LogLevel, msg: string, extra?: Record<string, unknown>): void {
  if (ORDER[l] < ORDER[level]) return;
  const line = `${new Date().toISOString()} ${l.toUpperCase()} ${msg}${extra ? " " + JSON.stringify(extra) : ""}`;
  process.stderr.write(line + "\n");
}

export const log = {
  debug: (m: string, e?: Record<string, unknown>) => emit("debug", m, e),
  info: (m: string, e?: Record<string, unknown>) => emit("info", m, e),
  warn: (m: string, e?: Record<string, unknown>) => emit("warn", m, e),
  error: (m: string, e?: Record<string, unknown>) => emit("error", m, e),
};

/** A loggable label for an ingest key: `pm_<prefix>_…`. Never the secret. */
export function keyLabel(key: string | null | undefined): string {
  if (!key) return "(none)";
  const m = /^pm_([a-z0-9]{8})_/.exec(key);
  if (m) return `pm_${m[1]}_…`;
  return `${key.slice(0, 3)}…(malformed)`;
}

/** The 8-char prefix of a well-formed key, or null. */
export function keyPrefix(key: string): string | null {
  return /^pm_([a-z0-9]{8})_/.exec(key)?.[1] ?? null;
}
