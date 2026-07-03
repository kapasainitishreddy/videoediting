"use client";

// The demo, cut like an editor — not a feature reel.
// One palette (dusk amber/navy), one transition language (cuts + fades,
// a single light-leak at the emotional peak), one quiet title, a chill
// score, and exactly two sound effects. Everything through the real
// renderEdit() pipeline.
import { useEffect, useState } from "react";
import { renderEdit, type BurnCaption } from "@/lib/ffmpeg-client";
import { renderTitleCard } from "@/lib/titles";
import { DEFAULT_LOOK } from "@/lib/cinematic";
import { composeScore, mixTimeline, type SfxType } from "@/lib/audio-cinema";
import { transitionByType } from "@/lib/transitions";
import type { TimelineSegment } from "@/lib/types";
import { v4 as uuid } from "uuid";

type Draw = (ctx: CanvasRenderingContext2D, t: number, W: number, H: number) => void;

// One cohesive dusk palette across every scene so the grade reads as a
// single film, not six unrelated clips.
const DUSK = {
  skyTop: "#1c2440",
  skyMid: "#4a3a5e",
  amber: "#e8955c",
  amberDeep: "#c96f45",
  silhouette: "#12141f",
  silhouette2: "#1a1d2c",
  star: "rgba(240,238,255,0.9)",
};

