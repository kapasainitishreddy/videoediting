"use client";

// Viral/story intelligence (#1-#4, #26-#30, #18-#20 of the uniqueness list):
// pacing structure, emotional arc, cold-open, virality scoring, trend
// fingerprints + taste profile, shot lists, edit variations, blueprint share
// codes, style blending, and platform format migration. Pure analysis over
// data the app already produces — every function runs locally.
import type { EditBlueprint, EditPlan, TransitionType, UserClip } from "./types";
import type { ClipAnalysis } from "./clip-analysis";
import { transitionByType } from "./transitions";
import { v4 as uuid } from "uuid";

// --- #26: three-act pacing analysis --------------------------------------------
export interface ActReport {
  act: "hook" | "build" | "payoff";
  window: [number, number];
  cutsPerSecond: number;
  verdict: string;
}

export function paceAnalysis(bp: EditBlueprint): { acts: ActReport[]; overall: string } {
  const d = bp.duration;
  const bands: [number, number, "hook" | "build" | "payoff"][] = [
    [0, d * 0.2, "hook"],
    [d * 0.2, d * 0.75, "build"],
    [d * 0.75, d, "payoff"],
  ];
  const acts: ActReport[] = bands.map(([a, b, act]) => {
    const cuts = bp.transitions.filter((t) => t.time >= a && t.time < b).length;
    const cps = cuts / Math.max(0.1, b - a);
    let verdict = "";
    if (act === "hook") verdict = cps >= 0.5 ? "Strong hook — opens with energy" : "Slow open — consider a faster first 2s";
    if (act === "build") verdict = cps > 0.2 ? "Build sustains momentum" : "Middle drags — trim or add a mid-beat";
    if (act === "payoff") verdict = cps >= 0.4 ? "Payoff lands with pace" : "Ending coasts — finish on a punch, not a fade-out";
    return { act, window: [Number(a.toFixed(1)), Number(b.toFixed(1))], cutsPerSecond: Number(cps.toFixed(2)), verdict };
  });
  const overall =
    acts[0].cutsPerSecond >= acts[1].cutsPerSecond
      ? "Front-loaded pacing — classic viral shape."
      : "Pacing builds toward the end — works for storytelling, risky for retention.";
  return { acts, overall };
}

// --- #28: emotional arc data (for the UI chart) ----------------------------------
export function emotionalArc(a: ClipAnalysis, points = 40): { t: number; energy: number }[] {
  if (a.times.length === 0) return [];
  const out: { t: number; energy: number }[] = [];
  const step = a.duration / points;
  for (let i = 0; i < points; i++) {
    const t0 = i * step;
    let sum = 0;
    let n = 0;
    for (let k = 0; k < a.times.length; k++) {
      if (a.times[k] >= t0 && a.times[k] < t0 + step) {
        sum += a.motion[k];
        n++;
      }
    }
    out.push({ t: Number(t0.toFixed(2)), energy: Number((n ? sum / n : 0).toFixed(4)) });
  }
  return out;
}

// --- #29: cold-open detector ------------------------------------------------------
export function coldOpenCheck(a: ClipAnalysis): { pass: boolean; peakAt: number; message: string } {
  if (a.times.length === 0) return { pass: true, peakAt: 0, message: "No data" };
  let peakI = 0;
  for (let i = 1; i < a.motion.length; i++) if (a.motion[i] > a.motion[peakI]) peakI = i;
  const peakAt = a.times[peakI];
  const pass = peakAt <= a.duration * 0.15;
  return {
    pass,
    peakAt: Number(peakAt.toFixed(2)),
    message: pass
      ? `Highest-energy moment is at ${peakAt.toFixed(1)}s — properly front-loaded.`
      : `Your best moment hides at ${peakAt.toFixed(1)}s. Move it into the first ${(a.duration * 0.15).toFixed(1)}s as the hook.`,
  };
}

