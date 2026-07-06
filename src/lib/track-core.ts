// Tracking core — the pure math behind the head/face tracker, the action
// (camera-follow) tracker, and face punch-in. NO browser APIs and NO
// imports, so every function here runs under `node --experimental-strip-types`
// in scripts/track-test.mjs.
//
// Detection tiers live in track-client.ts (MediaPipe BlazeFace → native
// FaceDetector → the skin-cluster heuristic below). Whatever tier produced
// the raw points, this module smooths them into a path and compiles that
// path into FFmpeg time-expressions the WASM core verified it can run
// (crop with t-expressions, zoompan with on-expressions).

export interface TrackPoint {
  t: number; // seconds in SOURCE clip time
  cx: number; // 0..1 across the frame
  cy: number; // 0..1 down the frame
  size: number; // 0..1 — subject diameter relative to frame min-side
  conf: number; // 0..1 — 0 means "nothing found at this sample"
}

export interface TrackPath {
  mode: "face" | "action";
  duration: number; // seconds analyzed
  aspect: number; // source width/height — needed to map into crops
  times: number[];
  cx: number[];
  cy: number[];
  size: number[];
  quality: number; // fraction of samples with a confident detection
}

// ---------------------------------------------------------------------------
// Tier-3 face detector: skin-probability clustering.
// Classic YCbCr + RGB skin rules — no model download, works offline, and is
// deliberately conservative: it reports conf=0 rather than guess.
// ---------------------------------------------------------------------------

export function isSkin(r: number, g: number, b: number): boolean {
  // RGB rule (Peer et al.): skin is warm and red-dominant
  if (!(r > 95 && g > 40 && b > 20 && r > g && r > b && r - Math.min(g, b) > 15)) return false;
  // YCbCr rule: chroma box that holds across ethnicities and lighting
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return y > 40 && cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
}

// Find the largest connected skin blob in an RGBA frame (any resolution —
// callers downscale to ~64px first). Returns null when no plausible face.
export function detectFaceInFrame(
  data: Uint8ClampedArray | number[],
  w: number,
  h: number
): { cx: number; cy: number; size: number; conf: number } | null {
  const skin = new Uint8Array(w * h);
  let skinCount = 0;
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    if (isSkin(data[p], data[p + 1], data[p + 2])) {
      skin[i] = 1;
      skinCount++;
    }
  }
  // sanity: a face fills ~1-40% of a frame; outside that it's noise or a wall
  if (skinCount < w * h * 0.004 || skinCount > w * h * 0.55) return null;

  // largest 4-connected component via BFS
  const seen = new Uint8Array(w * h);
  let best: number[] | null = null;
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!skin[start] || seen[start]) continue;
    const blob: number[] = [];
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      blob.push(i);
      const x = i % w;
      const y = (i / w) | 0;
      if (x > 0 && skin[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
      if (x < w - 1 && skin[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && skin[i - w] && !seen[i - w]) { seen[i - w] = 1; stack.push(i - w); }
      if (y < h - 1 && skin[i + w] && !seen[i + w]) { seen[i + w] = 1; stack.push(i + w); }
    }
    if (!best || blob.length > best.length) best = blob;
  }
  if (!best || best.length < w * h * 0.004) return null;

  let sx = 0, sy = 0;
  let minX = w, maxX = 0, minY = h, maxY = 0;
  for (const i of best) {
    const x = i % w;
    const y = (i / w) | 0;
    sx += x;
    sy += y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  // faces are roughly compact: reject long thin strips (arms, wood, sand)
  const fill = best.length / (bw * bh);
  const ratio = bw / bh;
  if (fill < 0.35 || ratio > 3 || ratio < 1 / 3) return null;

  return {
    cx: sx / best.length / w,
    cy: sy / best.length / h,
    size: Math.max(bw / w, bh / h),
    conf: Math.min(1, fill * (best.length / (w * h)) * 40),
  };
}

// ---------------------------------------------------------------------------
// Action tracker core: where is the MOTION between two frames?
// ---------------------------------------------------------------------------

export function motionCentroid(
  prev: Uint8ClampedArray | number[],
  cur: Uint8ClampedArray | number[],
  w: number,
  h: number
): { cx: number; cy: number; energy: number } {
  let wx = 0, wy = 0, total = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const d =
        Math.abs(cur[p] - prev[p]) +
        Math.abs(cur[p + 1] - prev[p + 1]) +
        Math.abs(cur[p + 2] - prev[p + 2]);
      wx += d * x;
      wy += d * y;
      total += d;
    }
  }
  if (total === 0) return { cx: 0.5, cy: 0.5, energy: 0 };
  return { cx: wx / total / w, cy: wy / total / h, energy: total / (w * h * 3 * 255) };
}

// ---------------------------------------------------------------------------
// Path smoothing: raw per-sample detections → a stable camera path.
// Gaps (conf=0) are bridged by interpolation; a forward+backward EMA kills
// jitter without lag; a velocity clamp stops whip-fast jumps the crop
// would telegraph as glitches.
// ---------------------------------------------------------------------------

