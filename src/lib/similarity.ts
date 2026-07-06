// Visual clip search — pure core, Node-testable. Lets the user search their
// own library without scrubbing: "find shots like this one" plus attribute
// filters (bright / dark / colorful / high-action). The signature is a
// compact hand-rolled embedding — a 3×3 spatial color layout + a luma
// histogram + motion stat — deliberately model-free so it runs instantly
// and offline on every device. The browser glue samples the frames.

export interface ClipSignature {
  clipId: string;
  // 9 cells × RGB mean (0..1) = 27 dims of spatial color layout
  layout: number[];
  // 8-bin luma histogram, normalized
  luma: number[];
  avgMotion: number; // from clip analysis
  avgSaturation: number;
}

// Build a signature from one RGBA frame sampled on a 3×3 grid (callers may
// average several frames' signatures for stability).
export function frameSignature(data: Uint8ClampedArray | number[], w: number, h: number): Omit<ClipSignature, "clipId" | "avgMotion"> {
  const layout = new Array(27).fill(0);
  const counts = new Array(9).fill(0);
  const luma = new Array(8).fill(0);
  let satSum = 0;
  const total = w * h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const r = data[p] / 255;
      const g = data[p + 1] / 255;
      const b = data[p + 2] / 255;
      const cell = Math.min(2, Math.floor((y * 3) / h)) * 3 + Math.min(2, Math.floor((x * 3) / w));
      layout[cell * 3] += r;
      layout[cell * 3 + 1] += g;
      layout[cell * 3 + 2] += b;
      counts[cell]++;
      const yv = 0.299 * r + 0.587 * g + 0.114 * b;
      luma[Math.min(7, Math.floor(yv * 8))]++;
      satSum += Math.max(r, g, b) - Math.min(r, g, b);
    }
  }
  for (let c = 0; c < 9; c++) {
    const n = Math.max(1, counts[c]);
    layout[c * 3] /= n;
    layout[c * 3 + 1] /= n;
    layout[c * 3 + 2] /= n;
  }
  return {
    layout: layout.map((v) => Number(v.toFixed(4))),
    luma: luma.map((v) => Number((v / total).toFixed(4))),
    avgSaturation: Number((satSum / total).toFixed(4)),
  };
}

export function averageSignatures(sigs: Omit<ClipSignature, "clipId" | "avgMotion">[]): Omit<ClipSignature, "clipId" | "avgMotion"> {
  if (sigs.length === 0) return { layout: new Array(27).fill(0), luma: new Array(8).fill(0), avgSaturation: 0 };
  const avg = (get: (s: (typeof sigs)[0]) => number[]) =>
    get(sigs[0]).map((_, i) => Number((sigs.reduce((sum, s) => sum + get(s)[i], 0) / sigs.length).toFixed(4)));
  return {
    layout: avg((s) => s.layout),
    luma: avg((s) => s.luma),
    avgSaturation: Number((sigs.reduce((s, x) => s + x.avgSaturation, 0) / sigs.length).toFixed(4)),
  };
}

// Cosine-ish similarity across the concatenated feature vector, 0..1.
export function signatureSimilarity(a: ClipSignature, b: ClipSignature): number {
  const va = [...a.layout, ...a.luma, a.avgSaturation * 2, a.avgMotion * 2];
  const vb = [...b.layout, ...b.luma, b.avgSaturation * 2, b.avgMotion * 2];
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < va.length; i++) {
    dot += va[i] * vb[i];
    na += va[i] ** 2;
    nb += vb[i] ** 2;
  }
  if (na === 0 || nb === 0) return 0;
  return Number((dot / Math.sqrt(na * nb)).toFixed(4));
}

export function findSimilar(query: ClipSignature, library: ClipSignature[], count = 5): { clipId: string; similarity: number }[] {
  return library
    .filter((s) => s.clipId !== query.clipId)
    .map((s) => ({ clipId: s.clipId, similarity: signatureSimilarity(query, s) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, count);
}

// Attribute search: plain-word filters computed from the same signature.
export type ClipAttribute = "bright" | "dark" | "colorful" | "muted" | "high-action" | "calm";

export function matchesAttribute(s: ClipSignature, attr: ClipAttribute): boolean {
  const meanLuma = s.luma.reduce((sum, v, i) => sum + v * (i + 0.5), 0) / 8;
  switch (attr) {
    case "bright": return meanLuma > 0.55;
    case "dark": return meanLuma < 0.35;
    case "colorful": return s.avgSaturation > 0.18;
    case "muted": return s.avgSaturation <= 0.1;
    case "high-action": return s.avgMotion > 0.08;
    case "calm": return s.avgMotion <= 0.035;
  }
}

export function searchByAttributes(library: ClipSignature[], attrs: ClipAttribute[]): string[] {
  return library.filter((s) => attrs.every((a) => matchesAttribute(s, a))).map((s) => s.clipId);
}
