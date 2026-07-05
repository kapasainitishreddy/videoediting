"use client";

// Post-render export tools:
//  • cropAspect() — derive a 1:1 or 16:9 version of the finished 9:16 MP4 in
//    one FFmpeg pass (center crop, audio copied through untouched).
//  • bestFrame() — scan the render for the most thumbnail-worthy frame:
//    sharp, well-exposed, colorful. Returns a JPEG ready to upload.
import { fetchFile } from "@ffmpeg/util";
import { getFFmpeg, probeDuration } from "./ffmpeg-client";

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(u8.byteLength);
  new Uint8Array(buf).set(u8);
  return buf;
}

export type ExportAspect = "1:1" | "16:9";

// Center-crop the 720x1280 master to another aspect. 1:1 → 720x720;
// 16:9 → 720x404 (rounded to even for yuv420p). The video stream is
// re-encoded (crop requires it) but audio is stream-copied.
export async function cropAspect(master: Blob, aspect: ExportAspect): Promise<Blob> {
  const ff = await getFFmpeg();
  await ff.writeFile("master.mp4", await fetchFile(master));
  const crop = aspect === "1:1" ? "crop=720:720:0:280" : "crop=720:404:0:438";
  const out = aspect === "1:1" ? "sq.mp4" : "wide.mp4";
  const code = await ff.exec([
    "-i", "master.mp4",
    "-vf", `${crop},format=yuv420p`,
    "-c:a", "copy",
    "-preset", "ultrafast", "-crf", "26",
    "-y", out,
  ]);
  if (code !== 0) throw new Error(`aspect export failed (${aspect})`);
  const data = await ff.readFile(out);
  await ff.deleteFile("master.mp4").catch(() => {});
  await ff.deleteFile(out).catch(() => {});
  return new Blob([toArrayBuffer(data as Uint8Array)], { type: "video/mp4" });
}

// --- Best-frame thumbnail ---------------------------------------------------------
// Pure scorer, exported for tests: sharpness (mean absolute neighbor delta),
// exposure (distance from mid-gray, penalized), and colorfulness.
export function frameScore(data: Uint8ClampedArray, w: number, h: number): number {
  let sharp = 0;
  let lum = 0;
  let sat = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const p = (y * w + x) * 4;
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];
      const l = (r + g + b) / 3;
      const right = (data[p + 4] + data[p + 5] + data[p + 6]) / 3;
      const below = (data[p + w * 4] + data[p + w * 4 + 1] + data[p + w * 4 + 2]) / 3;
      sharp += Math.abs(l - right) + Math.abs(l - below);
      lum += l;
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      sat += mx > 0 ? (mx - mn) / mx : 0;
      n++;
    }
  }
  sharp /= n * 255;
  lum /= n * 255;
  sat /= n;
  const exposure = 1 - Math.min(1, Math.abs(lum - 0.5) * 2.2); // best near mid
  return sharp * 2.2 + exposure * 1.0 + sat * 0.8;
}

export async function bestFrame(video: Blob, samples = 14): Promise<{ jpeg: Blob; at: number }> {
  try {
    return await bestFrameViaVideo(video, samples);
  } catch {
    // <video> can't decode this codec here (e.g. no native H.264 decoder) —
    // fall back to the FFmpeg WASM core, which decodes it just fine.
    return await bestFrameViaWasm(video, samples);
  }
}

