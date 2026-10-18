import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "../profile/useCurrentUser";
import { listLinkedAccounts } from "./accountsApi";

export const LINKED_ACCOUNTS_KEY = ["accounts", "linked"] as const;

export function useLinkedAccounts() {
  const me = useCurrentUser();
  const userId = me.data?.data?.itemId;
  const accounts = useQuery({
    enabled: Boolean(userId),
    queryFn: () => listLinkedAccounts(userId as string),
    queryKey: [...LINKED_ACCOUNTS_KEY, userId]
  });
  return {
    ...accounts,
    // Still waiting on who the user is counts as loading, not as "no accounts".
    isLoading: me.isLoading || accounts.isLoading,
    isError: me.isError || accounts.isError,
    refetch: () => (me.isError ? me.refetch() : accounts.refetch())
  };
}

/** Client-side navigation through the app router (it listens to popstate). */
export function navigateTo(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
