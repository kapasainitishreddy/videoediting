// Procedural foley — pure, Node-testable. Reads the motion-energy curve the
// app already measures per clip and places sound-design cues where the
// PICTURE says they belong: sharp spikes get impacts, fast rises get
// whooshes, sustained high energy gets a riser into the next hit. No model,
// no cloud — motion-driven sound design as a one-tap layer.

export interface FoleyCue {
  t: number; // seconds in the segment's OUTPUT time
  kind: "impact" | "whoosh" | "riser";
  strength: number; // 0..1 — mix level hint
  why: string;
}

export function foleyCues(
  motion: number[],
  times: number[],
  opts: { minSpacing?: number; threshold?: number; max?: number } = {}
): FoleyCue[] {
  const minSpacing = opts.minSpacing ?? 0.8;
  const threshold = opts.threshold ?? 0.08;
  const max = opts.max ?? 8;
  const n = Math.min(motion.length, times.length);
  if (n < 3) return [];

  const cues: FoleyCue[] = [];
  const peak = Math.max(...motion.slice(0, n), 1e-6);

  for (let i = 1; i < n - 1; i++) {
    if (cues.length >= max) break;
    const m = motion[i];
    const rise = m - motion[i - 1];
    const isLocalMax = m >= motion[i - 1] && m >= motion[i + 1];
    if (m < threshold) continue;
    if (cues.length > 0 && times[i] - cues[cues.length - 1].t < minSpacing) continue;

    if (isLocalMax && rise > peak * 0.35) {
      cues.push({
        t: Number(times[i].toFixed(2)),
        kind: "impact",
        strength: Number(Math.min(1, m / peak).toFixed(2)),
        why: "sharp motion spike — something lands here",
      });
    } else if (rise > peak * 0.18) {
      cues.push({
        t: Number(times[i].toFixed(2)),
        kind: "whoosh",
        strength: Number(Math.min(1, (rise / peak) * 1.4).toFixed(2)),
        why: "fast acceleration — movement crosses the frame",
      });
    }
  }

  // sustained build in the final third → riser into the ending
  const third = Math.floor((n * 2) / 3);
  const lateAvg = motion.slice(third, n).reduce((s, v) => s + v, 0) / Math.max(1, n - third);
  const earlyAvg = motion.slice(0, third).reduce((s, v) => s + v, 0) / Math.max(1, third);
  if (lateAvg > earlyAvg * 1.5 && lateAvg > threshold && cues.length < max) {
    cues.push({
      t: Number(times[third].toFixed(2)),
      kind: "riser",
      strength: 0.6,
      why: "energy builds through the final third — a riser sells the payoff",
    });
  }

  return cues.sort((a, b) => a.t - b.t);
}
