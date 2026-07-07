// Compositing + look filter builders — pure strings, Node-testable (no DOM,
// no imports beyond the pure expression compiler). These convert render
// intents into the exact FFmpeg filter graphs the WASM core runs, and are
// unit-tested + WASM-probed the same way track-core/chroma are.
//
//   • blurFillFilter    — "content-aware" letterbox fill: bars become a
//                          blurred, scaled copy of the shot (the standard
//                          social look) instead of dead black
//   • beautyFilter      — gentle skin smoothing (no model — light smartblur)
//   • portraitBlurFilter— fake depth-of-field: sharp centered subject over a
//                          blurred background copy
//   • freezeFrameFilter — hold a chosen frame for N seconds (call-out beat)
//   • privacyBlurComplex— blur a moving box that follows a tracked face
//   • splitStackComplex — 2-up split screen (vertical or horizontal stack)
//   • pipComplex        — picture-in-picture reaction overlay
import { piecewiseExpr, reduceKeyframes, type TrackPath } from "./track-core";

// ---- single-filter builders (drop into a -vf chain) ---------------------------

// Blurred-background fill so a non-9:16 source fills the frame with a
// defocused copy of itself rather than black bars. Emitted as a
// filter_complex fragment producing [v]; callers map [v].
export function blurFillComplex(coreChain: string, post = "", size = { w: 720, h: 1280 }, sigma = 20): string {
  const p = post ? `,${post}` : "";
  return (
    `[0:v]${coreChain},split[fbg][ffg];` +
    `[fbg]scale=${size.w}:${size.h}:force_original_aspect_ratio=increase,crop=${size.w}:${size.h},gblur=sigma=${sigma}[bg];` +
    `[ffg]scale=${size.w}:${size.h}:force_original_aspect_ratio=decrease[fg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1${p}[v]`
  );
}

// Skin-smoothing: smartblur only touches low-contrast areas (skin), leaving
// edges (eyes, hair, outlines) crisp — a tasteful beauty pass, no model.
export function beautyFilter(strength = 0.5): string {
  const s = Math.max(0.1, Math.min(1, strength));
  const lr = (1.5 + s * 2.5).toFixed(2); // luma radius 1.5..4
  const ls = (-0.25 - s * 0.35).toFixed(2); // negative luma strength = smooth
  return `smartblur=lr=${lr}:ls=${ls}:lt=-6`;
}

// Fake depth-of-field: a blurred copy of the frame with a sharp, feathered
// oval kept over the subject. cx/cy are 0..1 subject centers. Emitted as a
// filter_complex fragment producing [v].
export function portraitBlurComplex(
  cx: number,
  cy: number,
  coreChain: string,
  post = "",
  size = { w: 720, h: 1280 },
  sigma = 14
): string {
  const p = post ? `,${post}` : "";
  const px = Math.round(Math.max(0, Math.min(1, cx)) * size.w);
  const py = Math.round(Math.max(0, Math.min(1, cy)) * size.h);
  const rx = Math.round(size.w * 0.42);
  const ry = Math.round(size.h * 0.32);
  // geq builds a soft radial alpha mask centered on the subject; the sharp
  // copy carries that alpha and is overlaid on the blurred copy.
  return (
    `[0:v]${coreChain},split[pbg][pfg];` +
    `[pbg]gblur=sigma=${sigma}[bg];` +
    `[pfg]format=yuva420p,geq=lum='p(X,Y)':a='255*(1-min(1,(pow((X-${px})/${rx}\\,2)+pow((Y-${py})/${ry}\\,2))))'[fg];` +
    `[bg][fg]overlay=0:0:shortest=1${p}[v]`
  );
}

// Hold the frame at `atSec` (source time) for `holdSec`, then continue.
// Implemented as trim halves + a looped single frame between them.
export function freezeFrameChain(atSec: number, holdSec: number): { pre: string; complex: string } {
  const at = Math.max(0, atSec).toFixed(3);
  const hold = Math.max(0.3, holdSec).toFixed(2);
  // [0:v] split into: before (0..at), the frozen frame (loop), after (at..end)
  const complex =
    `[0:v]split=3[a][b][c];` +
    `[a]trim=start=0:end=${at},setpts=PTS-STARTPTS[pa];` +
    `[b]trim=start=${at}:end=${(atSec + 0.04).toFixed(3)},setpts=PTS-STARTPTS,` +
    `tpad=stop_mode=clone:stop_duration=${hold},trim=end=${hold},setpts=PTS-STARTPTS[pb];` +
    `[c]trim=start=${at},setpts=PTS-STARTPTS[pc];` +
    `[pa][pb][pc]concat=n=3:v=1:a=0[v]`;
  return { pre: "", complex };
}

