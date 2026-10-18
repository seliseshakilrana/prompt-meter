// Connected tool accounts. Reads go through data.collection("LinkedAccount") (owner-only
// read policy); every write goes through a webhook workflow (link-start, link-complete,
// unlink-account) because a browser must never be able to add an unverified link.
// All calls use the single blocksClient (blocks.http.request attaches the session).

import { BlocksApiError } from "@seliseblocks/client";
import { blocksClient } from "../../lib/blocks/client";
import { linkingConfig } from "../../lib/blocks/config";
import { normalizeList } from "../admin/adminApi";
import type { LinkMethod, LinkTool } from "./linking";

export type LinkedAccount = {
  ItemId?: string;
  userId: string;
  tool: LinkTool;
  email: string;
  method: LinkMethod;
  verifiedAt: string;
};

export type LinkStartResponse = { challengeId: string; tool: LinkTool; email: string; method: LinkMethod; expiresAt: string; nonce?: string };
export type LinkCompleteResponse = { linked: true; alreadyLinked?: boolean; tool: LinkTool; email: string };

/** A workflow refusal, carrying its error code (see linkErrorMessage). */
export class LinkError extends Error {
  constructor(readonly code: string, readonly status: number, readonly details: Record<string, unknown> = {}) {
    super(code);
  }
}

const SCHEMA = "LinkedAccount";
const FIELDS = ["ItemId", "userId", "tool", "email", "method", "verifiedAt"];

export function isLinkingConfigured(): boolean {
  return Boolean(linkingConfig.webhookBase && (linkingConfig.googleClientId || linkingConfig.microsoftClientId));
}

export async function listLinkedAccounts(userId: string): Promise<LinkedAccount[]> {
  // TODO(live): confirm the filter dialect, as for the other collections (adminApi.ts).
  const response = await blocksClient.data.collection<LinkedAccount>(SCHEMA, { fields: FIELDS }).list({ filter: { userId }, pageNo: 1, pageSize: 100 });
  // The read policy already limits rows to the owner; re-check in case the filter is ignored.
  return normalizeList<LinkedAccount>(response, SCHEMA).items.filter((row) => row.userId === userId);
}

// TODO(spike): a webhook may answer HTTP 200 with the Respond node's { statusCode, body }
// instead of using that status; both shapes are handled.
async function callWorkflow<T>(path: string, body: Record<string, unknown>): Promise<T> {
  if (!linkingConfig.webhookBase) throw new LinkError("not_configured", 0);
  let response: unknown;
  try {
    response = await blocksClient.http.request<unknown>(`${linkingConfig.webhookBase}/${path}`, { body, method: "POST" });
  } catch (error) {
    if (error instanceof BlocksApiError) {
      const errorBody = unwrap(error.body) as Record<string, unknown> | undefined;
      throw new LinkError(typeof errorBody?.error === "string" ? errorBody.error : "request_failed", error.status, errorBody ?? {});
    }
    throw error;
  }
  const envelope = response as { statusCode?: number; body?: unknown } | null;
  if (envelope && typeof envelope.statusCode === "number" && "body" in envelope) {
    const inner = (envelope.body ?? {}) as Record<string, unknown>;
    if (envelope.statusCode >= 400) throw new LinkError(typeof inner.error === "string" ? inner.error : "request_failed", envelope.statusCode, inner);
    return inner as T;
  }
  return unwrap(response) as T;
}

function unwrap(value: unknown): unknown {
  const record = value as { body?: unknown; output?: unknown } | null;
  if (record && typeof record === "object" && "body" in record && record.body && typeof record.body === "object") return record.body;
  return value;
}

export function startLink(request: { tool: LinkTool; email: string; method: LinkMethod }): Promise<LinkStartResponse> {
  return callWorkflow<LinkStartResponse>("link-start", request);
}

export function completeLink(request: { challengeId: string; idToken?: string; code?: string }): Promise<LinkCompleteResponse> {
  return callWorkflow<LinkCompleteResponse>("link-complete", request);
}

export function unlinkAccount(linkId: string): Promise<{ unlinked: true }> {
  return callWorkflow<{ unlinked: true }>("unlink-account", { linkId });
}

export async function checkLocalProxy(port = 8787): Promise<{ running: boolean; accounts: Record<string, string | null> }> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/link/status`, {
      method: "GET",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return { running: false, accounts: {} };
    const data = (await response.json()) as { running?: boolean; accounts?: Record<string, string | null> };
    return {
      running: Boolean(data.running),
      accounts: data.accounts ?? {}
    };
  } catch {
    return { running: false, accounts: {} };
  }
}

export async function authorizeFromLocalProxy(tool: LinkTool, userId: string, port = 8787): Promise<{ tool: LinkTool; email: string }> {
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/api/link/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool, userId })
    });
  } catch {
    throw new LinkError("proxy_unreachable", 0);
  }

  const data = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    tool?: LinkTool;
    email?: string;
    verifiedAt?: string;
  };

  if (!response.ok || !data.ok || !data.email) {
    throw new LinkError(data.error ?? "authorization_failed", response.status, data as Record<string, unknown>);
  }

  const email = data.email;
  const verifiedAt = data.verifiedAt ?? new Date().toISOString();

  await blocksClient.data.collection<LinkedAccount>(SCHEMA, { fields: FIELDS }).create({
    userId,
    tool,
    email,
    method: "local",
    verifiedAt
  });

  return { tool, email };
}

