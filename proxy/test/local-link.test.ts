import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { createProxyServer } from "../src/proxy.js";
import { MemorySink } from "../src/sinks.js";
import { PromptTracker } from "../src/grouping.js";
import { promptInteractive, type LocalLinkOptions } from "../src/local-link.js";
import type { AccountResolver } from "../src/accounts.js";
import { postJson, send, type TestProxy } from "./helpers.js";
import type { AddressInfo } from "node:net";

let proxy: TestProxy | null = null;

async function startLocalLinkProxy(
  accounts?: AccountResolver,
  localLinkOptions?: Omit<LocalLinkOptions, "accounts">
): Promise<TestProxy> {
  const sink = new MemorySink();
  const tracker = new PromptTracker(30 * 60_000);
  const server = createProxyServer({
    config: {
      upstreams: {
        anthropic: "http://127.0.0.1:9",
        openai: "http://127.0.0.1:9",
        gemini: "http://127.0.0.1:9",
      },
      defaultKey: null,
      keys: {},
      sendPreview: true,
      sessionGapMinutes: 30,
    },
    sink,
    tracker,
    accounts,
    localLinkOptions,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    sink,
    tracker,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections();
      }),
  };
}

afterEach(async () => {
  await proxy?.close();
  proxy = null;
});

describe("local-link endpoints & CORS/PNA headers", () => {
  it("responds to OPTIONS preflight with PNA and CORS headers", async () => {
    proxy = await startLocalLinkProxy();
    const res = await send(`${proxy.url}/api/link/status`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://dbbvxg-eptqw.slsblx.com",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Private-Network": "true",
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["access-control-allow-private-network"]).toBe("true");
    expect(res.headers["access-control-allow-methods"]).toBe("GET, POST, OPTIONS");
    expect(res.headers["access-control-allow-headers"]).toContain("Content-Type");
  });

  it("returns running status and detected accounts on GET /api/link/status", async () => {
    const resolver: AccountResolver = (tool) => {
      if (tool === "antigravity-cli") return "dev@example.com";
      if (tool === "claude-code") return "claude@example.com";
      return null;
    };
    proxy = await startLocalLinkProxy(resolver);

    const res = await send(`${proxy.url}/api/link/status`, {
      method: "GET",
    });

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["access-control-allow-private-network"]).toBe("true");
    const json = JSON.parse(res.body.toString("utf8"));
    expect(json).toEqual({
      running: true,
      accounts: {
        "antigravity-cli": "dev@example.com",
        "claude-code": "claude@example.com",
        codex: null,
      },
    });
  });

  it("returns ping response on GET /api/link/ping", async () => {
    proxy = await startLocalLinkProxy();
    const res = await send(`${proxy.url}/api/link/ping`);
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body.toString("utf8"));
    expect(json).toEqual({ ok: true, running: true });
  });

  it("returns 400 for invalid body or missing tool on POST /api/link/authorize", async () => {
    proxy = await startLocalLinkProxy();
    const res1 = await postJson(`${proxy.url}/api/link/authorize`, {});
    expect(res1.status).toBe(400);
    expect(JSON.parse(res1.body.toString("utf8"))).toEqual({ ok: false, error: "invalid_request" });

    const res2 = await send(`${proxy.url}/api/link/authorize`, {
      method: "POST",
      body: "not-json",
      headers: { "content-type": "application/json" },
    });
    expect(res2.status).toBe(400);
    expect(JSON.parse(res2.body.toString("utf8"))).toEqual({ ok: false, error: "invalid_request" });
  });

  it("returns 404 when no account is detected for the requested tool", async () => {
    const resolver: AccountResolver = () => null;
    proxy = await startLocalLinkProxy(resolver);

    const res = await postJson(`${proxy.url}/api/link/authorize`, {
      tool: "antigravity-cli",
      userId: "user_123",
    });
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body.toString("utf8"))).toEqual({ ok: false, error: "no_account_detected" });
  });

  it("automatically approves in test / non-TTY environment", async () => {
    const resolver: AccountResolver = (tool) => (tool === "antigravity-cli" ? "test@google.com" : null);
    proxy = await startLocalLinkProxy(resolver);

    const res = await postJson(`${proxy.url}/api/link/authorize`, {
      tool: "antigravity-cli",
      userId: "user_123",
    });

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["access-control-allow-private-network"]).toBe("true");
    const json = JSON.parse(res.body.toString("utf8"));
    expect(json.ok).toBe(true);
    expect(json.tool).toBe("antigravity-cli");
    expect(json.email).toBe("test@google.com");
    expect(typeof json.verifiedAt).toBe("string");
  });

  it("rejects with 403 when authorization prompt is declined", async () => {
    const resolver: AccountResolver = (tool) => (tool === "codex" ? "codex@openai.com" : null);
    proxy = await startLocalLinkProxy(resolver, {
      promptConfirm: async () => false,
    });

    const res = await postJson(`${proxy.url}/api/link/authorize`, {
      tool: "codex",
      userId: "user_123",
    });

    expect(res.status).toBe(403);
    const json = JSON.parse(res.body.toString("utf8"));
    expect(json).toEqual({ ok: false, error: "authorization_rejected" });
  });

  it("returns 408 when authorization prompt times out", async () => {
    const resolver: AccountResolver = (tool) => (tool === "codex" ? "codex@openai.com" : null);
    proxy = await startLocalLinkProxy(resolver, {
      promptConfirm: async () => {
        const err = new Error("authorization_timeout");
        (err as { code?: string }).code = "authorization_timeout";
        throw err;
      },
    });

    const res = await postJson(`${proxy.url}/api/link/authorize`, {
      tool: "codex",
      userId: "user_123",
    });

    expect(res.status).toBe(408);
    const json = JSON.parse(res.body.toString("utf8"));
    expect(json).toEqual({ ok: false, error: "authorization_timeout" });
  });

  it("handles method not allowed and unknown endpoints", async () => {
    proxy = await startLocalLinkProxy();

    const notAllowed = await send(`${proxy.url}/api/link/status`, { method: "POST" });
    expect(notAllowed.status).toBe(405);

    const notFound = await send(`${proxy.url}/api/link/unknown-endpoint`, { method: "GET" });
    expect(notFound.status).toBe(404);
  });
});

describe("promptInteractive readline behavior", () => {
  it("resolves true when user answers 'y'", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const promise = promptInteractive("claude-code", "user@anthropic.com", stdin, stdout, 5000);

    stdin.write("y\n");
    const result = await promise;
    expect(result).toBe(true);
  });

  it("resolves true when user presses enter (default yes)", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const promise = promptInteractive("antigravity-cli", "user@google.com", stdin, stdout, 5000);

    stdin.write("\n");
    const result = await promise;
    expect(result).toBe(true);
  });

  it("resolves false when user answers 'n'", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const promise = promptInteractive("codex", "user@openai.com", stdin, stdout, 5000);

    stdin.write("n\n");
    const result = await promise;
    expect(result).toBe(false);
  });

  it("rejects with timeout when user does not respond within timeout", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const promise = promptInteractive("codex", "user@openai.com", stdin, stdout, 20);

    await expect(promise).rejects.toThrow("authorization_timeout");
  });
});