// --- #2 (uniqueness): virality score ----------------------------------------------
export function viralityScore(plan: EditPlan, bp: EditBlueprint | null): { score: number; breakdown: { label: string; pts: number; max: number; tip: string }[] } {
  const breakdown: { label: string; pts: number; max: number; tip: string }[] = [];
  const segs = plan.segments;
  const total = segs.reduce((s, x) => s + (x.end - x.start) / x.speed, 0);

  // hook: first shot short & punchy
  const firstLen = segs.length ? (segs[0].end - segs[0].start) / segs[0].speed : 99;
  const hookPts = firstLen <= 1.2 ? 25 : firstLen <= 2 ? 15 : 5;
  breakdown.push({ label: "Hook speed", pts: hookPts, max: 25, tip: firstLen <= 1.2 ? "First shot is punchy" : "Open with a shorter, harder first shot" });

  // duration fit: 8-22s sweet spot
  const durPts = total >= 8 && total <= 22 ? 20 : total < 8 ? 10 : 8;
  breakdown.push({ label: "Duration", pts: durPts, max: 20, tip: total >= 8 && total <= 22 ? `${total.toFixed(0)}s sits in the retention sweet spot` : "Aim for 8–22s total" });

  // transition variety
  const kinds = new Set(segs.map((s) => s.transitionAfter).filter(Boolean));
  const varPts = Math.min(20, kinds.size * 5);
  breakdown.push({ label: "Transition variety", pts: varPts, max: 20, tip: kinds.size >= 3 ? "Good transition mix" : "Vary your transitions — repetition reads as template" });

  // pacing consistency vs reference
  let pacePts = 12;
  let paceTip = "No reference — steady rhythm assumed";
  if (bp) {
    const target = bp.style.avgShotLength;
    const avg = total / Math.max(1, segs.length);
    const drift = Math.abs(avg - target) / target;
    pacePts = drift < 0.2 ? 20 : drift < 0.5 ? 12 : 5;
    paceTip = drift < 0.2 ? "Pacing matches the reference closely" : "Your shots drift from the reference rhythm";
  }
  breakdown.push({ label: "Pacing match", pts: pacePts, max: 20, tip: paceTip });

  // shot variety (clip reuse)
  const uniqueClips = new Set(segs.map((s) => s.clipId)).size;
  const reuseRatio = uniqueClips / Math.max(1, segs.length);
  const shotPts = reuseRatio > 0.6 ? 15 : reuseRatio > 0.35 ? 10 : 5;
  breakdown.push({ label: "Shot variety", pts: shotPts, max: 15, tip: reuseRatio > 0.6 ? "Fresh footage throughout" : "Heavy clip reuse — shoot more coverage" });

  const score = breakdown.reduce((s, b) => s + b.pts, 0);
  return { score, breakdown };
}

// --- #1 (uniqueness): trend fingerprint + taste profile ----------------------------
export interface Fingerprint {
  id: string;
  name: string;
  bpm: number | null;
  pacing: string;
  avgShot: number;
  transitionMix: Partial<Record<TransitionType, number>>;
  grade: string;
  createdAt: number;
}

export function fingerprintOf(bp: EditBlueprint): Fingerprint {
  const mix: Partial<Record<TransitionType, number>> = {};
  for (const t of bp.transitions) mix[t.type] = (mix[t.type] ?? 0) + 1;
  return {
    id: uuid(),
    name: bp.sourceName,
    bpm: bp.beats?.bpm ?? null,
    pacing: bp.style.pacing,
    avgShot: bp.style.avgShotLength,
    transitionMix: mix,
    grade: bp.style.colorGrade,
    createdAt: Date.now(),
  };
}

