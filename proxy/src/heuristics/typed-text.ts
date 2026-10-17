/**
 * Telling text the user typed apart from text a tool injected into a user message.
 *
 * Claude Code puts `<system-reminder>` blocks next to tool results; Codex injects
 * `<environment_context>` / `<user_instructions>` messages with the user role.
 * These must not start a new prompt or end up in the preview.
 */

/** Whole tagged segments that are tool-injected context, not typed text. */
const INJECTED_SEGMENTS: RegExp[] = [
  /<system-reminder>[\s\S]*?(<\/system-reminder>|$)/g,
  /<environment_context>[\s\S]*?(<\/environment_context>|$)/g,
  /<user_instructions>[\s\S]*?(<\/user_instructions>|$)/g,
  /<local-command-stdout>[\s\S]*?(<\/local-command-stdout>|$)/g,
  /<local-command-stderr>[\s\S]*?(<\/local-command-stderr>|$)/g,
];

/** Whole texts that are tool-injected markers. */
const INJECTED_WHOLE: RegExp[] = [/^\[Request interrupted by user[^\]]*\]$/];

/** Returns the typed part of a text, or null if it was entirely injected. */
export function typedPart(text: string): string | null {
  let out = text;
  for (const re of INJECTED_SEGMENTS) out = out.replace(re, " ");
  out = out.trim();
  if (!out) return null;
  if (INJECTED_WHOLE.some((re) => re.test(out))) return null;
  return out;
}

/** Joins the typed parts of several text blocks; null when none is typed. */
export function typedFromTexts(texts: string[]): string | null {
  const parts = texts.map(typedPart).filter((t): t is string => t !== null);
  return parts.length ? parts.join("\n") : null;
}
