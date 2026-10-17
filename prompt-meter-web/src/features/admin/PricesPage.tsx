import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { CircleDollarSign, Plus, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Alert } from "../../shared/ui/Alert";
import { EmptyState } from "../../shared/ui/EmptyState";
import { ErrorState } from "../../shared/ui/ErrorState";
import { Modal } from "../../shared/ui/Modal";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Skeleton } from "../../shared/ui/Skeleton";
import { StatusPill } from "../../shared/ui/StatusPill";
import { createModelPrice, describeError, listModelPrices, listUnpricedModels } from "./adminApi";
import {
  PROVIDERS,
  emptyPriceForm,
  priceFormFrom,
  priceRowStatuses,
  rateLabel,
  toModelPriceInsertPayload,
  validatePriceForm
} from "./priceValidation";
import type { PriceFormErrors, PriceFormValues, PriceRowStatus } from "./priceValidation";
import { MODEL_PRICE_RATE_FIELDS } from "./types";
import type { ModelPrice, ModelPriceRateField } from "./types";
import { useIsPlatformAdmin } from "./useIsPlatformAdmin";

const PRICES_KEY = ["admin", "model-prices"] as const;
const UNPRICED_KEY = ["admin", "unpriced-models"] as const;

export default function PricesPage() {
  const access = useIsPlatformAdmin();
  const queryClient = useQueryClient();
  const prices = useQuery({ queryKey: PRICES_KEY, queryFn: listModelPrices });
  const unpriced = useQuery({ queryKey: UNPRICED_KEY, queryFn: listUnpricedModels, retry: false });
  const [form, setForm] = useState<{ title: string; values: PriceFormValues } | null>(null);

  const rows = prices.data?.items ?? [];
  const statuses = useMemo(() => priceRowStatuses(rows, Date.now()), [rows]);
  const canEdit = access.isAdmin;

  return (
    <section>
      <PageHeader
        title="Model prices"
        subtitle="USD per 1M tokens (web search: USD per request). Costs are computed when an event arrives, so a price change applies from its effective date and never rewrites history."
        actions={
          <>
            <ActionButton
              variant="icon"
              title="Refresh"
              icon={<RefreshCw size={18} />}
              onClick={() => {
                void prices.refetch();
                void unpriced.refetch();
              }}
            />
            {canEdit ? (
              <ActionButton icon={<Plus size={16} />} onClick={() => setForm({ title: "Add model price", values: emptyPriceForm(new Date()) })}>
                Add price
              </ActionButton>
            ) : null}
          </>
        }
      />

      {!access.isLoading && !canEdit ? (
        <Alert tone="info">Read-only. Only platform admins can add prices.</Alert>
      ) : null}
      {prices.data?.truncated ? <Alert tone="warn">Only the first rows were loaded; the price table is larger than expected.</Alert> : null}

      <div className="mt-3">
        {prices.isLoading ? (
          <div className="panel"><Skeleton className="skeleton-line-lg" /><Skeleton className="skeleton-line" /></div>
        ) : prices.isError ? (
          <ErrorState message={`Could not load prices: ${describeError(prices.error)}`} onRetry={() => void prices.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<CircleDollarSign size={28} />} title="No prices yet" description="Every event is stored as unpriced until a price row exists for its model." />
        ) : (
          <PriceTable rows={rows} statuses={statuses} onNewDated={canEdit ? (row) => setForm({ title: `New price for ${row.model}`, values: priceFormFrom(row, new Date()) }) : undefined} />
        )}
      </div>

      <UnpricedPanel query={unpriced} />

      {form && canEdit ? (
        <PriceFormModal
          title={form.title}
          initial={form.values}
          existing={rows}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            void queryClient.invalidateQueries({ queryKey: PRICES_KEY });
          }}
        />
      ) : null}
    </section>
  );
}

const STATUS_TONE: Record<PriceRowStatus, "good" | "warn" | "neutral"> = {
  current: "good",
  scheduled: "warn",
  superseded: "neutral",
  "invalid-date": "warn"
};

