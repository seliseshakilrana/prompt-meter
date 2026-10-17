import { isValidTimeZone } from "./zoned";

/** localStorage key for the optional timezone override (PLAN.md "Settings"). */
export const TIMEZONE_OVERRIDE_KEY = "prompt-meter:timezone-override";

type StorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;

function defaultStorage(): StorageLike | undefined {
  try {
    return typeof window !== "undefined" ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

export function getBrowserTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isValidTimeZone(zone) ? zone : "UTC";
}

/** Saved override, or undefined when unset or no longer a valid IANA zone. */
export function readTimeZoneOverride(storage: StorageLike | undefined = defaultStorage()): string | undefined {
  try {
    const value = storage?.getItem(TIMEZONE_OVERRIDE_KEY);
    return isValidTimeZone(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Saves an override; pass undefined (or an invalid zone) to clear it. */
export function writeTimeZoneOverride(zone: string | undefined, storage: StorageLike | undefined = defaultStorage()): void {
  try {
    if (isValidTimeZone(zone)) storage?.setItem(TIMEZONE_OVERRIDE_KEY, zone);
    else storage?.removeItem(TIMEZONE_OVERRIDE_KEY);
  } catch {
    // Storage can be blocked (private mode); the override then lasts for this page only.
  }
}

/** The zone the portal shows times in: a valid override wins, else the browser's. */
export function resolveTimeZone(override: string | undefined, browserZone: string = getBrowserTimeZone()): string {
  if (isValidTimeZone(override)) return override;
  return isValidTimeZone(browserZone) ? browserZone : "UTC";
}

/** IANA zones the runtime knows, for the override picker. */
export function listTimeZones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  const zones = intl.supportedValuesOf?.("timeZone") ?? [];
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}
