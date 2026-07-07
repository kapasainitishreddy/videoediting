// Multi-cam sync + repeat-take detection — pure, Node-testable.
//   • crossCorrelate / alignByAudio — find the time offset that lines up two
//     recordings of the same moment by their audio energy envelopes (the
//     clap/laugh/word lands at the same instant on every mic). This is what
//     turns the speaker-cut feature from "assumes cameras started together"
//     into "auto-aligns them first".
//   • detectRepeatTakes — group clips that are near-duplicates (the same
//     take shot twice) from their visual signatures, so the editor can keep
//     the best and hide the rest.
import type { ClipSignature } from "./similarity";
import { signatureSimilarity } from "./similarity";

// --- audio alignment ---------------------------------------------------------------

// Downsample a waveform to a coarse RMS energy envelope at `hz` samples/sec.
// Alignment works on the envelope, not raw samples — robust to different
// mics/levels and cheap to correlate.
export function energyEnvelope(data: Float32Array | number[], sampleRate: number, hz = 100): number[] {
  const hop = Math.max(1, Math.floor(sampleRate / hz));
  const out: number[] = [];
  for (let i = 0; i + hop <= data.length; i += hop) {
    let e = 0;
    for (let k = 0; k < hop; k++) e += data[i + k] * data[i + k];
    out.push(Math.sqrt(e / hop));
  }
  // normalize so loud/quiet recordings correlate on shape, not level
  const max = Math.max(1e-9, ...out);
  return out.map((v) => v / max);
}

// Best integer lag (in envelope frames) of `b` relative to `a`, searched
// within ±maxLag. Positive lag = b starts later than a. Returns the lag and
// a 0..1 confidence (normalized correlation peak).
export function crossCorrelate(a: number[], b: number[], maxLag: number): { lag: number; score: number } {
  let best = { lag: 0, score: -Infinity };
  const norm = (arr: number[]) => Math.sqrt(arr.reduce((s, v) => s + v * v, 0)) || 1;
  const na = norm(a);
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let dot = 0;
    let count = 0;
    for (let i = 0; i < a.length; i++) {
      const j = i + lag;
      if (j < 0 || j >= b.length) continue;
      dot += a[i] * b[j];
      count++;
    }
    if (count < Math.min(a.length, b.length) * 0.3) continue; // too little overlap
    const score = dot / (na * (norm(b.slice(Math.max(0, lag), Math.max(0, lag) + a.length)) || 1));
    if (score > best.score) best = { lag, score };
  }
  return { lag: best.lag, score: Number(Math.max(0, best.score).toFixed(3)) };
}

export interface CamInput {
  clipId: string;
  data: Float32Array | number[];
  sampleRate: number;
}

// Align N recordings to the earliest one. Returns each clip's start offset
// in seconds (the amount to trim off its head so all clips share a clock),
// plus a confidence per pairing. Clips that don't correlate (score < min)
// keep offset 0 and are flagged.
export function alignByAudio(
  cams: CamInput[],
  opts: { hz?: number; maxLagSec?: number; minScore?: number } = {}
): { clipId: string; offsetSec: number; score: number; aligned: boolean }[] {
  const hz = opts.hz ?? 100;
  const maxLagSec = opts.maxLagSec ?? 10;
  const minScore = opts.minScore ?? 0.4;
  if (cams.length === 0) return [];
  const envs = cams.map((c) => energyEnvelope(c.data, c.sampleRate, hz));
  const ref = envs[0];
  const maxLag = Math.round(maxLagSec * hz);

  const raw = cams.map((c, i) => {
    if (i === 0) return { clipId: c.clipId, lagSec: 0, score: 1, aligned: true };
    const { lag, score } = crossCorrelate(ref, envs[i], maxLag);
    return { clipId: c.clipId, lagSec: lag / hz, score, aligned: score >= minScore };
  });

  // shift everything so the earliest-starting aligned clip is offset 0
  const minLag = Math.min(0, ...raw.filter((r) => r.aligned).map((r) => r.lagSec));
  return raw.map((r) => ({
    clipId: r.clipId,
    offsetSec: r.aligned ? Number((r.lagSec - minLag).toFixed(2)) : 0,
    score: r.score,
    aligned: r.aligned,
  }));
}

// --- repeat-take detection --------------------------------------------------------------

export interface TakeGroup {
  keep: string; // the clip to keep (first / best of the group)
  duplicates: string[]; // near-identical takes to hide
  similarity: number; // representative similarity within the group
}

// Cluster clips whose visual signatures are near-identical (same shot, take
// twice). Greedy single-link grouping above `threshold`. The first clip in
// each group is kept; the rest are flagged as duplicates.
export function detectRepeatTakes(signatures: ClipSignature[], threshold = 0.94): TakeGroup[] {
  const used = new Set<string>();
  const groups: TakeGroup[] = [];
  for (let i = 0; i < signatures.length; i++) {
    if (used.has(signatures[i].clipId)) continue;
    const dups: { id: string; sim: number }[] = [];
    for (let j = i + 1; j < signatures.length; j++) {
      if (used.has(signatures[j].clipId)) continue;
      const sim = signatureSimilarity(signatures[i], signatures[j]);
      if (sim >= threshold) dups.push({ id: signatures[j].clipId, sim });
    }
    if (dups.length > 0) {
      dups.forEach((d) => used.add(d.id));
      used.add(signatures[i].clipId);
      groups.push({
        keep: signatures[i].clipId,
        duplicates: dups.map((d) => d.id),
        similarity: Number((dups.reduce((s, d) => s + d.sim, 0) / dups.length).toFixed(3)),
      });
    }
  }
  return groups;
}