const SCENES: { name: string; draw: Draw }[] = [
  {
    // wide dune, low sun — slow pan right
    name: "dune",
    draw: (c, t, W, H) => {
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, DUSK.skyTop);
      g.addColorStop(0.55, DUSK.skyMid);
      g.addColorStop(0.8, DUSK.amberDeep);
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
      const sx = W * 0.62 - t * W * 0.06;
      const sun = c.createRadialGradient(sx, H * 0.66, 0, sx, H * 0.66, 110);
      sun.addColorStop(0, "rgba(255,214,150,0.95)");
      sun.addColorStop(0.5, "rgba(232,149,92,0.35)");
      sun.addColorStop(1, "rgba(232,149,92,0)");
      c.fillStyle = sun;
      c.fillRect(0, 0, W, H);
      // dune curves
      c.fillStyle = DUSK.silhouette2;
      c.beginPath();
      c.moveTo(0, H);
      for (let x = 0; x <= W; x += 12) c.lineTo(x, H * 0.74 + Math.sin(x / 170 + 1.3) * 46 + t * 6);
      c.lineTo(W, H);
      c.fill();
      c.fillStyle = DUSK.silhouette;
      c.beginPath();
      c.moveTo(0, H);
      for (let x = 0; x <= W; x += 12) c.lineTo(x, H * 0.85 + Math.sin(x / 120 + 4) * 34);
      c.lineTo(W, H);
      c.fill();
    },
  },
  {
    // calm ocean horizon, sun path on water — near-static, tiny drift
    name: "ocean",
    draw: (c, t, W, H) => {
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, DUSK.skyMid);
      g.addColorStop(0.5, DUSK.amberDeep);
      g.addColorStop(0.52, "#2a2440");
      g.addColorStop(1, "#141426");
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
      // sun glow at horizon
      const sun = c.createRadialGradient(W / 2, H * 0.51, 0, W / 2, H * 0.51, 180);
      sun.addColorStop(0, "rgba(255,200,140,0.7)");
      sun.addColorStop(1, "rgba(255,200,140,0)");
      c.fillStyle = sun;
      c.fillRect(0, 0, W, H);
      // shimmering sun path
      for (let y = H * 0.53; y < H * 0.95; y += 7) {
        const w = 26 + (y - H * 0.53) * 0.35;
        const jitter = Math.sin(y * 0.7 + t * 3) * 7;
        c.fillStyle = `rgba(255,190,130,${0.24 - (y - H * 0.53) / (H * 1.6)})`;
        c.fillRect(W / 2 - w / 2 + jitter, y, w, 2.5);
      }
    },
  },
  {
    // layered mountain silhouettes with mist — very slow push feel
    name: "ridges",
    draw: (c, t, W, H) => {
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, DUSK.skyTop);
      g.addColorStop(0.7, DUSK.skyMid);
      g.addColorStop(1, DUSK.amberDeep);
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
      const layers = [
        { base: 0.55, amp: 70, col: "rgba(38,36,64,0.9)", speed: 8 },
        { base: 0.66, amp: 90, col: "rgba(28,27,48,0.95)", speed: 16 },
        { base: 0.78, amp: 80, col: DUSK.silhouette2, speed: 26 },
        { base: 0.9, amp: 60, col: DUSK.silhouette, speed: 40 },
      ];
      for (const l of layers) {
        c.fillStyle = l.col;
        c.beginPath();
        c.moveTo(0, H);
        for (let x = 0; x <= W; x += 10) {
          c.lineTo(x, H * l.base + Math.sin((x + t * l.speed) / 130) * l.amp * 0.4 + Math.sin((x + t * l.speed) / 47) * l.amp * 0.12);
        }
        c.lineTo(W, H);
        c.fill();
        // mist band above each ridge
        const m = c.createLinearGradient(0, H * l.base - 60, 0, H * l.base + 10);
        m.addColorStop(0, "rgba(120,110,140,0)");
        m.addColorStop(1, "rgba(120,110,140,0.14)");
        c.fillStyle = m;
        c.fillRect(0, H * l.base - 60, W, 70);
      }
    },
  },
  {
    // night sky — stars slowly rotating, one meteor at ~60%
    name: "stars",
    draw: (c, t, W, H) => {
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#0b0f22");
      g.addColorStop(0.8, DUSK.skyTop);
      g.addColorStop(1, "#2a2440");
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
      // deterministic starfield, slow parallax drift
      for (let i = 0; i < 90; i++) {
        const seed = i * 137.5;
        const x = ((seed * 7.3) % W) + t * (2 + (i % 3));
        const y = (seed * 13.7) % (H * 0.85);
        const tw = 0.55 + 0.45 * Math.sin(t * 2 + i);
        c.fillStyle = `rgba(240,238,255,${0.25 + 0.5 * tw * ((i % 4) / 4)})`;
        c.beginPath();
        c.arc(x % W, y, i % 5 === 0 ? 1.8 : 1, 0, Math.PI * 2);
        c.fill();
      }
      // one meteor, once
      if (t > 0.55 && t < 0.75) {
        const p = (t - 0.55) / 0.2;
        const mx = W * 0.75 - p * W * 0.4;
        const my = H * 0.18 + p * H * 0.16;
        const grad = c.createLinearGradient(mx + 60, my - 30, mx, my);
        grad.addColorStop(0, "rgba(240,238,255,0)");
        grad.addColorStop(1, "rgba(240,238,255,0.9)");
        c.strokeStyle = grad;
        c.lineWidth = 2.5;
        c.beginPath();
        c.moveTo(mx + 60, my - 30);
        c.lineTo(mx, my);
        c.stroke();
      }
      // dark ridge foreground
      c.fillStyle = DUSK.silhouette;
      c.beginPath();
      c.moveTo(0, H);
      for (let x = 0; x <= W; x += 14) c.lineTo(x, H * 0.88 + Math.sin(x / 90) * 26);
      c.lineTo(W, H);
      c.fill();
    },
  },
  {
    // dawn returns — sun rising through thin cloud bands, birds
    name: "dawn",
    draw: (c, t, W, H) => {
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, DUSK.skyTop);
      g.addColorStop(0.45, DUSK.skyMid);
      g.addColorStop(0.75, DUSK.amber);
      g.addColorStop(1, DUSK.amberDeep);
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
      const sy = H * 0.72 - t * H * 0.05;
      const sun = c.createRadialGradient(W / 2, sy, 0, W / 2, sy, 150);
      sun.addColorStop(0, "rgba(255,230,180,0.95)");
      sun.addColorStop(0.6, "rgba(232,149,92,0.3)");
      sun.addColorStop(1, "rgba(232,149,92,0)");
      c.fillStyle = sun;
      c.fillRect(0, 0, W, H);
      // thin cloud bands crossing the sun
      for (let i = 0; i < 4; i++) {
        const y = H * (0.6 + i * 0.05) - t * 8;
        c.fillStyle = `rgba(26,29,44,${0.5 - i * 0.08})`;
        c.fillRect(0, y, W, 8 - i);
      }
      // distant birds — two-arc glyphs drifting
      c.strokeStyle = "rgba(18,20,31,0.8)";
      c.lineWidth = 2;
      for (let b = 0; b < 5; b++) {
        const bx = W * (0.25 + b * 0.11) + t * 24;
        const by = H * (0.3 + (b % 3) * 0.05) + Math.sin(t * 3 + b) * 4;
        c.beginPath();
        c.arc(bx - 5, by, 5, Math.PI * 1.1, Math.PI * 1.9);
        c.arc(bx + 5, by, 5, Math.PI * 1.1, Math.PI * 1.9);
        c.stroke();
      }
      c.fillStyle = DUSK.silhouette;
      c.beginPath();
      c.moveTo(0, H);
      for (let x = 0; x <= W; x += 14) c.lineTo(x, H * 0.9 + Math.sin(x / 150 + 2) * 20);
      c.lineTo(W, H);
      c.fill();
    },
  },
];

