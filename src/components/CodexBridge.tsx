"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useProject } from "@/store/project";
import type { CodexBridgeStatus, CodexCommand } from "@/lib/codex-control";

const SAFE_ROUTES = new Set(["/", "/home", "/editor", "/marketing", "/features", "/export"]);

async function post(body: Record<string, unknown>): Promise<void> {
  const res = await fetch("/api/codex", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Codex bridge HTTP ${res.status}`);
}

function dispatchAndWait(
  requestEvent: string,
  resultEvent: string,
  detail: Record<string, unknown>,
  timeoutMs: number
): Promise<unknown> {
  const id = String(detail.id ?? "");
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`ViralEdit did not answer ${requestEvent} within ${Math.round(timeoutMs / 1_000)}s`));
    }, timeoutMs);

    const onResult = (event: Event) => {
      const custom = event as CustomEvent<Record<string, unknown>>;
      if (String(custom.detail?.id ?? "") !== id) return;
      cleanup();
      if (custom.detail?.ok === true) resolve(custom.detail?.data ?? custom.detail);
      else reject(new Error(String(custom.detail?.error ?? "ViralEdit command failed")));
    };

    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener(resultEvent, onResult as EventListener);
    };

    window.addEventListener(resultEvent, onResult as EventListener);
    window.dispatchEvent(new CustomEvent(requestEvent, { detail }));
  });
}

function currentStatus(busy: string | null): CodexBridgeStatus {
  const state = useProject.getState();
  return {
    route: window.location.pathname,
    clipCount: state.clips.length,
    planReady: !!state.plan,
    segmentCount: state.plan?.segments.length ?? 0,
    referenceReady: !!state.blueprint,
    renderedReady: !!state.renderedUrl,
    skillLevel: state.skillLevel,
    busy,
  };
}

export default function CodexBridge() {
  const router = useRouter();
  const polling = useRef(false);
  const activeCommand = useRef<string | null>(null);

  useEffect(() => {
    let stopped = false;

    const heartbeat = async () => {
      if (stopped) return;
      try {
        await post({ action: "heartbeat", status: currentStatus(activeCommand.current) });
      } catch {
        // The bridge is deliberately optional. If the local API disappears
        // during a dev restart, the next heartbeat reconnects automatically.
      }
    };

    heartbeat();
    const timer = window.setInterval(heartbeat, 1_500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let stopped = false;

    const execute = async (command: CodexCommand): Promise<unknown> => {
      const payload = command.payload ?? {};
      switch (command.kind) {
        case "status":
          return currentStatus(activeCommand.current);

        case "undo":
          useProject.getState().undoPlan();
          return { message: "Reverted the last timeline change.", status: currentStatus(null) };

        case "reset":
          useProject.getState().resetProject();
          return { message: "Reset the current ViralEdit project.", status: currentStatus(null) };

        case "navigate": {
          const route = typeof payload.route === "string" ? payload.route : "";
          if (!SAFE_ROUTES.has(route)) throw new Error(`Unsafe or unknown ViralEdit route: ${route || "(empty)"}`);
          router.push(route);
          return { message: `Navigating ViralEdit to ${route}.`, route };
        }

        case "chat": {
          const text = typeof payload.text === "string" ? payload.text.trim() : "";
          if (!text) throw new Error("viraledit_edit requires a non-empty instruction");
          return dispatchAndWait(
            "viraledit:codex-chat",
            "viraledit:codex-chat-result",
            { id: command.id, text },
            120_000
          );
        }

        case "auto-edit": {
          const direction = typeof payload.direction === "string" ? payload.direction.trim() : "";
          if (window.location.pathname !== "/editor") {
            throw new Error("Auto-edit requires ViralEdit to be on /editor. Use viraledit_navigate first.");
          }
          return dispatchAndWait(
            "viraledit:codex-auto-edit",
            "viraledit:codex-auto-edit-result",
            { id: command.id, direction },
            240_000
          );
        }

        case "render":
          if (window.location.pathname !== "/editor") {
            throw new Error("Render requires ViralEdit to be on /editor. Use viraledit_navigate first.");
          }
          return dispatchAndWait(
            "viraledit:codex-render",
            "viraledit:codex-render-result",
            { id: command.id },
            20 * 60_000
          );
      }
    };

    const poll = async () => {
      if (stopped || polling.current || activeCommand.current) return;
      polling.current = true;
      try {
        const res = await fetch("/api/codex?action=next", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { command?: CodexCommand | null };
        const command = body.command;
        if (!command) return;

        activeCommand.current = command.kind;
        try {
          const data = await execute(command);
          await post({ action: "complete", id: command.id, ok: true, data });
        } catch (error) {
          await post({
            action: "complete",
            id: command.id,
            ok: false,
            error: error instanceof Error ? error.message : "ViralEdit command failed",
          }).catch(() => {});
        } finally {
          activeCommand.current = null;
        }
      } catch {
        // Local dev server may be restarting. Polling resumes on the next tick.
      } finally {
        polling.current = false;
      }
    };

    poll();
    const timer = window.setInterval(poll, 500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [router]);

  return null;
}