export function tasteProfile(prints: Fingerprint[]): string[] {
  if (prints.length < 2) return ["Analyze a few more reels to build your taste profile."];
  const notes: string[] = [];
  const avgShot = prints.reduce((s, p) => s + p.avgShot, 0) / prints.length;
  notes.push(
    avgShot < 1.2
      ? `You gravitate to fast cuts (~${avgShot.toFixed(1)}s shots).`
      : `You favor breathing room (~${avgShot.toFixed(1)}s shots).`
  );
  const grades = new Map<string, number>();
  for (const p of prints) grades.set(p.grade, (grades.get(p.grade) ?? 0) + 1);
  const topGrade = [...grades.entries()].sort((a, b) => b[1] - a[1])[0];
  notes.push(`Your go-to look is "${topGrade[0]}" (${topGrade[1]}/${prints.length} reels).`);
  const allTrans = new Map<string, number>();
  for (const p of prints) for (const [k, v] of Object.entries(p.transitionMix)) allTrans.set(k, (allTrans.get(k) ?? 0) + (v ?? 0));
  const topT = [...allTrans.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topT) notes.push(`Signature transition: ${transitionByType(topT[0] as TransitionType).label}.`);
  const bpms = prints.filter((p) => p.bpm).map((p) => p.bpm!) as number[];
  if (bpms.length >= 2) notes.push(`Typical tempo: ~${Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length)} BPM.`);
  return notes;
}

// --- #9 (uniqueness): shot list generator ------------------------------------------
export function shotList(bp: EditBlueprint): { n: number; text: string }[] {
  const shots: { n: number; text: string }[] = [];
  const times = [0, ...bp.transitions.map((t) => t.time), bp.duration];
  for (let i = 0; i < times.length - 1; i++) {
    const len = times[i + 1] - times[i];
    const after = bp.transitions[i];
    const trans = after ? transitionByType(after.type) : null;
    shots.push({
      n: i + 1,
      text:
        `${len.toFixed(1)}s shot, vertical 9:16.` +
        (trans
          ? ` Ends in a ${trans.label.toLowerCase()} — ${trans.beginnerTip}`
          : " Final shot — hold it steady for the outro."),
    });
  }
  return shots;
}

// --- #20 (uniqueness): batch edit variations ----------------------------------------
export function editVariations(plan: EditPlan): { name: string; plan: EditPlan }[] {
  const clone = (p: EditPlan): EditPlan => JSON.parse(JSON.stringify(p));

  const punchy = clone(plan);
  punchy.segments.forEach((s) => {
    s.end = Number(Math.max(s.start + 0.35, s.start + (s.end - s.start) * 0.75).toFixed(2));
    if (s.transitionAfter === "fade" || s.transitionAfter === "blur") s.transitionAfter = "whip-pan";
  });
  punchy.explanation = "Variation: tighter cuts, whip energy.";

  const dreamy = clone(plan);
  dreamy.segments.forEach((s) => {
    s.speed = 0.85;
    if (s.transitionAfter === "hard-cut" || s.transitionAfter === "whip-pan") s.transitionAfter = "blur";
  });
  dreamy.colorGrade = "cinematic";
  dreamy.explanation = "Variation: slow dreamy blends, cinematic grade.";

  const raw = clone(plan);
  raw.segments.forEach((s) => (s.transitionAfter = s.transitionAfter ? "hard-cut" : null));
  raw.colorGrade = "high-contrast";
  raw.explanation = "Variation: all hard cuts, punchy grade — raw energy.";

  return [
    { name: "Punchy", plan: punchy },
    { name: "Dreamy", plan: dreamy },
    { name: "Raw", plan: raw },
  ];
}

