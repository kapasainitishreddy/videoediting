"use client";

// Transition detection v2 — the quality floor of the whole app.
//
// Design: two passes over the video, all local, deterministic.
//
//  PASS 1 (coarse, ~8 samples/s): per-sample global delta, brightness, and
//  a 6x6 block-delta grid. Candidate cuts are picked with an ADAPTIVE
//  threshold (rolling median + MAD), so action footage with a high motion
//  baseline doesn't drown real cuts, and static footage still surfaces
//  subtle ones.
//
//  PASS 2 (fine, ~1/30s around each candidate): localizes the exact cut
//  time, then classifies by EVIDENCE, not delta magnitude:
//    • flash    — luma spikes toward white/black and returns
//    • dissolve — the midpoint frame is explained better by blending the
//                 before/after frames than by either frame alone
//    • whip-pan — directional SAD flow is coherent (same direction) across
//                 consecutive fine frames spanning the cut
//    • zoom     — the zoom-warp SAD candidate wins across the cut
//    • hard-cut — a single-sample spike with clean similarity on both sides
//
// AI keys become garnish on top of this: the labels are already right, so a
// weak model only polishes descriptions and can never lower quality.
import type { DetectedTransition, TransitionType } from "./types";

export interface CoarseSample {
  time: number;
  delta: number; // 0..1 mean abs diff vs previous sample
  brightness: number; // 0..1
  blocks: Float32Array; // 6x6 per-block delta
}

export interface DetectionResult {
  transitions: DetectedTransition[];
  samples: { time: number; delta: number; brightness: number }[];
  duration: number;
}

const GRID = 60; // analysis resolution (square)
const BLOCKS = 6;

interface FrameGrab {
  gray: Float32Array; // GRID*GRID luma (for warp-SAD flow)
  rgb: Float32Array; // GRID*GRID*3 (differencing must be color-aware:
  // hue-only scene changes are invisible in luma — think sunset cuts)
  brightness: number;
}

class VideoSampler {
  private v: HTMLVideoElement;
  private ctx: CanvasRenderingContext2D;
  private url: string;
  duration = 0;

  private constructor(v: HTMLVideoElement, ctx: CanvasRenderingContext2D, url: string) {
    this.v = v;
    this.ctx = ctx;
    this.url = url;
  }

  static async open(blob: Blob): Promise<VideoSampler> {
    const url = URL.createObjectURL(blob);
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    v.src = url;
    await new Promise<void>((res, rej) => {
      v.onloadeddata = () => res();
      v.onerror = () => rej(new Error("Could not load video for analysis"));
    });
    let duration = v.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      await new Promise<void>((res) => {
        v.onseeked = () => res();
        v.currentTime = 1e7;
      });
      duration = Number.isFinite(v.duration) ? v.duration : v.currentTime;
    }
    const c = document.createElement("canvas");
    c.width = GRID;
    c.height = GRID;
    const s = new VideoSampler(v, c.getContext("2d", { willReadFrequently: true })!, url);
    s.duration = duration;
    return s;
  }

  async grab(t: number): Promise<FrameGrab> {
    const clamped = Math.max(0, Math.min(this.duration - 1e-3, t));
    await new Promise<void>((res) => {
      const done = () => res();
      this.v.onseeked = done;
      // seeking to the current time fires no event — nudge detection
      if (Math.abs(this.v.currentTime - clamped) < 1e-4) res();
      else this.v.currentTime = clamped;
    });
    this.ctx.drawImage(this.v, 0, 0, GRID, GRID);
    const d = this.ctx.getImageData(0, 0, GRID, GRID).data;
    const gray = new Float32Array(GRID * GRID);
    const rgb = new Float32Array(GRID * GRID * 3);
    let bright = 0;
    for (let p = 0, i = 0; i < d.length; i += 4, p++) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      gray[p] = g;
      rgb[p * 3] = d[i];
      rgb[p * 3 + 1] = d[i + 1];
      rgb[p * 3 + 2] = d[i + 2];
      bright += g;
    }
    return { gray, rgb, brightness: bright / (GRID * GRID * 255) };
  }

  close() {
    URL.revokeObjectURL(this.url);
    this.v.src = "";
  }
}

