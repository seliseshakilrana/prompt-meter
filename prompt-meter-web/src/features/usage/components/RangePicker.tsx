import { Calendar, Globe, RotateCcw } from "lucide-react";
import { useMemo } from "react";
import { listTimeZones } from "../../../lib/time/timezone";
import { useTimeZone } from "../../../lib/time/TimeZoneProvider";
import { formatLocalDate, formatUtcOffset } from "../../../lib/time/zoned";
import type { LocalRange, RangePreset } from "../../../lib/time/zoned";

type PresetOption = {
  key: RangePreset;
  label: string;
};

const PRESETS: PresetOption[] = [
  { key: "today", label: "Today" },
  { key: "thisWeek", label: "This week" },
  { key: "thisMonth", label: "This month" },
  { key: "last7", label: "Last 7 days" },
  { key: "last30", label: "Last 30 days" }
];

const CURATED_TIMEZONES = [
  { label: "Asia/Dhaka (UTC+6)", value: "Asia/Dhaka" },
  { label: "Asia/Kolkata (UTC+5:30)", value: "Asia/Kolkata" },
  { label: "Europe/London", value: "Europe/London" },
  { label: "America/New_York", value: "America/New_York" },
  { label: "UTC", value: "UTC" }
];

type Props = {
  preset: RangePreset;
  onPresetChange: (preset: RangePreset) => void;
  range: LocalRange;
};

export function RangePicker({ onPresetChange, preset, range }: Props) {
  const { browserTimeZone, override, setOverride, timeZone } = useTimeZone();

  const allZones = useMemo(() => listTimeZones(), []);
  const offsetString = useMemo(() => formatUtcOffset(Date.now(), timeZone), [timeZone]);

  const rangeLabel = useMemo(() => {
    const startStr = formatLocalDate(range.startDate, undefined, { day: "numeric", month: "short", year: "numeric" });
    const lastStr = formatLocalDate(range.lastDate, undefined, { day: "numeric", month: "short", year: "numeric" });
    return startStr === lastStr ? startStr : `${startStr} – ${lastStr}`;
  }, [range]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      {/* Preset buttons */}
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="inline-flex rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-1 shadow-sm">
          {PRESETS.map((p) => {
            const isActive = p.key === preset;
            return (
              <button
                key={p.key}
                type="button"
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  isActive
                    ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-xs"
                    : "text-[hsl(var(--low-emphasis))] hover:text-[hsl(var(--high-emphasis))] hover:bg-[hsl(var(--secondary))]"
                }`}
                onClick={() => onPresetChange(p.key)}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {/* Current range dates indicator */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-xs font-medium text-[hsl(var(--muted-foreground))]">
          <Calendar size={13} className="text-[hsl(var(--primary))]" />
          <span>{rangeLabel}</span>
        </div>
      </div>

      {/* Timezone picker & offset */}
      <div className="flex items-center gap-2">
        <div className="inline-flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2.5 py-1 text-xs shadow-sm">
          <Globe size={14} className="text-[hsl(var(--muted-foreground))]" />
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-[hsl(var(--foreground))]">{offsetString}</span>
            <select
              aria-label="Timezone override"
              className="bg-transparent border-0 text-xs font-medium text-[hsl(var(--foreground))] cursor-pointer focus:outline-none pr-1"
              value={override ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                setOverride(val === "" ? undefined : val);
              }}
            >
              <option value="">System ({browserTimeZone})</option>
              <optgroup label="Popular">
                {CURATED_TIMEZONES.map((zone) => (
                  <option key={zone.value} value={zone.value}>
                    {zone.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="All timezones">
                {allZones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
        </div>

        {override ? (
          <button
            type="button"
            className="icon-button p-1.5 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            onClick={() => setOverride(undefined)}
            title={`Reset timezone to browser default (${browserTimeZone})`}
          >
            <RotateCcw size={13} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
