import { NextRequest } from "next/server";
import { pickProvider, extractJson, availableProviders } from "@/lib/ai-providers";
import {
  TASK_PROMPTS,
  normalizeLabelTransitions,
  normalizeEditPlan,
  type NormalizedEditPlan,
} from "@/lib/ai-schema";
import { normalizeCompiledDirection } from "@/lib/prompt-compiler";
import { normalizeNiche } from "@/lib/niche";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";

export const maxDuration = 60;

// Each call here is a paid API request to whichever provider is
// configured — cap per IP so one visitor can't run up your MiniMax/
// Anthropic/OpenAI bill.
const LIMIT = 30;
const WINDOW_MS = 5 * 60_000;

// Provider-agnostic AI layer. Add ANY ONE of MINIMAX_API_KEY,
// ANTHROPIC_API_KEY, or OPENAI_API_KEY to .env.local and this route works —
// swapping keys never changes the shape of what the app receives.
//
// The guarantee: every provider is given the exact same system prompt
// (TASK_PROMPTS), and every reply is forced through the same
// normalize*() validator before it leaves this route. A provider can only
// ever return values the rest of the app already understands (real
// transition types, real color grades, clip IDs that exist on the
// timeline) — anything else is clamped or dropped, never passed through
// raw. The app never *requires* this route either: analysis and auto-edit
// both have full local fallbacks when no key is configured.
//
// POST { task: "label-transitions" | "edit-directions", payload, provider? }
export async function POST(req: NextRequest) {
  const rl = checkRateLimit(`${clientIp(req)}:ai`, LIMIT, WINDOW_MS);
  if (!rl.ok) return rateLimitResponse(rl);

  let body: { task?: string; payload?: unknown; provider?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const provider = pickProvider(body.provider);
  if (!provider) {
    return Response.json(
      {
        available: false,
        error:
          "No AI key configured. Add MINIMAX_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY to .env.local — the app works locally without any of them.",
      },
      { status: 200 }
    );
  }

  const system = TASK_PROMPTS[body.task ?? ""];
  if (!system) return Response.json({ error: `Unknown task: ${body.task}` }, { status: 400 });

  // classify-niche may carry sample frames as data URIs. Pull them out of the
  // text payload and hand them to the provider's vision channel instead of
  // stringifying ~100KB of base64 into the prompt. Text-only providers ignore
  // them and answer from the title/style alone.
  let images: string[] | undefined;
  let payloadForText: unknown = body.payload;
  if (body.task === "classify-niche") {
    const p = (body.payload ?? {}) as { frames?: unknown };
    if (Array.isArray(p.frames)) {
      images = p.frames.filter((f): f is string => typeof f === "string" && f.startsWith("data:")).slice(0, 6);
    }
    const { frames, ...rest } = p as Record<string, unknown>;
    void frames;
    payloadForText = rest;
  }

  let raw: unknown;
  try {
    const text = await provider.call(system, JSON.stringify(payloadForText), images);
    raw = extractJson(text);
    if (raw === null) {
      return Response.json(
        { available: true, provider: provider.name, error: `${provider.name} did not return valid JSON` },
        { status: 502 }
      );
    }
  } catch (err) {
    return Response.json(
      { available: true, provider: provider.name, error: `${provider.name} call failed: ${String(err).slice(0, 200)}` },
      { status: 502 }
    );
  }

  // Every provider's output goes through the SAME normalizer, so the
  // result shape and value set is identical regardless of who answered.
  if (body.task === "label-transitions") {
    const payload = body.payload as { duration?: number } | undefined;
    const duration = typeof payload?.duration === "number" ? payload.duration : 1e6;
    const transitions = normalizeLabelTransitions(raw, duration);
    return Response.json({ available: true, provider: provider.name, result: { transitions } });
  }

  if (body.task === "edit-directions") {
    const payload = body.payload as { plan?: NormalizedEditPlan } | undefined;
    const knownClipIds = new Set((payload?.plan?.segments ?? []).map((s) => s.clipId));
    const fallback: NormalizedEditPlan = payload?.plan
      ? { segments: payload.plan.segments, colorGrade: payload.plan.colorGrade }
      : { segments: [], colorGrade: "none" };
    const result = normalizeEditPlan(raw, knownClipIds, fallback);
    return Response.json({ available: true, provider: provider.name, result });
  }

  if (body.task === "compile-direction") {
    // The model returns a flat settings object; clamp every field to the
    // app's real enums. The client lays this over its own deterministic
    // compile, so an empty/partial refinement never breaks the pipeline.
    const result = normalizeCompiledDirection(raw);
    return Response.json({ available: true, provider: provider.name, result });
  }

  if (body.task === "classify-niche") {
    // Clamp to the fixed taxonomy — an unknown niche maps to "general".
    const result = normalizeNiche(raw);
    return Response.json({ available: true, provider: provider.name, result });
  }

  return Response.json({ available: true, provider: provider.name, result: raw });
}

export async function GET() {
  return Response.json({ configured: availableProviders() });
}
