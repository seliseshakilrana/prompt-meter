/**
 * Configuration. Precedence: CLI flags > environment variables > config file > defaults.
 *
 * Config file (default ~/.config/prompt-meter/config.json):
 * {
 *   "host": "127.0.0.1",
 *   "port": 8787,
 *   "upstreams": { "anthropic": "...", "openai": "...", "gemini": "..." },
 *   "ingestUrl": "https://…/ingest",
 *   "defaultKey": "pm_xxxxxxxx_…",
 *   "sendPreview": true,
 *   "keys": { "xxxxxxxx": { "sendPreview": false } },   // by 8-char prefix or full key
 *   "queuePath": "~/.local/state/prompt-meter/queue.db",
 *   "sessionGapMinutes": 30,
 *   "flushIntervalMs": 10000,
 *   "batchSize": 50
 * }
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RouteName } from "./adapters/index.js";
import { keyPrefix } from "./log.js";

export interface KeySettings {
  sendPreview?: boolean;
}

export interface Config {
  host: string;
  port: number;
  upstreams: Record<RouteName, string>;
  ingestUrl: string | null;
  defaultKey: string | null;
  sendPreview: boolean;
  keys: Record<string, KeySettings>;
  queuePath: string;
  sessionGapMinutes: number;
  flushIntervalMs: number;
  batchSize: number;
  sink: "ingest" | "stdout";
}

export const DEFAULT_UPSTREAMS: Record<RouteName, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com",
  gemini: "https://generativelanguage.googleapis.com",
};

export function defaultConfigPath(): string {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "prompt-meter", "config.json");
}

export function defaultQueuePath(): string {
  const base = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  return path.join(base, "prompt-meter", "queue.db");
}

export function defaultConfig(): Config {
  return {
    host: "127.0.0.1",
    port: 8787,
    upstreams: { ...DEFAULT_UPSTREAMS },
    ingestUrl: null,
    defaultKey: null,
    sendPreview: true,
    keys: {},
    queuePath: defaultQueuePath(),
    sessionGapMinutes: 30,
    flushIntervalMs: 10_000,
    batchSize: 50,
    sink: "ingest",
  };
}

function expandHome(p: string): string {
  return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

export interface CliOverrides {
  configPath?: string;
  port?: number;
  host?: string;
  sink?: "ingest" | "stdout";
}

export function loadConfig(overrides: CliOverrides = {}, env: NodeJS.ProcessEnv = process.env): Config {
  const cfg = defaultConfig();
  const explicitPath = overrides.configPath ?? env.PROMPT_METER_CONFIG;
  const file = explicitPath ? expandHome(explicitPath) : defaultConfigPath();
  if (fs.existsSync(file)) {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<Config>;
    Object.assign(cfg, { ...raw, upstreams: { ...cfg.upstreams, ...(raw.upstreams ?? {}) }, keys: raw.keys ?? {} });
  } else if (explicitPath) {
    throw new Error(`config file not found: ${file}`);
  }

  if (env.PROMPT_METER_HOST) cfg.host = env.PROMPT_METER_HOST;
  if (env.PROMPT_METER_PORT) cfg.port = Number(env.PROMPT_METER_PORT);
  if (env.PROMPT_METER_INGEST_URL) cfg.ingestUrl = env.PROMPT_METER_INGEST_URL;
  const envKey = env.PROMPT_METER_DEFAULT_KEY ?? env.PROMPT_METER_KEY;
  if (envKey) cfg.defaultKey = envKey;
  if (env.PROMPT_METER_QUEUE_PATH) cfg.queuePath = env.PROMPT_METER_QUEUE_PATH;
  if (env.PROMPT_METER_ANTHROPIC_UPSTREAM) cfg.upstreams.anthropic = env.PROMPT_METER_ANTHROPIC_UPSTREAM;
  if (env.PROMPT_METER_OPENAI_UPSTREAM) cfg.upstreams.openai = env.PROMPT_METER_OPENAI_UPSTREAM;
  if (env.PROMPT_METER_GEMINI_UPSTREAM) cfg.upstreams.gemini = env.PROMPT_METER_GEMINI_UPSTREAM;
  if (env.PROMPT_METER_SINK === "stdout" || env.PROMPT_METER_SINK === "ingest") cfg.sink = env.PROMPT_METER_SINK;

  if (overrides.port !== undefined) cfg.port = overrides.port;
  if (overrides.host !== undefined) cfg.host = overrides.host;
  if (overrides.sink !== undefined) cfg.sink = overrides.sink;

  cfg.queuePath = expandHome(cfg.queuePath);
  if (!Number.isInteger(cfg.port) || cfg.port < 0 || cfg.port > 65535) throw new Error(`invalid port: ${cfg.port}`);
  return cfg;
}

/** Whether previews are sent for this key: per-key setting (by full key or prefix), else the global default. */
export function previewEnabled(cfg: Pick<Config, "keys" | "sendPreview">, key: string | null): boolean {
  if (key) {
    const byFull = cfg.keys[key];
    if (byFull?.sendPreview !== undefined) return byFull.sendPreview;
    const p = keyPrefix(key);
    const byPrefix = p ? cfg.keys[p] : undefined;
    if (byPrefix?.sendPreview !== undefined) return byPrefix.sendPreview;
  }
  return cfg.sendPreview;
}