// --- math helpers -------------------------------------------------------------
function meanAbsDiff(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / (a.length * 255);
}

function rgbDiff(a: FrameGrab, b: FrameGrab): number {
  return meanAbsDiff(a.rgb, b.rgb);
}

function blockDeltas(a: FrameGrab, b: FrameGrab): Float32Array {
  const out = new Float32Array(BLOCKS * BLOCKS);
  const bs = GRID / BLOCKS;
  for (let by = 0; by < BLOCKS; by++) {
    for (let bx = 0; bx < BLOCKS; bx++) {
      let s = 0;
      for (let y = 0; y < bs; y++) {
        for (let x = 0; x < bs; x++) {
          const i = ((by * bs + y) * GRID + bx * bs + x) * 3;
          s += Math.abs(a.rgb[i] - b.rgb[i]) + Math.abs(a.rgb[i + 1] - b.rgb[i + 1]) + Math.abs(a.rgb[i + 2] - b.rgb[i + 2]);
        }
      }
      out[by * BLOCKS + bx] = s / (bs * bs * 3 * 255);
    }
  }
  return out;
}

// SAD under a shift/zoom hypothesis, color-aware: how well does warping B
// explain A?
function sadShift(a: FrameGrab, b: FrameGrab, dx: number, dy: number): number {
  let s = 0;
  let n = 0;
  const M = 6;
  for (let y = M; y < GRID - M; y++) {
    for (let x = M; x < GRID - M; x++) {
      const sx = x + dx;
      const sy = y + dy;
      if (sx < 0 || sx >= GRID || sy < 0 || sy >= GRID) continue;
      const i = (y * GRID + x) * 3;
      const j = (sy * GRID + sx) * 3;
      s += Math.abs(a.rgb[i] - b.rgb[j]) + Math.abs(a.rgb[i + 1] - b.rgb[j + 1]) + Math.abs(a.rgb[i + 2] - b.rgb[j + 2]);
      n++;
    }
  }
  return n ? s / (n * 3 * 255) : 1;
}

function sadZoom(a: FrameGrab, b: FrameGrab, f: number): number {
  let s = 0;
  let n = 0;
  const c = GRID / 2;
  const M = 6;
  for (let y = M; y < GRID - M; y++) {
    for (let x = M; x < GRID - M; x++) {
      const sx = Math.round(c + (x - c) * f);
      const sy = Math.round(c + (y - c) * f);
      if (sx < 0 || sx >= GRID || sy < 0 || sy >= GRID) continue;
      const i = (y * GRID + x) * 3;
      const j = (sy * GRID + sx) * 3;
      s += Math.abs(a.rgb[i] - b.rgb[j]) + Math.abs(a.rgb[i + 1] - b.rgb[j + 1]) + Math.abs(a.rgb[i + 2] - b.rgb[j + 2]);
      n++;
    }
  }
  return n ? s / (n * 3 * 255) : 1;
}

type Flow = { dir: "left" | "right" | "up" | "down" | "zoom-in" | "zoom-out" | "none"; gain: number };

