import { describe, expect, it } from "vitest";
import { buildAuthorizeUrl, linkErrorMessage, METHODS_BY_TOOL, normalizeEmail, parseCallbackFragment, savePendingLink, takePendingLink } from "./linking";
import type { PendingLink } from "./linking";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v)
  };
}

describe("account linking helpers", () => {
  it("offers only Google for Antigravity and all three for Codex", () => {
    expect(METHODS_BY_TOOL["antigravity-cli"]).toEqual(["google"]);
    expect(METHODS_BY_TOOL.codex).toEqual(["google", "microsoft", "email-code"]);
  });

  it("normalizes emails", () => {
    expect(normalizeEmail("  Me@Example.COM ")).toBe("me@example.com");
    expect(normalizeEmail("me@localhost")).toBeNull();
  });

  it("builds an ID-token-only sign-in URL with nonce, state and login hint", () => {
    const msUrl = new URL(buildAuthorizeUrl("microsoft", { clientId: "cid", loginHint: "me@outlook.com", nonce: "n1", redirectUri: "https://app.example/accounts/link/callback", state: "s1" }));
    expect(msUrl.origin + msUrl.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(msUrl.searchParams.get("response_type")).toBe("id_token");
    expect(msUrl.searchParams.get("response_mode")).toBe("fragment");
    expect(msUrl.searchParams.get("nonce")).toBe("n1");
    expect(msUrl.searchParams.get("state")).toBe("s1");
    expect(msUrl.searchParams.get("login_hint")).toBe("me@outlook.com");
    expect(msUrl.searchParams.get("scope")).toBe("openid email profile");

    const googleUrl = new URL(buildAuthorizeUrl("google", { clientId: "gid", loginHint: "me@gmail.com", nonce: "n2", redirectUri: "https://app.example/accounts/link/callback", state: "s2" }));
    expect(googleUrl.origin + googleUrl.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(googleUrl.searchParams.get("response_type")).toBe("id_token");
    expect(googleUrl.searchParams.has("response_mode")).toBe(false);
    expect(googleUrl.searchParams.get("nonce")).toBe("n2");
    expect(googleUrl.searchParams.get("login_hint")).toBe("me@gmail.com");
  });

  it("parses the callback fragment", () => {
    expect(parseCallbackFragment("#id_token=abc.def.ghi&state=s1")).toEqual({ idToken: "abc.def.ghi", kind: "token", state: "s1" });
    expect(parseCallbackFragment("#error=access_denied&error_description=nope&state=s1")).toEqual({ description: "nope", error: "access_denied", kind: "error", state: "s1" });
    expect(parseCallbackFragment("").kind).toBe("error");
  });

  it("pending link is one-use and bound to state", () => {
    const storage = memoryStorage();
    const pending: PendingLink = { challengeId: "c", email: "a@b.io", method: "google", returnTo: "/", startedAt: 1000, state: "s1", tool: "codex" };
    savePendingLink(pending, storage);
    expect(takePendingLink("other", 2000, storage)).toBeNull();
    expect(takePendingLink("s1", 2000, storage)).toBeNull(); // cleared by the first read
    savePendingLink(pending, storage);
    expect(takePendingLink("s1", 2000, storage)).toEqual(pending);
    savePendingLink(pending, storage);
    expect(takePendingLink("s1", 1000 + 11 * 60_000, storage)).toBeNull();
  });

  it("maps workflow error codes to messages", () => {
    expect(linkErrorMessage("linked_to_another_user")).toMatch(/another Prompt Meter user/);
    expect(linkErrorMessage("too_many_attempts")).toMatch(/Too many attempts\. Try again later/);
    expect(linkErrorMessage("limits_unavailable")).toMatch(/Couldn't check limits right now/);
    expect(linkErrorMessage("lookup_failed")).toMatch(/Couldn't check account details right now/);
    expect(linkErrorMessage("whatever", "fallback")).toBe("fallback");
  });
});
