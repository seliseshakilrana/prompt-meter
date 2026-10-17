/**
 * Pure timezone helpers built on Intl (no date library).
 *
 * Model (PLAN.md "Time and timezones"):
 * - Everything is stored in UTC. Rollup rows (UserHourly/TeamHourly) hold one
 *   row per UTC hour (`hourStart`, top of the hour).
 * - The portal builds local days/weeks/months in the viewer's IANA timezone.
 *   A local range ("today", "this week", ...) becomes a half-open UTC interval
 *   [start, end) that is used directly as the `hourStart` filter.
 * - An hourly row belongs to the local day that contains the hour's START.
 *   Filtering `start <= hourStart < end` picks exactly those rows, so the
 *   query and the client-side grouping always agree.
 *
 * Edge effect for zones whose offset is not a whole hour: in Asia/Kolkata
 * (UTC+5:30) local midnight is 18:30Z, so the 18:00Z row (local 23:30-00:30)
 * is counted entirely in the earlier day, including its 30 minutes after
 * midnight. Asia/Kathmandu (UTC+5:45) moves up to 45 minutes; a -X:30 zone
 * moves the first 30 minutes of the day the same way. Days are therefore off
 * by at most 45 minutes of usage at their edges -- fine for charts and tiles.
 * Exact numbers for those edge hours need raw UsageEvents (occurredAt).
 */

export type LocalDate = { year: number; month: number; day: number };
export type LocalDateTime = LocalDate & { hour: number; minute: number; second: number };
export type Granularity = "day" | "week" | "month";
/** 0 = Sunday ... 6 = Saturday (same as Date#getUTCDay). Default: Monday. */
export type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type UtcRange = {
  /** Inclusive UTC instant (ISO 8601, `Z`). */
  start: string;
  /** Exclusive UTC instant (ISO 8601, `Z`). */
  end: string;
};

export type LocalRange = UtcRange & {
  /** First local day in the range. */
  startDate: LocalDate;
  /** Last local day in the range (inclusive). */
  lastDate: LocalDate;
};

export type RangePreset = "today" | "thisWeek" | "thisMonth" | "last7" | "last30" | "last90";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      era: "short",
      hour: "numeric",
      hourCycle: "h23",
      minute: "numeric",
      month: "numeric",
      second: "numeric",
      timeZone,
      year: "numeric"
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function toMs(instant: Date | number | string): number {
  if (typeof instant === "number") return instant;
  if (typeof instant === "string") return Date.parse(instant);
  return instant.getTime();
}

/** Wall-clock fields of an instant in a timezone. */
export function getZonedParts(instant: Date | number | string, timeZone: string): LocalDateTime {
  const values: Record<string, string> = {};
  for (const part of partsFormatter(timeZone).formatToParts(toMs(instant))) values[part.type] = part.value;
  let year = Number(values.year);
  if (values.era === "BC" || values.era === "B") year = 1 - year;
  return {
    day: Number(values.day),
    hour: Number(values.hour) % 24,
    minute: Number(values.minute),
    month: Number(values.month),
    second: Number(values.second),
    year
  };
}

function wallAsUtcMs(value: LocalDate & Partial<LocalDateTime>): number {
  return Date.UTC(value.year, value.month - 1, value.day, value.hour ?? 0, value.minute ?? 0, value.second ?? 0);
}

/** Offset of `timeZone` from UTC at `instant`, in minutes (UTC+5:45 -> 345). */
export function getOffsetMinutes(instant: Date | number | string, timeZone: string): number {
  const ms = toMs(instant);
  const flooredMs = Math.floor(ms / 1000) * 1000;
  return Math.round((wallAsUtcMs(getZonedParts(flooredMs, timeZone)) - flooredMs) / 60_000);
}

/**
 * UTC instant (ms) of a local wall-clock time in `timeZone`.
 * - Ambiguous times (DST fall-back) resolve to the earlier occurrence.
 * - Nonexistent times (DST spring-forward gap) are shifted forward by the
 *   gap (London 01:30 on the change day -> 02:30 BST), like Temporal's
 *   "compatible" disambiguation. For a skipped midnight that is exactly the
 *   day's first real instant.
 */
export function zonedTimeToUtc(value: LocalDate & Partial<LocalDateTime>, timeZone: string): number {
  const guess = wallAsUtcMs(value);
  const offsets = new Set([
    getOffsetMinutes(guess - DAY_MS, timeZone),
    getOffsetMinutes(guess, timeZone),
    getOffsetMinutes(guess + DAY_MS, timeZone)
  ]);
  const candidates = [...offsets].map((offset) => guess - offset * 60_000);
  const exact = candidates.filter((candidate) => wallAsUtcMs(getZonedParts(candidate, timeZone)) === guess);
  if (exact.length > 0) return Math.min(...exact);
  return Math.max(...candidates);
}

export function localDateOf(instant: Date | number | string, timeZone: string): LocalDate {
  const { day, month, year } = getZonedParts(instant, timeZone);
  return { day, month, year };
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day) + days * DAY_MS);
  return { day: shifted.getUTCDate(), month: shifted.getUTCMonth() + 1, year: shifted.getUTCFullYear() };
}