export function smoothTrack(
  points: TrackPoint[],
  mode: "face" | "action",
  duration: number,
  aspect: number,
  opts: { alpha?: number; maxVel?: number } = {}
): TrackPath | null {
  const alpha = opts.alpha ?? 0.35;
  const maxVel = opts.maxVel ?? 0.35; // normalized frame-widths per second
  const good = points.filter((p) => p.conf > 0);
  if (points.length === 0 || good.length < Math.max(2, points.length * 0.25)) return null;

  // 1. bridge gaps: linear interpolation between confident neighbours,
  //    hold at the ends
  const cx: number[] = [];
  const cy: number[] = [];
  const size: number[] = [];
  const times = points.map((p) => p.t);
  for (let i = 0; i < points.length; i++) {
    if (points[i].conf > 0) {
      cx.push(points[i].cx);
      cy.push(points[i].cy);
      size.push(points[i].size);
      continue;
    }
    let prev = i - 1;
    while (prev >= 0 && points[prev].conf === 0) prev--;
    let next = i + 1;
    while (next < points.length && points[next].conf === 0) next++;
    const a = prev >= 0 ? points[prev] : null;
    const b = next < points.length ? points[next] : null;
    if (a && b) {
      const f = (points[i].t - a.t) / Math.max(1e-6, b.t - a.t);
      cx.push(a.cx + (b.cx - a.cx) * f);
      cy.push(a.cy + (b.cy - a.cy) * f);
      size.push(a.size + (b.size - a.size) * f);
    } else {
      const src = (a ?? b)!;
      cx.push(src.cx);
      cy.push(src.cy);
      size.push(src.size);
    }
  }

  // 2. velocity clamp on the raw bridged path
  for (let i = 1; i < cx.length; i++) {
    const dt = Math.max(1e-3, times[i] - times[i - 1]);
    const lim = maxVel * dt;
    cx[i] = cx[i - 1] + Math.max(-lim, Math.min(lim, cx[i] - cx[i - 1]));
    cy[i] = cy[i - 1] + Math.max(-lim, Math.min(lim, cy[i] - cy[i - 1]));
  }

  // 3. zero-lag smoothing: EMA forward, then EMA backward, average
  const ema = (arr: number[], reverse: boolean) => {
    const out = arr.slice();
    if (reverse) out.reverse();
    for (let i = 1; i < out.length; i++) out[i] = out[i - 1] + alpha * (out[i] - out[i - 1]);
    if (reverse) out.reverse();
    return out;
  };
  const fx = ema(cx, false), bx = ema(cx, true);
  const fy = ema(cy, false), by = ema(cy, true);
  const scx = fx.map((v, i) => (v + bx[i]) / 2);
  const scy = fy.map((v, i) => (v + by[i]) / 2);

  return {
    mode,
    duration,
    aspect,
    times,
    cx: scx.map((v) => Number(Math.max(0, Math.min(1, v)).toFixed(4))),
    cy: scy.map((v) => Number(Math.max(0, Math.min(1, v)).toFixed(4))),
    size: size.map((v) => Number(Math.max(0.02, Math.min(1, v)).toFixed(4))),
    quality: Number((good.length / points.length).toFixed(3)),
  };
}

// ---------------------------------------------------------------------------
// Keyframe reduction — FFmpeg expressions are strings; keep them sane.
// Greedy simplification: keep points whose removal would bend the path by
// more than `tol` (a poor man's Douglas-Peucker that preserves timing).
// ---------------------------------------------------------------------------

export function reduceKeyframes(
  times: number[],
  values: number[],
  maxKeys = 12,
  tol = 0.01
): { times: number[]; values: number[] } {
  if (times.length <= 2) return { times: times.slice(), values: values.slice() };
  const keep = new Array(times.length).fill(false);
  keep[0] = keep[times.length - 1] = true;
  // error of dropping interior point i between kept neighbours
  const passTol = (a: number, b: number) => {
    for (let i = a + 1; i < b; i++) {
      const f = (times[i] - times[a]) / Math.max(1e-6, times[b] - times[a]);
      const interp = values[a] + (values[b] - values[a]) * f;
      if (Math.abs(interp - values[i]) > tol) return i; // worst offender wins
    }
    return -1;
  };
  // iteratively add the point that violates tolerance the most
  let added = 2;
  let changed = true;
  while (changed && added < maxKeys) {
    changed = false;
    let a = 0;
    for (let b = 1; b < times.length; b++) {
      if (!keep[b]) continue;
      const bad = passTol(a, b);
      if (bad >= 0) {
        keep[bad] = true;
        added++;
        changed = true;
        if (added >= maxKeys) break;
      }
      a = b;
    }
  }
  const t: number[] = [], v: number[] = [];
  for (let i = 0; i < times.length; i++) {
    if (keep[i]) {
      t.push(times[i]);
      v.push(values[i]);
    }
  }
  return { times: t, values: v };
}

