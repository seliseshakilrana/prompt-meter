import http from "node:http";
import readline from "node:readline";
import type { AccountResolver } from "./accounts.js";
import type { Tool } from "./types.js";

export const LOCAL_LINK_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Private-Network": "true",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Prompt-Meter-Key",
};

export const TOOL_NAMES: Record<string, string> = {
  "antigravity-cli": "Antigravity CLI",
  "claude-code": "Claude Code",
  codex: "Codex",
};

export interface LocalLinkOptions {
  accounts?: AccountResolver;
  promptConfirm?: (tool: string, email: string) => Promise<boolean>;
  stdin?: NodeJS.ReadableStream & { isTTY?: boolean };
  stdout?: NodeJS.WritableStream;
  forceInteractive?: boolean;
  timeoutMs?: number;
}

export function promptInteractive(
  tool: string,
  email: string,
  stdin: NodeJS.ReadableStream = process.stdin,
  stdout: NodeJS.WritableStream = process.stdout,
  timeoutMs = 60_000
): Promise<boolean> {
  const toolName = TOOL_NAMES[tool] ?? tool;
  const promptText =
    `\n============================================================\n` +
    `[Prompt Meter] Authorization Request from Web Portal\n` +
    `Tool: ${toolName}\n` +
    `Account: ${email}\n` +
    `Authorize linking this account to your Prompt Meter profile? [Y/n]: `;
  const endBanner = "============================================================\n\n";

  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
  });

  return new Promise<boolean>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      rl.close();
      stdout.write("\n" + endBanner);
      const timeoutErr = new Error("authorization_timeout");
      (timeoutErr as { code?: string }).code = "authorization_timeout";
      reject(timeoutErr);
    }, timeoutMs);

    rl.question(promptText, (answer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rl.close();
      stdout.write(endBanner);
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === "" || trimmed === "y" || trimmed === "yes") {
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
}

export async function resolveApproval(
  tool: string,
  email: string,
  opts: LocalLinkOptions = {}
): Promise<boolean> {
  if (opts.promptConfirm) {
    return opts.promptConfirm(tool, email);
  }

  const stdin = opts.stdin ?? process.stdin;
  const stdout = opts.stdout ?? process.stdout;
  const isTTY = Boolean(stdin.isTTY);
  const isTest = process.env.NODE_ENV === "test";

  if (!opts.forceInteractive && (!isTTY || isTest)) {
    return true;
  }

  return promptInteractive(tool, email, stdin, stdout, opts.timeoutMs ?? 60_000);
}

function readJsonBody(req: http.IncomingMessage, maxBytes = 64 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("body_too_large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(JSON.parse(text));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

export async function handleLocalLink(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: LocalLinkOptions = {}
): Promise<void> {
  const rawUrl = req.url ?? "/";
  const qIdx = rawUrl.indexOf("?");
  const pathPart = qIdx === -1 ? rawUrl : rawUrl.slice(0, qIdx);
  const method = req.method ?? "GET";
  const origin = (req.headers.origin as string) || "*";
  const corsHeaders = {
    ...LOCAL_LINK_CORS_HEADERS,
    "Access-Control-Allow-Origin": origin,
  };

  if (method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  if (pathPart === "/api/link/status") {
    if (method !== "GET") {
      res.writeHead(405, { ...corsHeaders, "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
      return;
    }
    const accounts = opts.accounts;
    const detectedAccounts = {
      "antigravity-cli": accounts ? accounts("antigravity-cli") : null,
      "claude-code": accounts ? accounts("claude-code") : null,
      codex: accounts ? accounts("codex") : null,
    };
    res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
    res.end(JSON.stringify({ running: true, accounts: detectedAccounts }));
    return;
  }

  if (pathPart === "/api/link/ping") {
    if (method !== "GET") {
      res.writeHead(405, { ...corsHeaders, "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
      return;
    }
    res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, running: true }));
    return;
  }

  if (pathPart === "/api/link/authorize" || pathPart === "/api/link/request") {
    if (method !== "POST") {
      res.writeHead(405, { ...corsHeaders, "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      res.writeHead(400, { ...corsHeaders, "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "invalid_request" }));
      return;
    }

    if (!body || typeof body !== "object" || typeof (body as Record<string, unknown>).tool !== "string") {
      res.writeHead(400, { ...corsHeaders, "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "invalid_request" }));
      return;
    }

    const tool = (body as Record<string, unknown>).tool as string;
    const email = opts.accounts ? opts.accounts(tool as Tool) : null;
    if (!email) {
      res.writeHead(404, { ...corsHeaders, "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "no_account_detected" }));
      return;
    }

    let approved = false;
    try {
      approved = await resolveApproval(tool, email, opts);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || (err as Error)?.message;
      if (code === "authorization_timeout") {
        res.writeHead(408, { ...corsHeaders, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "authorization_timeout" }));
        return;
      }
      res.writeHead(500, { ...corsHeaders, "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "internal_error" }));
      return;
    }

    if (!approved) {
      res.writeHead(403, { ...corsHeaders, "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "authorization_rejected" }));
      return;
    }

    res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        tool,
        email,
        verifiedAt: new Date().toISOString(),
      })
    );
    return;
  }

  res.writeHead(404, { ...corsHeaders, "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "not_found" }));
}
