const compact = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, notation: "compact" });
const whole = new Intl.NumberFormat("en-US");

/** 1,284 / 12.9K / 4.2M */
export function formatTokens(value: number): string {
  return Math.abs(value) < 10_000 ? whole.format(Math.round(value)) : compact.format(value);
}

export function formatInteger(value: number): string {
  return whole.format(Math.round(value));
}

/** Dollars with enough precision for sub-cent API calls. */
export function formatUsd(value: number): string {
  if (value === 0) return "$0.00";
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 1 ? 2 : abs >= 0.01 ? 3 : 4;
  const text = abs < 0.0001 ? "<$0.0001" : `$${abs.toFixed(digits)}`;
  return value < 0 ? `-${text}` : text;
}

/** Axis ticks: $0 / $0.05 / $1.2K */
export function formatUsdTick(value: number): string {
  if (value === 0) return "$0";
  if (value >= 1000) return `$${compact.format(value)}`;
  if (value >= 1) return `$${Number(value.toFixed(2))}`;
  return `$${Number(value.toPrecision(2))}`;
}

const TOOL_LABELS: Record<string, string> = {
  "antigravity-cli": "Antigravity CLI",
  api: "API",
  "claude-code": "Claude Code",
  codex: "Codex",
  other: "Other"
};

export function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool;
}
