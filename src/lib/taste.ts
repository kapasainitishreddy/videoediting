"use client";

// The taste engine — editorial judgment, encoded.
//
// Twenty years of cutting teaches you one thing above all: restraint.
// A good edit has ONE visual language. Two transition types, not six.
// Effects you feel but never notice. Sound that hits twice, not eight
// times. This module enforces those rules on every plan/studio config
// before render, so the output reads as an EDIT, not a feature demo.
import type { EditPlan, TransitionType } from "./types";
import type { StudioConfig } from "@/store/project";
import type { SfxType } from "./audio-cinema";
import { SFX_FOR_TRANSITION } from "./audio-cinema";
import { transitionByType } from "./transitions";

export interface TasteReport {
  changes: string[];
}

// --- Rule 1: one transition language --------------------------------------
// Keep hard cuts + the two most-used soft transitions. Everything else
// becomes a hard cut. Six different transition types in 15 seconds reads
// as a showreel; two reads as style.
export function unifyTransitionLanguage(plan: EditPlan, report: TasteReport): void {
  const counts = new Map<TransitionType, number>();
  for (const s of plan.segments) {
    if (s.transitionAfter && s.transitionAfter !== "hard-cut") {
      counts.set(s.transitionAfter, (counts.get(s.transitionAfter) ?? 0) + 1);
    }
  }
  const keep = new Set(
    [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => t)
  );
  let demoted = 0;
  for (const s of plan.segments) {
    if (s.transitionAfter && s.transitionAfter !== "hard-cut" && !keep.has(s.transitionAfter)) {
      s.transitionAfter = "hard-cut";
      demoted++;
    }
  }
  if (demoted > 0) {
    report.changes.push(
      `Unified the transition language: kept ${[...keep].map((t) => transitionByType(t).label).join(" + ")}, cut ${demoted} one-off transition${demoted > 1 ? "s" : ""}`
    );
  }
}

// --- Rule 2: flashes are punctuation, not rhythm ----------------------------
export function limitFlashes(plan: EditPlan, report: TasteReport): void {
  const flashIdx = plan.segments
    .map((s, i) => (s.transitionAfter === "flash" ? i : -1))
    .filter((i) => i >= 0);
  if (flashIdx.length > 2) {
    // keep the first and the last flash (open + drop), demote the rest
    const keep = new Set([flashIdx[0], flashIdx[flashIdx.length - 1]]);
    for (const i of flashIdx) {
      if (!keep.has(i)) plan.segments[i].transitionAfter = "hard-cut";
    }
    report.changes.push(`Reduced ${flashIdx.length} flash cuts to 2 — flashes are punctuation, not rhythm`);
  }
}

// --- Rule 3: effect budget ---------------------------------------------------
// Grain + vignette + halation + aberration + atmosphere all at once turns
// footage to mud. Total "texture budget" is capped; the loudest layers get
// turned down first, and atmosphere over everything costs double.
export function enforceEffectBudget(studio: StudioConfig, report: TasteReport): StudioConfig {
  const s: StudioConfig = { ...studio, look: { ...studio.look } };
  const spend =
    (s.look.grain > 0 ? 1 : 0) +
    (s.look.vignette > 0.5 ? 1 : 0.5 * Math.min(1, s.look.vignette * 2)) +
    (s.look.halation ? 1 : 0) +
    (s.look.chromaticAberration || s.look.anamorphic ? 1 : 0) +
    (s.overlay ? 2 : 0);

  if (spend > 3) {
    const before = spend;
    if (s.overlay && s.overlayOpacity > 0.35) {
      s.overlayOpacity = 0.35;
      report.changes.push("Atmosphere dialed back to 35% — it should be felt, not watched");
    }
    if (s.look.grain > 0.2) {
      s.look.grain = 0.2;
      report.changes.push("Grain reduced to a whisper");
    }
    if (s.look.halation && s.look.grain > 0 && s.overlay) {
      s.look.halation = false;
      report.changes.push("Dropped halation — grain + atmosphere already carry the texture");
    }
    if (s.look.vignette > 0.45) s.look.vignette = 0.45;
    void before;
  }
  return s;
}

// --- Rule 4: caption hygiene --------------------------------------------------
// Nothing may compete with a title card, and text needs air between hits.
export function cleanCaptionWindows(
  captions: { start: number; end: number }[],
  titleWindow: { start: number; end: number } | null,
  report: TasteReport
): void {
  if (!titleWindow) return;
  let moved = 0;
  for (const c of captions) {
    if (c.start < titleWindow.end && c.end > titleWindow.start) {
      const dur = c.end - c.start;
      c.start = titleWindow.end + 0.15;
      c.end = c.start + dur;
      moved++;
    }
  }
  if (moved > 0) report.changes.push(`Moved ${moved} caption${moved > 1 ? "s" : ""} off the title card — one voice at a time`);
}

// --- Rule 5: sound design density ----------------------------------------------
// An impact on every cut is exhausting. Keep SFX only on the strongest
// moments: flashes, zooms, and at most every other whip.
export function restrainSfx(
  plan: EditPlan,
  sfxAt: { time: number; type: SfxType }[],
  report: TasteReport
): { time: number; type: SfxType }[] {
  if (sfxAt.length === 0) return sfxAt;
  const strong = new Set<SfxType>(["impact", "glitch"]);
  const kept: { time: number; type: SfxType }[] = [];
  let whooshSkip = false;
  for (const s of sfxAt) {
    if (strong.has(s.type)) {
      kept.push(s);
    } else {
      if (!whooshSkip) kept.push(s);
      whooshSkip = !whooshSkip; // every other soft sfx
    }
  }
  const maxSfx = Math.max(2, Math.floor(plan.segments.length / 3));
  const final = kept.slice(0, maxSfx + 2);
  if (final.length < sfxAt.length) {
    report.changes.push(`Sound FX thinned from ${sfxAt.length} to ${final.length} — silence makes the hits land`);
  }
  return final;
}

// --- Rule 6: opening discipline ---------------------------------------------
// The first shot is the hook. No transition INTO the edit, and the first
// cut should come quickly (within ~1.6s) to signal pace.
export function tightenHook(plan: EditPlan, report: TasteReport): void {
  const first = plan.segments[0];
  if (!first) return;
  const len = (first.end - first.start) / first.speed;
  if (len > 1.8 && plan.segments.length > 2) {
    first.end = Number((first.start + 1.6 * first.speed).toFixed(2));
    report.changes.push("Tightened the opening shot to 1.6s — hook first, breathe later");
  }
}

// --- The full pass -------------------------------------------------------------
export function applyTaste(
  plan: EditPlan,
  studio: StudioConfig
): { plan: EditPlan; studio: StudioConfig; report: TasteReport } {
  const report: TasteReport = { changes: [] };
  const p: EditPlan = JSON.parse(JSON.stringify(plan));
  unifyTransitionLanguage(p, report);
  limitFlashes(p, report);
  tightenHook(p, report);
  const s = enforceEffectBudget(studio, report);
  return { plan: p, studio: s, report };
}

export { SFX_FOR_TRANSITION };
