import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useCurrentUser } from "../profile/useCurrentUser";
import { cleanFilters } from "./data/filters";
import { SAMPLE_USERS } from "./data/sampleUsers";
import { dataSourceKind, getUsageDataSource } from "./data/source";
import type { UtcRange } from "../../lib/time/zoned";
import type { PricingStatus, UsageFilters } from "./data/types";

const SAMPLE_USER_KEY = "prompt-meter:sample-user";

export const usageKeys = {
  all: ["usage", dataSourceKind] as const,
  events: (userId: string, query: Record<string, unknown>) => [...usageKeys.all, "events", userId, query] as const,
  teamHourly: (teamId: string, range: UtcRange, filters: UsageFilters) => [...usageKeys.all, "teamHourly", teamId, range.start, range.end, filters] as const,
  userHourly: (userId: string, range: UtcRange, filters: UsageFilters) => [...usageKeys.all, "userHourly", userId, range.start, range.end, filters] as const
};

/**
 * Whose usage the page shows. With live data it is the signed-in user
 * (IAM `itemId`). With sample data the signed-in user owns no rows, so the
 * viewer picks one of the two sample users instead.
 */
export function useUsageUser() {
  const me = useCurrentUser();
  const [sampleUserId, setSampleUserIdState] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(SAMPLE_USER_KEY);
      if (SAMPLE_USERS.some((user) => user.userId === saved)) return saved!;
    } catch {
      // ignore blocked storage
    }
    return SAMPLE_USERS[0].userId;
  });

  function setSampleUserId(userId: string) {
    try {
      localStorage.setItem(SAMPLE_USER_KEY, userId);
    } catch {
      // ignore blocked storage
    }
    setSampleUserIdState(userId);
  }

  if (dataSourceKind === "sample") {
    return { isLoading: false, kind: dataSourceKind, sampleUserId, setSampleUserId, userId: sampleUserId as string | undefined };
  }
  // TODO(live): confirm UsageEvent.userId (set by the workflows from
  // GET /iam/v4/iam/me) is the same value as iam.me().data.itemId.
  return { isLoading: me.isLoading, kind: dataSourceKind, sampleUserId, setSampleUserId, userId: me.data?.data?.itemId };
}

/** UserHourly rows for one user, `range.start <= hourStart < range.end`. */
export function useUserHourly(userId: string | undefined, range: UtcRange, filters?: UsageFilters) {
  const clean = cleanFilters(filters);
  return useQuery({
    enabled: Boolean(userId),
    placeholderData: keepPreviousData,
    queryFn: async () => (await getUsageDataSource()).listUserHourly({ filters: clean, range, userId: userId! }),
    queryKey: usageKeys.userHourly(userId ?? "", range, clean)
  });
}

/** TeamHourly rows (team totals) for the Team usage page. */
export function useTeamHourly(teamId: string | undefined, range: UtcRange, filters?: Omit<UsageFilters, "teamId">) {
  const clean = cleanFilters(filters);
  return useQuery({
    enabled: Boolean(teamId),
    placeholderData: keepPreviousData,
    queryFn: async () => (await getUsageDataSource()).listTeamHourly({ filters: clean, range, teamId: teamId! }),
    queryKey: usageKeys.teamHourly(teamId ?? "", range, clean)
  });
}

export type EventsArgs = {
  range?: UtcRange;
  sessionId?: string;
  promptId?: string;
  pricingStatus?: PricingStatus;
  filters?: UsageFilters;
  limit?: number;
  enabled?: boolean;
};

/** Raw UsageEvents for the current user (lists, drill-downs, unpriced counts). Newest first. */
export function useUsageEvents(userId: string | undefined, args: EventsArgs) {
  const { enabled = true, ...rest } = args;
  const query = { ...rest, filters: cleanFilters(rest.filters) };
  return useQuery({
    enabled: enabled && Boolean(userId),
    placeholderData: keepPreviousData,
    queryFn: async () => (await getUsageDataSource()).listEvents({ ...query, userId: userId! }),
    queryKey: usageKeys.events(userId ?? "", query)
  });
}

/** Every call of one session (not limited to the page's date range). */
export function useSessionEvents(userId: string | undefined, sessionId: string | null | undefined, enabled: boolean) {
  return useUsageEvents(userId, { enabled: enabled && Boolean(sessionId), sessionId: sessionId ?? undefined });
}
