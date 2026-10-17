import { useCurrentUser } from "../profile/useCurrentUser";
import { isPlatformAdmin } from "./roles";

/** Reuses the scaffold's cached `iam.me()` query; read-only feature gating. */
export function useIsPlatformAdmin() {
  const me = useCurrentUser();
  const profile = me.data?.data;
  return {
    isAdmin: isPlatformAdmin(profile?.roles),
    isLoading: me.isLoading,
    isError: me.isError,
    userId: typeof profile?.itemId === "string" ? profile.itemId : undefined
  };
}
