import { linkingConfig } from "../../lib/blocks/config";
import { Alert } from "../../shared/ui/Alert";
import { PageHeader } from "../../shared/ui/PageHeader";
import { isLinkingConfigured } from "./accountsApi";
import { LinkedAccountsPanel } from "./LinkedAccountsPanel";

export default function AccountsPage() {
  return (
    <section>
      <PageHeader
        title="Connected accounts"
        subtitle="The Claude, Codex and Antigravity accounts you use. Usage the proxy reports from these accounts is marked verified."
      />
      {!isLinkingConfigured() ? (
        <Alert tone="info">
          Account linking isn't set up for this app yet. It needs the Google / Microsoft client ids and the link workflows
          (<code>VITE_PM_GOOGLE_CLIENT_ID</code>, <code>VITE_PM_MICROSOFT_CLIENT_ID</code>, <code>VITE_PM_WORKFLOW_WEBHOOK_BASE</code>).
        </Alert>
      ) : null}
      {!linkingConfig.enabled ? (
        <Alert tone="info">My usage doesn't require a connected account yet (<code>VITE_PM_ACCOUNT_LINKING</code> is off).</Alert>
      ) : null}
      <LinkedAccountsPanel returnTo="/accounts" />
    </section>
  );
}
