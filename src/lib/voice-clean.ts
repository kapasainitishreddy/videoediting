"use client";

// "Studio sound" — one-tap voice cleanup for a voiceover / music track.
// Descript charges for this; here it's a Web Audio chain, fully on-device:
//   1. measure the noise floor from the quietest windows
//   2. downward-expand below it (breath/hiss/roomtone drops away)
//   3. clarity EQ: rumble cut, mud dip, presence lift, de-ess shelf
//   4. gentle compression + makeup gain toward a healthy level
// The gating math runs on the raw buffer (deterministic); the EQ/comp
// stages use OfflineAudioContext nodes.
import { audioBufferToWav } from "./audio-cinema";

export interface CleanReport {
  noiseFloor: number; // measured RMS of the quietest 10% of windows
  gatedSeconds: number; // how much audio the expander pulled down
  gainDb: number; // makeup gain applied
}

export async function studioSound(blob: Blob): Promise<{ blob: Blob; report: CleanReport }> {
  const AC: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ac = new AC();
  let buf: AudioBuffer;
  try {
    buf = await ac.decodeAudioData(await blob.arrayBuffer());
  } finally {
    ac.close();
  }

  // --- 1+2: noise-floor measurement and downward expansion on the samples
  const sr = buf.sampleRate;
  const data = buf.getChannelData(0);
  const win = Math.floor(sr * 0.03);
  const rmses: number[] = [];
  for (let i = 0; i + win <= data.length; i += win) {
    let e = 0;
    for (let k = 0; k < win; k++) e += data[i + k] ** 2;
    rmses.push(Math.sqrt(e / win));
  }
  const sorted = [...rmses].sort((a, b) => a - b);
  const noiseFloor = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
  const gateAt = Math.max(0.004, noiseFloor * 2.2);

  const work = buf.getChannelData(0).slice();
  let gatedWindows = 0;
  let env = 1;
  for (let i = 0, w = 0; i + win <= work.length; i += win, w++) {
    const below = rmses[w] < gateAt;
    const target = below ? 0.18 : 1; // -15dB-ish expansion, never a hard mute
    if (below) gatedWindows++;
    for (let k = 0; k < win; k++) {
      env += (target - env) * 0.004; // ~8ms glide — no clicks
      work[i + k] *= env;
    }
  }

  const gated = new OfflineAudioContext(1, work.length, sr);
  const gatedBuf = gated.createBuffer(1, work.length, sr);
  gatedBuf.copyToChannel(new Float32Array(work), 0);

  // --- 3+4: EQ + compression chain
  const src = gated.createBufferSource();
  src.buffer = gatedBuf;

  const rumble = gated.createBiquadFilter();
  rumble.type = "highpass";
  rumble.frequency.value = 75;
  rumble.Q.value = 0.7;

  const mud = gated.createBiquadFilter();
  mud.type = "peaking";
  mud.frequency.value = 300;
  mud.gain.value = -2.5;
  mud.Q.value = 1.0;

  const presence = gated.createBiquadFilter();
  presence.type = "peaking";
  presence.frequency.value = 3200;
  presence.gain.value = 4;
  presence.Q.value = 0.8;

  const deEss = gated.createBiquadFilter();
  deEss.type = "highshelf";
  deEss.frequency.value = 7500;
  deEss.gain.value = -3;

  const comp = gated.createDynamicsCompressor();
  comp.threshold.value = -22;
  comp.knee.value = 12;
  comp.ratio.value = 3;
  comp.attack.value = 0.006;
  comp.release.value = 0.18;

  src.connect(rumble);
  rumble.connect(mud);
  mud.connect(presence);
  presence.connect(deEss);
  deEss.connect(comp);
  comp.connect(gated.destination);
  src.start(0);
  const rendered = await gated.startRendering();

  // makeup gain: normalize peak to -1 dBFS-ish
  const out = rendered.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < out.length; i++) if (Math.abs(out[i]) > peak) peak = Math.abs(out[i]);
  const gain = peak > 1e-4 ? Math.min(4, 0.89 / peak) : 1;
  if (Math.abs(gain - 1) > 0.02) for (let i = 0; i < out.length; i++) out[i] *= gain;

  return {
    blob: audioBufferToWav(rendered),
    report: {
      noiseFloor: Number(noiseFloor.toFixed(5)),
      gatedSeconds: Number(((gatedWindows * win) / sr).toFixed(1)),
      gainDb: Number((20 * Math.log10(gain)).toFixed(1)),
    },
  };
}
