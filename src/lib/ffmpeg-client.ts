"use client";

// FFmpeg WebAssembly wrapper — all video processing runs in the browser,
// so footage never leaves the device.
//
// The @ffmpeg/ffmpeg library is loaded UNBUNDLED from /public/ffmpeg/lib
// (copied there by scripts/copy-ffmpeg-core.js). Bundlers rewrite the
// dynamic import() inside its worker ("expression is too dynamic" under
// Turbopack), which breaks FFmpeg loading entirely — native ESM loading
// sidesteps the bundler for the worker chain.
import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import type { TimelineSegment } from "./types";
import { transitionByType, COLOR_GRADES } from "./transitions";
import { buildLookFilter, DEFAULT_LOOK, type LookConfig } from "./cinematic";
import { motionFilter, type MotionEffect } from "./motion";

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
    const libUrl = `${window.location.origin}/ffmpeg/lib/index.js`;
    const mod = (await import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ libUrl
    )) as typeof import("@ffmpeg/ffmpeg");
    const instance = new mod.FFmpeg();
    if (onProgress) {
      instance.on("progress", ({ progress }) => onProgress(Math.min(1, progress)));
    }
    await instance.load({
      coreURL: `${window.location.origin}/ffmpeg/ffmpeg-core.js`,
      wasmURL: `${window.location.origin}/ffmpeg/ffmpeg-core.wasm`,
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

// Fast duration probe using a <video> element (no ffmpeg needed).
// MediaRecorder-produced WebM reports Infinity until you seek far past the
// end (Chrome quirk) — handle that so in-browser recordings work too.
export function probeDuration(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement("video");
    v.preload = "metadata";
    const done = (d: number) => {
      URL.revokeObjectURL(url);
      resolve(d);
    };
    v.onloadedmetadata = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) {
        done(v.duration);
        return;
      }
      // Infinity-duration workaround: seek to an absurd time; the browser
      // clamps to the real end and duration becomes finite.
      v.onseeked = () => done(Number.isFinite(v.duration) ? v.duration : v.currentTime);
      v.currentTime = 1e7;
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

// Render the final edit: trim each segment, apply speed + color grade,
// then chain xfade transitions between consecutive segments.
export interface BurnCaption {
  png: Blob;
  start: number;
  end: number;
}

export interface RenderOptions {
  colorGrade?: string; // legacy simple grade key
  look?: LookConfig; // full cinematic look (wins over colorGrade extras)
  motionDefault?: MotionEffect; // applied to every segment
  motionBySegment?: Map<string, MotionEffect>; // per-segment override
  normalizeByClip?: Map<string, string>; // per-clip WB/exposure filter
  reframeByClip?: Map<string, string>; // per-clip subject-crop filter
  music?: Blob;
  captions?: BurnCaption[]; // captions, titles, lower thirds, credits, kinetic
  overlay?: { blob: Blob; opacity: number }; // atmosphere layer (blend=screen)
  onProgress?: (pct: number, msg: string) => void;
}

export async function renderEdit(
  clips: Map<string, Blob>,
  segments: TimelineSegment[],
  optsOrGrade: RenderOptions | string,
  onProgressLegacy?: (pct: number, msg: string) => void,
  musicLegacy?: Blob,
  captionsLegacy?: BurnCaption[]
): Promise<Blob> {
  const opts: RenderOptions =
    typeof optsOrGrade === "string"
      ? { colorGrade: optsOrGrade, onProgress: onProgressLegacy, music: musicLegacy, captions: captionsLegacy }
      : optsOrGrade;
  const onProgress = opts.onProgress;
  const music = opts.music;
  const captions = opts.captions;
  const look = opts.look ?? { ...DEFAULT_LOOK, grade: opts.colorGrade ?? "none" };

  const ff = await getFFmpeg();
  const gradeFilter = COLOR_GRADES[look.grade]?.filter ?? COLOR_GRADES[opts.colorGrade ?? ""]?.filter ?? "";
  const lookFilter = buildLookFilter(look, gradeFilter);

  // 1. Write + normalize every segment to 720x1280 (9:16) so xfade works
  const segFiles: { file: string; duration: number }[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const blob = clips.get(seg.clipId);
    if (!blob) throw new Error(`Missing clip ${seg.clipId}`);
    onProgress?.(Math.round((i / segments.length) * 50), `Preparing clip ${i + 1}/${segments.length}`);

    await ff.writeFile(`src_${i}.mp4`, await fetchFile(blob));
    const speedFilter = seg.speed !== 1 ? `setpts=${(1 / seg.speed).toFixed(4)}*PTS` : "";
    const segDur = (seg.end - seg.start) / seg.speed;
    const effect = opts.motionBySegment?.get(seg.id) ?? opts.motionDefault ?? "none";
    const m = motionFilter(effect, segDur);
    const reframe = opts.reframeByClip?.get(seg.clipId) ?? "";
    const normalize = opts.normalizeByClip?.get(seg.clipId) ?? "";
    const scaling = m.needsOverscan
      ? [m.pre, m.post]
      : [m.pre, "scale=720:1280:force_original_aspect_ratio=increase", "crop=720:1280"];
    const vf = [
      `trim=start=${seg.start}:end=${seg.end}`,
      "setpts=PTS-STARTPTS",
      speedFilter,
      reframe,
      ...scaling,
      "fps=30",
      normalize,
      lookFilter,
      "format=yuv420p",
    ].filter(Boolean).join(",");

    await ff.exec(["-i", `src_${i}.mp4`, "-vf", vf, "-an", "-preset", "ultrafast", "-crf", "26", `seg_${i}.mp4`]);
    await ff.deleteFile(`src_${i}.mp4`);
    const outDur = (seg.end - seg.start) / seg.speed;
    segFiles.push({ file: `seg_${i}.mp4`, duration: outDur });
  }

  if (segFiles.length === 1) {
    return finalize(ff, segFiles[0].file, music, captions, opts.overlay, onProgress);
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

  for (const s of segFiles) await ff.deleteFile(s.file).catch(() => {});
  return finalize(ff, current, music, captions, opts.overlay, onProgress);
}

// Composite atmosphere overlay, burn caption PNGs, lay music under the cut.
async function finalize(
  ff: FFmpeg,
  videoFile: string,
  music: Blob | undefined,
  captions: BurnCaption[] | undefined,
  atmosphere: { blob: Blob; opacity: number } | undefined,
  onProgress?: (pct: number, msg: string) => void
): Promise<Blob> {
  let out = videoFile;

  // Atmosphere layer first (under the text): blend=screen — black stays
  // transparent, particles/flares/leaks read as light.
  if (atmosphere) {
    onProgress?.(92, "Compositing atmosphere…");
    await ff.writeFile("atmo_in", await fetchFile(atmosphere.blob));
    const op = Math.max(0.05, Math.min(1, atmosphere.opacity));
    // No -stream_loop: looping MediaRecorder webm aborts the WASM instance.
    // Callers generate the overlay at least as long as the video; framesync's
    // repeatlast holds the final overlay frame if it runs short.
    const code = await ff.exec([
      "-i", out,
      "-i", "atmo_in",
      "-filter_complex",
      // blend must run on RGB planes: screen-mode math on YUV chroma shifts colors
      `[0:v]format=gbrp[base];[1:v]scale=720:1280,fps=30,format=gbrp[ov];[base][ov]blend=all_mode=screen:all_opacity=${op.toFixed(2)}:shortest=1,format=yuv420p[v]`,
      "-map", "[v]", "-preset", "ultrafast", "-y", "atmo_out.mp4",
    ]);
    await ff.deleteFile("atmo_in").catch(() => {});
    if (code === 0) {
      if (out !== videoFile) await ff.deleteFile(out).catch(() => {});
      out = "atmo_out.mp4";
    }
  }

  // Burn captions (over the atmosphere), before music is muxed in.
  if (captions && captions.length > 0) {
    onProgress?.(94, "Burning captions…");
    const inputs: string[] = ["-i", out];
    for (let i = 0; i < captions.length; i++) {
      await ff.writeFile(`cap_${i}.png`, await fetchFile(captions[i].png));
      inputs.push("-i", `cap_${i}.png`);
    }
    // chain: [0:v][1:v]overlay...enable[t1]; [t1][2:v]overlay...enable[t2]; …
    let label = "0:v";
    const steps: string[] = [];
    captions.forEach((c, i) => {
      const next = i === captions.length - 1 ? "vout" : `t${i}`;
      steps.push(
        `[${label}][${i + 1}:v]overlay=0:0:enable='between(t,${c.start.toFixed(2)},${c.end.toFixed(2)})'[${next}]`
      );
      label = next;
    });
    const capOut = "capped.mp4";
    const code = await ff.exec([
      ...inputs,
      "-filter_complex", steps.join(";"),
      "-map", "[vout]", "-preset", "ultrafast", "-y", capOut,
    ]);
    for (let i = 0; i < captions.length; i++) await ff.deleteFile(`cap_${i}.png`).catch(() => {});
    if (code === 0) {
      if (out !== videoFile) await ff.deleteFile(out).catch(() => {});
      out = capOut;
    }
  }

  if (music) {
    onProgress?.(96, "Adding music…");
    await ff.writeFile("music_in", await fetchFile(music));
    const code = await ff.exec([
      "-i", out, "-i", "music_in",
      "-map", "0:v", "-map", "1:a",
      "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
      "-shortest", "with_music.mp4",
    ]);
    if (code === 0) {
      if (out !== videoFile) await ff.deleteFile(out).catch(() => {});
      out = "with_music.mp4";
    }
    await ff.deleteFile("music_in").catch(() => {});
  }
  onProgress?.(98, "Finalizing…");
  const data = await ff.readFile(out);
  await ff.deleteFile(videoFile).catch(() => {});
  if (out !== videoFile) await ff.deleteFile(out).catch(() => {});
  return new Blob([toArrayBuffer(data as Uint8Array)], { type: "video/mp4" });
}
