import { Link2 } from "lucide-react";
import type { ReactNode } from "react";
import { linkingConfig } from "../../lib/blocks/config";
import { ErrorState } from "../../shared/ui/ErrorState";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Skeleton } from "../../shared/ui/Skeleton";
import { describeError } from "../admin/adminApi";
import { LinkedAccountsPanel } from "./LinkedAccountsPanel";
import { useLinkedAccounts } from "./useLinkedAccounts";

/**
 * Shows its children (the usage dashboard) only once the signed-in user has at least one
 * verified tool account. Until then it asks them to connect one. Off unless
 * VITE_PM_ACCOUNT_LINKING=on.
 */
export function RequireLinkedAccount({ children, returnTo }: { children: ReactNode; returnTo: string }) {
  const accounts = useLinkedAccounts();
  if (!linkingConfig.enabled) return <>{children}</>;
  if (accounts.isLoading) {
    return <div className="panel"><Skeleton className="skeleton-line-lg" /><Skeleton className="skeleton-line" /></div>;
  }
  if (accounts.isError) {
    return <ErrorState message={`Could not check your connected accounts: ${describeError(accounts.error)}`} onRetry={() => void accounts.refetch()} />;
  }
  if ((accounts.data ?? []).length > 0) return <>{children}</>;
  return (
    <section>
      <PageHeader
        title="Connect an AI account"
        subtitle="Prompt Meter shows usage for the Claude, Codex or Antigravity accounts you connect. Connect at least one to open your dashboard."
      />
      <div className="empty-state">
        <div className="empty-icon"><Link2 size={28} /></div>
        <p>Enter the email of the account you use with the tool, then confirm it with Google, Microsoft or a code sent to that address.</p>
      </div>
      <LinkedAccountsPanel returnTo={returnTo} />
    </section>
  );
}
