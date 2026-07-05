"use client";

// Per-clip visual analysis — the intelligence behind a "good" edit.
// One pass over the clip yields:
//   • a motion-energy curve  → pick the highlight window to cut on
//   • a brightness curve      → avoid cutting on black/blown frames
//   • directional flow        → choose a transition that matches the motion
// All client-side (canvas), no model download, works offline.

export type FlowDir = "left" | "right" | "up" | "down" | "zoom-in" | "zoom-out" | "still";

export interface ClipAnalysis {
  duration: number;
  fps: number; // sampling rate used
  motion: number[]; // per-sample motion energy 0..1
  brightness: number[]; // per-sample mean brightness 0..1
  times: number[]; // sample timestamps
}

const GRID = 48; // downscaled analysis resolution

// Sample the clip and build the motion/brightness curves.
export async function analyzeClip(
  blob: Blob,
  opts: { samplesPerSecond?: number; maxSamples?: number } = {}
): Promise<ClipAnalysis> {
  const sps = opts.samplesPerSecond ?? 8;
  const maxSamples = opts.maxSamples ?? 240;

  const url = URL.createObjectURL(blob);
  const v = document.createElement("video");
  v.preload = "auto";
  v.muted = true;
  v.src = url;
  await new Promise<void>((res, rej) => {
    v.onloadeddata = () => res();
    v.onerror = () => rej(new Error("clip load failed"));
  });
  let duration = v.duration;
  if (!Number.isFinite(duration) || duration <= 0) {
    // Infinity-duration WebM workaround
    await new Promise<void>((res) => {
      v.onseeked = () => res();
      v.currentTime = 1e7;
    });
    duration = Number.isFinite(v.duration) ? v.duration : v.currentTime;
  }

  const canvas = document.createElement("canvas");
  canvas.width = GRID;
  canvas.height = GRID;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  const step = Math.max(1 / sps, duration / maxSamples);
  const motion: number[] = [];
  const brightness: number[] = [];
  const times: number[] = [];
  let prev: Uint8ClampedArray | null = null;

  for (let t = 0; t < duration - 1e-3; t += step) {
    await new Promise<void>((res) => {
      v.onseeked = () => res();
      v.currentTime = t;
    });
    ctx.drawImage(v, 0, 0, GRID, GRID);
    const cur = ctx.getImageData(0, 0, GRID, GRID).data;

    let bright = 0;
    for (let i = 0; i < cur.length; i += 4) bright += cur[i] + cur[i + 1] + cur[i + 2];
    bright /= (cur.length / 4) * 3 * 255;

    let m = 0;
    if (prev) {
      for (let i = 0; i < cur.length; i += 4) {
        m += Math.abs(cur[i] - prev[i]) + Math.abs(cur[i + 1] - prev[i + 1]) + Math.abs(cur[i + 2] - prev[i + 2]);
      }
      m /= (cur.length / 4) * 3 * 255;
    }
    motion.push(m);
    brightness.push(bright);
    times.push(t);
    prev = cur.slice();
  }
  URL.revokeObjectURL(url);
  // first sample has no predecessor; mirror the second so peaks aren't skewed
  if (motion.length > 1) motion[0] = motion[1];
  return { duration, fps: 1 / step, motion, brightness, times };
}

// Pick the best [start,end] window of `want` seconds: highest summed motion
// energy, penalized for very dark frames (don't cut on black).
export function highlightWindow(a: ClipAnalysis, want: number): { start: number; end: number } {
  const n = a.times.length;
  if (n === 0 || a.duration <= want) return { start: 0, end: Math.min(want, a.duration) };

  const score = a.motion.map((m, i) => {
    const dark = a.brightness[i] < 0.06 ? -0.5 : 0;
    return m + dark;
  });

  const winSamples = Math.max(1, Math.round(want / (a.duration / n)));
  let best = -Infinity;
  let bestStart = 0;
  let running = 0;
  for (let i = 0; i < n; i++) {
    running += score[i];
    if (i >= winSamples) running -= score[i - winSamples];
    if (i >= winSamples - 1 && running > best) {
      best = running;
      bestStart = i - winSamples + 1;
    }
  }
  const start = Math.min(a.times[bestStart], Math.max(0, a.duration - want));
  return { start: Number(start.toFixed(2)), end: Number(Math.min(a.duration, start + want).toFixed(2)) };
}

