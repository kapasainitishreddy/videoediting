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
import { trackCropFilter, facePunchFilter, type TrackPath } from "./track-core";
import { chromaComplex, chromaImageBgComplex, type ChromaSettings } from "./chroma";

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
  trackByClip?: Map<string, TrackPath>; // face/action lock — animated follow crop
  chromaByClip?: Map<string, ChromaSettings>; // green-screen key + background
  punchBySegment?: Map<string, { cx: number; cy: number }>; // face punch-in target
  chromaBgImages?: Map<string, Blob>; // "vset:*" background plates, keyed by bg id
  lookBySegment?: Map<string, string>; // per-segment grade override (adjustment sections)
  // Draft mode: 360×640, higher CRF, and the slow overscan filters (zoompan
  // punch-ins / Ken Burns) plus caption/atmosphere passes are skipped — a
  // fast cut preview, not the final picture.
  draft?: boolean;
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
  const draft = opts.draft ?? false;
  const OW = draft ? 360 : 720;
  const OH = draft ? 640 : 1280;
  const CRF = draft ? "32" : "26";

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
    // face punch-in beats the generic motion effect for this segment
    const punch = opts.punchBySegment?.get(seg.id);
    let m = punch && !draft ? facePunchFilter(punch, segDur) : motionFilter(effect, segDur);
    // draft renders skip the overscan filters (zoompan is the slowest thing
    // in WASM) — the point of a draft is checking the CUT, fast
    if (draft && m.needsOverscan) m = motionFilter("none", segDur);
    // face/action lock (animated follow crop) wins over the static reframe
    const track = opts.trackByClip?.get(seg.clipId);
    const trackCrop = track ? trackCropFilter(track, { start: seg.start, end: seg.end, speed: seg.speed }) : "";
    const reframe = trackCrop || (opts.reframeByClip?.get(seg.clipId) ?? "");
    const normalize = opts.normalizeByClip?.get(seg.clipId) ?? "";
    // per-segment grade override (section looks) wins over the global look
    const segGrade = opts.lookBySegment?.get(seg.id);
    const segLookFilter = segGrade
      ? buildLookFilter({ ...look, grade: segGrade }, COLOR_GRADES[segGrade]?.filter ?? "")
      : lookFilter;
    const scaling = m.needsOverscan
      ? [m.pre, m.post]
      : [m.pre, `scale=${OW}:${OH}:force_original_aspect_ratio=increase`, `crop=${OW}:${OH}`];
    const chroma = opts.chromaByClip?.get(seg.clipId);
    if (chroma) {
      // keyed clip: composite person over the background, THEN grade
      const coreChain = [
        `trim=start=${seg.start}:end=${seg.end}`,
        "setpts=PTS-STARTPTS",
        speedFilter,
        reframe,
        ...scaling,
        "fps=30",
      ].filter(Boolean).join(",");
      const postChain = [normalize, segLookFilter, "format=yuv420p"].filter(Boolean).join(",");
      const vsetImage = chroma.bg.startsWith("vset:") ? opts.chromaBgImages?.get(chroma.bg) : undefined;
      if (vsetImage) {
        // virtual set: the still plate is input [1:v], looped behind the key
        await ff.writeFile(`vset_${i}.png`, await fetchFile(vsetImage));
        const fc = chromaImageBgComplex(chroma, coreChain, postChain, { w: OW, h: OH });
        await ff.exec([
          "-i", `src_${i}.mp4`,
          "-loop", "1", "-i", `vset_${i}.png`,
          "-filter_complex", fc,
          "-map", "[v]", "-an", "-preset", "ultrafast", "-crf", CRF, `seg_${i}.mp4`,
        ]);
        await ff.deleteFile(`vset_${i}.png`).catch(() => {});
      } else {
        const fc = chromaComplex(chroma, coreChain, postChain, segDur, { w: OW, h: OH });
        await ff.exec([
          "-i", `src_${i}.mp4`,
          "-filter_complex", fc,
          "-map", "[v]", "-an", "-preset", "ultrafast", "-crf", CRF, `seg_${i}.mp4`,
        ]);
      }
    } else {
      const vf = [
        `trim=start=${seg.start}:end=${seg.end}`,
        "setpts=PTS-STARTPTS",
        speedFilter,
        reframe,
        ...scaling,
        "fps=30",
        normalize,
        segLookFilter,
        "format=yuv420p",
      ].filter(Boolean).join(",");

      await ff.exec(["-i", `src_${i}.mp4`, "-vf", vf, "-an", "-preset", "ultrafast", "-crf", CRF, `seg_${i}.mp4`]);
    }
    await ff.deleteFile(`src_${i}.mp4`);
    const outDur = (seg.end - seg.start) / seg.speed;
    segFiles.push({ file: `seg_${i}.mp4`, duration: outDur });
  }

  if (segFiles.length === 1) {
    return finalize(ff, segFiles[0].file, music, draft ? undefined : captions, draft ? undefined : opts.overlay, onProgress);
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
  return finalize(ff, current, music, draft ? undefined : captions, draft ? undefined : opts.overlay, onProgress);
}

