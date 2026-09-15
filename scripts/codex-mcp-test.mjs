import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

let seq = 0;
const commands = new Map();
const mockBridge = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  res.setHeader("content-type", "application/json");

  if (req.method === "GET" && url.searchParams.get("action") === "health") {
    res.end(
      JSON.stringify({
        connected: true,
        status: { route: "/editor", clipCount: 2, planReady: true, segmentCount: 4, busy: null },
      })
    );
    return;
  }

  if (req.method === "POST") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || "{}");
    if (body.action === "enqueue") {
      const id = `cmd-${++seq}`;
      commands.set(id, {
        id,
        status: "completed",
        result: { ok: true, data: { kind: body.kind, payload: body.payload } },
      });
      res.statusCode = 202;
      res.end(JSON.stringify({ command: { id } }));
      return;
    }
  }

  if (req.method === "GET" && url.searchParams.get("action") === "result") {
    res.end(JSON.stringify({ command: commands.get(url.searchParams.get("id")) }));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

await new Promise((resolve) => mockBridge.listen(0, "127.0.0.1", resolve));
const address = mockBridge.address();
if (!address || typeof address === "string") throw new Error("mock bridge did not bind a TCP port");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(process.execPath, ["codex-plugin/mcp/server.mjs"], {
  cwd: repoRoot,
  env: { ...process.env, VIRALEDIT_URL: `http://127.0.0.1:${address.port}` },
  stdio: ["pipe", "pipe", "inherit"],
});

let buffer = "";
const waiters = [];
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  while (buffer.includes("\n")) {
    const idx = buffer.indexOf("\n");
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    const waiterIndex = waiters.findIndex((w) => w.id === msg.id);
    if (waiterIndex >= 0) waiters.splice(waiterIndex, 1)[0].resolve(msg);
  }
});

function rpc(id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 3_000);
    waiters.push({
      id,
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

try {
  const legacy = await rpc(1, "initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  });
  assert.equal(legacy.result.protocolVersion, "2025-11-25");
  assert.ok(legacy.result.capabilities.tools);

  const meta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
    "io.modelcontextprotocol/clientCapabilities": {},
  };
  const discover = await rpc("d1", "server/discover", { _meta: meta });
  assert.deepEqual(discover.result.supportedVersions, ["2026-07-28"]);
  assert.equal(discover.result.resultType, "complete");

  const list = await rpc("l1", "tools/list", { _meta: meta });
  const names = list.result.tools.map((tool) => tool.name);
  assert.ok(names.includes("viraledit_status"));
  assert.ok(names.includes("viraledit_edit"));
  assert.ok(names.includes("viraledit_render"));
  assert.equal(list.result.resultType, "complete");

  const status = await rpc("c1", "tools/call", { name: "viraledit_status", arguments: {}, _meta: meta });
  assert.equal(status.result.isError, false);
  assert.match(status.result.content[0].text, /clipCount/);

  const edit = await rpc("c2", "tools/call", {
    name: "viraledit_edit",
    arguments: { instruction: "tighten the hook" },
  });
  assert.equal(edit.result.isError, false);
  assert.match(edit.result.content[0].text, /tighten the hook/);

  console.log("codex-mcp-test: pass");
} finally {
  child.kill("SIGTERM");
  mockBridge.close();
}
