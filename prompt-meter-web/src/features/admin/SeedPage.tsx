import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Database, ShieldAlert } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Alert } from "../../shared/ui/Alert";
import { EmptyState } from "../../shared/ui/EmptyState";
import { Modal } from "../../shared/ui/Modal";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Skeleton } from "../../shared/ui/Skeleton";
import { StatusPill } from "../../shared/ui/StatusPill";
import { describeError, findExistingKeys, insertSeedRow } from "./adminApi";
import { modelPricesSeed } from "./seed/modelPrices";
import { sampleUsageSeed } from "./seed/sampleUsage";
import { SEED_COLLECTIONS, countByStatus, planSeed, priceCoverageWarning, remapSampleIds } from "./seedMapping";
import type { SeedCollection, SeedPlanItem } from "./seedMapping";
import { HOUR_MS, newestEventTime, shiftSampleToNow } from "./timeShift";
import type { SampleUsageRows } from "./timeShift";
import { useIsPlatformAdmin } from "./useIsPlatformAdmin";

type RowResult = { state: "pending" | "inserted" | "exists" | "error" | "skipped" | "invalid"; message?: string };
type RunState = "idle" | "running" | "done" | "cancelled";

const SAMPLE_USER_FOR_ME = sampleUsageSeed.users[0]?.userId ?? "sample-user-dhaka";
const SAMPLE_TEAM = sampleUsageSeed.teams[0]?.teamId ?? "sample-team-1";

export default function SeedPage() {
  const access = useIsPlatformAdmin();

  if (access.isLoading) {
    return <section><div className="panel"><Skeleton className="skeleton-line-lg" /></div></section>;
  }
  if (!access.isAdmin) {
    return (
      <section>
        <EmptyState icon={<ShieldAlert size={28} />} title="Not authorized" description="Loading seed data is limited to platform admins." />
      </section>
    );
  }
  return <SeedConsole currentUserId={access.userId} />;
}

