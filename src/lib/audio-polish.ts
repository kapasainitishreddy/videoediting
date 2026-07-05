"use client";

// Audio polish toolkit.
//  • measureLoudness / normalizeGain — match perceived volume across tracks
//  • silenceRanges — find dead air in a recording (voiceover trim, gap fill)
//  • polishVoice — clarity EQ chain: rumble cut + presence lift, one tap
//  • normalizeAudioBlob — bake a loudness-matched copy of any track
//  • roomTone — subtle synthesized ambience bed so silence never sounds dead
//  • suggestMood — pick a score mood from the footage's measured energy/brightness
//
// The DSP math (loudness, gains, silence detection, mood pick) is pure and
// runs on Float32Array — Node-testable. Only the blob decode/encode wrappers
// touch Web Audio.
import { audioBufferToWav } from "./audio-cinema";
import type { ScoreMood } from "./audio-cinema";

// --- pure math ---------------------------------------------------------------

export interface Loudness {
  rms: number; // 0..1 root-mean-square (perceived-ish level)
  peak: number; // 0..1 absolute peak
}

export function measureLoudness(data: Float32Array): Loudness {
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    sum += v * v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  return { rms: Math.sqrt(sum / Math.max(1, data.length)), peak };
}

// Gain to bring a track to the target RMS without clipping: limited so the
// post-gain peak stays ≤0.98, and clamped to ±12dB so a nearly-silent track
// doesn't get blown up into pure noise.
export function normalizeGain(l: Loudness, targetRms = 0.08): number {
  if (l.rms <= 1e-6) return 1;
  let g = targetRms / l.rms;
  if (l.peak * g > 0.98) g = 0.98 / l.peak;
  return Math.min(4, Math.max(0.25, Number(g.toFixed(3))));
}

// Dead-air detection: windows whose RMS stays under `threshold` for at least
// `minLen` seconds. Generic — used for voiceover trim suggestions and for
// deciding where an ambience bed is needed.
export function silenceRanges(
  data: Float32Array,
  sampleRate: number,
  opts: { threshold?: number; minLen?: number } = {}
): { start: number; end: number }[] {
  const threshold = opts.threshold ?? 0.012;
  const minLen = opts.minLen ?? 0.6;
  const hop = Math.floor(sampleRate * 0.05);
  const ranges: { start: number; end: number }[] = [];
  let start: number | null = null;
  for (let f = 0; f * hop < data.length; f++) {
    let e = 0;
    for (let i = 0; i < hop; i++) e += (data[f * hop + i] || 0) ** 2;
    const rms = Math.sqrt(e / hop);
    const t = (f * hop) / sampleRate;
    if (rms < threshold && start === null) start = t;
    if (rms >= threshold && start !== null) {
      if (t - start >= minLen) ranges.push({ start: Number(start.toFixed(2)), end: Number(t.toFixed(2)) });
      start = null;
    }
  }
  const total = data.length / sampleRate;
  if (start !== null && total - start >= minLen) ranges.push({ start: Number(start.toFixed(2)), end: Number(total.toFixed(2)) });
  return ranges;
}

// Score-mood suggestion from measured footage stats (clip-analysis output):
// high motion → epic; low motion + bright → uplift; low motion + mid → chill;
// dark footage → dark. Pure and deliberately simple — it's a default, the
// user can always override in the Studio.
export function suggestMood(stats: { avgMotion: number; brightness: number }): { mood: ScoreMood; why: string } {
  const { avgMotion, brightness } = stats;
  if (brightness < 0.28) return { mood: "dark", why: "Footage reads dark and moody" };
  if (avgMotion > 0.12) return { mood: "epic", why: "High-motion footage — a driving score fits" };
  if (brightness > 0.55) return { mood: "uplift", why: "Bright, airy footage — an upbeat score fits" };
  return { mood: "chill", why: "Relaxed pacing and mid tones — a chill score fits" };
}

// --- browser wrappers ----------------------------------------------------------

async function decode(blob: Blob): Promise<AudioBuffer> {
  const AC: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ac = new AC();
  try {
    return await ac.decodeAudioData(await blob.arrayBuffer());
  } finally {
    ac.close();
  }
}

// Loudness-matched copy of a track (music or voiceover) at the target RMS.
export async function normalizeAudioBlob(blob: Blob, targetRms = 0.08): Promise<{ blob: Blob; gain: number }> {
  const buf = await decode(blob);
  const gain = normalizeGain(measureLoudness(buf.getChannelData(0)), targetRms);
  if (Math.abs(gain - 1) < 0.05) return { blob, gain: 1 }; // already close — don't re-encode
  const ctx = new OfflineAudioContext(Math.min(2, buf.numberOfChannels), buf.length, buf.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g);
  g.connect(ctx.destination);
  src.start(0);
  return { blob: audioBufferToWav(await ctx.startRendering()), gain };
}

// Voice-clarity pass: high-pass at 85Hz (mic rumble / handling noise), a
// gentle presence lift around 2.8kHz (intelligibility), and a soft top-end
// ceiling. Tasteful by design — this should never sound "processed".
export async function polishVoice(blob: Blob): Promise<Blob> {
  const buf = await decode(blob);
  const ctx = new OfflineAudioContext(1, buf.length, buf.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buf;

  const rumble = ctx.createBiquadFilter();
  rumble.type = "highpass";
  rumble.frequency.value = 85;
  rumble.Q.value = 0.7;

  const presence = ctx.createBiquadFilter();
  presence.type = "peaking";
  presence.frequency.value = 2800;
  presence.gain.value = 3.5;
  presence.Q.value = 0.9;

  const ceiling = ctx.createBiquadFilter();
  ceiling.type = "lowpass";
  ceiling.frequency.value = 12000;

  src.connect(rumble);
  rumble.connect(presence);
  presence.connect(ceiling);
  ceiling.connect(ctx.destination);
  src.start(0);
  return audioBufferToWav(await ctx.startRendering());
}

// Subtle room-tone bed: low-level filtered noise with a slow amplitude drift.
// Layered under dialogue gaps (or a whole no-music edit) so silence doesn't
// read as an encoding error. Kept quiet on purpose (-36dB-ish).
export async function roomTone(seconds: number): Promise<Blob> {
  const sr = 44100;
  const ctx = new OfflineAudioContext(1, Math.ceil(sr * Math.max(0.5, seconds)), sr);
  const buf = ctx.createBuffer(1, sr * 2, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 450;
  const g = ctx.createGain();
  // slow drift between 0.012 and 0.02 so it breathes instead of hissing flat
  g.gain.setValueAtTime(0.016, 0);
  for (let t = 0; t < seconds; t += 2.5) {
    g.gain.linearRampToValueAtTime(0.012 + 0.008 * ((t / 2.5) % 2 === 0 ? 1 : 0.3), t + 2.5);
  }
  src.connect(lp);
  lp.connect(g);
  g.connect(ctx.destination);
  src.start(0);
  return audioBufferToWav(await ctx.startRendering());
}