export function addMonths(date: LocalDate, months: number): LocalDate {
  const index = date.year * 12 + (date.month - 1) + months;
  return { day: 1, month: (index % 12) + 1, year: Math.floor(index / 12) };
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(date: LocalDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

export function startOfWeek(date: LocalDate, weekStartsOn: WeekStart = 1): LocalDate {
  const back = (weekdayOf(date) - weekStartsOn + 7) % 7;
  return addDays(date, -back);
}

export function compareLocalDates(a: LocalDate, b: LocalDate): number {
  return wallAsUtcMs(a) - wallAsUtcMs(b);
}

const pad = (value: number, size = 2) => String(value).padStart(size, "0");

/** "YYYY-MM-DD" */
export function localDateKey(date: LocalDate): string {
  return `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`;
}

export function parseLocalDateKey(key: string): LocalDate | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return undefined;
  const date = { day: Number(match[3]), month: Number(match[2]), year: Number(match[1]) };
  const check = addDays(date, 0);
  return check.day === date.day && check.month === date.month ? date : undefined;
}

/** UTC ms of local midnight that starts `date`. */
export function startOfLocalDayUtc(date: LocalDate, timeZone: string): number {
  return zonedTimeToUtc(date, timeZone);
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Half-open UTC range covering the local days `first`..`last` (inclusive). */
export function rangeForLocalDates(first: LocalDate, last: LocalDate, timeZone: string): LocalRange {
  const [startDate, lastDate] = compareLocalDates(first, last) <= 0 ? [first, last] : [last, first];
  return {
    end: iso(startOfLocalDayUtc(addDays(lastDate, 1), timeZone)),
    lastDate,
    start: iso(startOfLocalDayUtc(startDate, timeZone)),
    startDate
  };
}

/** Local calendar range in the viewer's zone, as UTC instants. */
export function rangeForPreset(
  preset: RangePreset,
  now: Date | number,
  timeZone: string,
  weekStartsOn: WeekStart = 1
): LocalRange {
  const today = localDateOf(now, timeZone);
  switch (preset) {
    case "today":
      return rangeForLocalDates(today, today, timeZone);
    case "thisWeek": {
      const first = startOfWeek(today, weekStartsOn);
      return rangeForLocalDates(first, addDays(first, 6), timeZone);
    }
    case "thisMonth": {
      const first = { ...today, day: 1 };
      return rangeForLocalDates(first, addDays(addMonths(first, 1), -1), timeZone);
    }
    case "last7":
      return rangeForLocalDates(addDays(today, -6), today, timeZone);
    case "last30":
      return rangeForLocalDates(addDays(today, -29), today, timeZone);
    case "last90":
      return rangeForLocalDates(addDays(today, -89), today, timeZone);
  }
}

/** Smallest UTC range that covers all given ranges. */
export function unionRange(...ranges: UtcRange[]): UtcRange {
  if (ranges.length === 0) throw new Error("unionRange needs at least one range");
  let start = ranges[0]!.start;
  let end = ranges[0]!.end;
  for (const range of ranges) {
    if (Date.parse(range.start) < Date.parse(start)) start = range.start;
    if (Date.parse(range.end) > Date.parse(end)) end = range.end;
  }
  return { end, start };
}

export function isInRange(instant: Date | number | string, range: UtcRange): boolean {
  const ms = toMs(instant);
  return ms >= Date.parse(range.start) && ms < Date.parse(range.end);
}

/** Top of the UTC hour containing `instant`, as ISO. Matches rollup `hourStart`. */
export function floorToUtcHour(instant: Date | number | string): string {
  return iso(Math.floor(toMs(instant) / HOUR_MS) * HOUR_MS);
}

/**
 * Bucket key for an instant in local time:
 * day "YYYY-MM-DD", week "YYYY-MM-DD" of the week's first day, month "YYYY-MM".
 * For an hourly row pass its `hourStart` (the day containing the hour's start).
 */
export function bucketKey(
  instant: Date | number | string,
  timeZone: string,
  granularity: Granularity,
  weekStartsOn: WeekStart = 1
): string {
  const date = localDateOf(instant, timeZone);
  if (granularity === "day") return localDateKey(date);
  if (granularity === "week") return localDateKey(startOfWeek(date, weekStartsOn));
  return `${pad(date.year, 4)}-${pad(date.month)}`;
}

/** Every bucket key that a local range touches, in order (for zero-filled charts). */
export function enumerateBuckets(range: LocalRange, granularity: Granularity, weekStartsOn: WeekStart = 1): string[] {
  const keys: string[] = [];
  let cursor =
    granularity === "day" ? range.startDate
    : granularity === "week" ? startOfWeek(range.startDate, weekStartsOn)
    : { ...range.startDate, day: 1 };
  while (compareLocalDates(cursor, range.lastDate) <= 0) {
    keys.push(granularity === "month" ? localDateKey(cursor).slice(0, 7) : localDateKey(cursor));
    cursor = granularity === "day" ? addDays(cursor, 1) : granularity === "week" ? addDays(cursor, 7) : addMonths(cursor, 1);
  }
  return keys;
}

/** Group rows into local buckets, keyed by `bucketKey` of `getInstant(row)`. */
export function groupByLocal<T>(
  rows: readonly T[],
  getInstant: (row: T) => string,
  timeZone: string,
  granularity: Granularity,
  weekStartsOn: WeekStart = 1
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = bucketKey(getInstant(row), timeZone, granularity, weekStartsOn);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

/** "UTC+05:45", "UTC-03:00", "UTC" */
export function formatUtcOffset(instant: Date | number | string, timeZone: string): string {
  const offset = getOffsetMinutes(instant, timeZone);
  if (offset === 0) return "UTC";
  const sign = offset > 0 ? "+" : "-";
  const abs = Math.abs(offset);
  return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function formatLocalDateTime(instant: Date | number | string, timeZone: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(toMs(instant));
}

export function formatLocalTime(instant: Date | number | string, timeZone: string, locale?: string, withSeconds = false): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: withSeconds ? "2-digit" : undefined,
    timeZone
  }).format(toMs(instant));
}

/** Label for a local calendar date (no timezone math: the date is already local). */
export function formatLocalDate(date: LocalDate, locale?: string, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(wallAsUtcMs(date));
}
