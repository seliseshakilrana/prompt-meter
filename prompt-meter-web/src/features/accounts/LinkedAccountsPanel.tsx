import { useQueryClient } from "@tanstack/react-query";
import { Link2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Alert } from "../../shared/ui/Alert";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import { ErrorState } from "../../shared/ui/ErrorState";
import { Skeleton } from "../../shared/ui/Skeleton";
import { describeError } from "../admin/adminApi";
import { LinkError, unlinkAccount } from "./accountsApi";
import type { LinkedAccount } from "./accountsApi";
import { ConnectAccountDialog } from "./ConnectAccountDialog";
import { linkErrorMessage, METHOD_LABELS, toolLabel } from "./linking";
import { LINKED_ACCOUNTS_KEY, useLinkedAccounts } from "./useLinkedAccounts";

export function LinkedAccountsPanel({ returnTo, onLinked }: { returnTo: string; onLinked?: () => void }) {
  const accounts = useLinkedAccounts();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<LinkedAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = accounts.data ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: LINKED_ACCOUNTS_KEY });

  async function remove(account: LinkedAccount) {
    setRemoving(null);
    setError(null);
    try {
      await unlinkAccount(account.ItemId ?? "");
      await refresh();
    } catch (caught) {
      setError(caught instanceof LinkError ? linkErrorMessage(caught.code) : describeError(caught));
    }
  }

  return (
    <div className="panel">
      <div className="panel-title">
        <Link2 size={16} />
        <span>Connected AI accounts</span>
      </div>
      {accounts.isLoading ? (
        <Skeleton className="skeleton-line" />
      ) : accounts.isError ? (
        <ErrorState message={`Could not load your accounts: ${describeError(accounts.error)}`} onRetry={() => void accounts.refetch()} />
      ) : rows.length === 0 ? (
        <p className="muted">No accounts connected yet.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Tool</th><th>Account</th><th>Verified with</th><th>Since</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((account) => (
              <tr key={account.ItemId ?? `${account.tool}|${account.email}`}>
                <td>{toolLabel(account.tool)}</td>
                <td>{account.email}</td>
                <td>{METHOD_LABELS[account.method] ?? account.method}</td>
                <td>{account.verifiedAt ? new Date(account.verifiedAt).toLocaleDateString() : ""}</td>
                <td className="row-actions">
                  <ActionButton variant="icon" title="Remove" icon={<Trash2 size={16} />} onClick={() => setRemoving(account)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div>
        <ActionButton icon={<Plus size={16} />} onClick={() => setAdding(true)}>Connect account</ActionButton>
      </div>
      {adding ? (
        <ConnectAccountDialog
          onClose={() => setAdding(false)}
          onLinked={() => {
            setAdding(false);
            void refresh().then(() => onLinked?.());
          }}
          returnTo={returnTo}
        />
      ) : null}
      {removing ? (
        <ConfirmDialog
          title="Remove account"
          message={`Disconnect ${removing.email} (${toolLabel(removing.tool)})? New usage from it will no longer show as verified.`}
          onCancel={() => setRemoving(null)}
          onConfirm={() => void remove(removing)}
        />
      ) : null}
    </div>
  );
}