function SeedConsole({ currentUserId }: { currentUserId?: string }) {
  const queryClient = useQueryClient();
  const [shiftToNow, setShiftToNow] = useState(true);
  const [attributeToMe, setAttributeToMe] = useState(false);
  const [teamId, setTeamId] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [confirming, setConfirming] = useState(false);
  const [runState, setRunState] = useState<RunState>("idle");
  const [results, setResults] = useState<RowResult[]>([]);
  const [runPlan, setRunPlan] = useState<SeedPlanItem[] | null>(null);
  const [phase, setPhase] = useState("");
  const [runWarnings, setRunWarnings] = useState<string[]>([]);
  const cancelRef = useRef(false);

  const { deltaMs, rows } = useMemo(() => {
    const base: SampleUsageRows = { usageEvents: sampleUsageSeed.usageEvents, userHourly: sampleUsageSeed.userHourly, teamHourly: sampleUsageSeed.teamHourly };
    const shifted = shiftToNow ? shiftSampleToNow(base, nowMs) : { deltaMs: 0, rows: base };
    const remapped = remapSampleIds(shifted.rows, {
      users: attributeToMe && currentUserId ? { [SAMPLE_USER_FOR_ME]: currentUserId } : {},
      teams: teamId.trim() ? { [SAMPLE_TEAM]: teamId.trim() } : {}
    });
    return { deltaMs: shifted.deltaMs, rows: remapped };
  }, [shiftToNow, nowMs, attributeToMe, currentUserId, teamId]);

  const plan = useMemo(() => planSeed(modelPricesSeed, rows), [rows]);
  const counts = useMemo(() => countByStatus(plan), [plan]);
  const coverageWarning = useMemo(() => priceCoverageWarning(modelPricesSeed, rows), [rows]);
  const newest = newestEventTime(rows.usageEvents);
  const readyTotal = plan.filter((item) => item.status === "ready").length;
  const shown = runPlan ?? plan;
  const finished = results.filter((r) => r.state !== "pending").length;
  const futureEvents = rows.usageEvents.some((event) => Date.parse(event.occurredAt) > Date.now());

  async function run(items: SeedPlanItem[]) {
    cancelRef.current = false;
    setRunPlan(items);
    setRunState("running");
    setRunWarnings([]);
    const next: RowResult[] = items.map((item) =>
      item.status === "ready" ? { state: "pending" } : { state: item.status === "invalid" ? "invalid" : "skipped", message: item.reason }
    );
    setResults([...next]);
    const update = (index: number, result: RowResult) => {
      next[index] = result;
      setResults([...next]);
    };

    for (const collection of SEED_COLLECTIONS) {
      const indexes = items.map((item, index) => ({ item, index })).filter(({ item }) => item.collection === collection && item.status === "ready");
      if (indexes.length === 0) continue;
      if (cancelRef.current) break;

      setPhase(`Checking existing ${collection} rows...`);
      let existing: Set<string>;
      try {
        const found = await findExistingKeys(collection, items);
        existing = found.keys;
        if (found.truncated) {
          setRunWarnings((w) => [...w, `The existing ${collection} lookup was truncated: some rows that already exist may be inserted again or rejected by the unique index.`]);
        }
      } catch (error) {
        // Never insert blind: without the existence check a re-run could duplicate rows.
        const message = `Could not check existing rows, not inserted: ${describeError(error)}`;
        indexes.forEach(({ index }) => update(index, { state: "error", message }));
        continue;
      }

      for (const { item, index } of indexes) {
        if (cancelRef.current) break;
        if (existing.has(item.key)) {
          update(index, { state: "exists", message: "Already in the project: skipped." });
          continue;
        }
        setPhase(`Inserting ${collection}: ${item.label}`);
        try {
          await insertSeedRow(collection, item.payload as Record<string, unknown>);
          existing.add(item.key);
          update(index, { state: "inserted" });
        } catch (error) {
          update(index, { state: "error", message: describeError(error) });
        }
      }
    }

    setRunState(cancelRef.current ? "cancelled" : "done");
    setPhase("");
    void queryClient.invalidateQueries({ queryKey: ["admin"] });
  }

  const running = runState === "running";

  return (
    <section>
      <PageHeader title="Load seed data" subtitle="Model prices and the Phase 1 sample usage (UsageEvent, UserHourly, TeamHourly) from infra/blocks/seed." />

      <Alert tone="error">
        <strong className="inline-flex items-center gap-1"><AlertTriangle size={14} /> This writes to the live Blocks project.</strong>{" "}
        Rows are inserted for real and are visible to every user the access rules allow. Rows whose natural key already exists are skipped, so running it twice is safe, but nothing here deletes rows.
      </Alert>

      <div className="panel mt-3">
        <div className="panel-title"><Database size={16} /><span>Options</span></div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={shiftToNow} disabled={running} onChange={(e) => { setShiftToNow(e.target.checked); setNowMs(Date.now()); }} />
          <span>
            Shift sample timestamps so the newest event is now. Events and hourly rows move by the same whole number of hours, so hours stay on the hour.
            {shiftToNow ? <span className="muted"> Shift: {formatShift(deltaMs)}. Newest event: {newest !== null ? new Date(newest).toISOString() : "?"}.</span> : null}
          </span>
        </label>
        {shiftToNow ? (
          <button className="link-button justify-self-start text-sm" disabled={running} onClick={() => setNowMs(Date.now())}>Recompute shift from the current time</button>
        ) : null}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={attributeToMe} disabled={running || !currentUserId} onChange={(e) => setAttributeToMe(e.target.checked)} />
          <span>
            Attribute <code>{SAMPLE_USER_FOR_ME}</code>'s rows to me{currentUserId ? <> (<code>{currentUserId}</code>)</> : " (user id unavailable)"}, so the owner-only views show them. Other sample users keep their sample ids.
          </span>
        </label>
        <label className="form-field max-w-md">
          <span>Team id to use instead of <code>{SAMPLE_TEAM}</code> (optional, e.g. your Blocks organization id)</span>
          <input value={teamId} disabled={running} placeholder={SAMPLE_TEAM} onChange={(e) => setTeamId(e.target.value)} />
        </label>
        {!shiftToNow && futureEvents ? <Alert tone="warn">Some sample events are in the future. Turn on the shift, or the dashboards will show usage that has not happened yet.</Alert> : null}
        {coverageWarning ? <Alert tone="warn">{coverageWarning}</Alert> : null}
      </div>

      <div className="metrics">
        {SEED_COLLECTIONS.map((collection) => (
          <div key={collection} className="metric">
            <span>{collection}</span>
            <strong>{counts[collection].ready} to insert</strong>
            <small>{counts[collection].skipped} skipped, {counts[collection].invalid} invalid</small>
          </div>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button className="primary-button danger" disabled={running || readyTotal === 0} onClick={() => setConfirming(true)}>
          Insert {readyTotal} rows into the live project
        </button>
        {running ? <button className="icon-button" onClick={() => { cancelRef.current = true; }}>Stop after the current row</button> : null}
        {runPlan && !running ? <button className="icon-button" onClick={() => { setRunPlan(null); setResults([]); setRunState("idle"); }}>Back to preview</button> : null}
      </div>

      {runPlan ? (
        <div className="panel">
          <div className="panel-title"><span>{running ? "Running" : runState === "cancelled" ? "Stopped" : "Finished"}: {finished} / {results.length} rows</span></div>
          <progress className="w-full" max={Math.max(results.length, 1)} value={finished} />
          {phase ? <p className="muted">{phase}</p> : null}
          {runWarnings.map((warning) => <Alert key={warning} tone="warn">{warning}</Alert>)}
          <ResultSummary results={results} />
        </div>
      ) : null}

      <PreviewTable items={shown} results={runPlan ? results : undefined} />

      {confirming ? (
        <ConfirmSeed
          counts={counts}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void run(plan);
          }}
        />
      ) : null}
    </section>
  );
}

function formatShift(deltaMs: number): string {
  const hours = deltaMs / HOUR_MS;
  if (hours === 0) return "none";
  const days = Math.trunc(hours / 24);
  const rest = hours - days * 24;
  const sign = hours > 0 ? "+" : "-";
  return `${sign}${Math.abs(days) ? `${Math.abs(days)} d ` : ""}${Math.abs(rest)} h`;
}

function ResultSummary({ results }: { results: RowResult[] }) {
  const tally = results.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.state]: (acc[r.state] ?? 0) + 1 }), {});
  return (
    <div className="chips">
      {Object.entries(tally).map(([state, count]) => <span key={state} className="chip">{state}: {count}</span>)}
    </div>
  );
}

