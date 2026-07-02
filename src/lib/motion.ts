"use client";

// Motion tools: virtual camera moves, stabilization, shake, speed ramps,
// subject-aware reframing, match-cut detection. All built on filters the
// WASM core probe verified (crop with t-expressions, deshake, minterpolate).
import type { TimelineSegment } from "./types";
import type { ClipAnalysis } from "./clip-analysis";

export type MotionEffect = "none" | "ken-burns-in" | "ken-burns-out" | "shake" | "stabilize" | "drift";

export interface MotionConfig {
  perSegment: MotionEffect; // default applied to every segment
  autoKenBurnsOnStatic: boolean; // #6: add virtual dolly to low-motion shots
  smoothSlowmo: boolean; // use minterpolate on speed<1 segments (#8, slow!)
}

export const DEFAULT_MOTION: MotionConfig = {
  perSegment: "none",
  autoKenBurnsOnStatic: false,
  smoothSlowmo: false,
};

// Build the motion part of a segment's -vf chain. Input is already scaled
// to 792x1408 (10% overscan) when motion is active, so crops have headroom;
// output is exactly 720x1280.
export function motionFilter(effect: MotionEffect, durSec: number): { pre: string; post: string; needsOverscan: boolean } {
  const D = Math.max(0.3, durSec);
  // zoompan increment per output frame (30fps) to travel 0.16 zoom over D
  const inc = (0.16 / (30 * D)).toFixed(6);
  switch (effect) {
    case "ken-burns-in":
      // slow push-in via zoompan (crop can't animate w/h per-frame)
      return {
        pre: "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280",
        post: `zoompan=z='min(1+${inc}*on,1.16)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=720x1280:fps=30`,
        needsOverscan: true,
      };
    case "ken-burns-out":
      return {
        pre: "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280",
        post: `zoompan=z='max(1.16-${inc}*on,1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=720x1280:fps=30`,
        needsOverscan: true,
      };
    case "drift":
      // subtle lateral float — cheap "handheld operator breathing" feel
      return {
        pre: "scale=792:1408:force_original_aspect_ratio=increase,crop=792:1408",
        post: "crop=720:1280:'36+18*sin(t*0.9)':'64+10*sin(t*0.6)'",
        needsOverscan: true,
      };
    case "shake":
      // #9: procedural handheld — layered sines ≈ organic jitter
      return {
        pre: "scale=792:1408:force_original_aspect_ratio=increase,crop=792:1408",
        post:
          "crop=720:1280:'36+14*sin(t*13)+9*sin(t*7.3)+5*sin(t*23.7)':'64+11*sin(t*11.1)+7*sin(t*17.9)'",
        needsOverscan: true,
      };
    case "stabilize":
      // #7: deshake pass (before scaling to final)
      return { pre: "deshake=rx=32:ry=32", post: "", needsOverscan: false };
    default:
      return { pre: "", post: "", needsOverscan: false };
  }
}

// #8: speed ramp = split one segment into two sub-segments (slow → fast or
// fast → slow) at the midpoint. Works with the existing per-segment speed
// pipeline — no exotic PTS math, fully render-safe.
export function splitForRamp(seg: TimelineSegment, style: "slow-in" | "slow-out"): TimelineSegment[] {
  const mid = seg.start + (seg.end - seg.start) / 2;
  const a: TimelineSegment = { ...seg, id: seg.id + "_a", end: Number(mid.toFixed(2)), transitionAfter: null };
  const b: TimelineSegment = { ...seg, id: seg.id + "_b", start: Number(mid.toFixed(2)) };
  if (style === "slow-in") {
    a.speed = 0.5; // dramatic slow entry…
    b.speed = 1.5; // …snaps to speed
  } else {
    a.speed = 1.5;
    b.speed = 0.5; // decelerate into the moment
  }
  return [a, b];
}

// #6: which segments are static enough to deserve an automatic Ken Burns?
export function isStaticShot(a: ClipAnalysis, start: number, end: number): boolean {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.times.length; i++) {
    if (a.times[i] >= start && a.times[i] <= end) {
      sum += a.motion[i];
      n++;
    }
  }
  return n > 0 && sum / n < 0.03;
}

// --- #11: subject-aware auto-reframe -----------------------------------------
// Find the horizontal center of ACTION (motion centroid) so wide footage is
// cropped to 9:16 around the subject, not blindly down the middle.
export async function motionCentroidX(blob: Blob, samples = 8): Promise<number> {
  const url = URL.createObjectURL(blob);
  const v = document.createElement("video");
  v.preload = "auto";
  v.muted = true;
  v.src = url;
  await new Promise<void>((res, rej) => {
    v.onloadeddata = () => res();
    v.onerror = () => rej(new Error("reframe load failed"));
  });
  const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 3;
  const W = 64, H = 36;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  let prev: Uint8ClampedArray | null = null;
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < samples; i++) {
    const t = ((i + 0.5) / samples) * dur;
    await new Promise<void>((res) => {
      v.onseeked = () => res();
      v.currentTime = Math.min(dur - 0.05, t);
    });
    ctx.drawImage(v, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    if (prev) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const p = (y * W + x) * 4;
          const diff = Math.abs(d[p] - prev[p]) + Math.abs(d[p + 1] - prev[p + 1]);
          weighted += diff * x;
          total += diff;
        }
      }
    }
    prev = d.slice();
  }
  URL.revokeObjectURL(url);
  return total > 0 ? weighted / total / W : 0.5; // 0..1 across the frame
}