// Which motion hypothesis best explains the change between two frames, and
// by how much it beats "no motion"?
function dominantFlow(a: FrameGrab, b: FrameGrab): Flow {
  const still = sadShift(a, b, 0, 0);
  const R = 4;
  const cands: { dir: Flow["dir"]; cost: number }[] = [
    { dir: "left", cost: sadShift(a, b, -R, 0) },
    { dir: "right", cost: sadShift(a, b, R, 0) },
    { dir: "up", cost: sadShift(a, b, 0, -R) },
    { dir: "down", cost: sadShift(a, b, 0, R) },
    { dir: "zoom-in", cost: sadZoom(a, b, 1.09) },
    { dir: "zoom-out", cost: sadZoom(a, b, 0.92) },
  ];
  cands.sort((x, y) => x.cost - y.cost);
  const best = cands[0];
  const gain = still > 1e-6 ? 1 - best.cost / still : 0;
  if (gain < 0.12) return { dir: "none", gain: 0 };
  return { dir: best.dir, gain };
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// --- the detector ---------------------------------------------------------------
export async function detectTransitionsV2(
  blob: Blob,
  onProgress?: (pct: number, msg: string) => void
): Promise<DetectionResult> {
  const sampler = await VideoSampler.open(blob);
  const duration = sampler.duration;

  // ---- PASS 1: coarse scan
  const step = Math.max(1 / 12, Math.min(0.15, duration / 260)); // 6.6-12 samples/s
  const coarse: CoarseSample[] = [];
  const grabs: FrameGrab[] = [];
  let prev: FrameGrab | null = null;
  for (let t = 0; t < duration; t += step) {
    const g = await sampler.grab(t);
    if (prev) {
      coarse.push({
        time: t,
        delta: rgbDiff(g, prev),
        brightness: g.brightness,
        blocks: blockDeltas(g, prev),
      });
    }
    grabs.push(g);
    prev = g;
    onProgress?.(Math.round((t / duration) * 55), `Scanning ${t.toFixed(1)}s / ${duration.toFixed(1)}s`);
  }

  // ---- adaptive candidate pick, two detectors:
  //  A) spikes (hard cuts, flashes): rolling median + MAD z-score
  //  B) sustained change (fades, wipes, zooms): a window of elevated delta
  //     bracketed by quieter shoulders — spikes never look like this
  const W = 18; // ~1.5-2.7s window
  const candidates: number[] = []; // indices into coarse
  for (let i = 0; i < coarse.length; i++) {
    const lo = Math.max(0, i - W);
    const hi = Math.min(coarse.length, i + W);
    const win: number[] = [];
    for (let k = lo; k < hi; k++) if (k !== i) win.push(coarse[k].delta);
    const med = median(win);
    const mad = median(win.map((x) => Math.abs(x - med))) || 1e-4;
    const z = (coarse[i].delta - med) / (1.4826 * mad);
    if (z > 4.5 && coarse[i].delta > Math.max(0.04, med * 2)) {
      const l = coarse[i - 1]?.delta ?? 0;
      const r = coarse[i + 1]?.delta ?? 0;
      if (coarse[i].delta >= l * 0.95 && coarse[i].delta >= r * 0.95) candidates.push(i);
    }
  }
  // B) gradual-transition candidates: the definition of a dissolve/wipe/zoom
  // is that the SCENE changes a lot across ~0.6s while NO single step
  // spikes. Ordinary in-scene motion has high step deltas but low net
  // change; hard cuts have a spike. This is the clean separator.
  const K = Math.max(3, Math.round(0.6 / step));
  for (let gi = 0; gi + K < grabs.length; gi++) {
    const net = rgbDiff(grabs[gi], grabs[gi + K]);
    let maxStep = 0;
    for (let j = gi; j < Math.min(coarse.length, gi + K); j++) maxStep = Math.max(maxStep, coarse[j].delta);
    if (net > 0.085 && maxStep < net * 0.6) {
      candidates.push(Math.min(coarse.length - 1, gi + Math.floor(K / 2)));
    }
  }
  candidates.sort((a, b) => a - b);
  // merge candidates closer than 0.35s (keep the stronger)
  const merged: number[] = [];
  for (const c of candidates) {
    const last = merged[merged.length - 1];
    if (last !== undefined && coarse[c].time - coarse[last].time < 0.35) {
      if (coarse[c].delta > coarse[last].delta) merged[merged.length - 1] = c;
    } else {
      merged.push(c);
    }
  }

  // ---- PASS 2: fine localization + evidence-based classification
  const transitions: DetectedTransition[] = [];
  const fineStep = 1 / 30;
  for (let ci = 0; ci < merged.length; ci++) {
    const idx = merged[ci];
    const tCoarse = coarse[idx].time;
    onProgress?.(
      55 + Math.round(((ci + 1) / merged.length) * 40),
      `Examining cut ${ci + 1}/${merged.length} @ ${tCoarse.toFixed(1)}s`
    );

    // fine grid across ±0.45s — wide enough to watch a 0.5s dissolve or
    // zoom actually evolve (the previous ±1-sample window was blind to them)
    const HALF = 0.45;
    const t0 = Math.max(0, tCoarse - HALF);
    const t1 = Math.min(duration - fineStep, tCoarse + HALF);
    const fine: { t: number; g: FrameGrab }[] = [];
    for (let t = t0; t <= t1 + 1e-6; t += fineStep) fine.push({ t, g: await sampler.grab(t) });
    if (fine.length < 3) continue;

    // localize: peak adjacent diff for spikes; delta-weighted centroid works
    // for gradual transitions where no single frame dominates
    let cutK = 1;
    let peak = 0;
    const diffs: number[] = [];
    for (let k = 1; k < fine.length; k++) {
      const d = rgbDiff(fine[k].g, fine[k - 1].g);
      diffs.push(d);
      if (d > peak) {
        peak = d;
        cutK = k;
      }
    }
    const totalDiff = diffs.reduce((a, b) => a + b, 0);
    const spreadRatio = peak > 0 && diffs.length > 0 ? totalDiff / diffs.length / peak : 0;
    if (spreadRatio > 0.45 && totalDiff > 0) {
      // gradual: center on the energy centroid instead of the max frame
      let cW = 0;
      for (let k = 0; k < diffs.length; k++) cW += diffs[k] * (k + 1);
      cutK = Math.max(1, Math.min(fine.length - 1, Math.round(cW / totalDiff)));
    }
    const cutTime = fine[cutK].t;

    // evidence endpoints: the SHOULDERS of the window, past any transition
    const beforeIdx = 0;
    const afterIdx = fine.length - 1;
    const A = fine[beforeIdx].g;
    const B = fine[afterIdx].g;
    const mid = fine[cutK].g;

    // flash: luma at the cut spikes far from both neighbors toward an extreme
    const lumaCut = fine[cutK].g.brightness;
    const lumaBase = (A.brightness + B.brightness) / 2;
    const isFlash =
      (lumaCut > 0.78 && lumaCut - lumaBase > 0.22) || (lumaCut < 0.08 && lumaBase - lumaCut > 0.2);

    // dissolve: the cut-point frame ≈ blend(shoulderA, shoulderB) better
    // than either shoulder alone, and change is spread over many frames
    const blendErr = (() => {
      let s = 0;
      for (let i = 0; i < mid.rgb.length; i++) s += Math.abs(mid.rgb[i] - (A.rgb[i] + B.rgb[i]) / 2);
      return s / (mid.rgb.length * 255);
    })();
    const sideErr = Math.min(rgbDiff(mid, A), rgbDiff(mid, B));
    const isDissolve = blendErr < sideErr * 0.75 && spreadRatio > 0.4 && !isFlash;

    // directional motion, two time scales:
    //  consecutive pairs — fast whips (large per-frame shift)
    //  spaced pairs (5 frames ≈ 0.17s) — slow zooms/pans whose per-frame
    //  motion is under the SAD grid's resolution
    const flows: Flow[] = [];
    for (let k = Math.max(1, cutK - 8); k <= Math.min(fine.length - 1, cutK + 8); k++) {
      flows.push(dominantFlow(fine[k - 1].g, fine[k].g));
    }
    const spacedFlows: Flow[] = [];
    const SP = 5;
    for (let k = Math.max(0, cutK - 9); k + SP <= Math.min(fine.length - 1, cutK + 9); k += 2) {
      spacedFlows.push(dominantFlow(fine[k].g, fine[k + SP].g));
    }
    const coherent = (dir: Flow["dir"]) => flows.filter((f) => f.dir === dir && f.gain > 0.16).length;
    const coherentSpaced = (dir: Flow["dir"]) => spacedFlows.filter((f) => f.dir === dir && f.gain > 0.14).length;
    const horiz = Math.max(coherent("left"), coherent("right"));
    const zoomHit =
      coherentSpaced("zoom-in") >= 2 ||
      coherentSpaced("zoom-out") >= 2 ||
      coherent("zoom-in") >= 3 ||
      coherent("zoom-out") >= 3;
    const zoomInward =
      coherent("zoom-in") + coherentSpaced("zoom-in") >= coherent("zoom-out") + coherentSpaced("zoom-out");

    // wipe sweep: xfade-style whips/slides move a change BOUNDARY across
    // the frame rather than shifting all content. Track the column of max
    // block-delta across fine frames — a monotonic march = directional wipe.
    const colPeaks: number[] = [];
    for (let k = Math.max(1, cutK - 8); k <= Math.min(fine.length - 1, cutK + 8); k++) {
      const bd = blockDeltas(fine[k].g, fine[k - 1].g);
      let bestCol = 0;
      let bestVal = -1;
      for (let col = 0; col < BLOCKS; col++) {
        let v = 0;
        for (let row = 0; row < BLOCKS; row++) v += bd[row * BLOCKS + col];
        if (v > bestVal) {
          bestVal = v;
          bestCol = col;
        }
      }
      if (bestVal > 0.03 * BLOCKS) colPeaks.push(bestCol);
    }
    let sweep: "left" | "right" | null = null;
    if (colPeaks.length >= 3) {
      let inc = 0;
      let dec = 0;
      for (let k = 1; k < colPeaks.length; k++) {
        if (colPeaks[k] > colPeaks[k - 1]) inc++;
        else if (colPeaks[k] < colPeaks[k - 1]) dec++;
      }
      // trend, not strict monotonicity — smooth wipe boundaries jitter
      if (inc - dec >= 2 && colPeaks[colPeaks.length - 1] > colPeaks[0]) sweep = "right";
      else if (dec - inc >= 2 && colPeaks[0] > colPeaks[colPeaks.length - 1]) sweep = "left";
    }

    // radial signature: zooms change the frame edges much faster than the
    // center (content flies outward/inward). Uniform dissolves sit near 1.
    let ringRatio = 1;
    {
      let edgeSum = 0;
      let centerSum = 0;
      let frames = 0;
      for (let k = Math.max(1, cutK - 6); k <= Math.min(fine.length - 1, cutK + 6); k++) {
        const bd = blockDeltas(fine[k].g, fine[k - 1].g);
        let e = 0;
        let c = 0;
        let en = 0;
        let cn = 0;
        for (let row = 0; row < BLOCKS; row++) {
          for (let col = 0; col < BLOCKS; col++) {
            const v = bd[row * BLOCKS + col];
            const isEdge = row === 0 || col === 0 || row === BLOCKS - 1 || col === BLOCKS - 1;
            if (isEdge) {
              e += v;
              en++;
            } else {
              c += v;
              cn++;
            }
          }
        }
        if (cn > 0 && c / cn > 1e-4) {
          edgeSum += e / en;
          centerSum += c / cn;
          frames++;
        }
      }
      if (frames > 0 && centerSum > 0) ringRatio = edgeSum / centerSum;
    }

    let type: TransitionType;
    let description: string;
    let confidence: number;
    if (isFlash) {
      type = "flash";
      description = `Flash cut — luma spikes to ${(lumaCut * 100).toFixed(0)}% for a couple of frames on the hit`;
      confidence = 0.92;
    } else if (horiz >= 3 || sweep) {
      type = "whip-pan";
      const dir = sweep ?? (coherent("left") >= coherent("right") ? "left" : "right");
      description = `Whip pan ${dir} — ${sweep ? "a wipe boundary sweeps" : "coherent horizontal motion carries"} across the cut`;
      confidence = 0.85;
    } else if (zoomHit || (ringRatio > 1.7 && spreadRatio > 0.35)) {
      const inward = zoomInward;
      type = inward ? "zoom-in" : "zoom-out";
      description = inward
        ? "Zoom punch — the frame pushes in through the cut"
        : "Zoom out — the frame pulls back through the cut";
      confidence = 0.8;
    } else if (isDissolve) {
      type = "fade";
      description = "Dissolve — the frames blend over several frames instead of switching";
      confidence = 0.8;
    } else {
      type = "hard-cut";
      description = "Hard cut — instant switch, clean frames on both sides";
      confidence = Math.min(0.95, 0.6 + peak);
    }

    transitions.push({
      id: `t_${transitions.length}`,
      time: Number(cutTime.toFixed(2)),
      type,
      confidence: Number(confidence.toFixed(2)),
      durationFrames: type === "hard-cut" ? 1 : type === "fade" ? 12 : 6,
      description,
    });
  }

  sampler.close();
  onProgress?.(100, "Done");
  return {
    transitions,
    samples: coarse.map((c) => ({ time: c.time, delta: c.delta, brightness: c.brightness })),
    duration,
  };
}
