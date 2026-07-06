// LUT engine — pure, Node-testable. Real colorist interop that mobile-first
// editors don't offer:
//   • parseCube()     — read an industry-standard .cube 3D LUT
//   • generateCube()  — bake a .cube from any JS color transform
//   • GRADE_TRANSFORMS — JS approximations of the app's signature grades, so
//     "Export this look as a LUT" hands the exact vibe to Premiere/Resolve
//   • applyLut()      — trilinear sample, used for canvas preview and tests
// Render-side: the WASM core's lut3d filter reads a .cube written to its FS
// (probed in /dev/subject before the UI advertises it).

export interface CubeLut {
  size: number;
  title: string;
  // flat RGB triples, r-fastest ordering per the .cube spec: index =
  // (b*size*size + g*size + r) * 3
  data: Float32Array;
}

export type ColorTransform = (r: number, g: number, b: number) => [number, number, number];

// --- parse -----------------------------------------------------------------------

export function parseCube(text: string): { ok: true; lut: CubeLut } | { ok: false; error: string } {
  let size = 0;
  let title = "Imported LUT";
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("TITLE")) {
      title = line.replace(/^TITLE\s*/, "").replace(/^"|"$/g, "").slice(0, 60) || title;
      continue;
    }
    if (line.startsWith("LUT_3D_SIZE")) {
      size = parseInt(line.split(/\s+/)[1] ?? "0", 10);
      continue;
    }
    if (line.startsWith("LUT_1D_SIZE")) return { ok: false, error: "1D LUTs aren't supported — export a 3D .cube." };
    if (/^(DOMAIN_MIN|DOMAIN_MAX|LUT_3D_INPUT_RANGE)/.test(line)) continue;
    const parts = line.split(/\s+/).map(Number);
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) values.push(...parts);
  }
  if (size < 2 || size > 129) return { ok: false, error: "Missing or invalid LUT_3D_SIZE." };
  if (values.length !== size * size * size * 3) {
    return { ok: false, error: `Expected ${size ** 3} entries, found ${values.length / 3}.` };
  }
  return { ok: true, lut: { size, title, data: Float32Array.from(values) } };
}

// --- generate ----------------------------------------------------------------------

export function generateCube(title: string, transform: ColorTransform, size = 17): string {
  const lines = [`TITLE "${title.replace(/"/g, "'").slice(0, 60)}"`, `LUT_3D_SIZE ${size}`, ""];
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const [or, og, ob] = transform(r / (size - 1), g / (size - 1), b / (size - 1));
        const c = (v: number) => Math.max(0, Math.min(1, v)).toFixed(6);
        lines.push(`${c(or)} ${c(og)} ${c(ob)}`);
      }
    }
  }
  return lines.join("\n") + "\n";
}

// --- apply (preview + tests) ---------------------------------------------------------

export function applyLut(lut: CubeLut, r: number, g: number, b: number): [number, number, number] {
  const n = lut.size - 1;
  const sample = (ri: number, gi: number, bi: number, ch: number) =>
    lut.data[(bi * lut.size * lut.size + gi * lut.size + ri) * 3 + ch];
  const fr = Math.max(0, Math.min(1, r)) * n;
  const fg = Math.max(0, Math.min(1, g)) * n;
  const fb = Math.max(0, Math.min(1, b)) * n;
  const r0 = Math.floor(fr), g0 = Math.floor(fg), b0 = Math.floor(fb);
  const r1 = Math.min(n, r0 + 1), g1 = Math.min(n, g0 + 1), b1 = Math.min(n, b0 + 1);
  const tr = fr - r0, tg = fg - g0, tb = fb - b0;
  const out: [number, number, number] = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    const c00 = sample(r0, g0, b0, ch) * (1 - tr) + sample(r1, g0, b0, ch) * tr;
    const c10 = sample(r0, g1, b0, ch) * (1 - tr) + sample(r1, g1, b0, ch) * tr;
    const c01 = sample(r0, g0, b1, ch) * (1 - tr) + sample(r1, g0, b1, ch) * tr;
    const c11 = sample(r0, g1, b1, ch) * (1 - tr) + sample(r1, g1, b1, ch) * tr;
    const c0 = c00 * (1 - tg) + c10 * tg;
    const c1 = c01 * (1 - tg) + c11 * tg;
    out[ch] = c0 * (1 - tb) + c1 * tb;
  }
  return out;
}

// --- signature-grade transforms -------------------------------------------------------
// JS approximations of the app's grades for LUT export. They intentionally
// mirror the FFmpeg chains' intent (warmth, lift, contrast), not their exact
// math — a LUT is a handoff of the look, and these land visibly on-brand.

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const contrast = (v: number, amt: number) => clamp01((v - 0.5) * amt + 0.5);
const lift = (v: number, amt: number) => clamp01(v * (1 - amt) + amt);

export const GRADE_TRANSFORMS: Record<string, { label: string; fn: ColorTransform }> = {
  warm: {
    label: "Warm",
    fn: (r, g, b) => [contrast(r * 1.06 + 0.02, 1.05), contrast(g * 1.01, 1.05), contrast(b * 0.94, 1.05)],
  },
  cool: {
    label: "Cool",
    fn: (r, g, b) => [contrast(r * 0.94, 1.05), contrast(g * 1.0, 1.05), contrast(b * 1.07 + 0.015, 1.05)],
  },
  "high-contrast": {
    label: "High Contrast",
    fn: (r, g, b) => [contrast(r, 1.3), contrast(g, 1.3), contrast(b, 1.3)],
  },
  vintage: {
    label: "Vintage",
    fn: (r, g, b) => [lift(contrast(r * 1.03, 0.92), 0.05), lift(contrast(g * 0.99, 0.92), 0.045), lift(contrast(b * 0.9, 0.92), 0.06)],
  },
  noir: {
    label: "Neo-Noir",
    fn: (r, g, b) => {
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      const c = contrast(y, 1.35);
      return [clamp01(c * 0.96), clamp01(c * 0.98), clamp01(c * 1.08 + 0.01)];
    },
  },
  golden: {
    label: "Golden Hour",
    fn: (r, g, b) => [clamp01(r * 1.1 + 0.03), clamp01(g * 1.02 + 0.01), clamp01(b * 0.85)],
  },
  a24: {
    label: "Indie Film",
    fn: (r, g, b) => [lift(contrast(r, 0.94), 0.03), lift(contrast(g * 1.015, 0.94), 0.035), lift(contrast(b * 1.01, 0.94), 0.04)],
  },
};

// Bake the .cube for a named grade — falls back to a neutral identity LUT so
// exporting never fails, it just does nothing for unknown grades.
export function gradeToCube(grade: string, size = 17): { filename: string; text: string } {
  const t = GRADE_TRANSFORMS[grade];
  const fn: ColorTransform = t?.fn ?? ((r, g, b) => [r, g, b]);
  const label = t?.label ?? "Neutral";
  return {
    filename: `viraledit-${grade || "neutral"}.cube`,
    text: generateCube(`ViralEdit ${label}`, fn, size),
  };
}
