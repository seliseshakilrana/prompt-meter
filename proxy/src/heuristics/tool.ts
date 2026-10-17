/**
 * Which tool made a request. Pure heuristics on the User-Agent; edit freely.
 *
 * - anthropic: Claude Code sends a User-Agent like `claude-cli/2.x (external, cli)`.
 * - openai:    Codex sends a User-Agent containing `codex` (e.g. `codex_cli_rs/0.x`).
 * - google:    Antigravity CLI is matched on `antigravity` or `agy`.
 * Anything else is a plain API caller.
 */
import type { Provider, Tool } from "../types.js";

const RULES: Record<Provider, { tool: Tool; pattern: RegExp }[]> = {
  anthropic: [{ tool: "claude-code", pattern: /claude-cli|claude-code/i }],
  openai: [{ tool: "codex", pattern: /codex/i }],
  google: [{ tool: "antigravity-cli", pattern: /antigravity|\bagy\b/i }],
};

export function inferTool(provider: Provider, userAgent: string | undefined): Tool {
  const ua = userAgent ?? "";
  for (const rule of RULES[provider]) {
    if (rule.pattern.test(ua)) return rule.tool;
  }
  return "api";
}
