import {
  ChevronDown,
  ChevronRight,
  Clock,
  Filter,
  Lock,
  MessageSquare,
  Search,
  Sparkles,
  X
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTimeZone } from "../../../lib/time/TimeZoneProvider";
import { formatLocalDateTime, formatLocalTime } from "../../../lib/time/zoned";
import { groupSessions, tokensOf } from "../aggregate";
import { formatInteger, formatTokens, formatUsd, toolLabel } from "../format";
import type { UsageEvent } from "../data/types";

type Props = {
  events: UsageEvent[];
  isLoading?: boolean;
  activeSessionId?: string | null;
  onSelectSession?: (sessionId: string | null) => void;
};

export function EventsList({ activeSessionId, events, isLoading, onSelectSession }: Props) {
  const { timeZone } = useTimeZone();
  const [viewMode, setViewMode] = useState<"sessions" | "events">("sessions");
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(() => new Set());
  const [searchQuery, setSearchQuery] = useState("");

  const filteredEvents = useMemo(() => {
    let list = events;
    if (activeSessionId) {
      list = list.filter((e) => e.sessionId === activeSessionId);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (e) =>
          (e.promptPreview && e.promptPreview.toLowerCase().includes(q)) ||
          e.model.toLowerCase().includes(q) ||
          e.tool.toLowerCase().includes(q) ||
          (e.sessionId && e.sessionId.toLowerCase().includes(q))
      );
    }
    return list;
  }, [events, activeSessionId, searchQuery]);

  const sessions = useMemo(() => groupSessions(filteredEvents), [filteredEvents]);

  function toggleSession(key: string) {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="panel p-4 mb-4">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3 border-b border-[hsl(var(--border))] pb-3">
        <div className="flex items-center gap-2">
          <MessageSquare size={16} className="text-[hsl(var(--primary))]" />
          <h3 className="text-sm font-semibold m-0">Prompt & Session Drilldown</h3>
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            ({filteredEvents.length} {filteredEvents.length === 1 ? "call" : "calls"})
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Active Session Filter Chip */}
          {activeSessionId ? (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[hsl(var(--secondary))] text-xs font-medium">
              <Filter size={12} className="text-[hsl(var(--primary))]" />
              <span>Session: <code className="text-xs">{activeSessionId.slice(0, 12)}…</code></span>
              <button
                type="button"
                className="hover:text-[hsl(var(--destructive))] ml-1"
                onClick={() => onSelectSession?.(null)}
                title="Clear session filter"
              >
                <X size={12} />
              </button>
            </div>
          ) : null}

          {/* Search box */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
            <input
              type="text"
              placeholder="Search prompts or models..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="text-xs pl-7 pr-3 py-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] focus:border-[hsl(var(--primary))] outline-none w-44 sm:w-56"
            />
            {searchQuery ? (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                onClick={() => setSearchQuery("")}
              >
                <X size={12} />
              </button>
            ) : null}
          </div>

          {/* View mode toggle */}
          <div className="inline-flex rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-0.5 text-xs">
            <button
              type="button"
              className={`px-2.5 py-0.5 rounded font-medium transition-colors ${
                viewMode === "sessions"
                  ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                  : "text-[hsl(var(--low-emphasis))] hover:text-[hsl(var(--high-emphasis))]"
              }`}
              onClick={() => setViewMode("sessions")}
            >
              Sessions
            </button>
            <button
              type="button"
              className={`px-2.5 py-0.5 rounded font-medium transition-colors ${
                viewMode === "events"
                  ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                  : "text-[hsl(var(--low-emphasis))] hover:text-[hsl(var(--high-emphasis))]"
              }`}
              onClick={() => setViewMode("events")}
            >
              All Calls
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      {filteredEvents.length === 0 ? (
        <div className="text-center py-8 text-sm text-[hsl(var(--muted-foreground))]">
          No usage events found for this filter or range.
        </div>
      ) : viewMode === "sessions" ? (
        /* Sessions View */
        <div className="flex flex-col gap-2">
          {sessions.map((session) => {
            const isExpanded = expandedSessions.has(session.key);
            const firstPreview = session.prompts.find((p) => p.preview)?.preview;

            return (
              <div
                key={session.key}
                className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden"
              >
                {/* Session Header Bar */}
                <div
                  className="flex flex-wrap items-center justify-between gap-3 p-3 cursor-pointer hover:bg-[hsl(var(--secondary)/0.4)] transition-colors"
                  onClick={() => toggleSession(session.key)}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <button
                      type="button"
                      className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                      aria-label={isExpanded ? "Collapse session" : "Expand session"}
                    >
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>

                    <div className="flex flex-col gap-0.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-xs text-[hsl(var(--foreground))]">
                          {session.sessionId ? `Session ${session.sessionId.slice(0, 10)}…` : "Single Prompt / Call"}
                        </span>
                        {session.tools.map((t) => (
                          <span key={t} className="pill pill-neutral text-[10px] py-0 px-1.5 font-medium">
                            {toolLabel(t)}
                          </span>
                        ))}
                        {session.isManual ? (
                          <span className="pill pill-warn text-[10px] py-0 px-1.5 font-semibold">
                            Manual
                          </span>
                        ) : null}
                        {session.unpricedCount > 0 ? (
                          <span className="pill pill-warn text-[10px] py-0 px-1.5 font-medium">
                            {session.unpricedCount} unpriced
                          </span>
                        ) : null}
                      </div>

                      {firstPreview ? (
                        <p className="text-xs text-[hsl(var(--muted-foreground))] truncate max-w-md sm:max-w-xl m-0">
                          {firstPreview}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-xs font-medium shrink-0">
                    <span className="text-[hsl(var(--muted-foreground))] flex items-center gap-1">
                      <Clock size={12} />
                      {formatLocalTime(session.start, timeZone)}
                    </span>
                    <span>
                      <strong>{formatTokens(session.tokens)}</strong> tokens
                    </span>
                    <span className="text-[hsl(var(--foreground))]">
                      {formatUsd(session.costUsd)}
                    </span>
                    <span className="text-[hsl(var(--muted-foreground))] text-[11px]">
                      {session.eventCount} {session.eventCount === 1 ? "call" : "calls"}
                    </span>

                    {session.sessionId && onSelectSession ? (
                      <button
                        type="button"
                        className="text-[hsl(var(--primary))] hover:underline text-[11px]"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectSession(session.sessionId);
                        }}
                      >
                        Drill in
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* Expanded Session Prompts & Calls */}
                {isExpanded ? (
                  <div className="border-t border-[hsl(var(--border))] bg-[hsl(var(--secondary)/0.2)] p-3 flex flex-col gap-3">
                    {session.prompts.map((prompt) => (
                      <div
                        key={prompt.key}
                        className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3"
                      >
                        {/* Prompt Header */}
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-2 border-b border-[hsl(var(--border))]">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-[hsl(var(--foreground))]">
                              Prompt
                            </span>
                            {prompt.preview ? (
                              <span className="inline-flex items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))] bg-[hsl(var(--secondary))] px-1.5 py-0.5 rounded">
                                <Lock size={10} />
                                Owner preview
                              </span>
                            ) : null}
                          </div>

                          <div className="flex items-center gap-3 text-xs">
                            <span className="text-[hsl(var(--muted-foreground))]">
                              {formatLocalTime(prompt.start, timeZone)}
                            </span>
                            <span>
                              <strong>{formatTokens(prompt.tokens)}</strong> tokens
                            </span>
                            <span>{formatUsd(prompt.costUsd)}</span>
                          </div>
                        </div>

                        {/* Prompt Preview */}
                        {prompt.preview ? (
                          <div className="text-xs bg-[hsl(var(--secondary)/0.5)] p-2 rounded mb-2.5 text-[hsl(var(--foreground))] font-mono break-words">
                            "{prompt.preview}"
                          </div>
                        ) : null}

                        {/* Calls Table for this prompt */}
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-[hsl(var(--muted-foreground))] border-b border-[hsl(var(--border))]">
                                <th className="pb-1.5 font-medium">Time</th>
                                <th className="pb-1.5 font-medium">Model</th>
                                <th className="pb-1.5 font-medium text-right">In</th>
                                <th className="pb-1.5 font-medium text-right">Out</th>
                                <th className="pb-1.5 font-medium text-right">Cache</th>
                                <th className="pb-1.5 font-medium text-right">Tokens</th>
                                <th className="pb-1.5 font-medium text-right">Cost</th>
                              </tr>
                            </thead>
                            <tbody>
                              {prompt.calls.map((call) => (
                                <tr key={call.eventId} className="border-b border-[hsl(var(--border)/0.5)] last:border-0">
                                  <td className="py-1 text-[hsl(var(--muted-foreground))]">
                                    {formatLocalTime(call.occurredAt, timeZone, undefined, true)}
                                  </td>
                                  <td className="py-1 font-mono text-[11px]">{call.model}</td>
                                  <td className="py-1 text-right">{formatTokens(call.uncachedInputTokens)}</td>
                                  <td className="py-1 text-right">{formatTokens(call.outputTokens)}</td>
                                  <td className="py-1 text-right text-[hsl(var(--muted-foreground))]">
                                    {formatTokens(call.cacheReadTokens)}
                                  </td>
                                  <td className="py-1 text-right font-semibold">{formatTokens(tokensOf(call))}</td>
                                  <td className="py-1 text-right font-medium">
                                    {call.pricingStatus === "unpriced" || call.costUsd === null ? (
                                      <span className="pill pill-warn text-[9px] py-0 px-1">Unpriced</span>
                                    ) : (
                                      formatUsd(call.costUsd)
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        /* Flat All Calls Table View */
        <div className="table-shell">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th>Time ({timeZone})</th>
                <th>Tool</th>
                <th>Model</th>
                <th>Prompt Preview</th>
                <th className="text-right">Tokens</th>
                <th className="text-right">In / Out / Cache</th>
                <th className="text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.map((event) => (
                <tr key={event.eventId}>
                  <td className="whitespace-nowrap font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
                    {formatLocalDateTime(event.occurredAt, timeZone)}
                  </td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <span className="pill pill-neutral text-[10px] py-0.5 px-2">
                        {toolLabel(event.tool)}
                      </span>
                      {event.source === "manual" ? (
                        <span className="pill pill-warn text-[10px] py-0.5 px-1.5 font-semibold">
                          Manual
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="font-mono text-[11px]">{event.model}</td>
                  <td className="max-w-xs truncate" title={event.promptPreview ?? undefined}>
                    {event.promptPreview ? (
                      <span className="font-mono text-[11px] text-[hsl(var(--foreground))]">
                        "{event.promptPreview}"
                      </span>
                    ) : (
                      <span className="text-[hsl(var(--muted-foreground))] italic text-[11px]">No preview</span>
                    )}
                  </td>
                  <td className="text-right font-semibold">
                    {formatTokens(tokensOf(event))}
                  </td>
                  <td className="text-right text-[11px] text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                    {formatTokens(event.uncachedInputTokens)} / {formatTokens(event.outputTokens)} / {formatTokens(event.cacheReadTokens)}
                  </td>
                  <td className="text-right font-medium">
                    {event.pricingStatus === "unpriced" || event.costUsd === null ? (
                      <span className="pill pill-warn text-[9px] py-0 px-1">Unpriced</span>
                    ) : (
                      formatUsd(event.costUsd)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
