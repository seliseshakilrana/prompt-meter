import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/blocks/client", () => {
  return {
    blocksClient: {
      data: {
        collection: vi.fn()
      },
      http: {
        request: vi.fn()
      }
    }
  };
});

import { authorizeFromLocalProxy, checkLocalProxy, LinkError } from "./accountsApi";
import { blocksClient } from "../../lib/blocks/client";

describe("local proxy API integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("checkLocalProxy", () => {
    it("returns running: true and detected accounts when proxy responds 200", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          running: true,
          accounts: {
            "antigravity-cli": "dev@google.com",
            "claude-code": "claude@anthropic.com",
            codex: null
          }
        })
      } as Response);

      const res = await checkLocalProxy(8787);
      expect(res.running).toBe(true);
      expect(res.accounts).toEqual({
        "antigravity-cli": "dev@google.com",
        "claude-code": "claude@anthropic.com",
        codex: null
      });
    });

    it("returns running: false when proxy is not reachable", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Connection refused"));

      const res = await checkLocalProxy(8787);
      expect(res.running).toBe(false);
      expect(res.accounts).toEqual({});
    });

    it("returns running: false when proxy returns non-ok status", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 500
      } as Response);

      const res = await checkLocalProxy(8787);
      expect(res.running).toBe(false);
      expect(res.accounts).toEqual({});
    });
  });

  describe("authorizeFromLocalProxy", () => {
    it("authorizes successfully and creates LinkedAccount in Data Gateway", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          tool: "antigravity-cli",
          email: "dev@google.com",
          verifiedAt: "2026-10-18T10:00:00.000Z"
        })
      } as Response);

      const createSpy = vi.fn().mockResolvedValue({ id: "item_123" });
      vi.spyOn(blocksClient.data, "collection").mockReturnValue({
        create: createSpy
      } as unknown as ReturnType<typeof blocksClient.data.collection>);

      const result = await authorizeFromLocalProxy("antigravity-cli", "user_123", 8787);
      expect(result).toEqual({ tool: "antigravity-cli", email: "dev@google.com" });

      expect(createSpy).toHaveBeenCalledWith({
        userId: "user_123",
        tool: "antigravity-cli",
        email: "dev@google.com",
        method: "local",
        verifiedAt: "2026-10-18T10:00:00.000Z"
      });
    });

    it("throws LinkError proxy_unreachable when network request fails", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Failed to fetch"));

      await expect(authorizeFromLocalProxy("codex", "user_123", 8787)).rejects.toThrow(
        expect.objectContaining({ code: "proxy_unreachable" })
      );
    });

    it("throws LinkError authorization_rejected when proxy responds with 403", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ ok: false, error: "authorization_rejected" })
      } as Response);

      await expect(authorizeFromLocalProxy("codex", "user_123", 8787)).rejects.toThrow(
        expect.objectContaining({ code: "authorization_rejected", status: 403 })
      );
    });

    it("throws LinkError no_account_detected when proxy responds with 404", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ ok: false, error: "no_account_detected" })
      } as Response);

      await expect(authorizeFromLocalProxy("claude-code", "user_123", 8787)).rejects.toThrow(
        expect.objectContaining({ code: "no_account_detected", status: 404 })
      );
    });

    it("throws LinkError authorization_timeout when proxy responds with 408", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 408,
        json: async () => ({ ok: false, error: "authorization_timeout" })
      } as Response);

      await expect(authorizeFromLocalProxy("codex", "user_123", 8787)).rejects.toThrow(
        expect.objectContaining({ code: "authorization_timeout", status: 408 })
      );
    });
  });
});
