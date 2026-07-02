"use client";

// Real beat detection from an audio file using the Web Audio API.
// Decodes the track, builds a low-frequency energy envelope, detects onset
// peaks, then finds the dominant inter-onset period to lock a steady BPM
// and emit a clean beat grid. No external service.

export interface BeatResult {
  bpm: number;
  beatTimes: number[]; // seconds, on the locked grid
  onsets: number[]; // raw detected onset times (pre-grid)
  duration: number;
}

export async function detectBeats(file: Blob): Promise<BeatResult> {
  const arrayBuf = await file.arrayBuffer();
  const AC: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  let audio: AudioBuffer;
  try {
    audio = await ctx.decodeAudioData(arrayBuf.slice(0));
  } finally {
    ctx.close();
  }

  const sr = audio.sampleRate;
  const ch = audio.getChannelData(0);
  const duration = audio.duration;

  // 1. Energy envelope in ~10ms hops, emphasizing low end (kick/bass) by
  //    working on the raw signal squared — good enough for onset picking.
  const hop = Math.floor(sr * 0.01);
  const frames = Math.floor(ch.length / hop);
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const start = f * hop;
    for (let i = 0; i < hop; i++) {
      const s = ch[start + i] || 0;
      sum += s * s;
    }
    env[f] = Math.sqrt(sum / hop);
  }

  // 2. Spectral-flux-like novelty: positive change in energy vs a local mean
  const novelty = new Float32Array(frames);
  const W = 8;
  for (let f = 0; f < frames; f++) {
    let mean = 0;
    let n = 0;
    for (let k = Math.max(0, f - W); k < f; k++) {
      mean += env[k];
      n++;
    }
    mean = n ? mean / n : 0;
    novelty[f] = Math.max(0, env[f] - mean);
  }

  // 3. Peak-pick onsets: local maxima above an adaptive threshold
  const onsets: number[] = [];
  const thWin = 20;
  for (let f = 1; f < frames - 1; f++) {
    if (novelty[f] <= novelty[f - 1] || novelty[f] < novelty[f + 1]) continue;
    let mean = 0;
    let n = 0;
    for (let k = Math.max(0, f - thWin); k < Math.min(frames, f + thWin); k++) {
      mean += novelty[k];
      n++;
    }
    mean /= n || 1;
    if (novelty[f] > mean * 1.6 && novelty[f] > 1e-4) {
      const t = (f * hop) / sr;
      if (onsets.length === 0 || t - onsets[onsets.length - 1] > 0.12) onsets.push(t);
    }
  }

  // 4. Estimate BPM from the histogram of inter-onset intervals, folded
  //    into the 70–180 BPM range.
  const bpm = estimateBpm(onsets);

  // 5. Build a locked beat grid, phase-aligned to the strongest early onset
  const beatLen = 60 / bpm;
  const phase = onsets.length ? onsets[0] % beatLen : 0;
  const beatTimes: number[] = [];
  for (let t = phase; t < duration; t += beatLen) beatTimes.push(Number(t.toFixed(3)));

  return { bpm, beatTimes, onsets, duration };
}

function estimateBpm(onsets: number[]): number {
  if (onsets.length < 4) return 120;
  const intervals: number[] = [];
  for (let i = 1; i < onsets.length; i++) {
    const d = onsets[i] - onsets[i - 1];
    if (d > 0.2 && d < 2) intervals.push(d);
  }
  if (intervals.length === 0) return 120;

  // histogram over BPM bins
  const bins = new Map<number, number>();
  for (const d of intervals) {
    let b = 60 / d;
    while (b < 70) b *= 2;
    while (b > 180) b /= 2;
    const rounded = Math.round(b);
    bins.set(rounded, (bins.get(rounded) ?? 0) + 1);
  }
  // pick the bin (± neighbours) with the most support
  let bestBpm = 120;
  let bestScore = -1;
  for (const [b] of bins) {
    let score = 0;
    for (let k = -2; k <= 2; k++) score += bins.get(b + k) ?? 0;
    if (score > bestScore) {
      bestScore = score;
      bestBpm = b;
    }
  }
  return bestBpm;
}

// Given a set of cut points and a beat grid, snap each cut to the nearest
// beat (within tolerance) so edits land on the music.
export function snapToBeats(cutTimes: number[], beatTimes: number[], tolerance = 0.18): number[] {
  if (beatTimes.length === 0) return cutTimes;
  return cutTimes.map((t) => {
    let nearest = t;
    let best = tolerance;
    for (const b of beatTimes) {
      const d = Math.abs(b - t);
      if (d < best) {
        best = d;
        nearest = b;
      }
    }
    return Number(nearest.toFixed(3));
  });
}
