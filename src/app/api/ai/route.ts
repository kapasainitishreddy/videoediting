import { NextRequest } from "next/server";
import { pickProvider, extractJson, availableProviders } from "@/lib/ai-providers";
import {
  TASK_PROMPTS,
  normalizeLabelTransitions,
  normalizeEditPlan,
  type NormalizedEditPlan,
} from "@/lib/ai-schema";
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

  let raw: unknown;
  try {
    const text = await provider.call(system, JSON.stringify(body.payload));
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

  return Response.json({ available: true, provider: provider.name, result: raw });
}

export async function GET() {
  return Response.json({ configured: availableProviders() });
}
