export type CodexCommandKind =
  | "chat"
  | "auto-edit"
  | "render"
  | "undo"
  | "reset"
  | "status"
  | "navigate";

export type CodexCommandStatus = "pending" | "dispatched" | "completed" | "failed";

export interface CodexCommandResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface CodexBridgeStatus {
  route: string;
  clipCount: number;
  planReady: boolean;
  segmentCount?: number;
  referenceReady?: boolean;
  renderedReady?: boolean;
  skillLevel?: "beginner" | "pro";
  busy: string | null;
}

export interface CodexCommand {
  id: string;
  kind: CodexCommandKind;
  payload: Record<string, unknown>;
  status: CodexCommandStatus;
  createdAt: number;
  dispatchedAt?: number;
  completedAt?: number;
  result?: CodexCommandResult;
}

interface CodexControlState {
  commands: CodexCommand[];
  heartbeat: { at: number; status: CodexBridgeStatus } | null;
}

// Next.js dev reloads modules frequently. Keep the short-lived control queue on
// globalThis so an in-flight Codex command is not lost between hot reloads.
const g = globalThis as typeof globalThis & { __viralEditCodexControl?: CodexControlState };

function controlState(): CodexControlState {
  if (!g.__viralEditCodexControl) {
    g.__viralEditCodexControl = { commands: [], heartbeat: null };
  }
  return g.__viralEditCodexControl;
}

function newId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `codex-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function trimHistory(state: CodexControlState): void {
  if (state.commands.length <= 100) return;
  const active = state.commands.filter((c) => c.status === "pending" || c.status === "dispatched");
  const finished = state.commands.filter((c) => c.status === "completed" || c.status === "failed").slice(-80);
  state.commands = [...finished, ...active].slice(-100);
}

export function enqueueCodexCommand(
  kind: CodexCommandKind,
  payload: Record<string, unknown> = {},
  now = Date.now()
): CodexCommand {
  const state = controlState();
  const command: CodexCommand = {
    id: newId(),
    kind,
    payload,
    status: "pending",
    createdAt: now,
  };
  state.commands.push(command);
  trimHistory(state);
  return command;
}

export function takeNextCodexCommand(now = Date.now()): CodexCommand | null {
  const command = controlState().commands.find((c) => c.status === "pending");
  if (!command) return null;
  command.status = "dispatched";
  command.dispatchedAt = now;
  return command;
}

export function completeCodexCommand(
  commandId: string,
  result: CodexCommandResult,
  now = Date.now()
): CodexCommand | null {
  const command = controlState().commands.find((c) => c.id === commandId);
  if (!command) return null;
  command.status = result.ok ? "completed" : "failed";
  command.completedAt = now;
  command.result = result;
  return command;
}

export function getCodexCommand(commandId: string): CodexCommand | null {
  return controlState().commands.find((c) => c.id === commandId) ?? null;
}

export function updateCodexHeartbeat(status: CodexBridgeStatus, now = Date.now()): void {
  controlState().heartbeat = { at: now, status };
}

export function getCodexBridgeSnapshot(now = Date.now(), ttlMs = 5_000): {
  connected: boolean;
  lastSeenAt: number | null;
  status: CodexBridgeStatus | null;
} {
  const heartbeat = controlState().heartbeat;
  if (!heartbeat) return { connected: false, lastSeenAt: null, status: null };
  return {
    connected: now - heartbeat.at <= ttlMs,
    lastSeenAt: heartbeat.at,
    status: heartbeat.status,
  };
}

// Intentionally exported for the pure Node test only; production code never
// needs to reset this singleton.
export function __resetCodexControlForTests(): void {
  g.__viralEditCodexControl = { commands: [], heartbeat: null };
}
