// Reshoot comparison score — pure, Node-testable. A creator reshoots a clip
// trying to beat their last attempt; this scores the new take against the
// old one on the qualities that actually matter for a shot (steadiness,
// exposure, energy, sharpness proxy) and says what improved and what didn't.
// Built on the same per-clip stats analyzeClip already produces, so it runs
// from existing data — no extra pass, no model.

export interface ShotStats {
  motion: number[]; // per-sample motion energy (from clip-analysis)
  brightness: number[]; // per-sample mean brightness 0..1
}

export interface ShotQuality {
  steadiness: number; // 0..1 — low jitter is better (hand-hold stability)
  exposure: number; // 0..1 — closeness to a well-exposed mid
  energy: number; // 0..1 — average motion (more happening)
  consistency: number; // 0..1 — even brightness (no flicker / auto-exposure hunt)
}

function mean(a: number[]): number {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
}
function std(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
}

export function shotQuality(s: ShotStats): ShotQuality {
  const mMean = mean(s.motion);
  const mStd = std(s.motion);
  const bMean = mean(s.brightness);
  const bStd = std(s.brightness);
  // steadiness: penalize high motion VARIANCE (jerky handheld). A smooth
  // pan has high mean but low variance and still scores steady.
  const steadiness = Math.max(0, Math.min(1, 1 - mStd * 6));
  // exposure: 1 at 0.5 mid-grey, falling off toward crushed/blown
  const exposure = Math.max(0, 1 - Math.abs(bMean - 0.5) * 2.2);
  const energy = Math.max(0, Math.min(1, mMean * 6));
  const consistency = Math.max(0, Math.min(1, 1 - bStd * 5));
  return {
    steadiness: Number(steadiness.toFixed(3)),
    exposure: Number(exposure.toFixed(3)),
    energy: Number(energy.toFixed(3)),
    consistency: Number(consistency.toFixed(3)),
  };
}

export interface ReshootResult {
  previous: ShotQuality;
  current: ShotQuality;
  scorePrev: number; // 0..100
  scoreCurr: number;
  verdict: string;
  deltas: { label: string; change: number; note: string }[];
}

const WEIGHTS: Record<keyof ShotQuality, number> = { steadiness: 0.3, exposure: 0.3, energy: 0.2, consistency: 0.2 };

function overall(q: ShotQuality): number {
  return Math.round((q.steadiness * WEIGHTS.steadiness + q.exposure * WEIGHTS.exposure + q.energy * WEIGHTS.energy + q.consistency * WEIGHTS.consistency) * 100);
}

const LABELS: Record<keyof ShotQuality, string> = {
  steadiness: "Steadiness",
  exposure: "Exposure",
  energy: "Energy",
  consistency: "Even lighting",
};

export function reshootScore(previous: ShotStats, current: ShotStats): ReshootResult {
  const p = shotQuality(previous);
  const c = shotQuality(current);
  const scorePrev = overall(p);
  const scoreCurr = overall(c);
  const keys = Object.keys(WEIGHTS) as (keyof ShotQuality)[];
  const deltas = keys.map((k) => {
    const change = Number((c[k] - p[k]).toFixed(3));
    const note =
      Math.abs(change) < 0.03
        ? "about the same"
        : change > 0
          ? `better by ${(change * 100).toFixed(0)}%`
          : `worse by ${(-change * 100).toFixed(0)}%`;
    return { label: LABELS[k], change, note };
  });
  const diff = scoreCurr - scorePrev;
  const verdict =
    diff > 5
      ? `The reshoot is better (+${diff}). Keep this one.`
      : diff < -5
        ? `The original was better (${diff}). Your last take still wins.`
        : "Too close to call — both takes are about equal; pick on content.";
  return { previous: p, current: c, scorePrev, scoreCurr, verdict, deltas };
}