// Return up to `count` non-overlapping highlight windows, best first — so a
// clip reused several times contributes a different strong moment each time.
export function topHighlights(a: ClipAnalysis, want: number, count: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  if (a.times.length === 0) return [{ start: 0, end: Math.min(want, a.duration) }];
  const masked = { ...a, motion: a.motion.slice() };
  for (let k = 0; k < count; k++) {
    const w = highlightWindow(masked, want);
    out.push(w);
    // zero the chosen window (plus a margin) so the next pick is elsewhere
    for (let i = 0; i < masked.times.length; i++) {
      if (masked.times[i] >= w.start - 0.2 && masked.times[i] <= w.end + 0.2) masked.motion[i] = -1;
    }
  }
  return out;
}

// Distill a LONG clip into a highlight reel: the best non-overlapping
// moments, in chronological order, totaling ~targetSeconds. Shot length
// adapts to the target (shorter target → punchier shots). Pure — works from
// an existing analysis, so tests run in Node.
export function distillWindows(
  a: ClipAnalysis,
  targetSeconds: number,
  opts: { minShot?: number; maxShot?: number } = {}
): { start: number; end: number }[] {
  if (a.duration <= targetSeconds) return [{ start: 0, end: Number(a.duration.toFixed(2)) }];
  const minShot = opts.minShot ?? 0.8;
  const maxShot = opts.maxShot ?? 2.5;
  const shotLen = Math.max(minShot, Math.min(maxShot, targetSeconds / 6));
  const count = Math.max(1, Math.round(targetSeconds / shotLen));
  return topHighlights(a, shotLen, count).sort((x, y) => x.start - y.start);
}

// Detect letterbox/pillarbox bars baked into the SOURCE footage (black rows
// or columns present across sampled frames) and return an FFmpeg crop filter
// that strips them — so bars from someone else's export don't get re-framed
// into the 9:16 output as dead space. Returns null when the clip is clean.
export async function detectBars(blob: Blob): Promise<{ crop: string; note: string } | null> {
  const url = URL.createObjectURL(blob);
  const v = document.createElement("video");
  v.preload = "auto";
  v.muted = true;
  v.src = url;
  try {
    await new Promise<void>((res, rej) => {
      v.onloadeddata = () => res();
      v.onerror = () => rej(new Error("bar-detect load failed"));
    });
    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 3;
    const S = 96;
    const c = document.createElement("canvas");
    c.width = S;
    c.height = S;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;

    // "black across ALL samples" — a dark scene in one frame shouldn't count
    const rowMax = new Float32Array(S).fill(0);
    const colMax = new Float32Array(S).fill(0);
    for (const frac of [0.15, 0.5, 0.85]) {
      await new Promise<void>((res) => {
        v.onseeked = () => res();
        v.currentTime = Math.min(dur - 0.05, dur * frac);
      });
      ctx.drawImage(v, 0, 0, S, S);
      const d = ctx.getImageData(0, 0, S, S).data;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const p = (y * S + x) * 4;
          const lum = (d[p] + d[p + 1] + d[p + 2]) / 3;
          if (lum > rowMax[y]) rowMax[y] = lum;
          if (lum > colMax[x]) colMax[x] = lum;
        }
      }
    }
    const BLACK = 12;
    let top = 0;
    while (top < S / 3 && rowMax[top] < BLACK) top++;
    let bottom = 0;
    while (bottom < S / 3 && rowMax[S - 1 - bottom] < BLACK) bottom++;
    let left = 0;
    while (left < S / 3 && colMax[left] < BLACK) left++;
    let right = 0;
    while (right < S / 3 && colMax[S - 1 - right] < BLACK) right++;

    // require a meaningful bar (≥4% of the frame) to avoid nibbling shadows
    const MIN = Math.round(S * 0.04);
    if (top < MIN && bottom < MIN && left < MIN && right < MIN) return null;

    const wFrac = (S - left - right) / S;
    const hFrac = (S - top - bottom) / S;
    const xFrac = left / S;
    const yFrac = top / S;
    const crop = `crop=iw*${wFrac.toFixed(3)}:ih*${hFrac.toFixed(3)}:iw*${xFrac.toFixed(3)}:ih*${yFrac.toFixed(3)}`;
    const parts: string[] = [];
    if (top >= MIN || bottom >= MIN) parts.push("letterbox bars");
    if (left >= MIN || right >= MIN) parts.push("pillarbox bars");
    return { crop, note: `Stripped baked-in ${parts.join(" + ")}` };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Estimate dominant optical flow near a timestamp by testing candidate
