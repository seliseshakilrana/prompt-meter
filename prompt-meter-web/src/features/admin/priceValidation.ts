// Pure validation and display helpers for ModelPrice rows.
// Price history is never edited in place: a change is a new row with a later effectiveFrom
// (README "Pricing rules": newest effectiveFrom not after occurredAt applies).

import { modelPriceKey } from "./keys";
import { parseIsoUtc } from "./timeShift";
import { INTEGER_RATE_FIELDS, MODEL_PRICE_RATE_FIELDS, MODEL_PRICE_RATE_LABELS } from "./types";
import type { ModelPrice, ModelPriceRateField, ModelPriceRates } from "./types";

export const PROVIDERS = ["anthropic", "openai", "google"] as const;

export type ModelPriceInput = Omit<ModelPrice, "ItemId">;

export type PriceFormValues = {
  provider: string;
  model: string;
  /** Comma- or newline-separated. Entries ending in `*` are prefixes. */
  modelAliases: string;
  /** `YYYY-MM-DD` (midnight UTC) or a full ISO timestamp with a zone. */
  effectiveFrom: string;
  rates: Record<ModelPriceRateField, string>;
};

export type PriceFormErrors = Partial<Record<"provider" | "model" | "modelAliases" | "effectiveFrom" | ModelPriceRateField, string>>;

export type PriceValidationResult =
  | { ok: true; value: ModelPriceInput; warnings: string[] }
  | { ok: false; errors: PriceFormErrors; warnings: string[] };

const LONG_CONTEXT_RATE_FIELDS: ModelPriceRateField[] = [
  "longContextInputPer1M",
  "longContextOutputPer1M",
  "longContextCacheReadPer1M",
  "longContextCacheWrite5mPer1M",
  "longContextCacheWrite1hPer1M"
];

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Normalizes a date or ISO timestamp to `toISOString()` form (UTC), or null if invalid. */
export function normalizeEffectiveFrom(input: string): string | null {
  const value = input.trim();
  const dateOnly = DATE_ONLY_RE.exec(value);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    const ms = Date.UTC(Number(y), Number(m) - 1, Number(d));
    const date = new Date(ms);
    // Reject roll-over dates such as 2026-02-31.
    if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) return null;
    return date.toISOString();
  }
  const ms = parseIsoUtc(value);
  if (ms === null) return null;
  // Reject roll-overs in the date part of a full timestamp too.
  const datePart = DATE_ONLY_RE.exec(value.slice(0, 10));
  if (datePart && normalizeEffectiveFrom(value.slice(0, 10)) === null) return null;
  return new Date(ms).toISOString();
}

/** Empty -> null (not set). Otherwise a finite, non-negative number (integer where the schema says Int). */
export function parseRate(field: ModelPriceRateField, raw: string): { value: number | null; error?: string } {
  const text = raw.trim();
  if (text === "") return { value: null };
  if (!/^[+]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(text)) {
    return { value: null, error: "Enter a non-negative number, or leave empty for not set." };
  }
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) return { value: null, error: "Enter a non-negative number." };
  if (INTEGER_RATE_FIELDS.has(field) && !Number.isInteger(value)) return { value: null, error: "Must be a whole number of tokens." };
  if (INTEGER_RATE_FIELDS.has(field) && value > 2_147_483_647) return { value: null, error: "Too large for an Int field." };
  return { value };
}

export function parseAliases(raw: string): { value: string[]; error?: string } {
  const entries = raw
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const unique = Array.from(new Set(entries));
  for (const alias of unique) {
    if (/\s/.test(alias)) return { value: unique, error: `Alias "${alias}" contains whitespace.` };
    if (alias.indexOf("*") !== -1 && alias.indexOf("*") !== alias.length - 1) {
      return { value: unique, error: `Alias "${alias}": * is only allowed at the end (prefix match).` };
    }
    if (alias === "*") return { value: unique, error: "A bare * would match every model." };
  }
  return { value: unique };
}

