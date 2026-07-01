"use client";

// FFmpeg WebAssembly wrapper — all video processing runs in the browser,
// so footage never leaves the device.
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import type { TimelineSegment } from "./types";
import { transitionByType, COLOR_GRADES } from "./transitions";

// FFmpeg WASM may return views over SharedArrayBuffer; copy into a plain
// ArrayBuffer so Blob accepts it.
function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(u8.byteLength);
  new Uint8Array(buf).set(u8);
  return buf;
}

let ffmpeg: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;

export async function getFFmpeg(onProgress?: (p: number) => void): Promise<FFmpeg> {
  if (ffmpeg?.loaded) return ffmpeg;
  if (loading) return loading;

  loading = (async () => {
    const instance = new FFmpeg();
    if (onProgress) {
      instance.on("progress", ({ progress }) => onProgress(Math.min(1, progress)));
    }
    // Serve core from our own origin (copied into /public/ffmpeg at build)
    const base = "/ffmpeg";
    await instance.load({
      coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
    });
    ffmpeg = instance;
    return instance;
  })();
  return loading;
}

// Extract N evenly spaced JPEG frames for AI/heuristic analysis
export async function extractFrames(video: Blob, count = 16): Promise<Blob[]> {
  const ff = await getFFmpeg();
  await ff.writeFile("in.mp4", await fetchFile(video));
  const duration = await probeDuration(video);
  const interval = Math.max(0.2, duration / count);
  await ff.exec([
    "-i", "in.mp4",
    "-vf", `fps=1/${interval.toFixed(3)},scale=320:-2`,
    "-q:v", "5",
    "frame_%03d.jpg",
  ]);
  const frames: Blob[] = [];
  for (let i = 1; i <= count + 2; i++) {
    const name = `frame_${String(i).padStart(3, "0")}.jpg`;
    try {
      const data = await ff.readFile(name);
      frames.push(new Blob([toArrayBuffer(data as Uint8Array)], { type: "image/jpeg" }));
      await ff.deleteFile(name);
    } catch {
      break;
    }
  }
  await ff.deleteFile("in.mp4").catch(() => {});
  return frames;
}

// Fast duration probe using a <video> element (no ffmpeg needed)
export function probeDuration(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(v.duration);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read video metadata"));
    };
    v.src = url;
  });
}

// Generate a poster thumbnail (data URL) from a video blob
export function makeThumbnail(blob: Blob, at = 0.5): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    v.onloadeddata = () => {
      v.currentTime = Math.min(at, v.duration / 2);
    };
    v.onseeked = () => {
      const c = document.createElement("canvas");
      const scale = 240 / v.videoWidth;
      c.width = 240;
      c.height = Math.round(v.videoHeight * scale);
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.7));
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("thumbnail failed"));
    };
    v.src = url;
  });
}

// Detect cuts client-side by comparing downscaled frame histograms.
// This is the no-API-key fallback analyzer and it genuinely works:
// hard cuts and flashes show up as large inter-frame differences.
export async function detectCutsHeuristic(
  video: Blob,
  onProgress?: (pct: number, msg: string) => void
): Promise<{ time: number; delta: number; brightness: number }[]> {
  const duration = await probeDuration(video);
  const url = URL.createObjectURL(video);
  const v = document.createElement("video");
  v.preload = "auto";
  v.muted = true;
  v.src = url;
  await new Promise<void>((res, rej) => {
    v.onloadeddata = () => res();
    v.onerror = () => rej(new Error("video load failed"));
  });

  const W = 64, H = 64;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  const step = Math.max(0.1, Math.min(0.2, duration / 150)); // ~5-10 samples/sec
  let prev: Uint8ClampedArray | null = null;
  const results: { time: number; delta: number; brightness: number }[] = [];

  for (let t = 0; t < duration; t += step) {
    await new Promise<void>((res) => {
      v.onseeked = () => res();
      v.currentTime = t;
    });
    ctx.drawImage(v, 0, 0, W, H);
    const { data } = ctx.getImageData(0, 0, W, H);
    let brightness = 0;
    for (let i = 0; i < data.length; i += 4) brightness += data[i] + data[i + 1] + data[i + 2];
    brightness /= (data.length / 4) * 3 * 255;

    if (prev) {
      let delta = 0;
      for (let i = 0; i < data.length; i += 16) delta += Math.abs(data[i] - prev[i]);
      delta /= data.length / 16;
      results.push({ time: t, delta: delta / 255, brightness });
    }
    prev = data.slice();
    onProgress?.(Math.round((t / duration) * 100), `Scanning ${t.toFixed(1)}s / ${duration.toFixed(1)}s`);
  }
  URL.revokeObjectURL(url);
  return results;
}

