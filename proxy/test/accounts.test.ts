import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAccountResolver, detectAntigravityEmail, detectClaudeEmail, detectCodexEmail, jwtEmail } from "../src/accounts.js";
import { loadConfig } from "../src/config.js";
import { anthropicMessage } from "./fixtures.js";
import { postJson, startMock, startProxy } from "./helpers.js";

const jwt = (claims: object) =>
  [{ alg: "RS256" }, claims].map((p) => Buffer.from(JSON.stringify(p)).toString("base64url")).join(".") + ".sig";

let dir = "";
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = "";
});
function home(files: Record<string, unknown>): string {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-accounts-"));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), typeof content === "string" ? content : JSON.stringify(content));
  }
  return dir;
}

describe("account detection", () => {
  it("reads each tool's signed-in email, lowercased", () => {
    const h = home({
      ".claude.json": { oauthAccount: { emailAddress: "Dev@Example.com", accountUuid: "x" } },
      ".codex/auth.json": { OPENAI_API_KEY: null, tokens: { id_token: jwt({ email: "codex@example.com" }), access_token: "secret" } },
      ".gemini/antigravity-cli/antigravity-oauth-token": { auth_method: "consumer", token: { access_token: "a" } },
      ".gemini/jetski-standalone-oauth-token": { id_token: jwt({ email: "agy@gmail.com", email_verified: true }) },
    });
    const ctx = { home: h, env: {} };
    expect(detectClaudeEmail(ctx)).toBe("dev@example.com");
    expect(detectCodexEmail(ctx)).toBe("codex@example.com");
    expect(detectAntigravityEmail(ctx)).toBe("agy@gmail.com");
  });

  it("honours CLAUDE_CONFIG_DIR / CODEX_HOME and the OpenAI profile claim", () => {
    const h = home({
      "alt-claude/.claude.json": { oauthAccount: { emailAddress: "alt@example.com" } },
      "alt-codex/auth.json": { tokens: { id_token: jwt({ "https://api.openai.com/profile": { email: "p@example.com" } }) } },
    });
    const ctx = { home: h, env: { CLAUDE_CONFIG_DIR: path.join(h, "alt-claude"), CODEX_HOME: path.join(h, "alt-codex") } };
    expect(detectClaudeEmail(ctx)).toBe("alt@example.com");
    expect(detectCodexEmail(ctx)).toBe("p@example.com");
  });

  it("returns null for missing, broken or API-key-only setups", () => {
    const h = home({ ".claude.json": "{not json", ".codex/auth.json": { OPENAI_API_KEY: "sk-x", tokens: null }, ".gemini/google_accounts.json": { active: null } });
    const ctx = { home: h, env: {} };
    expect(detectClaudeEmail(ctx)).toBeNull();
    expect(detectCodexEmail(ctx)).toBeNull();
    expect(detectAntigravityEmail(ctx)).toBeNull();
    expect(jwtEmail("a.b")).toBeNull();
  });

  it("config wins, detection can be switched off, results are cached", () => {
    const h = home({ ".claude.json": { oauthAccount: { emailAddress: "first@example.com" } } });
    let t = 0;
    const resolve = createAccountResolver({ ctx: { home: h, env: {} }, overrides: { codex: "Set@Example.com" }, now: () => t });
    expect(resolve("codex")).toBe("set@example.com");
    expect(resolve("claude-code")).toBe("first@example.com");
    expect(resolve("api")).toBeNull();
    fs.writeFileSync(path.join(h, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "second@example.com" } }));
    expect(resolve("claude-code")).toBe("first@example.com");
    t = 61_000;
    expect(resolve("claude-code")).toBe("second@example.com");
    expect(createAccountResolver({ ctx: { home: h, env: {} }, detect: false })("claude-code")).toBeNull();
  });

  it("config file and env control detection", () => {
    const h = home({ "config.json": { accounts: { "claude-code": "cfg@example.com" } } });
    const cfg = loadConfig({ configPath: path.join(h, "config.json") }, { PROMPT_METER_DETECT_ACCOUNTS: "0" });
    expect(cfg.detectAccounts).toBe(false);
    expect(cfg.accounts["claude-code"]).toBe("cfg@example.com");
    expect(loadConfig({}, { XDG_CONFIG_HOME: "/nonexistent-dir" } as NodeJS.ProcessEnv).detectAccounts).toBe(true);
  });

  it("puts the tool's account on the event", async () => {
    const upstream = await startMock((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(anthropicMessage));
    });
    const proxy = await startProxy(upstream.url, { defaultKey: "pm_aaaaaaaa_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }, (tool) => (tool === "claude-code" ? "dev@example.com" : null));
    try {
      const req = { model: "claude-opus-5-5", max_tokens: 10, messages: [{ role: "user", content: "hi" }] };
      await postJson(`${proxy.url}/anthropic/v1/messages`, req, { "user-agent": "claude-cli/2.1.0 (external, cli)" });
      await postJson(`${proxy.url}/anthropic/v1/messages`, req, { "user-agent": "my-script/1.0" });
      await proxy.sink.waitFor(2);
      const byTool = Object.fromEntries(proxy.sink.events.map((e) => [e.event.tool, e.event.accountEmail]));
      expect(byTool).toEqual({ "claude-code": "dev@example.com", api: null });
    } finally {
      await proxy.close();
      await upstream.close();
    }
  });
});