// ---------------------------------------------------------------------------
// FFmpeg expression compiler.
// piecewiseExpr builds a nested-if linear interpolation over keyframes,
// with `t` remapped into SOURCE time:  src = offset + t*speed
// (segments are trimmed + retimed before the crop runs, so the crop's t
// starts at 0 and advances at `speed` source-seconds per output second).
// ---------------------------------------------------------------------------

export function piecewiseExpr(
  times: number[],
  values: number[],
  offset = 0,
  speed = 1
): string {
  if (times.length === 0) return "0.5";
  if (times.length === 1) return values[0].toFixed(4);
  const T = `(${offset.toFixed(3)}+t*${speed.toFixed(3)})`;
  // innermost: hold last value
  let expr = values[values.length - 1].toFixed(4);
  for (let i = times.length - 2; i >= 0; i--) {
    const t0 = times[i];
    const t1 = times[i + 1];
    const v0 = values[i];
    const v1 = values[i + 1];
    const dt = Math.max(1e-6, t1 - t0);
    const seg = `(${v0.toFixed(4)}+${(v1 - v0).toFixed(4)}*(${T}-${t0.toFixed(3)})/${dt.toFixed(4)})`;
    expr = `if(lt(${T},${t1.toFixed(3)}),${seg},${expr})`;
  }
  // before the first keyframe: hold first value
  return `if(lt(${T},${times[0].toFixed(3)}),${values[0].toFixed(4)},${expr})`;
}

// The face/action LOCK crop: carve a 9:16 window out of whatever arrives,
// x following the subject. Height is kept full — vertical drift looks like
// a mistake; horizontal follow reads as a camera operator.
export function trackCropFilter(
  path: TrackPath,
  seg: { start: number; end: number; speed: number },
  opts: { maxKeys?: number } = {}
): string {
  // keyframes inside this segment's window (±0.5s so edges interpolate)
  const t: number[] = [], v: number[] = [];
  for (let i = 0; i < path.times.length; i++) {
    if (path.times[i] >= seg.start - 0.5 && path.times[i] <= seg.end + 0.5) {
      t.push(path.times[i]);
      v.push(path.cx[i]);
    }
  }
  if (t.length === 0) return "";
  const r = reduceKeyframes(t, v, opts.maxKeys ?? 12, 0.008);
  const cxExpr = piecewiseExpr(r.times, r.values, seg.start, seg.speed);
  // crop w: 9:16 window (never wider than the source); x centers on subject
  return `crop=w='min(iw,ih*9/16)':h=ih:x='max(0,min(iw-ow,(${cxExpr})*iw-ow/2))':y=0`;
}

// Map a source-frame cx into the frame AFTER the standard center crop to
// 9:16 (used when punch-in runs on footage that was center-cropped, not
// track-cropped). Landscape loses its sides; portrait is untouched.
export function mapToCenterCrop(cx: number, srcAspect: number, outAspect = 9 / 16): number {
  if (srcAspect <= outAspect + 1e-6) return Math.max(0, Math.min(1, cx));
  const visible = outAspect / srcAspect; // fraction of width kept
  const mapped = (cx - (1 - visible) / 2) / visible;
  return Math.max(0, Math.min(1, mapped));
}

// Median subject position across a segment window — punch-in targets a
// stable point, not a wobbling one.
export function pathCenter(
  path: TrackPath,
  start: number,
  end: number
): { cx: number; cy: number; size: number } {
  const xs: number[] = [], ys: number[] = [], ss: number[] = [];
  for (let i = 0; i < path.times.length; i++) {
    if (path.times[i] >= start && path.times[i] <= end) {
      xs.push(path.cx[i]);
      ys.push(path.cy[i]);
      ss.push(path.size[i]);
    }
  }
  const med = (a: number[]) => {
    if (a.length === 0) return 0.5;
    const s = a.slice().sort((x, y) => x - y);
    return s[(s.length / 2) | 0];
  };
  return { cx: med(xs), cy: med(ys), size: ss.length ? med(ss) : 0.2 };
}

// Face punch-in: a zoompan push toward the subject — CapCut's "auto zoom to
// face". Returns the same {pre, post, needsOverscan} shape motionFilter uses
// so renderEdit can drop it into the existing per-segment chain.
export function facePunchFilter(
  center: { cx: number; cy: number },
  durSec: number,
  strength = 1.25
): { pre: string; post: string; needsOverscan: boolean } {
  const D = Math.max(0.3, durSec);
  const zMax = Math.max(1.05, Math.min(1.6, strength));
  const inc = ((zMax - 1) / (30 * D)).toFixed(6);
  const cx = Math.max(0.15, Math.min(0.85, center.cx)).toFixed(3);
  const cy = Math.max(0.15, Math.min(0.85, center.cy)).toFixed(3);
  return {
    pre: "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280",
    post:
      `zoompan=z='min(1+${inc}*on,${zMax.toFixed(3)})'` +
      `:x='max(0,min(iw-iw/zoom,${cx}*iw-iw/zoom/2))'` +
      `:y='max(0,min(ih-ih/zoom,${cy}*ih-ih/zoom/2))'` +
      ":d=1:s=720x1280:fps=30",
    needsOverscan: true,
  };
}
