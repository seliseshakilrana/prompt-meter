import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert } from "../../shared/ui/Alert";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Skeleton } from "../../shared/ui/Skeleton";
import { completeLink, LinkError } from "./accountsApi";
import { linkErrorMessage, parseCallbackFragment, takePendingLink, toolLabel } from "./linking";
import { LINKED_ACCOUNTS_KEY, navigateTo } from "./useLinkedAccounts";

type Outcome = { status: "working" } | { status: "done"; text: string; returnTo: string } | { status: "failed"; text: string };

/** Finishes a Google / Microsoft account link: checks state, hands the ID token to link-complete. */
export default function LinkCallbackPage() {
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<Outcome>({ status: "working" });
  // The pending link is one-use; StrictMode runs effects twice in development.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const result = parseCallbackFragment(window.location.hash);
    // Drop the token from the address bar and history straight away.
    window.history.replaceState({}, "", window.location.pathname);
    const pending = takePendingLink(result.state);
    if (result.kind === "error") {
      setOutcome({ status: "failed", text: result.error === "access_denied" ? linkErrorMessage("access_denied") : result.description || linkErrorMessage(result.error) });
      return;
    }
    if (!pending) {
      setOutcome({ status: "failed", text: linkErrorMessage("state_mismatch") });
      return;
    }
    completeLink({ challengeId: pending.challengeId, idToken: result.idToken })
      .then(async (linked) => {
        await queryClient.invalidateQueries({ queryKey: LINKED_ACCOUNTS_KEY });
        setOutcome({ status: "done", returnTo: pending.returnTo, text: `${toolLabel(linked.tool)} account ${linked.email} is connected.` });
      })
      .catch((error: unknown) => {
        setOutcome({ status: "failed", text: error instanceof LinkError ? linkErrorMessage(error.code) : linkErrorMessage(undefined) });
      });
  }, [queryClient]);

  return (
    <section>
      <PageHeader title="Connecting your account" subtitle="Checking the sign-in with the provider." />
      {outcome.status === "working" ? (
        <div className="panel"><Skeleton className="skeleton-line-lg" /></div>
      ) : outcome.status === "done" ? (
        <div className="panel">
          <div className="panel-title"><CheckCircle2 size={16} /><span>Connected</span></div>
          <p>{outcome.text}</p>
          <div><button className="primary-button" onClick={() => navigateTo(outcome.returnTo)}>Continue</button></div>
        </div>
      ) : (
        <>
          <Alert tone="error">{outcome.text}</Alert>
          <div className="mt-3"><button className="primary-button" onClick={() => navigateTo("/accounts")}>Back to connected accounts</button></div>
        </>
      )}
    </section>
  );
}