// Build the crop filter that reframes landscape input to 9:16 around the
// subject. cx is the 0..1 motion centroid.
export function reframeFilter(cx: number): string {
  // crop a 9:16 window from whatever aspect arrives; x centers on subject
  const clamped = Math.max(0.15, Math.min(0.85, cx));
  return `crop='min(iw,ih*9/16)':ih:'(iw-min(iw,ih*9/16))*${clamped.toFixed(3)}':0`;
}

// --- #10: match-cut detector --------------------------------------------------
// Compare the closing frame of each clip with the opening frame of every
// other clip; low histogram distance = natural match-cut pair.
export async function matchCutPairs(
  clips: { id: string; blob: Blob }[]
): Promise<{ fromId: string; toId: string; score: number }[]> {
  const S = 32;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;

  const frame = async (blob: Blob, where: "start" | "end") => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    v.src = url;
    await new Promise<void>((res, rej) => {
      v.onloadeddata = () => res();
      v.onerror = () => rej(new Error("matchcut load failed"));
    });
    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 3;
    await new Promise<void>((res) => {
      v.onseeked = () => res();
      v.currentTime = where === "start" ? 0.05 : Math.max(0.05, dur - 0.1);
    });
    ctx.drawImage(v, 0, 0, S, S);
    const d = ctx.getImageData(0, 0, S, S).data;
    URL.revokeObjectURL(url);
    // 4x4 spatial luma grid = crude composition signature
    const sig = new Float32Array(16);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const p = (y * S + x) * 4;
        sig[Math.floor(y / 8) * 4 + Math.floor(x / 8)] += (d[p] + d[p + 1] + d[p + 2]) / 3 / 255;
      }
    }
    for (let i = 0; i < 16; i++) sig[i] /= 64;
    return sig;
  };

  const ends = new Map<string, Float32Array>();
  const starts = new Map<string, Float32Array>();
  for (const cl of clips) {
    ends.set(cl.id, await frame(cl.blob, "end"));
    starts.set(cl.id, await frame(cl.blob, "start"));
  }

  const pairs: { fromId: string; toId: string; score: number }[] = [];
  for (const a of clips) {
    for (const b of clips) {
      if (a.id === b.id) continue;
      const ea = ends.get(a.id)!;
      const sb = starts.get(b.id)!;
      let dist = 0;
      for (let i = 0; i < 16; i++) dist += Math.abs(ea[i] - sb[i]);
      pairs.push({ fromId: a.id, toId: b.id, score: Number((1 - dist / 4).toFixed(3)) });
    }
  }
  return pairs.sort((x, y) => y.score - x.score);
}

// --- #15: composition score ---------------------------------------------------
// Heuristic 0-100: subject offset vs rule-of-thirds + tonal balance.
export async function compositionScore(blob: Blob, at = 0.5): Promise<{ score: number; tips: string[] }> {
  const url = URL.createObjectURL(blob);
  const v = document.createElement("video");
  v.preload = "auto";
  v.muted = true;
  v.src = url;
  await new Promise<void>((res, rej) => {
    v.onloadeddata = () => res();
    v.onerror = () => rej(new Error("comp load failed"));
  });
  const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 2;
  await new Promise<void>((res) => {
    v.onseeked = () => res();
    v.currentTime = Math.min(dur - 0.05, at * dur);
  });
  const S = 48;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(v, 0, 0, S, S);
  const d = ctx.getImageData(0, 0, S, S).data;
  URL.revokeObjectURL(url);

  // edge-energy centroid ≈ subject position
  let cx = 0, cy = 0, e = 0;
  const lum = (x: number, y: number) => {
    const p = (y * S + x) * 4;
    return (d[p] + d[p + 1] + d[p + 2]) / 3;
  };
  for (let y = 1; y < S - 1; y++) {
    for (let x = 1; x < S - 1; x++) {
      const g = Math.abs(lum(x + 1, y) - lum(x - 1, y)) + Math.abs(lum(x, y + 1) - lum(x, y - 1));
      cx += g * x;
      cy += g * y;
      e += g;
    }
  }
  const tips: string[] = [];
  if (e === 0) return { score: 40, tips: ["Frame is nearly empty — get closer to your subject"] };
  cx = cx / e / S;
  cy = cy / e / S;

  // distance to nearest thirds power point
  const points = [
    [1 / 3, 1 / 3], [2 / 3, 1 / 3], [1 / 3, 2 / 3], [2 / 3, 2 / 3],
  ];
  let dMin = 1;
  for (const [px, py] of points) dMin = Math.min(dMin, Math.hypot(cx - px, cy - py));
  const thirds = Math.max(0, 1 - dMin * 2.2);

  // tonal balance: top vs bottom luma spread
  let top = 0, bottom = 0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (y < S / 2) top += lum(x, y);
      else bottom += lum(x, y);
    }
  }
  const balance = 1 - Math.min(1, Math.abs(top - bottom) / (top + bottom + 1));

  const score = Math.round(thirds * 60 + balance * 40);
  if (thirds < 0.4) tips.push("Subject sits dead-center or at the edge — reframe toward a thirds point");
  if (balance < 0.5) tips.push("Frame is tonally top/bottom heavy — tilt to rebalance");
  if (score >= 75) tips.push("Strong composition — lead with this shot");
  return { score, tips };
}
