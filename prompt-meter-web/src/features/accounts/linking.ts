// Pure rules and helpers for connecting a tool account (no React, no network).
// The tool -> method table mirrors infra/blocks/workflows/lib/account-link.js; the
// workflow is the one that enforces it.

export type LinkTool = "claude-code" | "codex" | "antigravity-cli";
export type LinkMethod = "google" | "microsoft" | "email-code" | "local";
export type OidcMethod = Exclude<LinkMethod, "email-code" | "local">;

export const LINK_TOOLS: { id: LinkTool; label: string; hint: string }[] = [
  { id: "claude-code", label: "Claude Code", hint: "The email of your Claude account (claude.ai)." },
  { id: "codex", label: "Codex", hint: "The email of your ChatGPT / OpenAI account." },
  { id: "antigravity-cli", label: "Antigravity", hint: "The Google account you sign in to Antigravity with." }
];

export const METHODS_BY_TOOL: Record<LinkTool, LinkMethod[]> = {
  "claude-code": ["local", "google", "email-code"],
  codex: ["local", "google", "microsoft", "email-code"],
  "antigravity-cli": ["local", "google"]
};

export const METHOD_LABELS: Record<LinkMethod, string> = {
  google: "Google",
  microsoft: "Microsoft",
  "email-code": "Email code",
  local: "Local Machine"
};

export function toolLabel(tool: string): string {
  return LINK_TOOLS.find((t) => t.id === tool)?.label ?? tool;
}

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  return /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/.test(email) ? email : null;
}

export const LINK_CALLBACK_PATH = "/accounts/link/callback";

const AUTHORIZE_URLS: Record<OidcMethod, string> = {
  google: "https://accounts.google.com/o/oauth2/v2/auth",
  microsoft: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
};

/**
 * OpenID Connect sign-in that returns only an ID token in the URL fragment
 * (response_type=id_token). No access to the account is requested: the token just
 * proves the email, and the workflow checks its signature, audience and nonce.
 */
export function buildAuthorizeUrl(method: OidcMethod, opts: { clientId: string; redirectUri: string; nonce: string; state: string; loginHint: string }): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    login_hint: opts.loginHint,
    nonce: opts.nonce,
    prompt: "select_account",
    redirect_uri: opts.redirectUri,
    response_type: "id_token",
    scope: "openid email profile",
    state: opts.state
  });
  if (method === "microsoft") {
    params.set("response_mode", "fragment");
  }
  return `${AUTHORIZE_URLS[method]}?${params.toString()}`;
}

export type CallbackResult =
  | { kind: "token"; idToken: string; state: string }
  | { kind: "error"; error: string; description: string; state: string | null };

/** Reads the provider's answer from the callback URL fragment. */
export function parseCallbackFragment(hash: string): CallbackResult {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const state = params.get("state");
  const error = params.get("error");
  if (error) return { kind: "error", error, description: params.get("error_description") ?? "", state };
  const idToken = params.get("id_token");
  if (!idToken || !state) return { kind: "error", error: "missing_id_token", description: "The sign-in did not return an ID token.", state };
  return { kind: "token", idToken, state };
}

/** A sign-in in flight, kept in sessionStorage across the provider redirect. */
export type PendingLink = {
  state: string;
  challengeId: string;
  tool: LinkTool;
  email: string;
  method: OidcMethod;
  returnTo: string;
  startedAt: number;
};

const PENDING_KEY = "prompt-meter:pending-link";
const PENDING_MAX_AGE_MS = 10 * 60 * 1000;

export function savePendingLink(pending: PendingLink, storage: Storage = sessionStorage): void {
  storage.setItem(PENDING_KEY, JSON.stringify(pending));
}

/** Returns the pending link only when `state` matches it; always clears it (one use). */
export function takePendingLink(state: string | null, now = Date.now(), storage: Storage = sessionStorage): PendingLink | null {
  const raw = storage.getItem(PENDING_KEY);
  storage.removeItem(PENDING_KEY);
  if (!raw || !state) return null;
  try {
    const pending = JSON.parse(raw) as PendingLink;
    if (pending.state !== state || now - pending.startedAt > PENDING_MAX_AGE_MS) return null;
    return pending;
  } catch {
    return null;
  }
}

export function randomState(bytes = 24): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(values, (b) => b.toString(16).padStart(2, "0")).join("");
}

const ERROR_MESSAGES: Record<string, string> = {
  already_linked: "You have already connected this account.",
  linked_to_another_user: "This account is already connected to another Prompt Meter user.",
  too_many_attempts: "Too many attempts. Try again later, or use Google / Microsoft sign-in if this tool offers it.",
  method_not_allowed: "That sign-in option isn't available for this tool.",
  invalid_email: "Enter a valid email address.",
  challenge_expired: "That request expired. Start again.",
  challenge_used: "That request was already used. Start again.",
  challenge_busy: "This verification request is currently being processed. Please wait and try again.",
  challenge_not_found: "That request wasn't found. Start again.",
  wrong_code: "That code is wrong.",
  code_required: "Enter the 6-digit code from the email.",
  email_mismatch: "You signed in with a different email than the one you entered.",
  email_not_verified: "The provider doesn't confirm that this email belongs to the account.",
  provider_not_configured: "This sign-in option isn't set up on the server yet.",
  wrong_nonce: "The sign-in didn't match this request. Start again.",
  token_expired: "The sign-in took too long. Start again.",
  mail_failed: "The code email could not be sent. Try again.",
  access_denied: "The sign-in was cancelled.",
  state_mismatch: "This sign-in wasn't started from this browser tab, or it expired. Start again.",
  limits_unavailable: "Couldn't check limits right now. Try again in a minute.",
  lookup_failed: "Couldn't check account details right now. Try again in a minute.",
  not_configured: "Account linking isn't configured for this app yet.",
  proxy_unreachable: "Could not reach prompt-meter-proxy on your local machine. Is it running?",
  no_account_detected: "No local account was detected for this tool.",
  authorization_rejected: "Authorization was cancelled in your terminal.",
  authorization_timeout: "Authorization timed out. Please try again.",
  authorization_failed: "Authorization failed on your local machine."
};

export function linkErrorMessage(code: string | undefined, fallback = "Something went wrong. Try again."): string {
  return (code && ERROR_MESSAGES[code]) || fallback;
}
