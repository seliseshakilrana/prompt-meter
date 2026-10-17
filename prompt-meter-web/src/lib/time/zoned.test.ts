import { describe, expect, it } from "vitest";
import {
  bucketKey,
  enumerateBuckets,
  floorToUtcHour,
  formatLocalTime,
  formatUtcOffset,
  getOffsetMinutes,
  groupByLocal,
  isInRange,
  isValidTimeZone,
  localDateOf,
  parseLocalDateKey,
  rangeForLocalDates,
  rangeForPreset,
  startOfLocalDayUtc,
  unionRange,
  zonedTimeToUtc
} from "./zoned";
import { readTimeZoneOverride, resolveTimeZone, TIMEZONE_OVERRIDE_KEY, writeTimeZoneOverride } from "./timezone";

const DHAKA = "Asia/Dhaka";
const KOLKATA = "Asia/Kolkata";
const KATHMANDU = "Asia/Kathmandu";
const LONDON = "Europe/London";
const iso = (ms: number) => new Date(ms).toISOString();

// 2026-10-17 is a Saturday.
const NOW = Date.parse("2026-10-17T19:00:00Z");

describe("offsets", () => {
  it("reports whole, half and three-quarter hour offsets", () => {
    expect(getOffsetMinutes(NOW, DHAKA)).toBe(360);
    expect(getOffsetMinutes(NOW, KOLKATA)).toBe(330);
    expect(getOffsetMinutes(NOW, KATHMANDU)).toBe(345);
    expect(formatUtcOffset(NOW, KATHMANDU)).toBe("UTC+05:45");
    expect(formatUtcOffset(NOW, "UTC")).toBe("UTC");
    expect(formatUtcOffset(NOW, "America/St_Johns")).toBe("UTC-02:30");
  });

  it("follows Europe/London across both DST changes", () => {
    expect(getOffsetMinutes("2026-10-25T00:59:59Z", LONDON)).toBe(60);
    expect(getOffsetMinutes("2026-10-25T01:00:00Z", LONDON)).toBe(0);
    expect(getOffsetMinutes("2026-03-29T00:59:59Z", LONDON)).toBe(0);
    expect(getOffsetMinutes("2026-03-29T01:00:00Z", LONDON)).toBe(60);
  });

  it("validates IANA names", () => {
    expect(isValidTimeZone(KATHMANDU)).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("local midnight as UTC", () => {
  const oct18 = { day: 18, month: 10, year: 2026 };

  it.each([
    [DHAKA, "2026-10-17T18:00:00.000Z"],
    [KOLKATA, "2026-10-17T18:30:00.000Z"],
    [KATHMANDU, "2026-10-17T18:15:00.000Z"],
    ["UTC", "2026-10-18T00:00:00.000Z"]
  ])("%s", (zone, expected) => {
    expect(iso(startOfLocalDayUtc(oct18, zone))).toBe(expected);
  });

  it("resolves an ambiguous fall-back time to the earlier instant", () => {
    expect(iso(zonedTimeToUtc({ day: 25, hour: 1, minute: 30, month: 10, year: 2026 }, LONDON))).toBe("2026-10-25T00:30:00.000Z");
  });

  it("shifts a nonexistent spring-forward time forward by the gap (01:30 -> 02:30 BST)", () => {
    expect(iso(zonedTimeToUtc({ day: 29, hour: 1, minute: 30, month: 3, year: 2026 }, LONDON))).toBe("2026-03-29T01:30:00.000Z");
  });

  it("start of day is always the first instant of that local date, even where midnight is skipped", () => {
    // America/Santiago and America/Havana move clocks at local midnight.
    for (const zone of ["America/Santiago", "America/Havana", LONDON, KOLKATA]) {
      for (let offset = 0; offset < 366; offset += 1) {
        const date = localDateOf(Date.UTC(2026, 0, 1) + offset * 86_400_000, "UTC");
        const start = startOfLocalDayUtc(date, zone);
        expect(localDateOf(start, zone)).toEqual(date);
        expect(localDateOf(start - 1000, zone)).not.toEqual(date);
      }
    }
  });
});

describe("range presets", () => {
  it("today in Dhaka, Kolkata and Kathmandu", () => {
    expect(rangeForPreset("today", NOW, DHAKA)).toMatchObject({ end: "2026-10-18T18:00:00.000Z", start: "2026-10-17T18:00:00.000Z" });
    expect(rangeForPreset("today", NOW, KOLKATA)).toMatchObject({ end: "2026-10-18T18:30:00.000Z", start: "2026-10-17T18:30:00.000Z" });
    // 19:00Z is still Oct 17 nowhere east of +5... except it is Oct 18 01:00 in Dhaka; at 18:20Z Kathmandu is Oct 18 00:05.
    expect(rangeForPreset("today", Date.parse("2026-10-17T18:20:00Z"), KATHMANDU)).toMatchObject({
      end: "2026-10-18T18:15:00.000Z",
      start: "2026-10-17T18:15:00.000Z"
    });
    expect(rangeForPreset("today", Date.parse("2026-10-17T18:10:00Z"), KATHMANDU)).toMatchObject({
      start: "2026-10-16T18:15:00.000Z"
    });
  });

  it("this week starts on Monday in local time", () => {
    // NOW is Sunday 18 Oct 01:00 in Dhaka -> week of Monday 12 Oct.
    expect(rangeForPreset("thisWeek", NOW, DHAKA)).toMatchObject({ end: "2026-10-18T18:00:00.000Z", start: "2026-10-11T18:00:00.000Z" });
    // Kolkata: Sunday 00:30 local. An hour earlier (17:00Z) it was still Saturday 22:30.
    expect(rangeForPreset("thisWeek", NOW, KOLKATA)).toMatchObject({ end: "2026-10-18T18:30:00.000Z", start: "2026-10-11T18:30:00.000Z" });
    expect(rangeForPreset("thisWeek", NOW, KOLKATA, 0).start).toBe("2026-10-17T18:30:00.000Z");
    expect(rangeForPreset("thisWeek", Date.parse("2026-10-17T17:00:00Z"), KOLKATA, 0).start).toBe("2026-10-10T18:30:00.000Z");
  });

  it("this month in a fixed and in a DST zone", () => {
    expect(rangeForPreset("thisMonth", NOW, KOLKATA)).toMatchObject({ end: "2026-10-31T18:30:00.000Z", start: "2026-09-30T18:30:00.000Z" });
    // London: BST at the start of October, GMT at the end.
    expect(rangeForPreset("thisMonth", NOW, LONDON)).toMatchObject({ end: "2026-11-01T00:00:00.000Z", start: "2026-09-30T23:00:00.000Z" });
  });

  it("the London DST days are 25 and 23 hours long", () => {
    const autumn = rangeForLocalDates({ day: 25, month: 10, year: 2026 }, { day: 25, month: 10, year: 2026 }, LONDON);
    expect(autumn).toMatchObject({ end: "2026-10-26T00:00:00.000Z", start: "2026-10-24T23:00:00.000Z" });
    expect((Date.parse(autumn.end) - Date.parse(autumn.start)) / 3_600_000).toBe(25);
    const spring = rangeForLocalDates({ day: 29, month: 3, year: 2026 }, { day: 29, month: 3, year: 2026 }, LONDON);
    expect((Date.parse(spring.end) - Date.parse(spring.start)) / 3_600_000).toBe(23);
  });

  it("custom range accepts dates in either order and last N days include today", () => {
    const a = { day: 1, month: 10, year: 2026 };
    const b = { day: 3, month: 10, year: 2026 };
    expect(rangeForLocalDates(b, a, DHAKA)).toEqual(rangeForLocalDates(a, b, DHAKA));
    const last7 = rangeForPreset("last7", NOW, KOLKATA);
    expect(last7.startDate).toEqual({ day: 12, month: 10, year: 2026 });
    expect(last7.lastDate).toEqual({ day: 18, month: 10, year: 2026 });
  });

  it("union and membership are half-open", () => {
    const r = unionRange({ end: "2026-10-02T00:00:00Z", start: "2026-10-01T00:00:00Z" }, { end: "2026-10-05T00:00:00Z", start: "2026-09-30T00:00:00Z" });
    expect(r).toEqual({ end: "2026-10-05T00:00:00Z", start: "2026-09-30T00:00:00Z" });
    expect(isInRange("2026-10-05T00:00:00Z", r)).toBe(false);
    expect(isInRange("2026-09-30T00:00:00Z", r)).toBe(true);
  });
});

describe("grouping UTC hourly rows into local buckets", () => {
  // The sample's hours, 16:00Z-19:00Z on 2026-10-17.
  const rows = ["16", "17", "18", "19"].map((h) => ({ hourStart: `2026-10-17T${h}:00:00.000Z` }));
  const days = (zone: string) =>
    Object.fromEntries([...groupByLocal(rows, (r) => r.hourStart, zone, "day")].map(([k, v]) => [k, v.map((r) => r.hourStart.slice(11, 13))]));

  it("Dhaka (UTC+6): local midnight is exactly 18:00Z", () => {
    expect(days(DHAKA)).toEqual({ "2026-10-17": ["16", "17"], "2026-10-18": ["18", "19"] });
  });

  it("Kolkata (UTC+5:30): the 18:00Z hour starts at 23:30 and stays in the earlier day", () => {
    expect(days(KOLKATA)).toEqual({ "2026-10-17": ["16", "17", "18"], "2026-10-18": ["19"] });
  });

  it("Kathmandu (UTC+5:45): the 18:00Z hour starts at 23:45 and stays in the earlier day", () => {
    expect(days(KATHMANDU)).toEqual({ "2026-10-17": ["16", "17", "18"], "2026-10-18": ["19"] });
  });

  it("the hourStart range filter picks the same rows as grouping (Kolkata)", () => {
    const today = rangeForLocalDates({ day: 18, month: 10, year: 2026 }, { day: 18, month: 10, year: 2026 }, KOLKATA);
    expect(rows.filter((r) => isInRange(r.hourStart, today)).map((r) => r.hourStart.slice(11, 13))).toEqual(["19"]);
  });

  it("London: hours around the fall-back change land on the right local day", () => {
    const londonRows = ["2026-10-24T22:00:00.000Z", "2026-10-24T23:00:00.000Z", "2026-10-25T23:00:00.000Z", "2026-10-26T00:00:00.000Z"].map((hourStart) => ({ hourStart }));
    const grouped = groupByLocal(londonRows, (r) => r.hourStart, LONDON, "day");
    expect([...grouped.keys()]).toEqual(["2026-10-24", "2026-10-25", "2026-10-26"]);
    expect(grouped.get("2026-10-25")).toHaveLength(2);
  });

  it("weeks and months", () => {
    expect(bucketKey("2026-10-17T18:00:00Z", DHAKA, "week")).toBe("2026-10-12"); // Sunday 00:00 -> week of Mon 12th
    expect(bucketKey("2026-10-17T18:00:00Z", DHAKA, "week", 0)).toBe("2026-10-18");
    expect(bucketKey("2026-09-30T18:00:00Z", KOLKATA, "month")).toBe("2026-09"); // 23:30 on 30 Sep
    expect(bucketKey("2026-09-30T19:00:00Z", KOLKATA, "month")).toBe("2026-10");
  });

  it("enumerates zero-fill buckets", () => {
    const range = rangeForLocalDates({ day: 28, month: 9, year: 2026 }, { day: 2, month: 10, year: 2026 }, KOLKATA);
    expect(enumerateBuckets(range, "day")).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(enumerateBuckets(range, "month")).toEqual(["2026-09", "2026-10"]);
    expect(enumerateBuckets(range, "week")).toEqual(["2026-09-28"]);
  });
});

describe("helpers", () => {
  it("floors to the UTC hour like the rollup", () => {
    expect(floorToUtcHour("2026-10-17T18:58:02.000Z")).toBe("2026-10-17T18:00:00.000Z");
  });

  it("formats in the local zone", () => {
    expect(formatLocalTime("2026-10-17T18:21:15Z", KOLKATA, "en-GB")).toBe("23:51");
    expect(formatLocalTime("2026-10-17T18:21:15Z", KATHMANDU, "en-GB")).toBe("00:06");
  });

  it("parses date keys strictly", () => {
    expect(parseLocalDateKey("2026-02-29")).toBeUndefined();
    expect(parseLocalDateKey("2026-10-17")).toEqual({ day: 17, month: 10, year: 2026 });
  });
});

describe("timezone override", () => {
  function memoryStorage() {
    const map = new Map<string, string>();
    return { getItem: (k: string) => map.get(k) ?? null, map, removeItem: (k: string) => void map.delete(k), setItem: (k: string, v: string) => void map.set(k, v) };
  }

  it("a valid override wins, invalid ones are ignored and cleared", () => {
    const storage = memoryStorage();
    expect(resolveTimeZone(readTimeZoneOverride(storage), DHAKA)).toBe(DHAKA);
    writeTimeZoneOverride(KATHMANDU, storage);
    expect(resolveTimeZone(readTimeZoneOverride(storage), DHAKA)).toBe(KATHMANDU);
    storage.setItem(TIMEZONE_OVERRIDE_KEY, "Not/AZone");
    expect(readTimeZoneOverride(storage)).toBeUndefined();
    writeTimeZoneOverride(undefined, storage);
    expect(storage.map.has(TIMEZONE_OVERRIDE_KEY)).toBe(false);
    expect(resolveTimeZone(undefined, "bogus")).toBe("UTC");
  });
});