// Fast path: scan frames with a <video> element (works wherever the browser
// can decode the codec — every real phone/desktop for H.264).
async function bestFrameViaVideo(video: Blob, samples: number): Promise<{ jpeg: Blob; at: number }> {
  const url = URL.createObjectURL(video);
  const v = document.createElement("video");
  v.preload = "auto";
  v.muted = true;
  v.src = url;
  try {
    await new Promise<void>((res, rej) => {
      v.onloadeddata = () => res();
      v.onerror = () => rej(new Error("thumbnail scan load failed"));
    });
    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 5;
    const S = 120;
    const probe = document.createElement("canvas");
    probe.width = S;
    probe.height = S;
    const pctx = probe.getContext("2d", { willReadFrequently: true })!;

    let bestT = 0.5;
    let bestScore = -1;
    for (let i = 0; i < samples; i++) {
      const t = ((i + 0.5) / samples) * dur;
      await new Promise<void>((res) => {
        v.onseeked = () => res();
        v.currentTime = Math.min(dur - 0.05, t);
      });
      pctx.drawImage(v, 0, 0, S, S);
      const score = frameScore(pctx.getImageData(0, 0, S, S).data, S, S);
      if (score > bestScore) {
        bestScore = score;
        bestT = t;
      }
    }

    await new Promise<void>((res) => {
      v.onseeked = () => res();
      v.currentTime = Math.min(dur - 0.05, bestT);
    });
    const full = document.createElement("canvas");
    full.width = v.videoWidth || 720;
    full.height = v.videoHeight || 1280;
    full.getContext("2d")!.drawImage(v, 0, 0);
    const jpeg = await new Promise<Blob>((res) => full.toBlob((b) => res(b!), "image/jpeg", 0.92));
    return { jpeg, at: Number(bestT.toFixed(2)) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Load a PNG blob into pixel data via an <img> (works for any image, no video
// decoder needed).
async function pngToPixels(png: Blob): Promise<{ data: Uint8ClampedArray; w: number; h: number; img: HTMLImageElement }> {
  const url = URL.createObjectURL(png);
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
    img.src = url;
  });
  URL.revokeObjectURL(url);
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return { data: ctx.getImageData(0, 0, img.width, img.height).data, w: img.width, h: img.height, img };
}

// Fallback path: extract candidate frames with the FFmpeg WASM core (decodes
// H.264 anywhere), score them as images, return the winner re-encoded to JPEG.
async function bestFrameViaWasm(video: Blob, samples: number): Promise<{ jpeg: Blob; at: number }> {
  const ff = await getFFmpeg();
  const dur = await probeDuration(video).catch(() => 5);
  await ff.writeFile("bf.mp4", await fetchFile(video));

  let bestT = dur / 2;
  let bestScore = -1;
  for (let i = 0; i < samples; i++) {
    const t = ((i + 0.5) / samples) * dur;
    const name = `bf_${i}.png`;
    // input-seek to a small scaled frame — fast, precise enough for scoring
    const code = await ff.exec(["-ss", t.toFixed(2), "-i", "bf.mp4", "-frames:v", "1", "-vf", "scale=120:-2", "-y", name]);
    if (code !== 0) continue;
    try {
      const d = (await ff.readFile(name)) as Uint8Array;
      await ff.deleteFile(name);
      const { data, w, h } = await pngToPixels(new Blob([toArrayBuffer(d)], { type: "image/png" }));
      const score = frameScore(data, w, h);
      if (score > bestScore) {
        bestScore = score;
        bestT = t;
      }
    } catch {
      // undecodable sample — skip
    }
  }

  // full-resolution grab of the winner, PNG → JPEG via canvas
  await ff.exec(["-ss", bestT.toFixed(2), "-i", "bf.mp4", "-frames:v", "1", "-y", "bf_best.png"]);
  const bestPng = (await ff.readFile("bf_best.png")) as Uint8Array;
  await ff.deleteFile("bf_best.png").catch(() => {});
  await ff.deleteFile("bf.mp4").catch(() => {});
  const { img } = await pngToPixels(new Blob([toArrayBuffer(bestPng)], { type: "image/png" }));
  const out = document.createElement("canvas");
  out.width = img.width;
  out.height = img.height;
  out.getContext("2d")!.drawImage(img, 0, 0);
  const jpeg = await new Promise<Blob>((res) => out.toBlob((b) => res(b!), "image/jpeg", 0.92));
  return { jpeg, at: Number(bestT.toFixed(2)) };
}
