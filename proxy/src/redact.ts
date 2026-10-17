/**
 * Prompt preview cleaning: remove secret-looking text, collapse whitespace,
 * cut to 100 characters. The ingest workflow cleans it again (PLAN.md).
 */

const R = "[REDACTED]";

/** Ordered: specific token formats first, generic runs last. */
const SECRET_PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g, R],
  [/\bpm_[a-z0-9]{8}_[A-Za-z0-9]{32}\b/g, R], // prompt-meter ingest keys
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g, R], // Anthropic / OpenAI keys
  [/\bAIza[0-9A-Za-z_-]{30,}/g, R], // Google API keys
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, R], // GitHub tokens
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, R], // Slack tokens
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, R], // AWS access key ids
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, R], // JWTs
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${R}`],
  [
    /\b(password|passwd|pwd|pass|secret|client_secret|token|access_token|refresh_token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|auth)(["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi,
    `$1$2${R}`,
  ],
  [/\b[0-9a-fA-F]{32,}\b/g, R], // long hex runs
  [/[A-Za-z0-9+/_-]{40,}={0,2}/g, R], // long base64-ish runs
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}

export const PREVIEW_MAX = 100;

/** Clean a typed prompt into a preview of at most 100 characters (code points). */
export function makePreview(text: string | null | undefined): string | null {
  if (!text) return null;
  const cleaned = redactSecrets(text).replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const chars = Array.from(cleaned);
  if (chars.length <= PREVIEW_MAX) return cleaned;
  return chars.slice(0, PREVIEW_MAX - 1).join("").trimEnd() + "…";
}
