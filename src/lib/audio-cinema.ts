"use client";

// Cinematic audio engine — all synthesized locally with the Web Audio API.
//  • composeScore(): an original score matched to BPM + mood (#21)
//  • transition SFX bank: whoosh/impact/glitch/riser, synthesized (#14/#22)
//  • mixTimeline(): score + auto-placed SFX + optional voiceover with real
//    S-curve ducking (#13/#24) → one WAV blob for renderEdit's music input
import type { TransitionType } from "./types";

export type ScoreMood = "epic" | "chill" | "dark" | "uplift";

const NOTE = (semisFromA4: number) => 440 * Math.pow(2, semisFromA4 / 12);

// chord progressions per mood (semitone offsets from A)
const PROGRESSIONS: Record<ScoreMood, { chords: number[][]; bass: number[]; bright: number }> = {
  epic: { chords: [[0, 3, 7], [-4, 0, 3], [-7, -4, 0], [-5, -2, 2]], bass: [-24, -28, -31, -29], bright: 0.9 },
  chill: { chords: [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]], bass: [-24, -27, -31, -29], bright: 0.5 },
  dark: { chords: [[0, 3, 7], [-2, 1, 5], [-7, -4, 0], [-9, -5, -2]], bass: [-24, -26, -31, -33], bright: 0.3 },
  uplift: { chords: [[0, 4, 7], [2, 5, 9], [4, 7, 11], [5, 9, 12]], bass: [-24, -22, -20, -19], bright: 1.0 },
};

// Render a score to a mono WAV blob. Pads + bass + hats, chord change every
// bar, gentle build. Deliberately simple — reads as "score", not "loop".
export async function composeScore(opts: {
  bpm: number;
  seconds: number;
  mood: ScoreMood;
}): Promise<Blob> {
  const { bpm, seconds, mood } = opts;
  const sr = 44100;
  const ctx = new OfflineAudioContext(1, Math.ceil(sr * seconds), sr);
  const prog = PROGRESSIONS[mood];
  const beatLen = 60 / bpm;
  const barLen = beatLen * 4;

  const master = ctx.createGain();
  master.gain.setValueAtTime(0, 0);
  master.gain.linearRampToValueAtTime(0.8, 0.6); // ease in
  master.gain.setValueAtTime(0.8, Math.max(0.6, seconds - 1.0));
  master.gain.linearRampToValueAtTime(0.0, seconds); // resolve out
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1200 + prog.bright * 2600;
  master.connect(lp);
  lp.connect(ctx.destination);

  // pads: two slightly detuned triangles per chord tone
  for (let bar = 0; bar * barLen < seconds; bar++) {
    const chord = prog.chords[bar % prog.chords.length];
    const t0 = bar * barLen;
    const t1 = Math.min(seconds, t0 + barLen);
    for (const semis of chord) {
      for (const detune of [-4, 4]) {
        const o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.value = NOTE(semis);
        o.detune.value = detune;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.05, t0 + 0.3);
        g.gain.setValueAtTime(0.05, t1 - 0.25);
        g.gain.linearRampToValueAtTime(0, t1);
        o.connect(g);
        g.connect(master);
        o.start(t0);
        o.stop(t1);
      }
    }
    // bass: one note per beat, sine with quick decay
    const bassNote = prog.bass[bar % prog.bass.length];
    for (let b = 0; b < 4; b++) {
      const t = t0 + b * beatLen;
      if (t >= seconds) break;
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = NOTE(bassNote);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.22, t);
      g.gain.exponentialRampToValueAtTime(0.02, t + beatLen * 0.9);
      o.connect(g);
      g.connect(master);
      o.start(t);
      o.stop(t + beatLen);
    }
  }

  // hats: filtered noise ticks on offbeats after the first bar (build feel)
  const noiseBuf = ctx.createBuffer(1, sr, sr);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < sr; i++) nd[i] = Math.random() * 2 - 1;
  for (let t = barLen; t < seconds; t += beatLen / 2) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 8000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.06 * prog.bright, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(hp);
    hp.connect(g);
    g.connect(master);
    src.start(t, 0.2, 0.06);
  }

  const rendered = await ctx.startRendering();
  return audioBufferToWav(rendered);
}

// --- Synthesized SFX bank (#14/#22) -----------------------------------------
export type SfxType = "whoosh" | "impact" | "glitch" | "riser";