const RESULT_TONE: Record<RowResult["state"], "good" | "warn" | "neutral"> = {
  inserted: "good",
  exists: "neutral",
  pending: "neutral",
  skipped: "neutral",
  invalid: "warn",
  error: "warn"
};

function PreviewTable({ items, results }: { items: SeedPlanItem[]; results?: RowResult[] }) {
  return (
    <div className="table-shell">
      <table className="text-sm">
        <thead>
          <tr><th>Schema</th><th>Row</th><th>{results ? "Result" : "Plan"}</th><th>Notes</th></tr>
        </thead>
        <tbody>
          {items.map((item, index) => {
            const result = results?.[index];
            const state = result?.state ?? (item.status === "ready" ? "insert" : item.status);
            const tone = result ? RESULT_TONE[result.state] : item.status === "ready" ? "good" : item.status === "invalid" ? "warn" : "neutral";
            const notes = [result?.message ?? (result ? undefined : item.reason), ...item.warnings].filter(Boolean);
            return (
              <tr key={`${item.collection}-${index}`}>
                <td>{item.collection}</td>
                <td className="mono text-xs">{item.label}</td>
                <td><StatusPill tone={tone}>{state}</StatusPill></td>
                <td className="text-xs">{notes.map((note) => <div key={note}>{note}</div>)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ConfirmSeed({ counts, onCancel, onConfirm }: { counts: Record<SeedCollection, { ready: number }>; onCancel: () => void; onConfirm: () => void }) {
  const [understood, setUnderstood] = useState(false);
  return (
    <Modal title="Write seed data to the live project?" onClose={onCancel}>
      <p>
        This inserts up to {SEED_COLLECTIONS.map((c) => `${counts[c].ready} ${c}`).join(", ")} rows into the live Blocks project.
        Existing rows (same natural key) are skipped. There is no undo from this page.
      </p>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
        <span>I understand this writes real records to the live project.</span>
      </label>
      <div className="modal-actions">
        <button className="icon-button" onClick={onCancel}>Cancel</button>
        <button className="primary-button danger" disabled={!understood} onClick={onConfirm}>Insert rows</button>
      </div>
    </Modal>
  );
}