// Render the final edit: trim each segment, apply speed + color grade,
// then chain xfade transitions between consecutive segments.
export async function renderEdit(
  clips: Map<string, Blob>,
  segments: TimelineSegment[],
  colorGrade: string,
  onProgress?: (pct: number, msg: string) => void
): Promise<Blob> {
  const ff = await getFFmpeg();
  const gradeFilter = COLOR_GRADES[colorGrade]?.filter ?? "";

  // 1. Write + normalize every segment to 720x1280 (9:16) so xfade works
  const segFiles: { file: string; duration: number }[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const blob = clips.get(seg.clipId);
    if (!blob) throw new Error(`Missing clip ${seg.clipId}`);
    onProgress?.(Math.round((i / segments.length) * 50), `Preparing clip ${i + 1}/${segments.length}`);

    await ff.writeFile(`src_${i}.mp4`, await fetchFile(blob));
    const speedFilter = seg.speed !== 1 ? `setpts=${(1 / seg.speed).toFixed(4)}*PTS,` : "";
    const vf = [
      `trim=start=${seg.start}:end=${seg.end}`,
      "setpts=PTS-STARTPTS",
      speedFilter.replace(/,$/, ""),
      "scale=720:1280:force_original_aspect_ratio=increase",
      "crop=720:1280",
      "fps=30",
      gradeFilter,
      "format=yuv420p",
    ].filter(Boolean).join(",");

    await ff.exec(["-i", `src_${i}.mp4`, "-vf", vf, "-an", "-preset", "ultrafast", `seg_${i}.mp4`]);
    await ff.deleteFile(`src_${i}.mp4`);
    const outDur = (seg.end - seg.start) / seg.speed;
    segFiles.push({ file: `seg_${i}.mp4`, duration: outDur });
  }

  if (segFiles.length === 1) {
    const data = await ff.readFile(segFiles[0].file);
    return new Blob([toArrayBuffer(data as Uint8Array)], { type: "video/mp4" });
  }

  // 2. Chain xfades left-to-right
  onProgress?.(60, "Blending transitions…");
  let current = segFiles[0].file;
  let currentDur = segFiles[0].duration;
  for (let i = 1; i < segFiles.length; i++) {
    const recipe = transitionByType(segments[i - 1].transitionAfter ?? "hard-cut");
    const out = `mix_${i}.mp4`;
    if (!recipe.xfade || recipe.defaultDuration === 0) {
      // hard cut: concat demuxer
      await ff.writeFile("list.txt", `file '${current}'\nfile '${segFiles[i].file}'\n`);
      await ff.exec(["-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", out]);
      currentDur = currentDur + segFiles[i].duration;
    } else {
      const d = Math.min(recipe.defaultDuration, currentDur - 0.05, segFiles[i].duration - 0.05);
      const offset = Math.max(0, currentDur - d);
      await ff.exec([
        "-i", current, "-i", segFiles[i].file,
        "-filter_complex",
        `[0:v][1:v]xfade=transition=${recipe.xfade}:duration=${d.toFixed(2)}:offset=${offset.toFixed(2)},format=yuv420p[v]`,
        "-map", "[v]", "-preset", "ultrafast", out,
      ]);
      currentDur = currentDur + segFiles[i].duration - d;
    }
    if (current !== segFiles[0].file) await ff.deleteFile(current).catch(() => {});
    current = out;
    onProgress?.(60 + Math.round((i / (segFiles.length - 1)) * 35), `Transition ${i}/${segFiles.length - 1}`);
  }

  onProgress?.(97, "Finalizing…");
  const data = await ff.readFile(current);
  // cleanup
  for (const s of segFiles) await ff.deleteFile(s.file).catch(() => {});
  await ff.deleteFile(current).catch(() => {});
  return new Blob([toArrayBuffer(data as Uint8Array)], { type: "video/mp4" });
}
