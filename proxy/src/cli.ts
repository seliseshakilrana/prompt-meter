#!/usr/bin/env node
/** prompt-meter-proxy start [--port N] [--host H] [--config FILE] [--sink stdout|ingest] */
import { parseArgs } from "node:util";
import { startApp } from "./app.js";
import { loadConfig } from "./config.js";
import { log } from "./log.js";

const USAGE = `Usage: prompt-meter-proxy start [--port <n>] [--host <addr>] [--config <file>] [--sink stdout|ingest]

  --port     Port to listen on (default 8787)
  --host     Address to bind (default 127.0.0.1)
  --config   Config file (default ~/.config/prompt-meter/config.json)
  --sink     "stdout" prints events instead of sending them (default "ingest")
`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: "string" },
      host: { type: "string" },
      config: { type: "string" },
      sink: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const isStart = positionals.length === 0 || positionals[0] === "start";
  if (values.help || !isStart) {
    process.stdout.write(USAGE);
    return values.help ? 0 : 1;
  }
  if (values.sink && values.sink !== "stdout" && values.sink !== "ingest") {
    process.stderr.write(`invalid --sink: ${values.sink}\n${USAGE}`);
    return 1;
  }
  const cfg = loadConfig({
    configPath: values.config,
    port: values.port !== undefined ? Number(values.port) : undefined,
    host: values.host,
    sink: values.sink as "stdout" | "ingest" | undefined,
  });
  const app = await startApp(cfg);
  const shutdown = (signal: string) => {
    log.info(`received ${signal}, shutting down`);
    void app.stop().then(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  return -1; // keep running
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exit(code);
  },
  (err) => {
    log.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  },
);
