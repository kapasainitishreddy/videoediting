// Chroma key core — green screen detection + FFmpeg filter builders.
// Pure (no browser APIs, no imports) so scripts/track-test.mjs unit-tests it
// under node. The render integration lives in ffmpeg-client.ts.

export interface ChromaSettings {
  color: string; // "#00ff00" key color
  similarity: number; // 0.05..0.45 — chromakey tolerance
  blend: number; // 0..0.3 — edge softness
  bg: "studio" | "blur" | string; // "studio" dark, "blur" bokeh, or "#rrggbb"
}

export const DEFAULT_CHROMA: Omit<ChromaSettings, "color"> = {
  similarity: 0.18,
  blend: 0.06,
  bg: "studio",
};

const STUDIO_BG = "#101014"; // matches the app's letterbox black

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

// FFmpeg wants 0xRRGGBB
export function hexToFFmpeg(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return "0x00ff00";
  return `0x${rgbToHex(rgb.r, rgb.g, rgb.b).slice(1)}`;
}

// ---------------------------------------------------------------------------
// Auto key-color detection.
// A real green/blue screen dominates the frame BORDER with one saturated
// hue. Sample the border ring of an RGBA frame; if ≥55% of it agrees on a
// saturated green or blue, that's the key. Returns null on normal footage —
// callers should not offer keying then.
// ---------------------------------------------------------------------------

export function detectKeyColor(
  data: Uint8ClampedArray | number[],
  w: number,
  h: number
): { color: string; coverage: number } | null {
  const ring = Math.max(1, Math.round(Math.min(w, h) * 0.08));
  const px: number[][] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= ring && x < w - ring && y >= ring && y < h - ring) continue;
      const p = (y * w + x) * 4;
      px.push([data[p], data[p + 1], data[p + 2]]);
    }
  }
  if (px.length === 0) return null;

  const isKeyish = ([r, g, b]: number[]) => {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max < 60 || max - min < 50) return null; // too dark / unsaturated
    if (g === max && g > r * 1.35 && g > b * 1.35) return "g";
    if (b === max && b > r * 1.35 && b > g * 1.35) return "b";
    return null;
  };

  let gCount = 0, bCount = 0;
  for (const p of px) {
    const k = isKeyish(p);
    if (k === "g") gCount++;
    else if (k === "b") bCount++;
  }
  const dominant = gCount >= bCount ? "g" : "b";
  const count = Math.max(gCount, bCount);
  const coverage = count / px.length;
  if (coverage < 0.55) return null;

  // average the matching border pixels for the exact key shade
  let sr = 0, sg = 0, sb = 0;
  for (const p of px) {
    if (isKeyish(p) === dominant) {
      sr += p[0];
      sg += p[1];
      sb += p[2];
    }
  }
  return {
    color: rgbToHex(sr / count, sg / count, sb / count),
    coverage: Number(coverage.toFixed(3)),
  };
}

// ---------------------------------------------------------------------------
// Filter builders.
// The keyed segment is rendered with -filter_complex instead of -vf:
//   [0:v] core chain (trim/speed/scale/crop/fps) → chromakey → [fg]
//   background (solid color source, or a blurred split of the clip) → [bg]
//   [bg][fg] overlay → post chain (normalize/look/format) → [v]
// chromakey runs AFTER scaling (keys the 720x1280 frame) and BEFORE the
// look, so grades touch the composite, not the alpha.
// ---------------------------------------------------------------------------

export function chromaKeyFilter(c: ChromaSettings): string {
  const sim = Math.max(0.03, Math.min(0.5, c.similarity)).toFixed(3);
  const blend = Math.max(0, Math.min(0.35, c.blend)).toFixed(3);
  return `chromakey=${hexToFFmpeg(c.color)}:${sim}:${blend}`;
}

export function chromaBgHex(c: ChromaSettings): string {
  if (c.bg === "studio") return STUDIO_BG;
  if (c.bg === "blur") return STUDIO_BG; // unused in blur mode
  return hexToRgb(c.bg) ? c.bg : STUDIO_BG;
}

// Assemble the whole per-segment filter_complex.
//  coreChain: trim,setpts,speed,(track|reframe),scale,crop,fps — NO look
//  postChain: normalize,look,format=yuv420p — applied to the composite
//  durSec: composite duration (color source needs an explicit duration)
export function chromaComplex(
  c: ChromaSettings,
  coreChain: string,
  postChain: string,
  durSec: number
): string {
  const key = chromaKeyFilter(c);
  const post = postChain ? `,${postChain}` : "";
  if (c.bg === "blur") {
    // bokeh background from the clip itself — split after the core chain
    return (
      `[0:v]${coreChain},split[cbg][cfg];` +
      `[cbg]boxblur=18:2,eq=brightness=-0.08[bg];` +
      `[cfg]${key}[fg];` +
      `[bg][fg]overlay=0:0:shortest=1${post}[v]`
    );
  }
  const bgHex = hexToFFmpeg(chromaBgHex(c));
  return (
    `color=c=${bgHex}:s=720x1280:r=30:d=${Math.max(0.2, durSec).toFixed(2)}[bg];` +
    `[0:v]${coreChain},${key}[fg];` +
    `[bg][fg]overlay=0:0:shortest=1${post}[v]`
  );
}
