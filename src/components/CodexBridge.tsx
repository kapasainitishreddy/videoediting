"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useProject } from "@/store/project";
import { getVideo, savePlan } from "@/lib/storage";
import { smartAutoEdit } from "@/lib/auto-edit";
import { applyPlanOps, compileDirection } from "@/lib/prompt-compiler";
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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

function applyCompiledDirection(direction: string): void {
  if (!direction.trim()) return;
  const compiled = compileDirection(direction);
  const state = useProject.getState();
  const cur = state.studio;
  const studio = compiled.studio;
  const patch: Partial<typeof cur> = {};

  if (studio.motionDefault !== undefined) patch.motionDefault = studio.motionDefault;
  if (studio.autoKenBurns !== undefined) patch.autoKenBurns = studio.autoKenBurns;
  if (studio.autoReframe !== undefined) patch.autoReframe = studio.autoReframe;
  if (studio.overlay !== undefined) patch.overlay = studio.overlay;
  if (studio.overlayOpacity !== undefined) patch.overlayOpacity = studio.overlayOpacity;
  if (studio.scoreMood !== undefined) patch.scoreMood = studio.scoreMood;
  if (studio.autoSfx !== undefined) patch.autoSfx = studio.autoSfx;
  if (studio.kineticCaptions !== undefined) patch.kineticCaptions = studio.kineticCaptions;
  if (Object.keys(studio.look).length) patch.look = { ...cur.look, ...studio.look };
  if (Object.keys(patch).length) state.setStudio(patch);
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

    const runAutoEdit = async (direction: string) => {
      const state = useProject.getState();
      if (state.clips.length === 0) throw new Error("No clips are loaded in ViralEdit yet.");

      activeCommand.current = "auto-edit: loading clips";
      const clipBlobs = new Map<string, Blob>();
      for (const clip of state.clips) {
        const video = await getVideo(clip.id);
        if (video) clipBlobs.set(clip.id, video.blob);
      }
      if (clipBlobs.size === 0) throw new Error("ViralEdit clip metadata exists, but the IndexedDB video blobs are missing.");

      const plan = await smartAutoEdit({
        blueprint: state.blueprint,
        clips: state.clips,
        clipBlobs,
        direction,
        beats: null,
        onProgress: (message) => {
          activeCommand.current = `auto-edit: ${message}`;
        },
      });

      if (direction.trim()) {
        const compiled = compileDirection(direction);
        if (compiled.plan.colorGrade) plan.colorGrade = compiled.plan.colorGrade;
        if (compiled.plan.transitionCycle || compiled.plan.transitionMap) {
          plan.segments = applyPlanOps(plan.segments, {
            transitionCycle: compiled.plan.transitionCycle,
            transitionMap: compiled.plan.transitionMap,
          });
        }
        if (compiled.notes.length) plan.explanation += ` Pipeline: ${compiled.summary}.`;
        applyCompiledDirection(direction);
      }

      state.setPlan(plan);
      await savePlan("current", plan);
      if (window.location.pathname !== "/editor") router.push("/editor");

      return {
        message: "Auto-edit created a timeline from the clips currently loaded in ViralEdit.",
        direction: direction || null,
        segmentCount: plan.segments.length,
        colorGrade: plan.colorGrade,
        explanation: plan.explanation,
      };
    };

    const waitForRender = async () => {
      const deadline = Date.now() + 20 * 60_000;
      while (!stopped && Date.now() < deadline) {
        const state = useProject.getState();
        if (state.renderedUrl || window.location.pathname === "/export") {
          return {
            message: "ViralEdit finished rendering and opened the export screen.",
            route: window.location.pathname,
            renderedReady: true,
          };
        }
        await sleep(750);
      }
      throw new Error("Render did not reach the export screen within 20 minutes.");
    };

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
          if (window.location.pathname !== "/editor" || !useProject.getState().plan) {
            throw new Error("Conversational editing needs an existing timeline on /editor. Run viraledit_auto_edit first.");
          }
          return dispatchAndWait(
            "viraledit:codex-chat",
            "viraledit:codex-chat-result",
            { id: command.id, text },
            120_000
          );
        }

        case "auto-edit": {
          const direction = typeof payload.direction === "string" ? payload.direction.trim() : "";
          return runAutoEdit(direction);
        }

        case "render": {
          if (window.location.pathname !== "/editor" || !useProject.getState().plan) {
            throw new Error("Render needs an existing timeline on /editor. Run viraledit_auto_edit first.");
          }
          await dispatchAndWait(
            "viraledit:codex-chat",
            "viraledit:codex-chat-result",
            { id: command.id, text: "render" },
            30_000
          );
          activeCommand.current = "rendering";
          return waitForRender();
        }
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
