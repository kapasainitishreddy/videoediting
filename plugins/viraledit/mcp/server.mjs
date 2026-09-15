#!/usr/bin/env node
import readline from "node:readline";

const SERVER_INFO = { name: "viraledit", version: "0.1.0" };
const MODERN_VERSION = "2026-07-28";
const LEGACY_VERSION = "2025-11-25";
const INSTRUCTIONS =
  "Operate the user's live local ViralEdit AI session. Check viraledit_status first. Footage remains in the browser; this server sends edit commands only.";

const emptySchema = { type: "object", additionalProperties: false };
const TOOLS = [
  {
    name: "viraledit_status",
    description:
      "Inspect the live local ViralEdit browser session: route, loaded clips, reference/timeline/render readiness, editing mode, and current bridge activity.",
    inputSchema: emptySchema,
  },
  {
    name: "viraledit_edit",
    description:
      "Apply one reversible natural-language editing instruction to the current ViralEdit timeline, using the app's existing conversational editor.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        instruction: {
          type: "string",
          minLength: 1,
          description: "Example: tighten the hook, cut the silences, make it moody, make it 30 seconds.",
        },
      },
      required: ["instruction"],
    },
  },
  {
    name: "viraledit_auto_edit",
    description:
      "Build a ViralEdit timeline from clips already loaded in the browser. Optionally provide a creative direction. Uses the existing deterministic auto-edit engine and does not upload footage.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        direction: {
          type: "string",
          description: "Optional editing direction, such as cinematic smooth transitions or fast cuts high energy.",
        },
      },
    },
  },
  {
    name: "viraledit_render",
    description:
      "Render the current ViralEdit timeline with the app's existing FFmpeg-WASM pipeline and wait for the export screen. Requires a timeline.",
    inputSchema: emptySchema,
  },
  {
    name: "viraledit_undo",
    description: "Undo the most recent reversible timeline-plan change in the live ViralEdit project.",
    inputSchema: emptySchema,
  },
  {
    name: "viraledit_reset",
    description:
      "Reset the current ViralEdit project state. This is destructive to the in-memory/session project state, so use only when the user asks to reset/start over.",
    inputSchema: emptySchema,
  },
  {
    name: "viraledit_navigate",
    description: "Navigate the connected ViralEdit tab to a safe app screen.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        route: {
          type: "string",
          enum: ["/", "/home", "/editor", "/marketing", "/features", "/export"],
        },
      },
      required: ["route"],
    },
  },
];

function serverMeta() {
  return { "io.modelcontextprotocol/serverInfo": SERVER_INFO };
}

function isModern(request) {
  return (
    request?.method === "server/discover" ||
    request?.params?._meta?.["io.modelcontextprotocol/protocolVersion"] === MODERN_VERSION
  );
}

function baseUrl() {
  const raw = process.env.VIRALEDIT_URL || "http://127.0.0.1:3000";
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
    throw new Error("VIRALEDIT_URL must be a loopback http:// URL (127.0.0.1, localhost, or ::1).");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

async function fetchJson(path, options = {}) {
  const url = new URL(path, baseUrl());
  const response = await fetch(url, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    signal: AbortSignal.timeout(options.timeoutMs || 7_500),
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const message = data?.error || `${response.status} ${response.statusText}`;
    throw new Error(`ViralEdit bridge: ${message}`);
  }
  return data;
}

async function health() {
  return fetchJson("/api/codex?action=health");
}

async function requireBrowser() {
  const snapshot = await health();
  if (!snapshot.connected) {
    throw new Error(
      "ViralEdit is running but no connected browser tab is reporting to the Codex bridge. Open the local ViralEdit app in a browser."
    );
  }
  return snapshot;
}

async function enqueueAndWait(kind, payload = {}, timeoutMs = 150_000) {
  await requireBrowser();
  const queued = await fetchJson("/api/codex", {
    method: "POST",
    body: JSON.stringify({ action: "enqueue", kind, payload }),
  });
  const id = queued?.command?.id;
  if (!id) throw new Error("ViralEdit bridge did not return a command id.");

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fetchJson(`/api/codex?action=result&id=${encodeURIComponent(id)}`);
    const command = result?.command;
    if (command?.status === "completed") return command.result?.data ?? { ok: true };
    if (command?.status === "failed") throw new Error(command.result?.error || "ViralEdit command failed.");
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`ViralEdit command timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
}

function assertString(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
  return value.trim();
}

async function callTool(name, args = {}) {
  switch (name) {
    case "viraledit_status":
      return health();
    case "viraledit_edit":
      return enqueueAndWait("chat", { text: assertString(args.instruction, "instruction") }, 150_000);
    case "viraledit_auto_edit":
      return enqueueAndWait(
        "auto-edit",
        { direction: typeof args.direction === "string" ? args.direction.trim() : "" },
        300_000
      );
    case "viraledit_render":
      return enqueueAndWait("render", {}, 21 * 60_000);
    case "viraledit_undo":
      return enqueueAndWait("undo", {}, 60_000);
    case "viraledit_reset":
      return enqueueAndWait("reset", {}, 60_000);
    case "viraledit_navigate":
      return enqueueAndWait("navigate", { route: assertString(args.route, "route") }, 60_000);
    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { protocolCode: -32602 });
  }
}

function toolResult(data, modern, isError = false) {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return {
    ...(modern ? { resultType: "complete" } : {}),
    content: [{ type: "text", text }],
    structuredContent: data,
    isError,
    ...(modern ? { _meta: serverMeta() } : {}),
  };
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(request) {
  const id = request?.id;
  const method = request?.method;
  const modern = isModern(request);
  if (id === undefined || id === null) return;

  try {
    if (method === "initialize") {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: LEGACY_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        },
      });
      return;
    }

    if (method === "server/discover") {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          resultType: "complete",
          supportedVersions: [MODERN_VERSION],
          capabilities: { tools: {} },
          instructions: INSTRUCTIONS,
          ttlMs: 0,
          cacheScope: "private",
          _meta: serverMeta(),
        },
      });
      return;
    }

    if (method === "ping") {
      send({ jsonrpc: "2.0", id, result: {} });
      return;
    }

    if (method === "tools/list") {
      send({
        jsonrpc: "2.0",
        id,
        result: modern
          ? { resultType: "complete", tools: TOOLS, ttlMs: 0, cacheScope: "private", _meta: serverMeta() }
          : { tools: TOOLS },
      });
      return;
    }

    if (method === "tools/call") {
      const name = request?.params?.name;
      const args = request?.params?.arguments || {};
      try {
        const data = await callTool(name, args);
        send({ jsonrpc: "2.0", id, result: toolResult(data, modern, false) });
      } catch (error) {
        if (error?.protocolCode) {
          send({ jsonrpc: "2.0", id, error: { code: error.protocolCode, message: error.message } });
        } else {
          send({
            jsonrpc: "2.0",
            id,
            result: toolResult({ error: error instanceof Error ? error.message : String(error) }, modern, true),
          });
        }
      }
      return;
    }

    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (error) {
    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: error instanceof Error ? error.message : "Internal error" },
    });
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const message = JSON.parse(trimmed);
    void handle(message);
  } catch (error) {
    console.error(`ViralEdit MCP ignored invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
});
