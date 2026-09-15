import { NextRequest } from "next/server";
import {
  completeCodexCommand,
  enqueueCodexCommand,
  getCodexBridgeSnapshot,
  getCodexCommand,
  isCodexBridgeAllowed,
  takeNextCodexCommand,
  updateCodexHeartbeat,
  type CodexBridgeStatus,
  type CodexCommandKind,
} from "@/lib/codex-control";

export const dynamic = "force-dynamic";

const COMMAND_KINDS = new Set<CodexCommandKind>([
  "chat",
  "auto-edit",
  "render",
  "undo",
  "reset",
  "status",
  "navigate",
]);

function denied(req: NextRequest): Response | null {
  const hostname = new URL(req.url).hostname;
  if (isCodexBridgeAllowed(process.env.VIRALEDIT_CODEX_BRIDGE, hostname)) return null;
  return Response.json(
    { error: "Codex control bridge is disabled or this request is not loopback-local." },
    { status: 403, headers: { "Cache-Control": "no-store" } }
  );
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  const blocked = denied(req);
  if (blocked) return blocked;

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "health";

  if (action === "health") return json(getCodexBridgeSnapshot());
  if (action === "next") return json({ command: takeNextCodexCommand() });
  if (action === "result") {
    const id = url.searchParams.get("id")?.trim();
    if (!id) return json({ error: "Missing command id" }, 400);
    const command = getCodexCommand(id);
    if (!command) return json({ error: "Unknown command" }, 404);
    return json({ command });
  }

  return json({ error: "Unknown action" }, 400);
}

export async function POST(req: NextRequest) {
  const blocked = denied(req);
  if (blocked) return blocked;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const action = typeof body.action === "string" ? body.action : "";

  if (action === "enqueue") {
    const kind = typeof body.kind === "string" ? (body.kind as CodexCommandKind) : null;
    if (!kind || !COMMAND_KINDS.has(kind)) return json({ error: "Invalid command kind" }, 400);
    const payload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
      ? (body.payload as Record<string, unknown>)
      : {};
    return json({ command: enqueueCodexCommand(kind, payload) }, 202);
  }

  if (action === "complete") {
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return json({ error: "Missing command id" }, 400);
    const ok = body.ok === true;
    const command = completeCodexCommand(id, {
      ok,
      data: body.data,
      error: typeof body.error === "string" ? body.error.slice(0, 1_000) : undefined,
    });
    if (!command) return json({ error: "Unknown command" }, 404);
    return json({ command });
  }

  if (action === "heartbeat") {
    const raw = body.status;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return json({ error: "Missing status" }, 400);
    const value = raw as Record<string, unknown>;
    if (typeof value.route !== "string" || typeof value.clipCount !== "number" || typeof value.planReady !== "boolean") {
      return json({ error: "Invalid status" }, 400);
    }
    const status: CodexBridgeStatus = {
      route: value.route.slice(0, 200),
      clipCount: Math.max(0, Math.floor(value.clipCount)),
      planReady: value.planReady,
      segmentCount: typeof value.segmentCount === "number" ? Math.max(0, Math.floor(value.segmentCount)) : undefined,
      referenceReady: typeof value.referenceReady === "boolean" ? value.referenceReady : undefined,
      renderedReady: typeof value.renderedReady === "boolean" ? value.renderedReady : undefined,
      skillLevel: value.skillLevel === "pro" ? "pro" : value.skillLevel === "beginner" ? "beginner" : undefined,
      busy: typeof value.busy === "string" ? value.busy.slice(0, 300) : null,
    };
    updateCodexHeartbeat(status);
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
}
