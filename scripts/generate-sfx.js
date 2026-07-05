// Generates the bundled transition sound-effect library in public/sfx/.
//
// These are real, layered SFX (not the tiny on-the-fly preview synth) —
// rendered offline here to 44.1kHz stereo WAV so the app can serve them over
// HTTP like any other asset. They're the primary "sound effects from the web"
// source: sfx-web.ts fetches /sfx/<type>.wav, and only falls back to the
// live Web-Audio synth if a file is missing. Because they're my own
// synthesis there's no third-party licensing to worry about, and the service
// worker caches them so they keep working offline.
//
// Deterministic: a seeded PRNG makes re-runs byte-identical, so regenerating
// never churns the committed files. Run: node scripts/generate-sfx.js
const fs = require("fs");
const path = require("path");

const SR = 44100;
const OUT_DIR = path.join(__dirname, "..", "public", "sfx");

// --- seeded PRNG (mulberry32) so noise is reproducible ----------------------
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- time-varying RBJ bandpass (per-sample coeff update) --------------------
function bandpassSweep(input, sr, f0Fn, q) {
  const out = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const t = i / input.length;
    const f0 = Math.max(30, Math.min(sr / 2 - 100, f0Fn(t)));
    const w0 = (2 * Math.PI * f0) / sr;
    const alpha = Math.sin(w0) / (2 * q);
    const b0 = alpha, b1 = 0, b2 = -alpha;
    const a0 = 1 + alpha, a1 = -2 * Math.cos(w0), a2 = 1 - alpha;
    const x0 = input[i];
    const y0 = (b0 / a0) * x0 + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    out[i] = y0;
  }
  return out;
}

function lowpass(input, sr, fc) {
  const out = new Float32Array(input.length);
  const rc = 1 / (2 * Math.PI * fc);
  const dt = 1 / sr;
  const a = dt / (rc + dt);
  let prev = 0;
  for (let i = 0; i < input.length; i++) {
    prev = prev + a * (input[i] - prev);
    out[i] = prev;
  }
  return out;
}

function normalize(chs, peak = 0.9) {
  let max = 1e-9;
  for (const ch of chs) for (let i = 0; i < ch.length; i++) max = Math.max(max, Math.abs(ch[i]));
  const g = peak / max;
  for (const ch of chs) for (let i = 0; i < ch.length; i++) ch[i] *= g;
}

// Delay a channel by `d` seconds (for stereo width) — simple integer shift.
function delayCh(ch, sr, d) {
  const n = Math.round(d * sr);
  const out = new Float32Array(ch.length);
  for (let i = 0; i < ch.length; i++) out[i] = i - n >= 0 ? ch[i - n] : 0;
  return out;
}

// --- generators -------------------------------------------------------------
function whoosh(rng) {
  const N = Math.round(0.6 * SR);
  const noise = new Float32Array(N);
  for (let i = 0; i < N; i++) noise[i] = rng() * 2 - 1;
  // rise then fall — the classic "whip" arc
  const swept = bandpassSweep(noise, SR, (t) => (t < 0.55 ? 350 + t * 5200 : 3200 - (t - 0.55) * 3200), 1.4);
  const L = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / N;
    const env = Math.min(1, t / 0.1) * Math.pow(1 - t, 1.6); // attack .1, smooth decay
    L[i] = swept[i] * env;
  }
  const R = delayCh(L, SR, 0.012); // haas width
  normalize([L, R], 0.85);
  return [L, R];
}

