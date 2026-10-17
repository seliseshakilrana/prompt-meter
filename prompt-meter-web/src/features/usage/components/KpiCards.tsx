import { AlertCircle, Coins, Cpu, FileQuestion, MessageSquareCode, Sparkles } from "lucide-react";
import { Alert } from "../../../shared/ui/Alert";
import { Skeleton } from "../../../shared/ui/Skeleton";
import { formatInteger, formatTokens, formatUsd } from "../format";
import type { Totals } from "../aggregate";

type Props = {
  totals: Totals;
  isLoading?: boolean;
};

export function KpiCards({ isLoading, totals }: Props) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="panel p-4 flex flex-col gap-2">
            <Skeleton className="skeleton-line w-24" />
            <Skeleton className="skeleton-line-lg w-36 h-8" />
            <Skeleton className="skeleton-line w-40" />
          </div>
        ))}
      </div>
    );
  }

  const callsPerPrompt =
    totals.promptCount > 0 ? (totals.eventCount / totals.promptCount).toFixed(1) : "0";

  return (
    <div className="flex flex-col gap-3 mb-4">
      {/* Unpriced warning banner */}
      {totals.unpricedCount > 0 ? (
        <Alert tone="warn">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="shrink-0" />
            <span>
              <strong>{totals.unpricedCount} unpriced event{totals.unpricedCount > 1 ? "s" : ""}</strong>{" "}
              in this range. These calls have no matching ModelPrice row yet and are counted as $0.00.
            </span>
          </div>
        </Alert>
      ) : null}

      {/* KPI 4-column metric grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Total Tokens */}
        <div className="panel p-4 flex flex-col justify-between">
          <div>
            <div className="panel-title flex items-center justify-between text-xs font-semibold text-[hsl(var(--muted-foreground))]">
              <span className="flex items-center gap-1.5">
                <Coins size={14} className="text-[hsl(var(--primary))]" />
                Total Tokens
              </span>
            </div>
            <div className="text-2xl font-bold mt-2 text-[hsl(var(--foreground))]">
              {formatTokens(totals.tokens)}
            </div>
          </div>
          <div className="text-xs text-[hsl(var(--muted-foreground))] mt-2 truncate" title={`${formatTokens(totals.inputTokens)} in · ${formatTokens(totals.outputTokens)} out · ${formatTokens(totals.cacheReadTokens)} cached`}>
            <span>{formatTokens(totals.inputTokens)} in</span>
            <span className="mx-1">·</span>
            <span>{formatTokens(totals.outputTokens)} out</span>
            <span className="mx-1">·</span>
            <span>{formatTokens(totals.cacheReadTokens)} cache</span>
          </div>
        </div>

        {/* Total Cost */}
        <div className="panel p-4 flex flex-col justify-between">
          <div>
            <div className="panel-title flex items-center justify-between text-xs font-semibold text-[hsl(var(--muted-foreground))]">
              <span className="flex items-center gap-1.5">
                <Sparkles size={14} className="text-[hsl(var(--primary))]" />
                Total Cost
              </span>
            </div>
            <div className="text-2xl font-bold mt-2 text-[hsl(var(--foreground))]">
              {formatUsd(totals.costUsd)}
            </div>
          </div>
          <div className="text-xs text-[hsl(var(--muted-foreground))] mt-2">
            <span>{formatInteger(totals.eventCount)} total calls recorded</span>
          </div>
        </div>

        {/* Prompts & Calls */}
        <div className="panel p-4 flex flex-col justify-between">
          <div>
            <div className="panel-title flex items-center justify-between text-xs font-semibold text-[hsl(var(--muted-foreground))]">
              <span className="flex items-center gap-1.5">
                <MessageSquareCode size={14} className="text-[hsl(var(--primary))]" />
                Prompts & Calls
              </span>
            </div>
            <div className="text-2xl font-bold mt-2 text-[hsl(var(--foreground))]">
              {formatInteger(totals.promptCount)}
              <span className="text-sm font-normal text-[hsl(var(--muted-foreground))] ml-1.5">prompts</span>
            </div>
          </div>
          <div className="text-xs text-[hsl(var(--muted-foreground))] mt-2">
            <span>{callsPerPrompt} calls/prompt on average</span>
          </div>
        </div>

        {/* Manual Usage Callout */}
        <div className="panel p-4 flex flex-col justify-between">
          <div>
            <div className="panel-title flex items-center justify-between text-xs font-semibold text-[hsl(var(--muted-foreground))]">
              <span className="flex items-center gap-1.5">
                <Cpu size={14} className="text-[hsl(var(--primary))]" />
                Manual Usage
              </span>
              <span className="pill pill-warn text-[10px] py-0 px-1.5 font-semibold">Manual</span>
            </div>
            <div className="text-2xl font-bold mt-2 text-[hsl(var(--foreground))]">
              {formatTokens(totals.manualTokens)}
              <span className="text-sm font-normal text-[hsl(var(--muted-foreground))] ml-1.5">tokens</span>
            </div>
          </div>
          <div className="text-xs text-[hsl(var(--muted-foreground))] mt-2">
            <span>{formatUsd(totals.manualCostUsd)} ({totals.manualEventCount} manual {totals.manualEventCount === 1 ? "call" : "calls"})</span>
          </div>
        </div>
      </div>
    </div>
  );
}