// Remove a watermark / logo from a clip: the user draws a box, FFmpeg's
// delogo interpolates the region away from its surroundings. Region is
// normalized 0..1 in source coordinates; a new clip blob comes back.
export async function removeWatermark(
  video: Blob,
  region: { x: number; y: number; w: number; h: number },
  srcSize: { w: number; h: number },
  onProgress?: (p: number) => void
): Promise<Blob> {
  const ff = await getFFmpeg(onProgress);
  await ff.writeFile("wm_in.mp4", await fetchFile(video));
  // delogo needs ≥1px of frame border around the box
  const px = (v: number, span: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(hi, v * span)));
  const x = px(region.x, srcSize.w, 1, srcSize.w - 4);
  const y = px(region.y, srcSize.h, 1, srcSize.h - 4);
  const w = px(region.w, srcSize.w, 4, srcSize.w - x - 1);
  const h = px(region.h, srcSize.h, 4, srcSize.h - y - 1);
  const code = await ff.exec([
    "-i", "wm_in.mp4",
    "-vf", `delogo=x=${x}:y=${y}:w=${w}:h=${h}`,
    "-preset", "ultrafast", "-crf", "23", "-c:a", "copy", "-y", "wm_out.mp4",
  ]);
  await ff.deleteFile("wm_in.mp4").catch(() => {});
  if (code !== 0) throw new Error("Watermark removal failed on this clip");
  const data = await ff.readFile("wm_out.mp4");
  await ff.deleteFile("wm_out.mp4").catch(() => {});
  return new Blob([toArrayBuffer(data as Uint8Array)], { type: "video/mp4" });
}

// Apply an imported .cube LUT to a clip via the WASM core's lut3d filter.
// Returns null (not an error) if this build lacks lut3d — the caller falls
// back to canvas preview and says so.
export async function applyCubeToClip(video: Blob, cubeText: string): Promise<Blob | null> {
  const ff = await getFFmpeg();
  await ff.writeFile("lut_in.mp4", await fetchFile(video));
  await ff.writeFile("user.cube", new TextEncoder().encode(cubeText));
  const code = await ff.exec([
    "-i", "lut_in.mp4",
    "-vf", "lut3d=user.cube",
    "-preset", "ultrafast", "-crf", "23", "-c:a", "copy", "-y", "lut_out.mp4",
  ]);
  await ff.deleteFile("lut_in.mp4").catch(() => {});
  await ff.deleteFile("user.cube").catch(() => {});
  if (code !== 0) return null;
  const data = await ff.readFile("lut_out.mp4");
  await ff.deleteFile("lut_out.mp4").catch(() => {});
  return new Blob([toArrayBuffer(data as Uint8Array)], { type: "video/mp4" });
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
