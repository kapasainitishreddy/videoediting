// Retention & pacing toolkit — pure plan-level analysis and plan surgery.
// No "use client", no DOM: everything here works from the EditPlan (and
// optionally clip names), so it runs in Node tests and the browser alike.
//
//  • retentionHeatmap()  — per-second drop-off risk estimate for the timeline
//  • deadIntroCheck()    — flags a slow opening and says exactly what to trim
//  • hookVariants()      — three alternate openings to A/B test
//  • callbackEnding()    — replays a beat of the hook at the end (rewatch bait)
//  • lengthVariants()    — 15s / 30s / 60s cuts derived from one plan
//  • chapterMarkers()    — YouTube-style timestamp list for the description
//  • loopabilityCheck()  — structural "does this loop cleanly?" score
//
// These are heuristics, not oracles — each result carries a human-readable
// tip so the user learns WHY, and nothing here auto-applies without a tap.
import type { EditPlan, TimelineSegment, UserClip } from "./types";
import { transitionByType } from "./transitions";

const clonePlan = (p: EditPlan): EditPlan => JSON.parse(JSON.stringify(p));

function segOutLen(s: TimelineSegment): number {
  return (s.end - s.start) / s.speed;
}

export function planDuration(plan: EditPlan): number {
  let total = plan.segments.reduce((sum, s) => sum + segOutLen(s), 0);
  for (let i = 0; i < plan.segments.length - 1; i++) {
    const r = transitionByType(plan.segments[i].transitionAfter ?? "hard-cut");
    if (r.xfade && r.defaultDuration > 0) total -= r.defaultDuration;
  }
  return Math.max(0.5, total);
}

// --- Retention heatmap --------------------------------------------------------
// Risk model: attention decays the longer a shot runs without a cut (viewers
// swipe when nothing changes), resets at every cut, decays faster late in the
// video, and a monotonous transition language adds a constant penalty.
export interface RetentionPoint {
  t: number; // seconds into the output
  risk: number; // 0..1, higher = more likely to lose the viewer here
}

export function retentionHeatmap(plan: EditPlan, resolution = 2): { points: RetentionPoint[]; worst: RetentionPoint; summary: string } {
  const total = planDuration(plan);
  // cut times in output space
  const cuts: number[] = [];
  let clock = 0;
  for (let i = 0; i < plan.segments.length - 1; i++) {
    clock += segOutLen(plan.segments[i]);
    cuts.push(clock);
  }
  const kinds = new Set(plan.segments.map((s) => s.transitionAfter).filter(Boolean));
  const monotonyPenalty = plan.segments.length > 3 && kinds.size <= 1 ? 0.08 : 0;

  const points: RetentionPoint[] = [];
  const step = 1 / resolution;
  for (let t = 0; t < total; t += step) {
    const lastCut = cuts.filter((c) => c <= t).pop() ?? 0;
    const sinceCut = t - lastCut;
    // shot staleness: ~0 right after a cut, saturating toward 0.75 by ~4s
    const staleness = 0.75 * (1 - Math.exp(-sinceCut / 2.2));
    // late-video fatigue: linear ramp adding up to 0.15 at the very end
    const fatigue = 0.15 * (t / total);
    const risk = Math.min(1, staleness + fatigue + monotonyPenalty);
    points.push({ t: Number(t.toFixed(2)), risk: Number(risk.toFixed(3)) });
  }
  const worst = points.reduce((w, p) => (p.risk > w.risk ? p : w), points[0] ?? { t: 0, risk: 0 });
  const summary =
    worst.risk > 0.7
      ? `Biggest drop-off risk around ${worst.t.toFixed(0)}s — a long uncut stretch. Add a cut or motion there.`
      : "No dangerous dead zones — cuts keep arriving before attention lapses.";
  return { points, worst, summary };
}

// --- Dead-intro detector --------------------------------------------------------
export function deadIntroCheck(plan: EditPlan): { pass: boolean; trimSeconds: number; message: string } {
  if (plan.segments.length === 0) return { pass: true, trimSeconds: 0, message: "No plan yet." };
  const first = segOutLen(plan.segments[0]);
  const avg = planDuration(plan) / plan.segments.length;
  // A first shot much longer than the average rhythm reads as a slow open.
  if (first > Math.max(2, avg * 1.6)) {
    const trim = Number((first - Math.max(1, avg)).toFixed(1));
    return {
      pass: false,
      trimSeconds: trim,
      message: `Your opening shot runs ${first.toFixed(1)}s — ~${trim}s longer than your edit's rhythm. Trim it to hook faster.`,
    };
  }
  return { pass: true, trimSeconds: 0, message: `Opening shot is ${first.toFixed(1)}s — arrives on rhythm.` };
}

