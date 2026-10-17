import { RefreshCw, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { useT } from "../../lib/i18n/LocalizationProvider";
import { useNow, useTimeZone } from "../../lib/time/TimeZoneProvider";
import { rangeForPreset } from "../../lib/time/zoned";
import type { RangePreset } from "../../lib/time/zoned";
import { ActionButton } from "../../shared/ui/ActionButton";
import { EmptyState } from "../../shared/ui/EmptyState";
import { ErrorState } from "../../shared/ui/ErrorState";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Skeleton } from "../../shared/ui/Skeleton";
import { distinctValues, summarize, trendByDay } from "./aggregate";
import { Breakdowns } from "./components/Breakdowns";
import { EventsList } from "./components/EventsList";
import { KpiCards } from "./components/KpiCards";
import { RangePicker } from "./components/RangePicker";
import { SampleUserSwitcher } from "./components/SampleUserSwitcher";
import { UsageTrendChart } from "./components/UsageTrendChart";
import { toolLabel } from "./format";
import { useUsageEvents, useUsageUser, useUserHourly } from "./useUsage";
import type { Source, UsageFilters } from "./data/types";

export default function MyUsagePage() {
  const { t } = useT();
  const { timeZone } = useTimeZone();
  const now = useNow();
  const { isLoading: userLoading, userId } = useUsageUser();

  const [preset, setPreset] = useState<RangePreset>("today");
  const [toolFilter, setToolFilter] = useState<string>("");
  const [teamFilter, setTeamFilter] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<Source | "">("");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Compute local range from preset and active timezone
  const range = useMemo(() => rangeForPreset(preset, now, timeZone), [preset, now, timeZone]);

  const filters: UsageFilters = useMemo(
    () => ({
      source: sourceFilter || undefined,
      teamId: teamFilter || undefined,
      tool: toolFilter || undefined
    }),
    [sourceFilter, teamFilter, toolFilter]
  );

  const hourlyQuery = useUserHourly(userId, range, filters);
  const eventsQuery = useUsageEvents(userId, {
    filters,
    limit: 100,
    range,
    sessionId: activeSessionId || undefined
  });

  const hourlyRows = hourlyQuery.data ?? [];
  const events = eventsQuery.data?.items ?? [];

  // Available filter options discovered from data
  const distinctTools = useMemo(() => distinctValues(hourlyRows, "tool"), [hourlyRows]);
  const distinctTeams = useMemo(() => distinctValues(hourlyRows, "teamId"), [hourlyRows]);

  // Aggregate metrics
  const totals = useMemo(() => summarize(hourlyRows, range, events), [hourlyRows, range, events]);
  const trendPoints = useMemo(() => trendByDay(hourlyRows, events, range, timeZone), [hourlyRows, events, range, timeZone]);

  const isInitialLoading = userLoading || (hourlyQuery.isLoading && !hourlyQuery.data);
  const hasError = hourlyQuery.isError || eventsQuery.isError;
  const isRefreshing = hourlyQuery.isFetching || eventsQuery.isFetching;

  function handleRefresh() {
    void hourlyQuery.refetch();
    void eventsQuery.refetch();
  }

  function handleResetFilters() {
    setToolFilter("");
    setTeamFilter("");
    setSourceFilter("");
    setActiveSessionId(null);
  }

  const hasActiveFilters = Boolean(toolFilter || teamFilter || sourceFilter || activeSessionId);

  return (
    <section>
      <PageHeader
        title={t("usage.title", "My usage")}
        subtitle={t("usage.subtitle", "Track your tokens, costs, and prompts across tools.")}
        actions={
          <ActionButton
            variant="icon"
            title="Refresh usage data"
            icon={<RefreshCw size={18} className={isRefreshing ? "animate-spin" : ""} />}
            onClick={handleRefresh}
          />
        }
      />

      {/* Sample User Switcher Banner (active in sample mode) */}
      <SampleUserSwitcher />

      {/* Range and Timezone Picker */}
      <RangePicker preset={preset} onPresetChange={setPreset} range={range} />

      {/* Dimensional Filters Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          {/* Tool filter */}
          <select
            aria-label="Filter by Tool"
            className="text-xs px-2.5 py-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] focus:border-[hsl(var(--primary))] outline-none font-medium cursor-pointer"
            value={toolFilter}
            onChange={(e) => setToolFilter(e.target.value)}
          >
            <option value="">All Tools</option>
            {distinctTools.map((tool) => (
              <option key={tool} value={tool}>
                {toolLabel(tool)}
              </option>
            ))}
          </select>

          {/* Team filter */}
          {distinctTeams.length > 0 ? (
            <select
              aria-label="Filter by Team"
              className="text-xs px-2.5 py-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] focus:border-[hsl(var(--primary))] outline-none font-medium cursor-pointer"
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
            >
              <option value="">All Teams</option>
              {distinctTeams.map((team) => (
                <option key={team} value={team}>
                  {team}
                </option>
              ))}
            </select>
          ) : null}

          {/* Source filter */}
          <select
            aria-label="Filter by Source"
            className="text-xs px-2.5 py-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] focus:border-[hsl(var(--primary))] outline-none font-medium cursor-pointer"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as Source | "")}
          >
            <option value="">All Sources</option>
            <option value="proxy">Proxy (Collector)</option>
            <option value="manual">Manual Entry</option>
          </select>

          {hasActiveFilters ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] px-2 py-1"
              onClick={handleResetFilters}
            >
              <RotateCcw size={12} />
              Reset filters
            </button>
          ) : null}
        </div>
      </div>

      {/* Main Content Area */}
      {isInitialLoading ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="panel p-4">
                <Skeleton className="skeleton-line w-24 mb-2" />
                <Skeleton className="skeleton-line-lg w-32" />
              </div>
            ))}
          </div>
          <div className="panel p-4">
            <Skeleton className="skeleton-line-lg w-48 mb-4" />
            <Skeleton className="w-full h-48" />
          </div>
        </div>
      ) : hasError ? (
        <ErrorState
          message="Failed to load usage data. Check your network connection and try again."
          onRetry={handleRefresh}
        />
      ) : (
        <>
          {/* Summary Metric Cards */}
          <KpiCards totals={totals} isLoading={hourlyQuery.isFetching && !hourlyQuery.data} />

          {/* Daily Trend Chart */}
          <UsageTrendChart points={trendPoints} />

          {/* Tool, Model, Source Breakdowns */}
          <Breakdowns
            hourlyRows={hourlyRows}
            unpricedEvents={events}
            range={range}
            isLoading={hourlyQuery.isFetching}
          />

          {/* Events & Sessions Drilldown Table */}
          <EventsList
            events={events}
            activeSessionId={activeSessionId}
            onSelectSession={setActiveSessionId}
            isLoading={eventsQuery.isFetching}
          />
        </>
      )}
    </section>
  );
}
export { MyUsagePage };