function impact(rng) {
  const N = Math.round(0.7 * SR);
  const L = new Float32Array(N);
  // body: pitch-dropping sine 165 → 42 Hz
  let phase = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const f = 42 + 123 * Math.exp(-t * 9);
    phase += (2 * Math.PI * f) / SR;
    const env = Math.exp(-t * 6);
    L[i] += Math.sin(phase) * env * 0.9;
  }
  // transient click (first 4ms)
  for (let i = 0; i < Math.round(0.004 * SR); i++) L[i] += (rng() * 2 - 1) * (1 - i / (0.004 * SR)) * 0.6;
  // low-thud noise burst
  const nb = new Float32Array(N);
  for (let i = 0; i < N; i++) nb[i] = rng() * 2 - 1;
  const thud = lowpass(nb, SR, 800);
  for (let i = 0; i < N; i++) L[i] += thud[i] * Math.exp(-(i / SR) * 14) * 0.5;
  const R = new Float32Array(L); // impact is centered/mono-ish
  normalize([L, R], 0.95);
  return [L, R];
}

function glitch(rng) {
  const N = Math.round(0.42 * SR);
  const L = new Float32Array(N);
  const freqs = [220, 660, 1320, 440, 1760, 330, 990];
  let cursor = 0;
  let k = 0;
  while (cursor < N) {
    const segLen = Math.round((0.02 + rng() * 0.03) * SR);
    const f = freqs[k % freqs.length];
    const amp = 0.25 + rng() * 0.15;
    const gate = rng() > 0.25; // some segments drop out (stutter)
    for (let i = 0; i < segLen && cursor + i < N; i++) {
      const ph = (2 * Math.PI * f * i) / SR;
      L[cursor + i] = gate ? (Math.sin(ph) > 0 ? amp : -amp) : 0; // square
    }
    cursor += segLen;
    k++;
  }
  // sprinkle reversed noise bursts
  for (let b = 0; b < 3; b++) {
    const at = Math.round(rng() * (N - 0.05 * SR));
    for (let i = 0; i < 0.04 * SR; i++) L[at + i] += (rng() * 2 - 1) * (i / (0.04 * SR)) * 0.3;
  }
  const R = delayCh(L, SR, 0.005);
  normalize([L, R], 0.8);
  return [L, R];
}

function riser(rng) {
  const N = Math.round(1.2 * SR);
  const noise = new Float32Array(N);
  for (let i = 0; i < N; i++) noise[i] = rng() * 2 - 1;
  const swept = bandpassSweep(noise, SR, (t) => 200 * Math.pow(25, t), 2.2); // 200 → 5000 exp
  const L = new Float32Array(N);
  let phase = 0;
  for (let i = 0; i < N; i++) {
    const t = i / N;
    const env = Math.pow(t, 1.5) * (t > 0.97 ? (1 - t) / 0.03 : 1); // build then quick release
    const f = 200 + 1800 * t * t;
    phase += (2 * Math.PI * f) / SR;
    L[i] = (swept[i] * 0.8 + Math.sin(phase) * 0.2) * env;
  }
  const R = delayCh(L, SR, 0.009);
  normalize([L, R], 0.8);
  return [L, R];
}

// --- WAV writer (16-bit PCM, interleaved stereo) ----------------------------
function writeWav(file, chs) {
  const numCh = chs.length;
  const n = chs[0].length;
  const buf = Buffer.alloc(44 + n * numCh * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * numCh * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(numCh, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * numCh * 2, 28);
  buf.writeUInt16LE(numCh * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * numCh * 2, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chs[c][i]));
      buf.writeInt16LE((s * 32767) | 0, o);
      o += 2;
    }
  }
  fs.writeFileSync(file, buf);
  return buf.length;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // distinct seed per effect keeps them independent but reproducible
  const jobs = [
    ["whoosh", whoosh, 1337],
    ["impact", impact, 4242],
    ["glitch", glitch, 9001],
    ["riser", riser, 2718],
  ];
  for (const [name, fn, seed] of jobs) {
    const chs = fn(makeRng(seed));
    const bytes = writeWav(path.join(OUT_DIR, `${name}.wav`), chs);
    console.log(`  ${name}.wav  ${(bytes / 1024).toFixed(1)} KB`);
  }
  console.log(`Wrote ${jobs.length} SFX to ${OUT_DIR}`);
}

main();