// --- Hook A/B variants ------------------------------------------------------------
// Three alternate openings, each a real plan the user can render:
//  Tight   — first shot cut to ≤1s
//  Swapped — second shot leads instead
//  Teaser  — 0.8s flash of the FINAL shot first ("ending first"), then the edit
export function hookVariants(plan: EditPlan): { name: string; why: string; plan: EditPlan }[] {
  if (plan.segments.length < 2) return [];
  const out: { name: string; why: string; plan: EditPlan }[] = [];

  const tight = clonePlan(plan);
  const f = tight.segments[0];
  f.end = Number(Math.min(f.end, f.start + 1 * f.speed).toFixed(2));
  tight.explanation = "Hook variant: opening shot tightened to under a second.";
  out.push({ name: "Tight open", why: "Cuts the first shot to ≤1s so something happens immediately.", plan: tight });

  const swapped = clonePlan(plan);
  [swapped.segments[0], swapped.segments[1]] = [swapped.segments[1], swapped.segments[0]];
  const last = swapped.segments[swapped.segments.length - 1];
  last.transitionAfter = null;
  if (swapped.segments.length >= 2 && swapped.segments[swapped.segments.length - 2].transitionAfter === null) {
    swapped.segments[swapped.segments.length - 2].transitionAfter = "hard-cut";
  }
  swapped.explanation = "Hook variant: second shot promoted to the opener.";
  out.push({ name: "Swapped open", why: "Leads with your second shot — sometimes the real hook hides at #2.", plan: swapped });

  const teaser = clonePlan(plan);
  const src = teaser.segments[teaser.segments.length - 1];
  const flashLen = Math.min(0.8, (src.end - src.start) * 0.6);
  teaser.segments.unshift({
    ...src,
    id: `teaser_${src.id}`,
    end: Number((src.start + flashLen).toFixed(2)),
    transitionAfter: "flash",
  });
  const tLast = teaser.segments[teaser.segments.length - 1];
  tLast.transitionAfter = null;
  teaser.explanation = "Hook variant: 0.8s teaser of the ending, then the edit.";
  out.push({ name: "Ending-first teaser", why: "Flashes the payoff up front — viewers stay to see how you got there.", plan: teaser });

  return out;
}

// --- Callback ending ----------------------------------------------------------------
// Appends a short replay of the opening beat at the very end — rewards
// rewatchers and makes autoplay loops feel intentional.
export function callbackEnding(plan: EditPlan): EditPlan {
  if (plan.segments.length < 2) return plan;
  const next = clonePlan(plan);
  const hook = next.segments[0];
  const beat = Math.min(0.9, (hook.end - hook.start) * 0.7);
  const prevLast = next.segments[next.segments.length - 1];
  prevLast.transitionAfter = "fade";
  next.segments.push({
    ...hook,
    id: `callback_${hook.id}`,
    end: Number((hook.start + beat).toFixed(2)),
    transitionAfter: null,
  });
  next.explanation = (next.explanation ? next.explanation + " " : "") + "Callback ending: the hook returns for a beat at the end.";
  return next;
}

// --- 15 / 30 / 60 length variants ------------------------------------------------------
// Derives shorter (or confirms fitting) cuts of the same edit. Strategy per
// target: keep the hook and the payoff, drop middle segments outward-in, then
// tighten remaining shots proportionally. Never drops below 2 segments.
export function lengthVariants(plan: EditPlan, targets: number[] = [15, 30, 60]): { target: number; fits: boolean; plan: EditPlan }[] {
  return targets.map((target) => {
    const current = planDuration(plan);
    if (current <= target + 0.5) {
      return { target, fits: true, plan: clonePlan(plan) };
    }
    const next = clonePlan(plan);
    // drop middle segments until close (keep first + last)
    while (next.segments.length > 2 && planDuration(next) > target) {
      const mid = Math.floor(next.segments.length / 2);
      next.segments.splice(mid, 1);
    }
    // proportional tighten to close the rest of the gap
    const still = planDuration(next);
    if (still > target) {
      const factor = Math.max(0.35, target / still);
      for (const s of next.segments) {
        const len = (s.end - s.start) * factor;
        s.end = Number((s.start + Math.max(0.35 * s.speed, len)).toFixed(2));
      }
    }
    next.segments[next.segments.length - 1].transitionAfter = null;
    next.explanation = `${target}s cut: middle trimmed, hook and payoff kept.`;
    return { target, fits: false, plan: next };
  });
}

// --- Chapter markers ---------------------------------------------------------------------
export function chapterMarkers(plan: EditPlan, clips: UserClip[]): string {
  const lines: string[] = [];
  let clock = 0;
  plan.segments.forEach((s, i) => {
    const mm = Math.floor(clock / 60);
    const ss = Math.floor(clock % 60);
    const name = clips.find((c) => c.id === s.clipId)?.name.replace(/\.[a-z0-9]+$/i, "") ?? `Shot ${i + 1}`;
    lines.push(`${mm}:${String(ss).padStart(2, "0")} ${name}`);
    clock += segOutLen(s);
  });
  return lines.join("\n");
}

// --- Loopability (structural) ---------------------------------------------------------------
// Plan-level signals only (no pixels): does the edit END in a way that cuts
// cleanly back into its start on autoplay? Honest about being structural.
export function loopabilityCheck(plan: EditPlan): { score: number; tips: string[] } {
  const tips: string[] = [];
  let score = 40;
  const segs = plan.segments;
  if (segs.length === 0) return { score: 0, tips: ["No plan yet."] };

  const first = segs[0];
  const last = segs[segs.length - 1];
  if (first.clipId === last.clipId) {
    score += 25;
    tips.push("First and last shots share a clip — visual continuity across the loop point.");
  } else {
    tips.push("Ending on a different clip than you open with — the loop seam will show. A callback ending fixes this.");
  }
  const lastLen = segOutLen(last);
  if (lastLen <= 1.5) {
    score += 15;
    tips.push("Short final shot — the loop lands before attention drops.");
  } else {
    tips.push(`Final shot runs ${lastLen.toFixed(1)}s — trim it so the loop arrives sooner.`);
  }
  const secondToLast = segs.length >= 2 ? segs[segs.length - 2].transitionAfter : null;
  if (secondToLast === "fade" || secondToLast === "blur") {
    tips.push("A fade near the end reads as 'the end' — hard cuts loop better.");
  } else {
    score += 10;
  }
  const firstLen = segOutLen(first);
  if (firstLen <= 1.2) score += 10;
  return { score: Math.min(100, score), tips };
}
