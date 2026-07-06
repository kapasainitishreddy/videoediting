"use client";

// Browser side of the head/face + action trackers.
//
// Face detection runs in tiers — best available wins, everything degrades
// gracefully, nothing leaves the device:
//   1. MediaPipe BlazeFace (real ML, 230KB model committed in /models,
//      WASM runtime served same-origin from /vision)
//   2. The browser's native Shape-Detection FaceDetector (Chrome, some
//      platforms) — also on-device ML
//   3. The skin-cluster heuristic in track-core.ts — zero downloads
//
// Whatever tier detected, track-core smooths the samples into a camera
// path and compiles FFmpeg expressions at render time.

import {
  detectFaceInFrame,
  motionCentroid,
  smoothTrack,
  type TrackPath,
  type TrackPoint,
} from "./track-core";

export type { TrackPath } from "./track-core";

// Minimal typing for the native Shape Detection API (not in lib.dom yet)
interface NativeFaceDetection {
  boundingBox: { x: number; y: number; width: number; height: number };
}
interface NativeFaceDetector {
  detect(source: CanvasImageSource): Promise<NativeFaceDetection[]>;
}
declare global {
  interface Window {
    FaceDetector?: new (opts?: { fastMode?: boolean; maxDetectedFaces?: number }) => NativeFaceDetector;
  }
}

type MpFaceDetector = import("@mediapipe/tasks-vision").FaceDetector;

let mpDetectorPromise: Promise<MpFaceDetector | null> | null = null;

// Load the MediaPipe face detector once per session. Returns null (and
// remembers it) when the runtime or model can't load — callers fall through
// to the next tier without user-visible errors.
export function getMediaPipeFaceDetector(): Promise<MpFaceDetector | null> {
  if (!mpDetectorPromise) {
    mpDetectorPromise = (async () => {
      try {
        const vision = await import("@mediapipe/tasks-vision");
        const fileset = await vision.FilesetResolver.forVisionTasks("/vision");
        return await vision.FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: "/models/face_detector.tflite" },
          runningMode: "IMAGE",
          minDetectionConfidence: 0.4,
        });
      } catch {
        return null;
      }
    })();
  }
  return mpDetectorPromise;
}

export type FaceTier = "mediapipe" | "native" | "heuristic";

async function pickFaceTier(): Promise<{ tier: FaceTier; mp: MpFaceDetector | null; native: NativeFaceDetector | null }> {
  const mp = await getMediaPipeFaceDetector();
  if (mp) return { tier: "mediapipe", mp, native: null };
  if (typeof window !== "undefined" && window.FaceDetector) {
    try {
      const native = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 3 });
      return { tier: "native", mp: null, native };
    } catch {
      /* fall through */
    }
  }
  return { tier: "heuristic", mp: null, native: null };
}

async function loadVideo(blob: Blob): Promise<{ v: HTMLVideoElement; url: string; duration: number }> {
  const url = URL.createObjectURL(blob);
  const v = document.createElement("video");
  v.preload = "auto";
  v.muted = true;
  v.src = url;
  await new Promise<void>((res, rej) => {
    v.onloadeddata = () => res();
    v.onerror = () => rej(new Error("track: clip failed to load"));
  });
  let duration = v.duration;
  if (!Number.isFinite(duration) || duration <= 0) {
    await new Promise<void>((res) => {
      v.onseeked = () => res();
      v.currentTime = 1e7;
    });
    duration = Number.isFinite(v.duration) ? v.duration : v.currentTime;
  }
  return { v, url, duration };
}

const seekTo = (v: HTMLVideoElement, t: number) =>
  new Promise<void>((res) => {
    v.onseeked = () => res();
    v.currentTime = t;
  });

// ---------------------------------------------------------------------------
// Face tracking: sample ~4fps, detect per frame, smooth into a path.
// ---------------------------------------------------------------------------

