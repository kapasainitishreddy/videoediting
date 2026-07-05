// Render-cost estimator — pure, Node-testable. In-browser FFmpeg WASM has no
// hardware acceleration, so a few effects (animated zoom/zoompan, film grain,
// halation blur, the atmosphere blend pass, and every per-clip analysis pass)
// are dramatically more expensive than the rest. Stacking them can push a
// render from seconds to minutes. This module turns the current settings into
// an honest time estimate + a plain list of what's costing the most, so the
// editor can warn BEFORE the user commits to a long render instead of leaving
// them staring at a spinner.
//
// The weights are calibrated against observed WASM renders in this codebase:
//   • warm grade + letterbox + ~15 caption PNGs + score ≈ 60s  (observed 57s)
//   • the same edit + auto Ken Burns ≈ many minutes (observed: did not finish
//     within 5 min) — zoompan + the extra analysis passes dominate.

export interface RenderCostInput {
  clipCount: number;
  segmentCount: number;
  // heavy look filters
  grade: string; // "none" is free; anything else adds a little
  grain: boolean;
  halation: boolean;
  vignette: boolean;
  anamorphic: boolean;
  letterbox: boolean;
  denoise: boolean;
  autoNormalize: boolean;
  // motion / analysis passes (the expensive ones)
  autoKenBurns: boolean;
  autoReframe: boolean;
  motionDefault: string; // "none" free; shake/drift/stabilize/ken-burns add
  emojiReactions: boolean;
  // compositing
  overlay: boolean; // atmosphere blend layer
  scoreMood: boolean; // compose + mux
  music: boolean; // loudness-match pass
  captionCount: number; // total burn-in PNGs (captions + title + credits + overlays+)
}

export interface RenderCostEstimate {
  score: number; // rough seconds estimate
  level: "fast" | "moderate" | "heavy";
  secondsLow: number;
  secondsHigh: number;
  heavy: string[]; // human-readable list of the costliest enabled features
}

// per-item weights, in "estimated seconds" units
const W = {
  base: 4, // fixed overhead (excludes the one-time ~31MB WASM download)
  perClipPrep: 5, // trim + scale + grade + encode per source clip
  perSegXfade: 2, // xfade chaining between shots
  gradeNonNeutral: 3,
  grain: 15,
  halation: 12,
  vignette: 5,
  anamorphic: 10,
  denoise: 10,
  letterbox: 2,
  autoNormalizePerClip: 6, // measureColor sampling
  autoKenBurnsAnalysisPerClip: 24, // analyzeClip seek-heavy pass
  autoKenBurnsZoompanPerSeg: 26, // zoompan is the single worst filter in WASM
  autoReframePerClip: 14, // motionCentroidX analysis
  emojiAnalysisPerClip: 22, // another analyzeClip pass
  motionPerSeg: 6, // shake/drift/stabilize per segment
  overlayBlend: 24, // generate overlay clip (real-time) + screen blend pass
  score: 8,
  musicLoudness: 4,
  perCaption: 1.4, // each burn-in overlay step
};

export function estimateRenderCost(i: RenderCostInput): RenderCostEstimate {
  let s = W.base;
  const heavy: { label: string; cost: number }[] = [];
  const add = (cost: number, label?: string) => {
    s += cost;
    if (label && cost >= 12) heavy.push({ label, cost });
  };

  add(i.clipCount * W.perClipPrep);
  add(Math.max(0, i.segmentCount - 1) * W.perSegXfade);
  if (i.grade && i.grade !== "none") add(W.gradeNonNeutral);
  if (i.grain) add(W.grain, "film grain");
  if (i.halation) add(W.halation, "halation bloom");
  if (i.vignette) add(W.vignette);
  if (i.anamorphic) add(W.anamorphic);
  if (i.denoise) add(W.denoise, "denoise");
  if (i.letterbox) add(W.letterbox);
  if (i.autoNormalize) add(i.clipCount * W.autoNormalizePerClip, "auto color match");

  if (i.autoKenBurns) {
    add(i.clipCount * W.autoKenBurnsAnalysisPerClip + i.segmentCount * W.autoKenBurnsZoompanPerSeg, "auto Ken Burns");
  }
  if (i.autoReframe) add(i.clipCount * W.autoReframePerClip, "subject reframe");
  if (i.emojiReactions) add(i.clipCount * W.emojiAnalysisPerClip, "emoji reactions");
  if (i.motionDefault && i.motionDefault !== "none") {
    add(i.segmentCount * W.motionPerSeg, i.motionDefault === "stabilize" ? "stabilize" : `${i.motionDefault} motion`);
  }
  if (i.overlay) add(W.overlayBlend, "atmosphere layer");
  if (i.scoreMood) add(W.score);
  if (i.music) add(W.musicLoudness);
  add(i.captionCount * W.perCaption, i.captionCount >= 14 ? "many text/overlay layers" : undefined);

  const score = Math.round(s);
  const level: RenderCostEstimate["level"] = score >= 120 ? "heavy" : score >= 45 ? "moderate" : "fast";
  // WASM timing varies a lot by device; give a range, not false precision.
  return {
    score,
    level,
    secondsLow: Math.round(score * 0.6),
    secondsHigh: Math.round(score * 1.8),
    heavy: heavy.sort((a, b) => b.cost - a.cost).slice(0, 3).map((h) => h.label),
  };
}

// Friendly one-liner for the UI.
export function renderCostMessage(e: RenderCostEstimate): string {
  const time =
    e.secondsHigh < 60
      ? `~${e.secondsLow}–${e.secondsHigh}s`
      : `~${Math.max(1, Math.round(e.secondsLow / 60))}–${Math.round(e.secondsHigh / 60)} min`;
  if (e.level === "fast") return `Quick render (${time}).`;
  if (e.level === "moderate") return `Render should take ${time}.`;
  const why = e.heavy.length ? ` — ${e.heavy.join(", ")} ${e.heavy.length > 1 ? "are" : "is"} the costly part` : "";
  return `Heavy render (${time})${why}. It runs entirely on your device; keep this tab open.`;
}