export const SFX_FOR_TRANSITION: Partial<Record<TransitionType, SfxType>> = {
  "whip-pan": "whoosh",
  "slide-left": "whoosh",
  "slide-right": "whoosh",
  "zoom-in": "impact",
  "zoom-out": "whoosh",
  flash: "impact",
  glitch: "glitch",
  spin: "whoosh",
  blur: "riser",
};

function renderSfxInto(ctx: OfflineAudioContext, type: SfxType, at: number, gainScale = 1) {
  const sr = ctx.sampleRate;
  const noiseBuf = ctx.createBuffer(1, sr, sr);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < sr; i++) nd[i] = Math.random() * 2 - 1;

  if (type === "whoosh") {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(300, at);
    bp.frequency.exponentialRampToValueAtTime(3200, at + 0.28);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.5 * gainScale, at + 0.12);
    g.gain.exponentialRampToValueAtTime(0.01, at + 0.38);
    src.connect(bp); bp.connect(g); g.connect(ctx.destination);
    src.start(at, 0, 0.4);
  } else if (type === "impact") {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(160, at);
    o.frequency.exponentialRampToValueAtTime(40, at + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.8 * gainScale, at);
    g.gain.exponentialRampToValueAtTime(0.01, at + 0.35);
    o.connect(g); g.connect(ctx.destination);
    o.start(at); o.stop(at + 0.4);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const lpn = ctx.createBiquadFilter();
    lpn.type = "lowpass"; lpn.frequency.value = 900;
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0.4 * gainScale, at);
    gn.gain.exponentialRampToValueAtTime(0.01, at + 0.15);
    src.connect(lpn); lpn.connect(gn); gn.connect(ctx.destination);
    src.start(at, 0, 0.15);
  } else if (type === "glitch") {
    for (let k = 0; k < 5; k++) {
      const t = at + k * 0.035;
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.value = 400 + Math.pow(2, k) * 180;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.16 * gainScale, t);
      g.gain.setValueAtTime(0, t + 0.02);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + 0.03);
    }
  } else if (type === "riser") {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.Q.value = 2;
    bp.frequency.setValueAtTime(200, Math.max(0, at - 0.5));
    bp.frequency.exponentialRampToValueAtTime(4000, at + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, Math.max(0, at - 0.5));
    g.gain.exponentialRampToValueAtTime(0.35 * gainScale, at);
    g.gain.exponentialRampToValueAtTime(0.01, at + 0.1);
    src.connect(bp); bp.connect(g); g.connect(ctx.destination);
    src.start(Math.max(0, at - 0.5), 0, 0.65);
  }
}

export async function renderSfxPreview(type: SfxType): Promise<Blob> {
  const ctx = new OfflineAudioContext(1, 44100, 44100);
  renderSfxInto(ctx, type, 0.1);
  return audioBufferToWav(await ctx.startRendering());
}

// --- speech detection for ducking (#13/#23) ----------------------------------
export async function speechRanges(voice: Blob): Promise<{ start: number; end: number }[]> {
  const AC: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ac = new AC();
  let buf: AudioBuffer;
  try {
    buf = await ac.decodeAudioData(await voice.arrayBuffer());
  } finally {
    ac.close();
  }
  const d = buf.getChannelData(0);
  const hop = Math.floor(buf.sampleRate * 0.05);
  const ranges: { start: number; end: number }[] = [];
  let inSpeech = false;
  let start = 0;
  for (let f = 0; f * hop < d.length; f++) {
    let e = 0;
    for (let i = 0; i < hop; i++) e += Math.abs(d[f * hop + i] || 0);
    e /= hop;
    const t = (f * hop) / buf.sampleRate;
    if (e > 0.02 && !inSpeech) {
      inSpeech = true;
      start = t;
    } else if (e <= 0.01 && inSpeech) {
      inSpeech = false;
      if (t - start > 0.15) ranges.push({ start, end: t });
    }
  }
  if (inSpeech) ranges.push({ start, end: buf.duration });
  return ranges;
}