// --- #18 (uniqueness): blueprint share codes ------------------------------------------
export function blueprintToCode(bp: EditBlueprint): string {
  const compact = {
    v: 1,
    n: bp.sourceName.slice(0, 40),
    d: bp.duration,
    t: bp.transitions.map((t) => [t.time, t.type]),
    b: bp.beats?.bpm ?? null,
    s: [bp.style.colorGrade, bp.style.pacing, bp.style.avgShotLength],
  };
  const json = JSON.stringify(compact);
  return "VE1." + btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function blueprintFromCode(code: string): EditBlueprint | null {
  try {
    if (!code.startsWith("VE1.")) return null;
    const b64 = code.slice(4).replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(escape(atob(b64)));
    const c = JSON.parse(json);
    const transitions = (c.t as [number, TransitionType][]).map(([time, type], i) => ({
      id: `sh_${i}`,
      time,
      type,
      confidence: 1,
      durationFrames: 8,
      description: transitionByType(type).description,
    }));
    const beatLen = c.b ? 60 / c.b : null;
    return {
      id: uuid(),
      sourceName: `${c.n} (shared)`,
      duration: c.d,
      transitions,
      beats: c.b
        ? { bpm: c.b, beatTimes: beatLen ? Array.from({ length: Math.floor(c.d / beatLen) }, (_, i) => Number((i * beatLen).toFixed(2))) : [], energy: "medium" }
        : null,
      style: { colorGrade: c.s[0], pacing: c.s[1], avgShotLength: c.s[2], aspectRatio: "9:16", notes: [] },
      guide: [],
      createdAt: Date.now(),
    };
  } catch {
    return null;
  }
}

// --- #6 (uniqueness): style blending ---------------------------------------------------
export function blendStyles(pacingFrom: EditBlueprint, lookFrom: EditBlueprint): EditBlueprint {
  return {
    ...pacingFrom,
    id: uuid(),
    sourceName: `${pacingFrom.sourceName} × ${lookFrom.sourceName}`,
    transitions: pacingFrom.transitions.map((t, i) => ({
      ...t,
      type: lookFrom.transitions[i % Math.max(1, lookFrom.transitions.length)]?.type ?? t.type,
    })),
    style: { ...lookFrom.style, avgShotLength: pacingFrom.style.avgShotLength, pacing: pacingFrom.style.pacing },
    createdAt: Date.now(),
  };
}

// --- #4 (uniqueness): platform format migration ------------------------------------------
export function migrateFormat(bp: EditBlueprint, platform: "tiktok" | "reels" | "shorts"): EditBlueprint {
  const clone: EditBlueprint = JSON.parse(JSON.stringify(bp));
  clone.id = uuid();
  clone.sourceName = `${bp.sourceName} → ${platform}`;
  if (platform === "tiktok") {
    // faster hook: compress the first 20% of cut times by 30%
    clone.transitions.forEach((t) => {
      if (t.time < bp.duration * 0.2) t.time = Number((t.time * 0.7).toFixed(2));
    });
    clone.style.notes = [...clone.style.notes, "TikTok: hook compressed — first cut lands sooner"];
  } else if (platform === "shorts") {
    clone.style.avgShotLength = Number((bp.style.avgShotLength * 1.15).toFixed(2));
    clone.style.notes = [...clone.style.notes, "Shorts: slightly longer shots tolerated — breathing room added"];
  } else {
    clone.style.notes = [...clone.style.notes, "Reels: loop-friendly — make your last shot cut cleanly back into your first"];
  }
  clone.createdAt = Date.now();
  return clone;
}

// --- #30: b-roll insertion points ----------------------------------------------------------
export function brollGaps(a: ClipAnalysis, threshold = 0.02, minLen = 1.2): { start: number; end: number }[] {
  const gaps: { start: number; end: number }[] = [];
  let start: number | null = null;
  for (let i = 0; i < a.times.length; i++) {
    const low = a.motion[i] < threshold;
    if (low && start === null) start = a.times[i];
    if (!low && start !== null) {
      if (a.times[i] - start >= minLen) gaps.push({ start: Number(start.toFixed(2)), end: Number(a.times[i].toFixed(2)) });
      start = null;
    }
  }
  if (start !== null && a.duration - start >= minLen) gaps.push({ start: Number(start.toFixed(2)), end: Number(a.duration.toFixed(2)) });
  return gaps;
}

// --- clips needed for UserClip typing in variations -----------------------------------------
export type { UserClip };