// whole-frame shifts and a zoom, picking the one that best aligns two
// frames a short interval apart. Coarse but reliable for pans/zooms.
export async function flowAt(blob: Blob, time: number, dir: "in" | "out"): Promise<FlowDir> {
  const url = URL.createObjectURL(blob);
  const v = document.createElement("video");
  v.preload = "auto";
  v.muted = true;
  v.src = url;
  await new Promise<void>((res, rej) => {
    v.onloadeddata = () => res();
    v.onerror = () => rej(new Error("flow load failed"));
  });
  const dur = Number.isFinite(v.duration) ? v.duration : time + 0.3;
  const dt = 0.12;
  // "in" = motion entering clip (near its start); sample [time, time+dt]
  // "out" = motion leaving clip (near its end); sample [time-dt, time]
  const t0 = dir === "in" ? Math.max(0, time) : Math.max(0, Math.min(dur - dt, time - dt));
  const t1 = Math.min(dur - 1e-3, t0 + dt);

  const S = 40;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;

  const grab = async (t: number) => {
    await new Promise<void>((res) => {
      v.onseeked = () => res();
      v.currentTime = t;
    });
    ctx.drawImage(v, 0, 0, S, S);
    return ctx.getImageData(0, 0, S, S).data;
  };
  const f0 = await grab(t0);
  const f1 = await grab(t1);
  URL.revokeObjectURL(url);

  const gray = (d: Uint8ClampedArray) => {
    const g = new Float32Array(S * S);
    for (let p = 0, i = 0; i < d.length; i += 4, p++) g[p] = (d[i] + d[i + 1] + d[i + 2]) / 3;
    return g;
  };
  const g0 = gray(f0);
  const g1 = gray(f1);

  // Sum of absolute differences with g1 shifted by (dx,dy) vs g0
  const sad = (dx: number, dy: number) => {
    let s = 0;
    let count = 0;
    for (let y = 4; y < S - 4; y++) {
      for (let x = 4; x < S - 4; x++) {
        const sx = x + dx;
        const sy = y + dy;
        if (sx < 0 || sx >= S || sy < 0 || sy >= S) continue;
        s += Math.abs(g0[y * S + x] - g1[sy * S + sx]);
        count++;
      }
    }
    return count ? s / count : Infinity;
  };
  // zoom SAD: compare g0 to g1 scaled about the center by factor f
  const sadZoom = (f: number) => {
    let s = 0;
    let count = 0;
    const cx = S / 2;
    const cy = S / 2;
    for (let y = 4; y < S - 4; y++) {
      for (let x = 4; x < S - 4; x++) {
        const sx = Math.round(cx + (x - cx) * f);
        const sy = Math.round(cy + (y - cy) * f);
        if (sx < 0 || sx >= S || sy < 0 || sy >= S) continue;
        s += Math.abs(g0[y * S + x] - g1[sy * S + sx]);
        count++;
      }
    }
    return count ? s / count : Infinity;
  };

  const R = 3;
  const still = sad(0, 0);
  const candidates: { dir: FlowDir; cost: number }[] = [
    { dir: "still", cost: still },
    { dir: "left", cost: sad(-R, 0) },
    { dir: "right", cost: sad(R, 0) },
    { dir: "up", cost: sad(0, -R) },
    { dir: "down", cost: sad(0, R) },
    { dir: "zoom-in", cost: sadZoom(1.08) },
    { dir: "zoom-out", cost: sadZoom(0.93) },
  ];
  candidates.sort((a, b) => a.cost - b.cost);
  const winner = candidates[0];
  // Require the winning shift to beat "still" by a margin, else it's static
  if (winner.dir !== "still" && winner.cost > still * 0.92) return "still";
  return winner.dir;
}
