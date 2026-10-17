import { Cpu, Layers, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import { formatInteger, formatTokens, formatUsd, toolLabel } from "../format";
import type { BreakdownRow } from "../aggregate";
import type { HourlyRow } from "../aggregate";
import type { Source, UsageEvent } from "../data/types";
import type { UtcRange } from "../../../lib/time/zoned";
import { breakdownBy } from "../aggregate";
import { isInRange } from "../../../lib/time/zoned";

type TabKind = "tool" | "model" | "source";

type Props = {
  hourlyRows: readonly (HourlyRow & { source?: Source })[];
  unpricedEvents: readonly UsageEvent[];
  range: UtcRange;
  isLoading?: boolean;
};

export function Breakdowns({ hourlyRows, isLoading, range, unpricedEvents }: Props) {
  const [tab, setTab] = useState<TabKind>("tool");

  const toolRows = useMemo(
    () => breakdownBy("tool", hourlyRows, unpricedEvents, range),
    [hourlyRows, unpricedEvents, range]
  );

  const modelRows = useMemo(
    () => breakdownBy("model", hourlyRows, unpricedEvents, range),
    [hourlyRows, unpricedEvents, range]
  );

  const sourceRows = useMemo<BreakdownRow[]>(() => {
    let proxyTokens = 0;
    let proxyCost = 0;
    let proxyEvents = 0;
    let proxyUnpriced = 0;

    let manualTokens = 0;
    let manualCost = 0;
    let manualEvents = 0;
    let manualUnpriced = 0;

    for (const row of hourlyRows) {
      if (!isInRange(row.hourStart, range)) continue;
      const tokens = (row.totalInputTokens || 0) + (row.outputTokens || 0);
      if (row.source === "manual") {
        manualTokens += tokens;
        manualCost += row.costUsd || 0;
        manualEvents += row.eventCount || 0;
      } else {
        proxyTokens += tokens;
        proxyCost += row.costUsd || 0;
        proxyEvents += row.eventCount || 0;
      }
    }

    for (const event of unpricedEvents) {
      if (event.pricingStatus === "unpriced") {
        if (event.source === "manual") manualUnpriced += 1;
        else proxyUnpriced += 1;
      }
    }

    const res: BreakdownRow[] = [];
    if (proxyEvents > 0 || proxyTokens > 0) {
      res.push({
        costUsd: proxyCost,
        eventCount: proxyEvents,
        id: "proxy\u0000proxy",
        source: "proxy",
        tokens: proxyTokens,
        unpricedCount: proxyUnpriced,
        value: "Proxy (Collector)"
      });
    }
    if (manualEvents > 0 || manualTokens > 0) {
      res.push({
        costUsd: manualCost,
        eventCount: manualEvents,
        id: "manual\u0000manual",
        source: "manual",
        tokens: manualTokens,
        unpricedCount: manualUnpriced,
        value: "Manual entry"
      });
    }
    return res.sort((a, b) => b.tokens - a.tokens);
  }, [hourlyRows, unpricedEvents, range]);

  const activeRows = tab === "tool" ? toolRows : tab === "model" ? modelRows : sourceRows;
  const maxTokens = Math.max(1, ...activeRows.map((r) => r.tokens));

  return (
    <div className="panel p-4 mb-4">
      {/* Header with Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3 border-b border-[hsl(var(--border))] pb-3">
        <div className="flex items-center gap-2">
          <Layers size={16} className="text-[hsl(var(--primary))]" />
          <h3 className="text-sm font-semibold m-0">Usage Breakdowns</h3>
        </div>

        <div className="inline-flex rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-0.5 text-xs">
          <button
            type="button"
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded font-medium transition-colors ${
              tab === "tool"
                ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                : "text-[hsl(var(--low-emphasis))] hover:text-[hsl(var(--high-emphasis))]"
            }`}
            onClick={() => setTab("tool")}
          >
            <Wrench size={12} />
            By Tool
          </button>
          <button
            type="button"
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded font-medium transition-colors ${
              tab === "model"
                ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                : "text-[hsl(var(--low-emphasis))] hover:text-[hsl(var(--high-emphasis))]"
            }`}
            onClick={() => setTab("model")}
          >
            <Cpu size={12} />
            By Model
          </button>
          <button
            type="button"
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded font-medium transition-colors ${
              tab === "source"
                ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                : "text-[hsl(var(--low-emphasis))] hover:text-[hsl(var(--high-emphasis))]"
            }`}
            onClick={() => setTab("source")}
          >
            <Layers size={12} />
            By Source
          </button>
        </div>
      </div>

      {/* Breakdown Rows */}
      {activeRows.length === 0 ? (
        <div className="text-center py-8 text-sm text-[hsl(var(--muted-foreground))]">
          No breakdown data found in this range.
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {activeRows.map((row) => {
            const percent = Math.min(100, Math.max(2, Math.round((row.tokens / maxTokens) * 100)));
            const label = tab === "tool" ? toolLabel(row.value) : row.value;

            return (
              <div
                key={row.id}
                className="group relative flex flex-col gap-1 p-2.5 rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--secondary)/0.4)] transition-colors"
              >
                <div className="flex items-center justify-between text-xs gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-sm truncate text-[hsl(var(--foreground))]">
                      {label}
                    </span>
                    {row.source === "manual" ? (
                      <span className="pill pill-warn text-[10px] py-0 px-1.5 font-semibold">
                        Manual
                      </span>
                    ) : null}
                    {row.unpricedCount > 0 ? (
                      <span className="pill pill-warn text-[10px] py-0 px-1.5">
                        {row.unpricedCount} unpriced
                      </span>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-4 shrink-0 font-medium">
                    <span className="text-[hsl(var(--foreground))]">
                      <strong>{formatTokens(row.tokens)}</strong> tokens
                    </span>
                    <span className="text-[hsl(var(--muted-foreground))]">
                      {formatUsd(row.costUsd)}
                    </span>
                    <span className="text-[hsl(var(--muted-foreground))] text-[11px]">
                      {formatInteger(row.eventCount)} {row.eventCount === 1 ? "call" : "calls"}
                    </span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-[hsl(var(--secondary))] h-1.5 rounded-full overflow-hidden mt-0.5">
                  <div
                    className={`h-full rounded-full transition-all ${
                      row.source === "manual" ? "bg-[#f59e0b]" : "bg-[hsl(var(--primary))]"
                    }`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