export async function trackFace(
  blob: Blob,
  opts: { onProgress?: (frac: number) => void; near?: { cx: number; cy: number } } = {}
): Promise<{ path: TrackPath | null; tier: FaceTier }> {
  const { v, url, duration } = await loadVideo(blob);
  try {
    const aspect = v.videoWidth / Math.max(1, v.videoHeight);
    const { tier, mp, native } = await pickFaceTier();
    // multi-face: when the user picked a face, follow the detection nearest
    // to the running anchor instead of the biggest one in frame
    let anchor: { cx: number; cy: number } | null = opts.near ?? null;
    const pickCost = (cand: { cx: number; cy: number; size: number }) =>
      anchor ? Math.hypot(cand.cx - anchor.cx, cand.cy - anchor.cy) - cand.size * 0.15 : -cand.size;

    // ML tiers get a decent-res frame; the heuristic works at 64px
    const MLW = 256;
    const mlH = Math.max(64, Math.round(MLW / aspect));
    const ml = document.createElement("canvas");
    ml.width = MLW;
    ml.height = mlH;
    const mlCtx = ml.getContext("2d", { willReadFrequently: true })!;
    const HW = 64;
    const hH = Math.max(16, Math.round(HW / aspect));
    const hc = document.createElement("canvas");
    hc.width = HW;
    hc.height = hH;
    const hCtx = hc.getContext("2d", { willReadFrequently: true })!;

    const step = Math.max(0.2, duration / 40); // ≤ ~40 samples, ≥5/sec never
    const points: TrackPoint[] = [];
    for (let t = 0; t < duration - 1e-3; t += step) {
      await seekTo(v, Math.min(duration - 0.05, t));
      let pt: TrackPoint = { t, cx: 0, cy: 0, size: 0, conf: 0 };

      if (tier === "mediapipe" && mp) {
        mlCtx.drawImage(v, 0, 0, MLW, mlH);
        const res = mp.detect(ml);
        let best: { cx: number; cy: number; size: number; conf: number } | null = null;
        for (const d of res.detections) {
          const bb = d.boundingBox;
          if (!bb) continue;
          const conf = d.categories[0]?.score ?? 0.5;
          const size = Math.max(bb.width / MLW, bb.height / mlH);
          const cand = { cx: (bb.originX + bb.width / 2) / MLW, cy: (bb.originY + bb.height / 2) / mlH, size, conf };
          if (!best || pickCost(cand) < pickCost(best)) best = cand;
        }
        if (best) {
          pt = { t, ...best };
          anchor = { cx: best.cx, cy: best.cy };
        }
      } else if (tier === "native" && native) {
        mlCtx.drawImage(v, 0, 0, MLW, mlH);
        try {
          const faces = await native.detect(ml);
          let best: { cx: number; cy: number; size: number } | null = null;
          for (const f of faces) {
            const bb = f.boundingBox;
            const cand = {
              cx: (bb.x + bb.width / 2) / MLW,
              cy: (bb.y + bb.height / 2) / mlH,
              size: Math.max(bb.width / MLW, bb.height / mlH),
            };
            if (!best || pickCost(cand) < pickCost(best)) best = cand;
          }
          if (best) {
            pt = { t, ...best, conf: 0.8 };
            anchor = { cx: best.cx, cy: best.cy };
          }
        } catch {
          /* conf stays 0 */
        }
      }

      // heuristic tier — also the per-frame fallback when ML found nothing
      if (pt.conf === 0) {
        hCtx.drawImage(v, 0, 0, HW, hH);
        const d = hCtx.getImageData(0, 0, HW, hH).data;
        const f = detectFaceInFrame(d, HW, hH);
        if (f) pt = { t, ...f, conf: tier === "heuristic" ? f.conf : f.conf * 0.6 };
      }

      points.push(pt);
      opts.onProgress?.(Math.min(1, (t + step) / duration));
    }

    return { path: smoothTrack(points, "face", duration, aspect), tier };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------------------
// Action tracking: follow WHERE THE MOTION IS — the "camera movement
// tracker". No model needed; frame-difference centroids, smoothed.
// ---------------------------------------------------------------------------

export async function trackAction(
  blob: Blob,
  opts: { onProgress?: (frac: number) => void } = {}
): Promise<{ path: TrackPath | null; tier: "motion" }> {
  const { v, url, duration } = await loadVideo(blob);
  try {
    const aspect = v.videoWidth / Math.max(1, v.videoHeight);
    const W = 64;
    const H = Math.max(16, Math.round(W / aspect));
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;

    const step = Math.max(0.2, duration / 40);
    const points: TrackPoint[] = [];
    let prev: Uint8ClampedArray | null = null;
    for (let t = 0; t < duration - 1e-3; t += step) {
      await seekTo(v, Math.min(duration - 0.05, t));
      ctx.drawImage(v, 0, 0, W, H);
      const cur = ctx.getImageData(0, 0, W, H).data;
      if (prev) {
        const m = motionCentroid(prev, cur, W, H);
        points.push({
          t,
          cx: m.cx,
          cy: m.cy,
          size: 0.3,
          // static frames give a meaningless centroid — mark unconfident so
          // smoothTrack bridges through them instead of jumping to noise
          conf: m.energy > 0.004 ? Math.min(1, m.energy * 25) : 0,
        });
      }
      prev = cur.slice();
      opts.onProgress?.(Math.min(1, (t + step) / duration));
    }

    return { path: smoothTrack(points, "action", duration, aspect), tier: "motion" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// List candidate faces near the start of a clip so the user can pick WHICH
// person the lock should follow. Uses the same ML tiers; the heuristic tier
// can only ever offer its single best blob.
export async function detectFacesAt(
  blob: Blob,
  atFrac = 0.35
): Promise<{ cx: number; cy: number; size: number }[]> {
  const { v, url, duration } = await loadVideo(blob);
  try {
    const aspect = v.videoWidth / Math.max(1, v.videoHeight);
    const { tier, mp, native } = await pickFaceTier();
    const MLW = 256;
    const mlH = Math.max(64, Math.round(MLW / aspect));
    const c = document.createElement("canvas");
    c.width = MLW;
    c.height = mlH;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    await seekTo(v, Math.min(duration - 0.05, duration * atFrac));
    ctx.drawImage(v, 0, 0, MLW, mlH);

    const faces: { cx: number; cy: number; size: number }[] = [];
    if (tier === "mediapipe" && mp) {
      for (const d of mp.detect(c).detections) {
        const bb = d.boundingBox;
        if (!bb) continue;
        faces.push({
          cx: (bb.originX + bb.width / 2) / MLW,
          cy: (bb.originY + bb.height / 2) / mlH,
          size: Math.max(bb.width / MLW, bb.height / mlH),
        });
      }
    } else if (tier === "native" && native) {
      try {
        for (const f of await native.detect(c)) {
          const bb = f.boundingBox;
          faces.push({
            cx: (bb.x + bb.width / 2) / MLW,
            cy: (bb.y + bb.height / 2) / mlH,
            size: Math.max(bb.width / MLW, bb.height / mlH),
          });
        }
      } catch {
        /* fall through to heuristic below */
      }
    }
    if (faces.length === 0) {
      const HW = 64;
      const hH = Math.max(16, Math.round(HW / aspect));
      const hc = document.createElement("canvas");
      hc.width = HW;
      hc.height = hH;
      const hctx = hc.getContext("2d", { willReadFrequently: true })!;
      hctx.drawImage(v, 0, 0, HW, hH);
      const f = detectFaceInFrame(hctx.getImageData(0, 0, HW, hH).data, HW, hH);
      if (f) faces.push({ cx: f.cx, cy: f.cy, size: f.size });
    }
    return faces.filter((f) => f.size > 0.04).sort((a, b) => a.cx - b.cx);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Detect the key color of a (potential) green/blue screen clip — samples a
// frame near the middle and runs the pure border-ring detector.
export async function detectClipKeyColor(blob: Blob): Promise<{ color: string; coverage: number } | null> {
  const { detectKeyColor } = await import("./chroma");
  const { v, url, duration } = await loadVideo(blob);
  try {
    const W = 96;
    const H = Math.max(32, Math.round(W / (v.videoWidth / Math.max(1, v.videoHeight))));
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    // two samples — the screen must be there throughout, not in one lucky frame
    let result: { color: string; coverage: number } | null = null;
    for (const frac of [0.35, 0.7]) {
      await seekTo(v, Math.min(duration - 0.05, duration * frac));
      ctx.drawImage(v, 0, 0, W, H);
      const k = detectKeyColor(ctx.getImageData(0, 0, W, H).data, W, H);
      if (!k) return null;
      result = k;
    }
    return result;
  } finally {
    URL.revokeObjectURL(url);
  }
}