export function validatePriceForm(values: PriceFormValues, existing: Pick<ModelPrice, "provider" | "model" | "effectiveFrom">[] = []): PriceValidationResult {
  const errors: PriceFormErrors = {};
  const warnings: string[] = [];

  const provider = values.provider.trim().toLowerCase();
  if (!provider) errors.provider = "Provider is required.";
  else if (!(PROVIDERS as readonly string[]).includes(provider)) errors.provider = `Provider must be one of ${PROVIDERS.join(", ")}.`;

  const model = values.model.trim();
  if (!model) errors.model = "Model is required.";
  else if (/\s/.test(model)) errors.model = "Model id must not contain whitespace.";
  else if (model.includes("*")) errors.model = "Put prefixes (ending in *) in aliases, not in the model id.";

  const aliases = parseAliases(values.modelAliases);
  if (aliases.error) errors.modelAliases = aliases.error;

  const effectiveFrom = values.effectiveFrom.trim() ? normalizeEffectiveFrom(values.effectiveFrom) : null;
  if (!values.effectiveFrom.trim()) errors.effectiveFrom = "Effective-from date is required.";
  else if (!effectiveFrom) errors.effectiveFrom = "Use YYYY-MM-DD or an ISO timestamp with a zone, e.g. 2026-10-17T00:00:00Z.";

  const rates = {} as ModelPriceRates;
  for (const field of MODEL_PRICE_RATE_FIELDS) {
    const parsed = parseRate(field, values.rates[field] ?? "");
    rates[field] = parsed.value;
    if (parsed.error) errors[field] = parsed.error;
  }

  const anyLongContextRate = LONG_CONTEXT_RATE_FIELDS.some((field) => rates[field] !== null);
  if (anyLongContextRate && rates.longContextThreshold === null && !errors.longContextThreshold) {
    errors.longContextThreshold = "Long-context rates are set, so a threshold is required (otherwise they never apply).";
  }
  if (rates.longContextThreshold !== null && !anyLongContextRate) {
    warnings.push("A long-context threshold is set without long-context rates: events above it will be stored unpriced.");
  }
  if (rates.inputPer1M === null || rates.outputPer1M === null) {
    warnings.push("Input or output rate is not set: most events for this model will be stored unpriced.");
  }

  if (provider && model && effectiveFrom) {
    const key = modelPriceKey({ provider, model, effectiveFrom });
    if (existing.some((row) => modelPriceKey(row) === key)) {
      errors.effectiveFrom = "A price row for this provider, model and effective-from already exists. Pick a different date.";
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors, warnings };
  return {
    ok: true,
    value: { provider, model, modelAliases: aliases.value, effectiveFrom: effectiveFrom as string, ...rates },
    warnings
  };
}

/**
 * Payload for `insertModelPrice`: null ("not set") fields are left out rather than sent as null.
 * TODO(live): confirm the gateway insert input accepts an omitted Float/Int field as null.
 */
export function toModelPriceInsertPayload(value: ModelPriceInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    provider: value.provider,
    model: value.model,
    modelAliases: value.modelAliases,
    effectiveFrom: value.effectiveFrom
  };
  for (const field of MODEL_PRICE_RATE_FIELDS) {
    const rate = value[field];
    if (rate !== null && rate !== undefined) payload[field] = rate;
  }
  return payload;
}

export function emptyPriceForm(today: Date): PriceFormValues {
  const rates = {} as Record<ModelPriceRateField, string>;
  for (const field of MODEL_PRICE_RATE_FIELDS) rates[field] = "";
  return { provider: "anthropic", model: "", modelAliases: "", effectiveFrom: today.toISOString().slice(0, 10), rates };
}

/** Prefill for "new dated price" from an existing row; the date defaults to today. */
export function priceFormFrom(row: ModelPrice, today: Date): PriceFormValues {
  const form = emptyPriceForm(today);
  form.provider = row.provider ?? "";
  form.model = row.model ?? "";
  form.modelAliases = (row.modelAliases ?? []).join(", ");
  for (const field of MODEL_PRICE_RATE_FIELDS) {
    const rate = row[field];
    form.rates[field] = typeof rate === "number" ? String(rate) : "";
  }
  return form;
}

export type PriceRowStatus = "current" | "scheduled" | "superseded" | "invalid-date";

/** Per (provider, model): the newest row not after `nowMs` is current; later rows are scheduled. */
export function priceRowStatuses(rows: Pick<ModelPrice, "provider" | "model" | "effectiveFrom">[], nowMs: number): PriceRowStatus[] {
  const currentByModel = new Map<string, number>();
  rows.forEach((row) => {
    const ms = parseIsoUtc(row.effectiveFrom);
    if (ms === null || ms > nowMs) return;
    const key = JSON.stringify([row.provider, row.model]);
    const best = currentByModel.get(key);
    if (best === undefined || ms > best) currentByModel.set(key, ms);
  });
  return rows.map((row) => {
    const ms = parseIsoUtc(row.effectiveFrom);
    if (ms === null) return "invalid-date";
    if (ms > nowMs) return "scheduled";
    return currentByModel.get(JSON.stringify([row.provider, row.model])) === ms ? "current" : "superseded";
  });
}

export function rateLabel(field: ModelPriceRateField): string {
  return MODEL_PRICE_RATE_LABELS[field];
}
