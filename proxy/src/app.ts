/** Wires config, queue, sender, sink and the proxy server together. */
import type http from "node:http";
import type { AddressInfo } from "node:net";
import type { Config } from "./config.js";
import { keyLabel, log } from "./log.js";
import { createProxyServer } from "./proxy.js";
import { EventQueue } from "./queue.js";
import { Sender } from "./sender.js";
import { type EventSink, QueueSink, StdoutSink } from "./sinks.js";

export interface RunningApp {
  server: http.Server;
  port: number;
  queue: EventQueue | null;
  sender: Sender | null;
  stop(): Promise<void>;
}

export async function startApp(cfg: Config): Promise<RunningApp> {
  let queue: EventQueue | null = null;
  let sender: Sender | null = null;
  let sink: EventSink;
  if (cfg.sink === "stdout") {
    sink = new StdoutSink();
  } else {
    queue = new EventQueue(cfg.queuePath);
    sender = new Sender(queue, {
      ingestUrl: cfg.ingestUrl,
      flushIntervalMs: cfg.flushIntervalMs,
      batchSize: cfg.batchSize,
    });
    sink = new QueueSink(queue, sender);
    sender.start();
  }

  const server = createProxyServer({ config: cfg, sink });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(cfg.port, cfg.host, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  log.info(`prompt-meter-proxy listening on http://${cfg.host}:${port}`, {
    sink: cfg.sink,
    defaultKey: keyLabel(cfg.defaultKey),
    queued: queue?.count() ?? 0,
  });

  return {
    server,
    port,
    queue,
    sender,
    async stop() {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      if (sender) {
        await sender.flush().catch(() => undefined);
        await sender.stop();
      }
      queue?.close();
    },
  };
}
