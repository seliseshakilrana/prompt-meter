import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getBrowserTimeZone, readTimeZoneOverride, resolveTimeZone, writeTimeZoneOverride } from "./timezone";

type TimeZoneValue = {
  /** Zone the browser reports. */
  browserTimeZone: string;
  /** Saved override, if any. */
  override: string | undefined;
  setOverride: (zone: string | undefined) => void;
  /** Zone every date in the portal is shown and grouped in. */
  timeZone: string;
};

const TimeZoneContext = createContext<TimeZoneValue | undefined>(undefined);

export function TimeZoneProvider({ children }: { children: ReactNode }) {
  const [browserTimeZone] = useState(getBrowserTimeZone);
  const [override, setOverrideState] = useState(() => readTimeZoneOverride());

  // Keep several tabs in sync when the override changes elsewhere.
  useEffect(() => {
    const onStorage = () => setOverrideState(readTimeZoneOverride());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setOverride = useCallback((zone: string | undefined) => {
    writeTimeZoneOverride(zone);
    setOverrideState(zone && zone !== "" ? zone : undefined);
  }, []);

  const value = useMemo<TimeZoneValue>(() => ({
    browserTimeZone,
    override,
    setOverride,
    timeZone: resolveTimeZone(override, browserTimeZone)
  }), [browserTimeZone, override, setOverride]);

  return <TimeZoneContext.Provider value={value}>{children}</TimeZoneContext.Provider>;
}

export function useTimeZone(): TimeZoneValue {
  const context = useContext(TimeZoneContext);
  if (!context) {
    const browserTimeZone = getBrowserTimeZone();
    return {
      browserTimeZone,
      override: undefined,
      setOverride: () => {},
      timeZone: browserTimeZone
    };
  }
  return context;
}

/** Current time, refreshed on an interval so "today" rolls over at local midnight. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