// --- the full timeline mix (#13/#14/#21/#24/#47) ------------------------------
// score/music + SFX at each transition + optional voiceover with S-curve
// ducking → single WAV for the renderer.
export async function mixTimeline(opts: {
  seconds: number;
  music?: Blob | null; // uploaded track OR composed score
  // Each cue is placed at `time`. When `blob` is present (a real web/bundled
  // SFX file, see sfx-web.ts) it's played verbatim; otherwise `type` is
  // synthesized on the fly — so a missing/blocked download never drops the SFX.
  sfxAt?: { time: number; type: SfxType; blob?: Blob }[];
  voiceover?: Blob | null;
}): Promise<Blob> {
  const sr = 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil(sr * Math.max(1, opts.seconds)), sr);

  let duckRanges: { start: number; end: number }[] = [];
  if (opts.voiceover) duckRanges = await speechRanges(opts.voiceover);

  // Pre-decode any real SFX blobs (async) before the synchronous scheduling
  // loop below. De-duplicated so a whoosh reused 8 times decodes once.
  const sfxCues = opts.sfxAt ?? [];
  const sfxBuffers = new Map<Blob, AudioBuffer>();
  const toDecode = [...new Set(sfxCues.map((s) => s.blob).filter((b): b is Blob => !!b))];
  if (toDecode.length) {
    const AC: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const tmp = new AC();
    try {
      for (const blob of toDecode) {
        try {
          sfxBuffers.set(blob, await tmp.decodeAudioData(await blob.arrayBuffer()));
        } catch {
          // undecodable file → this cue will synthesize instead
        }
      }
    } finally {
      tmp.close();
    }
  }

  if (opts.music) {
    const AC: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const tmp = new AC();
    let mbuf: AudioBuffer;
    try {
      mbuf = await tmp.decodeAudioData(await opts.music.arrayBuffer());
    } finally {
      tmp.close();
    }
    const src = ctx.createBufferSource();
    src.buffer = mbuf;
    const g = ctx.createGain();
    // S-curve ducking: ease down before speech, ease back after (#24)
    g.gain.setValueAtTime(0.9, 0);
    for (const r of duckRanges) {
      const a = Math.max(0, r.start - 0.35);
      g.gain.setTargetAtTime(0.25, a, 0.12);
      g.gain.setTargetAtTime(0.9, r.end + 0.1, 0.25);
    }
    src.connect(g);
    g.connect(ctx.destination);
    src.start(0);
  }

  for (const s of sfxCues) {
    if (s.time < 0 || s.time >= opts.seconds) continue;
    const buf = s.blob ? sfxBuffers.get(s.blob) : undefined;
    if (buf) {
      // Real SFX file: play it at the cut.
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = 0.9;
      src.connect(g);
      g.connect(ctx.destination);
      src.start(s.time);
    } else {
      // No file (or it failed to decode) → synthesize.
      renderSfxInto(ctx, s.type, s.time, 0.9);
    }
  }

  if (opts.voiceover) {
    const AC: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const tmp = new AC();
    let vbuf: AudioBuffer;
    try {
      vbuf = await tmp.decodeAudioData(await opts.voiceover.arrayBuffer());
    } finally {
      tmp.close();
    }
    const src = ctx.createBufferSource();
    src.buffer = vbuf;
    const g = ctx.createGain();
    g.gain.value = 1.0;
    src.connect(g);
    g.connect(ctx.destination);
    src.start(0);
  }

  return audioBufferToWav(await ctx.startRendering());
}

// --- WAV encode ----------------------------------------------------------------
export function audioBufferToWav(buf: AudioBuffer): Blob {
  const ch = Math.min(2, buf.numberOfChannels);
  const n = buf.length * ch;
  const bytes = new DataView(new ArrayBuffer(44 + n * 2));
  const wr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes.setUint8(o + i, s.charCodeAt(i));
  };
  wr(0, "RIFF");
  bytes.setUint32(4, 36 + n * 2, true);
  wr(8, "WAVE");
  wr(12, "fmt ");
  bytes.setUint32(16, 16, true);
  bytes.setUint16(20, 1, true);
  bytes.setUint16(22, ch, true);
  bytes.setUint32(24, buf.sampleRate, true);
  bytes.setUint32(28, buf.sampleRate * 2 * ch, true);
  bytes.setUint16(32, 2 * ch, true);
  bytes.setUint16(34, 16, true);
  wr(36, "data");
  bytes.setUint32(40, n * 2, true);
  let o = 44;
  const chans: Float32Array[] = [];
  for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
  for (let i = 0; i < buf.length; i++) {
    for (let c = 0; c < ch; c++) {
      bytes.setInt16(o, Math.max(-1, Math.min(1, chans[c][i])) * 32767, true);
      o += 2;
    }
  }
  return new Blob([bytes.buffer], { type: "audio/wav" });
}
