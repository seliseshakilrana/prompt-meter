import { BarChart3, Calendar, HelpCircle, Layers } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { formatLocalDate, parseLocalDateKey } from "../../../lib/time/zoned";
import { formatTokens, formatUsd, formatUsdTick } from "../format";
import type { TrendPoint } from "../aggregate";

type MetricMode = "tokens" | "cost";

type Props = {
  points: TrendPoint[];
  isLoading?: boolean;
};

export function UsageTrendChart({ isLoading, points }: Props) {
  const chartId = useId();
  const [mode, setMode] = useState<MetricMode>("tokens");
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const activePoint = useMemo(() => {
    if (hoveredKey) {
      const found = points.find((p) => p.key === hoveredKey);
      if (found) return found;
    }
    // Default to the last point that has usage, or the last point in the range
    const withUsage = [...points].reverse().find((p) => p.proxyTokens > 0 || p.manualTokens > 0);
    return withUsage ?? points[points.length - 1] ?? null;
  }, [points, hoveredKey]);

  // Compute maximum values for scaling
  const maxVal = useMemo(() => {
    let max = 0;
    for (const p of points) {
      const total = mode === "tokens" ? p.proxyTokens + p.manualTokens : p.proxyCostUsd + p.manualCostUsd;
      if (total > max) max = total;
    }
    return max > 0 ? max : mode === "tokens" ? 1000 : 1;
  }, [points, mode]);

  // SVG dimensions
  const svgWidth = 640;
  const svgHeight = 220;
  const paddingLeft = 50;
  const paddingRight = 16;
  const paddingTop = 20;
  const paddingBottom = 32;

  const plotWidth = svgWidth - paddingLeft - paddingRight;
  const plotHeight = svgHeight - paddingTop - paddingBottom;
  const zeroY = svgHeight - paddingBottom;

  const count = Math.max(1, points.length);
  const step = plotWidth / count;
  const barWidth = Math.max(6, Math.min(32, step * 0.65));

  // Format axis ticks
  const ticks = [0, 0.5, 1].map((ratio) => {
    const val = maxVal * ratio;
    const y = zeroY - plotHeight * ratio;
    const label = mode === "tokens" ? formatTokens(val) : formatUsdTick(val);
    return { label, y };
  });

  return (
    <div className="panel p-4 mb-4">
      {/* Chart Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <BarChart3 size={16} className="text-[hsl(var(--primary))]" />
          <h3 className="text-sm font-semibold m-0">Daily Usage Trend</h3>
        </div>

        <div className="flex items-center gap-3">
          {/* Legend */}
          <div className="flex items-center gap-3 text-xs text-[hsl(var(--muted-foreground))]">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-xs bg-[hsl(var(--primary))]" />
              Proxy
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-xs bg-[#f59e0b]" />
              Manual
            </span>
          </div>

          {/* Metric Mode Toggle */}
          <div className="inline-flex rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-0.5 text-xs">
            <button
              type="button"
              className={`px-2.5 py-0.5 rounded font-medium transition-colors ${
                mode === "tokens"
                  ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                  : "text-[hsl(var(--low-emphasis))] hover:text-[hsl(var(--high-emphasis))]"
              }`}
              onClick={() => setMode("tokens")}
            >
              Tokens
            </button>
            <button
              type="button"
              className={`px-2.5 py-0.5 rounded font-medium transition-colors ${
                mode === "cost"
                  ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                  : "text-[hsl(var(--low-emphasis))] hover:text-[hsl(var(--high-emphasis))]"
              }`}
              onClick={() => setMode("cost")}
            >
              Cost ($)
            </button>
          </div>
        </div>
      </div>

      {/* Point details strip */}
      {activePoint ? (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 mb-2 rounded bg-[hsl(var(--secondary)/0.6)] text-xs">
          <div className="flex items-center gap-2">
            <Calendar size={13} className="text-[hsl(var(--primary))]" />
            <strong className="text-[hsl(var(--foreground))]">
              {(() => {
                const date = parseLocalDateKey(activePoint.key);
                return date
                  ? formatLocalDate(date, undefined, { weekday: "short", month: "short", day: "numeric" })
                  : activePoint.key;
              })()}
            </strong>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span>
              Total: <strong>{formatTokens(activePoint.proxyTokens + activePoint.manualTokens)}</strong> ({formatUsd(activePoint.proxyCostUsd + activePoint.manualCostUsd)})
            </span>
            <span>
              Proxy: <strong>{formatTokens(activePoint.proxyTokens)}</strong> ({formatUsd(activePoint.proxyCostUsd)})
            </span>
            {activePoint.manualTokens > 0 || activePoint.manualCostUsd > 0 ? (
              <span className="text-[#d97706]">
                Manual: <strong>{formatTokens(activePoint.manualTokens)}</strong> ({formatUsd(activePoint.manualCostUsd)})
              </span>
            ) : null}
            <span>{activePoint.eventCount} calls</span>
            {activePoint.unpricedCount > 0 ? (
              <span className="pill pill-warn text-[10px] py-0 px-1">
                {activePoint.unpricedCount} unpriced
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* SVG Chart */}
      <div className="relative w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-auto max-h-[260px] min-w-[480px] select-none"
          role="img"
          aria-label="Usage trend chart"
        >
          {/* Horizontal Grid lines & Y-axis labels */}
          {ticks.map((tick, idx) => (
            <g key={idx}>
              <line
                x1={paddingLeft}
                y1={tick.y}
                x2={svgWidth - paddingRight}
                y2={tick.y}
                stroke="hsl(var(--border))"
                strokeDasharray={idx > 0 ? "3 3" : undefined}
                strokeWidth={1}
              />
              <text
                x={paddingLeft - 6}
                y={tick.y + 3}
                textAnchor="end"
                fontSize={10}
                fill="hsl(var(--muted-foreground))"
              >
                {tick.label}
              </text>
            </g>
          ))}

          {/* Daily Bars */}
          {points.map((point, i) => {
            const centerX = paddingLeft + (i + 0.5) * step;
            const x = centerX - barWidth / 2;

            const proxyVal = mode === "tokens" ? point.proxyTokens : point.proxyCostUsd;
            const manualVal = mode === "tokens" ? point.manualTokens : point.manualCostUsd;

            const proxyH = Math.min(plotHeight, Math.max(0, (proxyVal / maxVal) * plotHeight));
            const manualH = Math.min(plotHeight - proxyH, Math.max(0, (manualVal / maxVal) * plotHeight));

            const proxyY = zeroY - proxyH;
            const manualY = proxyY - manualH;

            const isHovered = hoveredKey === point.key;
            const parsed = parseLocalDateKey(point.key);
            const labelDay = parsed ? String(parsed.day) : point.key.slice(-2);

            // Show label every N days if many points
            const showLabel = points.length <= 14 || i % Math.ceil(points.length / 10) === 0 || i === points.length - 1;

            return (
              <g
                key={point.key}
                className="cursor-pointer"
                onMouseEnter={() => setHoveredKey(point.key)}
                onMouseLeave={() => setHoveredKey(null)}
                tabIndex={0}
                onFocus={() => setHoveredKey(point.key)}
                onBlur={() => setHoveredKey(null)}
              >
                {/* Background hover highlight */}
                <rect
                  x={centerX - step / 2}
                  y={paddingTop}
                  width={step}
                  height={plotHeight + 5}
                  fill={isHovered ? "hsl(var(--secondary)/0.5)" : "transparent"}
                  rx={3}
                />

                {/* Proxy Bar */}
                {proxyH > 0 ? (
                  <rect
                    x={x}
                    y={proxyY}
                    width={barWidth}
                    height={proxyH}
                    fill="hsl(var(--primary))"
                    rx={manualH > 0 ? 0 : 2}
                    opacity={isHovered ? 0.85 : 1}
                  />
                ) : null}

                {/* Manual Bar (stacked on top of Proxy) */}
                {manualH > 0 ? (
                  <rect
                    x={x}
                    y={manualY}
                    width={barWidth}
                    height={manualH}
                    fill="#f59e0b"
                    rx={2}
                    opacity={isHovered ? 0.85 : 1}
                  />
                ) : null}

                {/* Subtle base marker if both zero */}
                {proxyH === 0 && manualH === 0 ? (
                  <circle cx={centerX} cy={zeroY - 1} r={1.5} fill="hsl(var(--border))" />
                ) : null}

                {/* X-axis date label */}
                {showLabel ? (
                  <text
                    x={centerX}
                    y={zeroY + 16}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={isHovered ? "700" : "500"}
                    fill={isHovered ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))"}
                  >
                    {labelDay}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
