import { afterEach, describe, expect, it } from "vitest";
import { PromptTracker } from "../src/grouping.js";
import { anthropicMessage } from "./fixtures.js";
import { type MockServer, type TestProxy, postJson, startMock, startProxy } from "./helpers.js";

const KEY = "pm_aaaaaaaa_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const SESSION_USER_ID = "user_0f0f_account_11111111-2222-3333-4444-555555555555_session_9a9a9a9a-0000-1111-2222-333333333333";
const MAIN_SYSTEM = [{ type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." }];

let upstream: MockServer | null = null;
let proxy: TestProxy | null = null;
afterEach(async () => {
  await proxy?.close();
  await upstream?.close();
});

let counter = 0;
async function setup() {
  upstream = await startMock((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ...anthropicMessage, id: `msg_${++counter}` }));
  });
  proxy = await startProxy(upstream.url, { defaultKey: KEY });
}

const ua = { "user-agent": "claude-cli/2.1.0 (external, cli)" };

describe("prompt grouping", () => {
  it("groups tool-result follow-ups and background calls into the typed prompt", async () => {
    await setup();
    const url = `${proxy!.url}/anthropic/v1/messages`;
    const metadata = { user_id: SESSION_USER_ID };
    const tools = [{ name: "Bash" }, { name: "Task" }];
    const turn1 = [{ role: "user", content: [{ type: "text", text: "<system-reminder>ctx</system-reminder>" }, { type: "text", text: "Refactor the auth module" }] }];

    // 1. typed prompt
    await postJson(url, { model: "claude-opus-5-5", system: MAIN_SYSTEM, tools, metadata, messages: turn1 }, ua);
    // 2. background: title generation on a small model without tools
    await postJson(
      url,
      { model: "claude-haiku-4-5", system: [{ type: "text", text: "Analyze if this message indicates a new conversation topic." }], metadata, messages: [{ role: "user", content: "Refactor the auth module" }] },
      ua,
    );
    // 3. tool-result-only follow-up (with an injected system-reminder)
    const turn2 = [
      ...turn1,
      { role: "assistant", content: [{ type: "tool_use", id: "tu1", name: "Task", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: "done" }, { type: "text", text: "<system-reminder>todo list</system-reminder>" }] },
    ];
    await postJson(url, { model: "claude-opus-5-5", system: MAIN_SYSTEM, tools, metadata, messages: turn2 }, ua);
    // 4. subagent (Task) call: has typed text but is a background call
    await postJson(
      url,
      {
        model: "claude-opus-5-5",
        system: [{ type: "text", text: "You are an agent for Claude Code, Anthropic's official CLI for Claude." }],
        tools,
        metadata,
        messages: [{ role: "user", content: "Search the codebase for auth helpers" }],
      },
      ua,
    );
    // 5. a retry of the very same request as step 1 (e.g. after a 529) keeps the prompt
    await postJson(url, { model: "claude-opus-5-5", system: MAIN_SYSTEM, tools, metadata, messages: turn1 }, ua);
    // 6. a new typed prompt
    const turn3 = [...turn2, { role: "assistant", content: "Done." }, { role: "user", content: "Now add tests" }];
    await postJson(url, { model: "claude-opus-5-5", system: MAIN_SYSTEM, tools, metadata, messages: turn3 }, ua);

    await proxy!.sink.waitFor(6);
    const ev = proxy!.sink.events.map((e) => e.event);
    const p1 = ev[0]!.promptId;
    expect(ev.slice(0, 5).map((e) => e.promptId)).toEqual([p1, p1, p1, p1, p1]);
    expect(ev.slice(0, 5).map((e) => e.callIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(ev.slice(0, 5).every((e) => e.promptPreview === "Refactor the auth module")).toBe(true);
    expect(ev[5]!.promptId).not.toBe(p1);
    expect(ev[5]!.callIndex).toBe(0);
    expect(ev[5]!.promptPreview).toBe("Now add tests");
    expect(new Set(ev.map((e) => e.sessionId))).toEqual(new Set(["9a9a9a9a-0000-1111-2222-333333333333"]));
  });

  it("uses an inactivity gap for sessions when the tool sends no marker", () => {
    const t = new PromptTracker(30 * 60_000);
    const base = { provider: "openai" as const, key: KEY, sessionMarker: null, messageCount: 1, background: false };
    const a = t.classify({ ...base, typedText: "one", now: 0 });
    const b = t.classify({ ...base, typedText: null, now: 10 * 60_000 });
    const c = t.classify({ ...base, typedText: "two", now: 10 * 60_000 + 31 * 60_000 });
    expect(b.sessionId).toBe(a.sessionId);
    expect(b.prompt.promptId).toBe(a.prompt.promptId);
    expect(c.sessionId).not.toBe(a.sessionId);
    const other = t.classify({ ...base, key: "pm_bbbbbbbb_x", typedText: null, now: 10 * 60_000 + 31 * 60_000 });
    expect(other.sessionId).not.toBe(c.sessionId);
  });
});
