/**
 * Which account each tool is signed in with on this machine, read from the tool's own
 * local files. Each event carries it as `accountEmail`; the ingest marks it verified only
 * when the key owner has linked that tool account in the portal, so a wrong or missing
 * value here never attributes usage to anyone.
 *
 * Only the email is read. Tokens in these files are decoded locally for their email claim
 * and are never logged, stored or sent.
 *
 * - claude-code:     $CLAUDE_CONFIG_DIR/.claude.json or ~/.claude.json -> oauthAccount.emailAddress
 * - codex:           $CODEX_HOME/auth.json or ~/.codex/auth.json -> tokens.id_token (email claim)
 * - antigravity-cli: ~/.gemini/antigravity-cli/antigravity-oauth-token, then
 *                    ~/.gemini/jetski-standalone-oauth-token -> id_token (email claim),
 *                    then ~/.gemini/google_accounts.json -> active
 *
 * A config value (`accounts` in config.json) always wins over detection.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { log } from "./log.js";
import type { Tool } from "./types.js";

export type LinkableTool = "claude-code" | "codex" | "antigravity-cli";
export const LINKABLE_TOOLS: LinkableTool[] = ["claude-code", "codex", "antigravity-cli"];

export interface DetectContext {
  home: string;
  env: NodeJS.ProcessEnv;
}

/** Returns the account email for a tool, or null. */
export type AccountResolver = (tool: Tool) => string | null;

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The email claim of an unverified JWT (local file, local use only). */
export function jwtEmail(token: unknown): string | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const claims = record(JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")));
    if (!claims) return null;
    const profile = record(claims["https://api.openai.com/profile"]);
    return normalizeEmail(claims.email) ?? normalizeEmail(profile?.email);
  } catch {
    return null;
  }
}

export function detectClaudeEmail(ctx: DetectContext): string | null {
  const file = ctx.env.CLAUDE_CONFIG_DIR ? path.join(ctx.env.CLAUDE_CONFIG_DIR, ".claude.json") : path.join(ctx.home, ".claude.json");
  return normalizeEmail(record(record(readJson(file))?.oauthAccount)?.emailAddress);
}

export function detectCodexEmail(ctx: DetectContext): string | null {
  const dir = ctx.env.CODEX_HOME || path.join(ctx.home, ".codex");
  const auth = record(readJson(path.join(dir, "auth.json")));
  return jwtEmail(record(auth?.tokens)?.id_token);
}

export function detectAntigravityEmail(ctx: DetectContext): string | null {
  const dir = path.join(ctx.home, ".gemini");
  for (const name of ["antigravity-cli/antigravity-oauth-token", "jetski-standalone-oauth-token"]) {
    const file = record(readJson(path.join(dir, name)));
    const email = jwtEmail(file?.id_token) ?? jwtEmail(record(file?.token)?.id_token);
    if (email) return email;
  }
  return normalizeEmail(record(readJson(path.join(dir, "google_accounts.json")))?.active);
}

const DETECTORS: Record<LinkableTool, (ctx: DetectContext) => string | null> = {
  "claude-code": detectClaudeEmail,
  codex: detectCodexEmail,
  "antigravity-cli": detectAntigravityEmail,
};

export interface ResolverOptions {
  /** Emails from config.json; they win over detection. */
  overrides?: Partial<Record<LinkableTool, string>>;
  /** Read the tools' local files (default true). */
  detect?: boolean;
  ctx?: DetectContext;
  /** How long a detected value is reused before the files are read again (default 60 s). */
  cacheMs?: number;
  now?: () => number;
}

export function createAccountResolver(opts: ResolverOptions = {}): AccountResolver {
  const ctx = opts.ctx ?? { home: os.homedir(), env: process.env };
  const cacheMs = opts.cacheMs ?? 60_000;
  const now = opts.now ?? Date.now;
  const cache = new Map<LinkableTool, { email: string | null; at: number }>();
  return (tool) => {
    if (!(LINKABLE_TOOLS as string[]).includes(tool)) return null;
    const t = tool as LinkableTool;
    const configured = normalizeEmail(opts.overrides?.[t]);
    if (configured) return configured;
    if (opts.detect === false) return null;
    const hit = cache.get(t);
    if (hit && now() - hit.at < cacheMs) return hit.email;
    let email: string | null = null;
    try {
      email = DETECTORS[t](ctx);
    } catch (err) {
      log.debug("account detection failed", { tool: t, error: String(err) });
    }
    cache.set(t, { email, at: now() });
    return email;
  };
}

/** Tools that currently resolve to an account (for the startup log; emails not printed). */
export function detectedTools(resolve: AccountResolver): LinkableTool[] {
  return LINKABLE_TOOLS.filter((tool) => resolve(tool) !== null);
}
