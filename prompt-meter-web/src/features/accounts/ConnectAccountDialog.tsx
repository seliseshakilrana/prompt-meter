import { KeyRound, Mail, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { linkingConfig } from "../../lib/blocks/config";
import { Alert } from "../../shared/ui/Alert";
import { FormField } from "../../shared/ui/FormField";
import { Modal } from "../../shared/ui/Modal";
import { useAuth } from "../../app/providers/AuthProvider";
import { useCurrentUser } from "../profile/useCurrentUser";
import {
  authorizeFromLocalProxy,
  checkLocalProxy,
  completeLink,
  LinkError,
  startLink
} from "./accountsApi";
import {
  buildAuthorizeUrl,
  LINK_CALLBACK_PATH,
  LINK_TOOLS,
  linkErrorMessage,
  METHOD_LABELS,
  METHODS_BY_TOOL,
  normalizeEmail,
  randomState,
  savePendingLink
} from "./linking";
import type { LinkMethod, LinkTool, OidcMethod } from "./linking";

const CLIENT_IDS: Record<OidcMethod, string> = {
  google: linkingConfig.googleClientId,
  microsoft: linkingConfig.microsoftClientId
};

function errorText(error: unknown): string {
  if (error instanceof LinkError) {
    if (error.code === "wrong_code" && typeof error.details.attemptsLeft === "number") {
      return `${linkErrorMessage("wrong_code")} ${error.details.attemptsLeft} attempt(s) left.`;
    }
    return linkErrorMessage(error.code);
  }
  return linkErrorMessage(undefined);
}

/**
 * Asks for the tool and its account email, then proves the email:
 * 1. Local loopback authorization from prompt-meter-proxy via terminal prompt, or
 * 2. Google / Microsoft sign-in (redirect, finished on /accounts/link/callback), or
 * 3. A code sent to the address.
 */
export function ConnectAccountDialog({
  onClose,
  onLinked,
  returnTo,
  userId
}: {
  onClose: () => void;
  onLinked: () => void;
  returnTo: string;
  userId?: string;
}) {
  const me = useCurrentUser();
  const { claims } = useAuth();
  const effectiveUserId =
    userId ??
    me.data?.data?.itemId ??
    ((me.data?.data as Record<string, unknown> | undefined)?.id as string | undefined) ??
    (claims?.sub as string | undefined) ??
    (claims?.userId as string | undefined);

  const [tool, setTool] = useState<LinkTool>("claude-code");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<LinkMethod | "code" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [codeStep, setCodeStep] = useState<{ challengeId: string; email: string } | null>(null);
  const [code, setCode] = useState("");
  const [proxyState, setProxyState] = useState<{
    checked: boolean;
    running: boolean;
    accounts: Record<string, string | null>;
  }>({
    checked: false,
    running: false,
    accounts: {}
  });

  const toolInfo = LINK_TOOLS.find((t) => t.id === tool)!;
  const detectedEmail = proxyState.accounts[tool];

  useEffect(() => {
    let mounted = true;
    void checkLocalProxy().then((res) => {
      if (mounted) {
        setProxyState({ checked: true, running: res.running, accounts: res.accounts });
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  async function handleLocalAuthorize() {
    if (!effectiveUserId) {
      setError("You must be signed in to connect an account.");
      return;
    }
    setError(null);
    setBusy("local");
    try {
      await authorizeFromLocalProxy(tool, effectiveUserId);
      onLinked();
    } catch (caught) {
      setBusy(null);
      if (caught instanceof LinkError && caught.code === "already_linked") {
        onLinked();
        return;
      }
      setError(errorText(caught));
    }
  }

  async function begin(method: LinkMethod) {
    if (method === "local") {
      await handleLocalAuthorize();
      return;
    }
    setError(null);
    const normalized = normalizeEmail(email);
    if (!normalized) {
      setError(linkErrorMessage("invalid_email"));
      return;
    }
    setBusy(method);
    try {
      const started = await startLink({ email: normalized, method, tool });
      if (method === "email-code") {
        setCodeStep({ challengeId: started.challengeId, email: normalized });
        setBusy(null);
        return;
      }
      const state = randomState();
      savePendingLink({ challengeId: started.challengeId, email: normalized, method, returnTo, startedAt: Date.now(), state, tool });
      window.location.assign(buildAuthorizeUrl(method, {
        clientId: CLIENT_IDS[method],
        loginHint: normalized,
        nonce: started.nonce ?? "",
        redirectUri: `${window.location.origin}${LINK_CALLBACK_PATH}`,
        state
      }));
    } catch (caught) {
      setBusy(null);
      if (caught instanceof LinkError && caught.code === "already_linked") {
        onLinked();
        return;
      }
      setError(errorText(caught));
    }
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    if (!codeStep) return;
    setError(null);
    setBusy("code");
    try {
      await completeLink({ challengeId: codeStep.challengeId, code: code.trim() });
      onLinked();
    } catch (caught) {
      setBusy(null);
      if (caught instanceof LinkError && caught.code === "wrong_code" && caught.details.attemptsLeft === 0) {
        setCodeStep(null);
        setCode("");
        setError("No attempts left. Start again.");
      } else {
        setError(errorText(caught));
        if (caught instanceof LinkError && ["challenge_used", "challenge_expired", "too_many_attempts"].includes(caught.code)) {
          setCodeStep(null);
          setCode("");
        }
      }
    }
  }

  if (codeStep) {
    return (
      <Modal title="Enter the code" onClose={onClose}>
        <form className="form-stack" onSubmit={submitCode}>
          <p>We sent a 6-digit code to <strong>{codeStep.email}</strong>. It expires in 10 minutes.</p>
          <FormField
            autoComplete="one-time-code"
            autoFocus
            inputMode="numeric"
            label="Code"
            maxLength={6}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            pattern="\d{6}"
            required
            value={code}
          />
          {error ? <Alert tone="error">{error}</Alert> : null}
          <div className="modal-actions">
            <button className="icon-button" onClick={() => setCodeStep(null)} type="button">Back</button>
            <button className="primary-button" disabled={busy !== null || code.length !== 6} type="submit">
              {busy === "code" ? "Checking..." : "Connect account"}
            </button>
          </div>
        </form>
      </Modal>
    );
  }

  return (
    <Modal title="Connect an AI account" onClose={onClose}>
      <div className="form-stack">
        <label className="form-field">
          <span>Tool</span>
          <select onChange={(event) => setTool(event.target.value as LinkTool)} value={tool}>
            {LINK_TOOLS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>

        {/* Dedicated prominent Local Machine Authorization Option */}
        <div style={{ padding: "14px", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)", background: "hsl(var(--card))", display: "grid", gap: "10px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong style={{ fontSize: "14px", display: "flex", alignItems: "center", gap: "6px" }}>
              <Terminal size={16} />
              <span>Authorize from Local Machine</span>
            </strong>
            {proxyState.running ? (
              <span style={{ fontSize: "12px", color: "hsl(var(--primary))", fontWeight: 600 }}>Proxy active</span>
            ) : proxyState.checked ? (
              <span className="muted small">Proxy offline</span>
            ) : null}
          </div>

          {proxyState.running ? (
            <>
              {detectedEmail ? (
                <p className="muted small" style={{ margin: 0 }}>
                  Detected: <strong>{detectedEmail}</strong> (from local session)
                </p>
              ) : null}
              <button
                className="primary-button"
                disabled={busy !== null}
                onClick={() => void handleLocalAuthorize()}
                type="button"
                style={{ width: "100%", justifyContent: "center" }}
              >
                <Terminal size={16} />
                <span>{busy === "local" ? "Waiting for confirmation in your terminal..." : "Authorize from Local Machine"}</span>
              </button>
            </>
          ) : (
            <div style={{ display: "grid", gap: "6px" }}>
              <button
                className="outline-button"
                disabled
                type="button"
                style={{ width: "100%", justifyContent: "center" }}
              >
                <Terminal size={16} />
                <span>Authorize from Local Machine</span>
              </button>
              <p className="muted small" style={{ margin: 0 }}>
                Start prompt-meter-proxy to authorize locally
              </p>
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px", margin: "4px 0" }}>
          <hr style={{ flex: 1, border: "0", borderTop: "1px solid hsl(var(--border))" }} />
          <span className="muted small">or connect via email</span>
          <hr style={{ flex: 1, border: "0", borderTop: "1px solid hsl(var(--border))" }} />
        </div>

        <FormField
          autoComplete="email"
          label={`${toolInfo.label} account email`}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          type="email"
          value={email}
        />
        <p className="muted">{toolInfo.hint} Prove it's yours with the sign-in that account uses:</p>
        <div className="method-list">
          {METHODS_BY_TOOL[tool]
            .filter((method) => method !== "local")
            .map((method) => {
              const missingClient = method !== "email-code" && !CLIENT_IDS[method as OidcMethod];
              return (
                <button
                  className="outline-button"
                  disabled={busy !== null || missingClient}
                  key={method}
                  onClick={() => void begin(method)}
                  title={missingClient ? "Not set up on this app yet" : undefined}
                  type="button"
                >
                  {method === "email-code" ? <Mail size={16} /> : <KeyRound size={16} />}
                  {busy === method ? "Starting..." : method === "email-code" ? "Email me a code" : `Continue with ${METHOD_LABELS[method]}`}
                </button>
              );
            })}
        </div>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <p className="muted small">Only your email address is checked. Prompt Meter gets no access to your {toolInfo.label} account or its data.</p>
      </div>
    </Modal>
  );
}