// Privacy blur: a moving, blurred box that follows a tracked face. The box
// position animates via the same piecewise expressions the follow-crop uses.
// Emitted as a filter_complex fragment producing [v].
export function privacyBlurComplex(
  path: TrackPath,
  seg: { start: number; end: number; speed: number },
  size = { w: 720, h: 1280 },
  opts: { pad?: number; sigma?: number } = {}
): string {
  const pad = opts.pad ?? 1.6; // enlarge the box vs the raw face bbox
  const sigma = opts.sigma ?? 16;
  // keyframes in-window
  const t: number[] = [], xs: number[] = [], ys: number[] = [], szs: number[] = [];
  for (let i = 0; i < path.times.length; i++) {
    if (path.times[i] >= seg.start - 0.5 && path.times[i] <= seg.end + 0.5) {
      t.push(path.times[i]);
      xs.push(path.cx[i]);
      ys.push(path.cy[i]);
      szs.push(path.size[i]);
    }
  }
  if (t.length === 0) return "";
  const medSize = [...szs].sort((a, b) => a - b)[Math.floor(szs.length / 2)] || 0.25;
  const bw = Math.round(Math.max(48, Math.min(size.w, medSize * pad * size.w)));
  const bh = Math.round(Math.max(48, Math.min(size.h, medSize * pad * size.h)));
  const rx = reduceKeyframes(t, xs, 10, 0.01);
  const ry = reduceKeyframes(t, ys, 10, 0.01);
  const cxE = piecewiseExpr(rx.times, rx.values, seg.start, seg.speed);
  const cyE = piecewiseExpr(ry.times, ry.values, seg.start, seg.speed);
  // top-left of the box, clamped to the frame
  const xE = `max(0\\,min(${size.w - bw}\\,(${cxE})*${size.w}-${bw / 2}))`;
  const yE = `max(0\\,min(${size.h - bh}\\,(${cyE})*${size.h}-${bh / 2}))`;
  return (
    `[0:v]split[pvbase][pvreg];` +
    `[pvreg]crop=${bw}:${bh}:x='${xE}':y='${yE}',gblur=sigma=${sigma}[blur];` +
    `[pvbase][blur]overlay=x='${xE}':y='${yE}':shortest=1[v]`
  );
}

// 2-up split screen. `dir` "v" stacks top/bottom (two 9:16 halves), "h"
// side-by-side. Each input is scaled+cropped to its cell. filter_complex
// over inputs [0:v] and [1:v] → [v].
export function splitStackComplex(dir: "v" | "h", size = { w: 720, h: 1280 }): string {
  if (dir === "h") {
    const cw = Math.round(size.w / 2);
    const cell = `scale=${cw}:${size.h}:force_original_aspect_ratio=increase,crop=${cw}:${size.h},setsar=1`;
    return `[0:v]${cell}[l];[1:v]${cell}[r];[l][r]hstack=inputs=2,fps=30,format=yuv420p[v]`;
  }
  const ch = Math.round(size.h / 2);
  const cell = `scale=${size.w}:${ch}:force_original_aspect_ratio=increase,crop=${size.w}:${ch},setsar=1`;
  return `[0:v]${cell}[t];[1:v]${cell}[b];[t][b]vstack=inputs=2,fps=30,format=yuv420p[v]`;
}

// Picture-in-picture: [1:v] shrunk into a corner of [0:v]. corner is one of
// tl/tr/bl/br; scale is the PiP width as a fraction of frame width.
export function pipComplex(
  corner: "tl" | "tr" | "bl" | "br",
  scale = 0.32,
  size = { w: 720, h: 1280 },
  margin = 24
): string {
  const pw = Math.round(size.w * Math.max(0.15, Math.min(0.6, scale)));
  const m = margin;
  const x = corner === "tl" || corner === "bl" ? `${m}` : `W-w-${m}`;
  const y = corner === "tl" || corner === "tr" ? `${m}` : `H-h-${m}`;
  return (
    `[0:v]scale=${size.w}:${size.h}:force_original_aspect_ratio=increase,crop=${size.w}:${size.h},setsar=1[main];` +
    `[1:v]scale=${pw}:-1,setsar=1[pip];` +
    `[main][pip]overlay=${x}:${y}:shortest=1,fps=30,format=yuv420p[v]`
  );
}
