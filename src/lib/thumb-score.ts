// Thumbnail CTR scoring — pure, Node-testable. The export page already picks
// a "best frame"; this upgrades it into an A/B/C candidate picker with an
// honest predicted-appeal score. The model is heuristic (face presence,
// contrast, saturation, sharpness, rule-of-thirds placement, exposure) —
// the factors thumbnail research consistently rewards — and every score
// comes with reasons so the user learns WHY, not just which.

export interface FrameStats {
  t: number; // timestamp in the video
  brightness: number; // 0..1 mean luma
  contrast: number; // 0..1 luma std-dev
  saturation: number; // 0..1 mean chroma distance
  sharpness: number; // 0..1 edge energy (Laplacian-ish)
  faceSize: number; // 0..1 largest face fraction (0 = none)
  faceOffCenter: number; // 0..1 face distance from nearest thirds point (0 = on thirds)
}

export interface ThumbScore {
  t: number;
  score: number; // 0..100
  reasons: string[];
}

export function scoreFrame(s: FrameStats): ThumbScore {
  let score = 30;
  const reasons: string[] = [];

  // exposure sweet spot: 0.35–0.65 mean luma
  if (s.brightness >= 0.3 && s.brightness <= 0.7) {
    score += 12;
  } else if (s.brightness < 0.12) {
    score -= 18;
    reasons.push("too dark to read at feed size");
  } else if (s.brightness > 0.85) {
    score -= 12;
    reasons.push("blown-out highlights");
  }

  if (s.contrast > 0.16) {
    score += 12;
    reasons.push("strong contrast — pops in a feed");
  } else if (s.contrast < 0.07) {
    score -= 8;
    reasons.push("flat, low-contrast frame");
  }

  if (s.saturation > 0.14) {
    score += 8;
    reasons.push("vivid color");
  }

  if (s.sharpness > 0.1) {
    score += 10;
  } else if (s.sharpness < 0.04) {
    score -= 10;
    reasons.push("motion-blurred / soft");
  }

  if (s.faceSize > 0.08) {
    score += 18;
    reasons.push("a visible face — faces lift click-through");
    if (s.faceSize > 0.45) {
      score -= 6;
      reasons.push("face fills most of the frame — a little context helps");
    }
    if (s.faceOffCenter < 0.18) {
      score += 6;
      reasons.push("face sits near a rule-of-thirds point");
    }
  }

  return { t: s.t, score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}

// Top `count` candidates, forced apart in time so A/B/C are genuinely
// different frames rather than three neighbors of the same moment.
export function pickThumbCandidates(stats: FrameStats[], count = 3, minGap = 1.0): ThumbScore[] {
  const scored = stats.map(scoreFrame).sort((a, b) => b.score - a.score);
  const picked: ThumbScore[] = [];
  for (const s of scored) {
    if (picked.length >= count) break;
    if (picked.some((p) => Math.abs(p.t - s.t) < minGap)) continue;
    picked.push(s);
  }
  return picked;
}
