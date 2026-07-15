// Contextual "what should I do next" suggestions — a lightweight stand-in
// for an AI that's watching your project (not your screen: a browser tab has
// no business capturing video of itself). Every rule reads only state the
// editor already has on hand — clip count, trims, music/captions, per-clip
// motion/brightness from the existing analyzeClip cache, and the render-cost
// estimate — and is deterministic, so it's unit-testable like the rest of
// the pure libs in this folder.

export type TipActionKind =
  | "quick-edit"
  | "enable-ken-burns"
  | "enable-stabilize"
  | "add-music"
  | "add-captions"
  | "open-filters";

export interface Tip {
  id: string;
  message: string;
  action?: { label: string; kind: TipActionKind };
}

export interface ClipMotionSummary {
  clipId: string;
  avgMotion: number; // 0..1, mean of ClipAnalysis.motion
  motionVariance: number; // 0..1-ish, spread of ClipAnalysis.motion — a jumpy signal reads as "shaky"
}

export interface TipContext {
  clipCount: number;
  segmentCount: number;
  allSegmentsFullLength: boolean; // every segment still spans its whole source clip — nothing trimmed
  hasMusic: boolean;
  hasCaptions: boolean;
  allHardCuts: boolean; // every segment's transitionAfter is "hard-cut" or null
  colorGradeSet: boolean;
  autoKenBurnsOn: boolean;
  stabilizeOn: boolean;
  clipMotion: ClipMotionSummary[]; // only clips actually used on the timeline
  renderLevel?: "fast" | "moderate" | "heavy";
}

const STATIC_MOTION_THRESHOLD = 0.03; // matches isStaticShot's threshold in motion.ts
const SHAKY_VARIANCE_THRESHOLD = 0.05;

export function computeTips(ctx: TipContext, max = 4): Tip[] {
  const tips: Tip[] = [];

  if (ctx.clipCount === 0) {
    tips.push({ id: "no-clips", message: "Add your first clip above to get started." });
  } else if (ctx.segmentCount === 0) {
    tips.push({
      id: "nothing-on-timeline",
      message: "Your clips aren't on the timeline yet — add them one by one, or let Quick Edit arrange them for you.",
      action: { label: "Try Quick Edit", kind: "quick-edit" },
    });
  }

  if (ctx.segmentCount > 0 && ctx.allSegmentsFullLength) {
    tips.push({
      id: "nothing-trimmed",
      message: "None of your shots are trimmed yet — drag a clip's edge on the timeline to cut the boring parts.",
    });
  }

  if (ctx.segmentCount > 0 && !ctx.hasMusic && !ctx.hasCaptions) {
    tips.push({
      id: "silent-and-textless",
      message: "Silent, textless edits lose viewers fast — add music or captions.",
      action: { label: "Add music", kind: "add-music" },
    });
  } else if (ctx.segmentCount > 0 && !ctx.hasCaptions) {
    tips.push({
      id: "no-captions",
      message: "Most viewers watch muted — captions keep the edit legible with the sound off.",
      action: { label: "Add captions", kind: "add-captions" },
    });
  }

  if (ctx.segmentCount > 1 && ctx.allHardCuts) {
    tips.push({ id: "all-hard-cuts", message: "Every cut is a hard cut — try a transition on one of your shots." });
  }

  const staticClips = ctx.clipMotion.filter((c) => c.avgMotion < STATIC_MOTION_THRESHOLD);
  if (staticClips.length > 0 && !ctx.autoKenBurnsOn) {
    tips.push({
      id: "static-shots",
      message: `${staticClips.length} shot${staticClips.length > 1 ? "s look" : " looks"} static — Auto Ken Burns adds subtle camera movement.`,
      action: { label: "Turn on Auto Ken Burns", kind: "enable-ken-burns" },
    });
  }

  const shakyClips = ctx.clipMotion.filter((c) => c.motionVariance > SHAKY_VARIANCE_THRESHOLD);
  if (shakyClips.length > 0 && !ctx.stabilizeOn) {
    tips.push({
      id: "shaky-shots",
      message: `${shakyClips.length} shot${shakyClips.length > 1 ? "s look" : " looks"} shaky — Stabilize can smooth it out.`,
      action: { label: "Turn on Stabilize", kind: "enable-stabilize" },
    });
  }

  if (ctx.segmentCount > 0 && !ctx.colorGradeSet) {
    tips.push({
      id: "no-grade",
      message: "No color grade applied yet — a quick filter makes footage feel finished.",
      action: { label: "Open filters", kind: "open-filters" },
    });
  }

  if (ctx.renderLevel === "heavy") {
    tips.push({ id: "heavy-render", message: "This edit is render-heavy — expect a longer render, or trim a few effects to speed it up." });
  }

  return tips.slice(0, max);
}

export function motionVariance(motion: number[]): number {
  if (motion.length === 0) return 0;
  const avg = motion.reduce((a, b) => a + b, 0) / motion.length;
  const variance = motion.reduce((a, b) => a + (b - avg) ** 2, 0) / motion.length;
  return Math.sqrt(variance);
}
