// The contract every AI provider must satisfy.
//
// Different LLMs phrase things differently, so we can't guarantee identical
// prose. What we CAN guarantee — regardless of whether MiniMax, Claude, or
// OpenAI answered — is that the data that reaches the UI always has the
// same shape and only ever contains values the rest of the app understands.
// Every provider's raw reply is forced through normalizeX() below before
// it is returned from /api/ai. If a provider hallucinates an invalid
// transition type, a color grade that doesn't exist, or a time outside the
// clip, it gets clamped or dropped here — never passed through raw.
import type { TransitionType } from "./types";
import { TRANSITIONS, COLOR_GRADES } from "./transitions";
import { COMPILE_DIRECTION_PROMPT } from "./prompt-compiler";
import { CLASSIFY_NICHE_PROMPT } from "./niche";

const VALID_TRANSITIONS = new Set<string>(TRANSITIONS.map((t) => t.type));
const VALID_GRADES = new Set<string>(Object.keys(COLOR_GRADES));

function coerceTransitionType(v: unknown): TransitionType {
  const s = typeof v === "string" ? v.toLowerCase().trim().replace(/\s+/g, "-") : "";
  return (VALID_TRANSITIONS.has(s) ? s : "hard-cut") as TransitionType;
}

function coerceColorGrade(v: unknown): string {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  return VALID_GRADES.has(s) ? s : "none";
}

function coerceNumber(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export interface NormalizedTransitionLabel {
  time: number;
  type: TransitionType;
  description: string;
}

// task: "label-transitions" — clamps every entry to a real time/type/short text
export function normalizeLabelTransitions(raw: unknown, duration: number): NormalizedTransitionLabel[] {
  const arr = (raw as { transitions?: unknown[] })?.transitions;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((item) => {
      const o = item as Record<string, unknown>;
      return {
        time: coerceNumber(o.time, 0, 0, duration),
        type: coerceTransitionType(o.type),
        description: typeof o.description === "string" ? o.description.slice(0, 160) : "",
      };
    })
    .filter((t) => t.description.length > 0)
    .slice(0, 100);
}

export interface NormalizedSegment {
  id: string;
  clipId: string;
  start: number;
  end: number;
  transitionAfter: TransitionType | null;
  speed: number;
}

export interface NormalizedEditPlan {
  segments: NormalizedSegment[];
  colorGrade: string;
}

// task: "edit-directions" — every field is clamped/validated; segments whose
// clipId isn't one of the clips actually on the timeline are dropped, so a
// provider can never point the editor at footage that doesn't exist.
export function normalizeEditPlan(raw: unknown, knownClipIds: Set<string>, fallback: NormalizedEditPlan): NormalizedEditPlan {
  const o = raw as Record<string, unknown>;
  const rawSegments = Array.isArray(o?.segments) ? o.segments : null;
  if (!rawSegments || rawSegments.length === 0) return fallback;

  const segments: NormalizedSegment[] = [];
  for (const item of rawSegments) {
    const s = item as Record<string, unknown>;
    const clipId = typeof s.clipId === "string" ? s.clipId : "";
    if (!knownClipIds.has(clipId)) continue; // never trust an unknown clip reference
    const start = coerceNumber(s.start, 0, 0, 1e6);
    const end = coerceNumber(s.end, start + 1, start + 0.05, 1e6);
    segments.push({
      id: typeof s.id === "string" ? s.id : `seg_${segments.length}`,
      clipId,
      start,
      end,
      transitionAfter: s.transitionAfter == null ? null : coerceTransitionType(s.transitionAfter),
      speed: coerceNumber(s.speed, 1, 0.25, 4),
    });
  }
  if (segments.length === 0) return fallback;

  return {
    segments,
    colorGrade: coerceColorGrade(o.colorGrade),
  };
}

// Every provider must return one JSON object matching these system prompts.
// Keeping the prompt identical across providers is half of the consistency
// guarantee; the normalize functions above are the other half.
export const TASK_PROMPTS: Record<string, string> = {
  "label-transitions": `You are a viral video editing expert. You receive transitions ALREADY DETECTED by a deterministic analyzer (time, type, confidence, evidence). Your job is only to polish: improve each description into one vivid, useful sentence for a creator recreating the edit, and correct a type ONLY when the evidence clearly contradicts it AND confidence < 0.8. You MUST pick "type" only from: ${TRANSITIONS.map((t) => t.type).join(", ")}. Keep every time value unchanged. Respond with ONLY a JSON object, no prose, no markdown fences: {"transitions":[{"time":number,"type":string,"description":string}]}`,
  "edit-directions": `You are a viral video editor. The user gives you a plain-English direction and a current edit plan (segments with clipId, start, end, transitionAfter, speed; plus a colorGrade). Return an improved plan as JSON with the SAME segment clipIds (never invent new ones) — only adjust start/end/transitionAfter/speed/colorGrade to match the direction. "transitionAfter" must be one of: ${TRANSITIONS.map((t) => t.type).join(", ")}, or null for the last segment. "colorGrade" must be one of: ${Object.keys(COLOR_GRADES).join(", ")}. Respond with ONLY a JSON object, no prose, no markdown fences: {"segments":[{"id":string,"clipId":string,"start":number,"end":number,"transitionAfter":string|null,"speed":number}],"colorGrade":string}`,
  // Refines the deterministic prompt-compiler result: model returns a flat
  // settings object, normalizeCompiledDirection clamps it to real enums.
  "compile-direction": COMPILE_DIRECTION_PROMPT,
  // Vision (or text) niche classification; normalizeNiche clamps to taxonomy.
  "classify-niche": CLASSIFY_NICHE_PROMPT,
};