async function captureScene(scene: { name: string; draw: Draw }, seconds: number): Promise<Blob> {
  const W = 540, H = 960;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const rec = new MediaRecorder(canvas.captureStream(30), {
    mimeType: "video/webm;codecs=vp8",
    videoBitsPerSecond: 5_000_000,
  });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
  rec.start(100);
  const t0 = performance.now();
  await new Promise<void>((done) => {
    function frame() {
      const t = (performance.now() - t0) / 1000;
      if (t >= seconds) return done();
      scene.draw(ctx, t / seconds, W, H);
      requestAnimationFrame(frame);
    }
    frame();
  });
  rec.stop();
  await stopped;
  return new Blob(chunks, { type: "video/webm" });
}

export default function DemoPage() {
  const [status, setStatus] = useState("idle");
  const [url, setUrl] = useState<string | null>(null);

  async function run() {
    setStatus("filming scenes…");
    const clips = new Map<string, Blob>();
    const segments: TimelineSegment[] = [];
    // The cut: cuts + fades only; ONE light-leak into the star scene (the
    // emotional peak). Shot lengths breathe: 2.4 / 2.2 / 2.6 / 3.0 / 3.2.
    const cutPlan: { lenSec: number; transitionAfter: TimelineSegment["transitionAfter"] }[] = [
      { lenSec: 2.4, transitionAfter: "hard-cut" },
      { lenSec: 2.2, transitionAfter: "fade" },
      { lenSec: 2.6, transitionAfter: "light-leak" },
      { lenSec: 3.0, transitionAfter: "fade" },
      { lenSec: 3.2, transitionAfter: null },
    ];
    for (let i = 0; i < SCENES.length; i++) {
      setStatus(`filming ${SCENES[i].name}… (${i + 1}/${SCENES.length})`);
      const blob = await captureScene(SCENES[i], cutPlan[i].lenSec + 0.4);
      const id = uuid();
      clips.set(id, blob);
      segments.push({
        id: uuid(),
        clipId: id,
        start: 0.1,
        end: 0.1 + cutPlan[i].lenSec,
        transitionAfter: cutPlan[i].transitionAfter,
        speed: 1,
      });
    }

    let outDur = 0;
    for (const sg of segments) outDur += sg.end - sg.start;
    for (let i = 0; i < segments.length - 1; i++) {
      const r = transitionByType(segments[i].transitionAfter ?? "hard-cut");
      if (r.xfade && r.defaultDuration > 0) outDur -= r.defaultDuration;
    }

    // One quiet title. Nothing else on screen, ever.
    setStatus("title…");
    const captions: BurnCaption[] = [
      {
        png: await renderTitleCard({ title: "golden hour", subtitle: "cut by ViralEdit", style: "minimal" }),
        start: 0.4,
        end: 2.3,
      },
    ];

    // Chill score at 88 BPM; exactly TWO sound moments: a soft whoosh into
    // the light-leak, and a low impact when the stars arrive.
    setStatus("score…");
    const score = await composeScore({ bpm: 88, seconds: outDur + 0.5, mood: "chill" });
    const leakAt = segments.slice(0, 3).reduce((s, x) => s + (x.end - x.start), 0) - 0.45 - 0.5;
    const sfxAt: { time: number; type: SfxType }[] = [
      { time: Number(leakAt.toFixed(2)), type: "whoosh" },
      { time: Number((leakAt + 0.45).toFixed(2)), type: "impact" },
    ];
    const audio = await mixTimeline({ seconds: outDur + 0.5, music: score, sfxAt });

    // The look: A24 Indie with restrained grain/vignette. No letterbox on
    // vertical. No halation. No atmosphere layer — the scenes carry it.
    setStatus("rendering…");
    const out = await renderEdit(clips, segments, {
      look: {
        ...DEFAULT_LOOK,
        grade: "a24-indie",
        grain: 0.18,
        vignette: 0.3,
      },
      music: audio,
      captions,
      onProgress: (pct, msg) => setStatus(`${msg} (${pct}%)`),
    });
    const u = URL.createObjectURL(out);
    setUrl(u);
    setStatus("done");
    (window as unknown as { demoBytes: () => Promise<number[]> }).demoBytes = async () =>
      Array.from(new Uint8Array(await out.arrayBuffer()));
  }

  useEffect(() => {
    // Kicks off the async demo render once on mount; setState only happens
    // inside the .catch continuation (fetch-on-mount pattern).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    run().catch((e) => setStatus(`error: ${e}`));
  }, []);

  return (
    <main className="p-6">
      <h1 className="mb-2 text-lg font-bold">Golden hour — {status}</h1>
      {url && <video src={url} controls loop className="w-72 rounded-xl" />}
    </main>
  );
}
