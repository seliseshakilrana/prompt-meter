import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, previewEnabled } from "../src/config.js";
import { keyLabel } from "../src/log.js";

describe("config", () => {
  it("merges file < env < CLI flags", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-cfg-"));
    const file = path.join(dir, "config.json");
    fs.writeFileSync(
      file,
      JSON.stringify({ port: 9000, ingestUrl: "https://file/ingest", defaultKey: "pm_aaaaaaaa_x", upstreams: { openai: "http://mock-openai" } }),
    );
    const cfg = loadConfig({ configPath: file, sink: "stdout" }, { PROMPT_METER_PORT: "9100", PROMPT_METER_KEY: "pm_cccccccc_y" });
    expect(cfg.port).toBe(9100);
    expect(cfg.ingestUrl).toBe("https://file/ingest");
    expect(cfg.defaultKey).toBe("pm_cccccccc_y");
    expect(cfg.upstreams.openai).toBe("http://mock-openai");
    expect(cfg.upstreams.anthropic).toBe("https://api.anthropic.com");
    expect(cfg.upstreams.gemini).toBe("https://generativelanguage.googleapis.com");
    expect(cfg.sink).toBe("stdout");
    expect(loadConfig({ configPath: file, port: 1234 }, {}).port).toBe(1234);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("defaults to 127.0.0.1:8787", () => {
    const cfg = loadConfig({}, { XDG_CONFIG_HOME: "/nonexistent-dir" } as NodeJS.ProcessEnv);
    expect(cfg.host).toBe("127.0.0.1");
    expect(cfg.port).toBe(8787);
  });

  it("per-key preview setting by full key or prefix, else global", () => {
    const keys = { aaaaaaaa: { sendPreview: false }, "pm_bbbbbbbb_full": { sendPreview: true } };
    expect(previewEnabled({ keys, sendPreview: true }, "pm_aaaaaaaa_secret")).toBe(false);
    expect(previewEnabled({ keys, sendPreview: false }, "pm_bbbbbbbb_full")).toBe(true);
    expect(previewEnabled({ keys, sendPreview: true }, "pm_cccccccc_z")).toBe(true);
  });

  it("never logs more than the key prefix", () => {
    expect(keyLabel("pm_a1b2c3d4_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345")).toBe("pm_a1b2c3d4_…");
    expect(keyLabel("garbage-secret-value")).toBe("gar…(malformed)");
  });
});