function PriceTable({ onNewDated, rows, statuses }: { onNewDated?: (row: ModelPrice) => void; rows: ModelPrice[]; statuses: PriceRowStatus[] }) {
  return (
    <div className="table-shell">
      <table className="text-sm">
        <thead>
          <tr>
            <th>Provider</th>
            <th>Model</th>
            <th>Aliases</th>
            <th>Effective from (UTC)</th>
            <th>Status</th>
            {MODEL_PRICE_RATE_FIELDS.map((field) => <th key={field} className="whitespace-nowrap">{rateLabel(field)}</th>)}
            {onNewDated ? <th /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.ItemId ?? `${row.provider}-${row.model}-${row.effectiveFrom}`}>
              <td>{row.provider}</td>
              <td className="mono whitespace-nowrap">{row.model}</td>
              <td className="mono text-xs">{row.modelAliases.length ? row.modelAliases.join(", ") : <span className="muted">none</span>}</td>
              <td className="whitespace-nowrap">{formatUtc(row.effectiveFrom)}</td>
              <td><StatusPill tone={STATUS_TONE[statuses[index] ?? "superseded"]}>{statuses[index] ?? "superseded"}</StatusPill></td>
              {MODEL_PRICE_RATE_FIELDS.map((field) => <td key={field} className="whitespace-nowrap text-right">{formatRate(field, row[field])}</td>)}
              {onNewDated ? (
                <td><button className="link-button whitespace-nowrap" onClick={() => onNewDated(row)}>New dated price</button></td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatUtc(value: string): string {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") : value || "?";
}

function formatRate(field: ModelPriceRateField, value: number | null): ReactNode {
  if (value === null) return <span className="pill pill-warn" title="Not set: events that need this rate are stored unpriced">not set</span>;
  if (field === "longContextThreshold") return value.toLocaleString();
  if (field === "fastMultiplier") return `x${value}`;
  return `$${value}`;
}

function UnpricedPanel({ query }: { query: UseQueryResult<Awaited<ReturnType<typeof listUnpricedModels>>> }) {
  return (
    <div className="panel">
      <div className="panel-title"><CircleDollarSign size={16} /><span>Models seen on unpriced events</span></div>
      <p className="muted">Best effort: only events you are allowed to read are scanned. Add a price row (or an alias) to price future events; stored events are re-priced by a separate job.</p>
      {query.isLoading ? (
        <Skeleton className="skeleton-line" />
      ) : query.isError ? (
        <p className="muted">Could not read usage events: {describeError(query.error)}</p>
      ) : !query.data || query.data.items.length === 0 ? (
        <p className="muted">No unpriced events found{query.data ? ` (${query.data.scanned} scanned)` : ""}.</p>
      ) : (
        <div className="table-shell">
          <table className="text-sm">
            <thead><tr><th>Provider</th><th>Model</th><th>Unpriced events</th><th>Last seen (UTC)</th></tr></thead>
            <tbody>
              {query.data.items.map((item) => (
                <tr key={`${item.provider}-${item.model}`}>
                  <td>{item.provider}</td>
                  <td className="mono">{item.model}</td>
                  <td>{item.eventCount}{query.data?.truncated ? "+" : ""}</td>
                  <td>{item.lastSeen ? formatUtc(item.lastSeen) : "?"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PriceFormModal({
  existing,
  initial,
  onClose,
  onSaved,
  title
}: { existing: ModelPrice[]; initial: PriceFormValues; onClose: () => void; onSaved: () => void; title: string }) {
  const [values, setValues] = useState<PriceFormValues>(initial);
  const [errors, setErrors] = useState<PriceFormErrors>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) => createModelPrice(payload),
    onSuccess: onSaved
  });

  function submit() {
    const result = validatePriceForm(values, existing);
    setWarnings(result.warnings);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    save.mutate(toModelPriceInsertPayload(result.value));
  }

  const setRate = (field: ModelPriceRateField, value: string) => setValues((v) => ({ ...v, rates: { ...v.rates, [field]: value } }));

  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="grid gap-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="max-h-[65vh] overflow-y-auto pr-1">
          <p className="mb-3 text-sm">This adds a new dated row. Existing rows are kept so past events keep the price they were computed with. Leave a rate empty for "not set".</p>
          <div className="form-grid">
            <label className="form-field">
              <span>Provider</span>
              <select value={values.provider} onChange={(e) => setValues((v) => ({ ...v, provider: e.target.value }))}>
                {PROVIDERS.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
              </select>
              <FieldError message={errors.provider} />
            </label>
            <TextField label="Model" value={values.model} error={errors.model} placeholder="claude-sonnet-5-5" onChange={(model) => setValues((v) => ({ ...v, model }))} />
            <TextField label="Aliases (comma separated, * = prefix)" value={values.modelAliases} error={errors.modelAliases} placeholder="claude-sonnet-5-5-*" onChange={(modelAliases) => setValues((v) => ({ ...v, modelAliases }))} />
            <TextField label="Effective from (YYYY-MM-DD, UTC)" value={values.effectiveFrom} error={errors.effectiveFrom} placeholder="2026-10-17" onChange={(effectiveFrom) => setValues((v) => ({ ...v, effectiveFrom }))} />
            {MODEL_PRICE_RATE_FIELDS.map((field) => (
              <TextField key={field} label={rateLabel(field)} value={values.rates[field]} error={errors[field]} inputMode="decimal" placeholder="not set" onChange={(value) => setRate(field, value)} />
            ))}
          </div>
        </div>
        {warnings.length ? <Alert tone="warn">{warnings.map((w) => <div key={w}>{w}</div>)}</Alert> : null}
        {save.isError ? <Alert tone="error">Save failed: {describeError(save.error)}</Alert> : null}
        <div className="modal-actions">
          <button type="button" className="icon-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary-button" disabled={save.isPending}>{save.isPending ? "Saving..." : "Save new price row"}</button>
        </div>
      </form>
    </Modal>
  );
}

function TextField({
  error,
  inputMode,
  label,
  onChange,
  placeholder,
  value
}: { error?: string; inputMode?: "decimal"; label: string; onChange: (value: string) => void; placeholder?: string; value: string }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <input value={value} inputMode={inputMode} placeholder={placeholder} aria-invalid={error ? true : undefined} onChange={(e) => onChange(e.target.value)} />
      <FieldError message={error} />
    </label>
  );
}

function FieldError({ message }: { message?: string }) {
  return message ? <small className="text-xs text-[hsl(var(--destructive))]">{message}</small> : null;
}
