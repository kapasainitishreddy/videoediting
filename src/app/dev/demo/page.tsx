"use client";

// Dev demo: draws six content-rich "scenes" (golden hour, ocean, city
// night, forest whip, neon, sunrise) with real camera motion, captures
// each as a clip, then runs them through the SAME renderEdit() the app
// uses — so the transitions you see are the real product output, just on
// synthetic footage (no real reel is reachable from this sandbox).
import { useEffect, useRef, useState } from "react";
import { renderEdit } from "@/lib/ffmpeg-client";
import type { TimelineSegment } from "@/lib/types";
import { v4 as uuid } from "uuid";

type Draw = (ctx: CanvasRenderingContext2D, t: number, W: number, H: number) => void;

// Each scene draws a full frame at local time t (0..1 within the clip),
// with deliberate camera motion so pans/zooms are legible in transitions.
const SCENES: { name: string; draw: Draw }[] = [
  {
    name: "GOLDEN HOUR",
    draw: (c, t, W, H) => {
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#ff9a3c");
      g.addColorStop(0.5, "#ff6f61");
      g.addColorStop(1, "#4a2c5a");
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
      // sun sinking + drifting right (camera pan)
      const sx = W * 0.3 + t * W * 0.15;
      const sy = H * 0.4 + t * H * 0.06;
      const sun = c.createRadialGradient(sx, sy, 0, sx, sy, 160);
      sun.addColorStop(0, "rgba(255,245,200,0.95)");
      sun.addColorStop(1, "rgba(255,245,200,0)");
      c.fillStyle = sun;
      c.fillRect(0, 0, W, H);
      // parallax hills
      c.fillStyle = "#3a1f47";
      hill(c, W, H, 0.72, 60, t * 40);
      c.fillStyle = "#2a1533";
      hill(c, W, H, 0.82, 90, t * 80);
    },
  },
  {
    name: "OCEAN",
    draw: (c, t, W, H) => {
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#7ec7e8");
      g.addColorStop(0.45, "#2a8fbd");
      g.addColorStop(1, "#0a4d6e");
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
      // sun glint band + moving wave lines (zoom-in feel: scale up)
      c.save();
      c.translate(W / 2, H / 2);
      c.scale(1 + t * 0.25, 1 + t * 0.25);
      c.translate(-W / 2, -H / 2);
      c.strokeStyle = "rgba(255,255,255,0.5)";
      c.lineWidth = 4;
      for (let i = 0; i < 10; i++) {
        const y = H * 0.5 + i * 40 + Math.sin(t * 6 + i) * 8;
        c.beginPath();
        c.moveTo(0, y);
        for (let x = 0; x <= W; x += 20) c.lineTo(x, y + Math.sin(x / 40 + t * 8 + i) * 6);
        c.stroke();
      }
      c.restore();
    },
  },
  {
    name: "CITY NIGHT",
    draw: (c, t, W, H) => {
      c.fillStyle = "#0a0a1a";
      c.fillRect(0, 0, W, H);
      // buildings
      for (let i = 0; i < 8; i++) {
        const bx = (i / 8) * W;
        const bw = W / 8 - 6;
        const bh = H * (0.35 + ((i * 37) % 40) / 100);
        c.fillStyle = "#151530";
        c.fillRect(bx, H - bh, bw, bh);
        // windows blinking
        for (let wy = 0; wy < bh; wy += 30) {
          for (let wx = 6; wx < bw - 6; wx += 20) {
            const on = (Math.sin(t * 10 + i * 3 + wy + wx) > 0.3) ? 1 : 0.1;
            c.fillStyle = `rgba(255,210,120,${on})`;
            c.fillRect(bx + wx, H - bh + wy + 6, 10, 14);
          }
        }
      }
      // light streaks sweeping (whip motion)
      c.strokeStyle = "rgba(120,200,255,0.7)";
      c.lineWidth = 6;
      for (let s = 0; s < 4; s++) {
        const y = H * 0.75 + s * 30;
        const x = ((t * 2 + s * 0.25) % 1) * W * 1.4 - W * 0.2;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + 120, y);
        c.stroke();
      }
    },
  },
  {
    name: "FOREST",
    draw: (c, t, W, H) => {
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#a8d98a");
      g.addColorStop(1, "#1e4d2b");
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
      // trees rushing left (fast whip pan)
      for (let i = 0; i < 14; i++) {
        const base = (i / 14) * W * 2;
        const x = ((base - t * W * 2.2) % (W * 2 + 200)) - 100;
        const th = H * (0.45 + ((i * 53) % 30) / 100);
        c.fillStyle = i % 2 ? "#2d5f38" : "#24512f";
        c.fillRect(x, H - th, 40, th);
        c.beginPath();
        c.fillStyle = i % 2 ? "#3a7a48" : "#2f6b3c";
        c.arc(x + 20, H - th, 55, 0, Math.PI * 2);
        c.fill();
      }
      // light rays
      c.fillStyle = "rgba(255,255,200,0.15)";
      for (let r = 0; r < 5; r++) c.fillRect(W * (0.1 + r * 0.2) + t * 30, 0, 30, H);
    },
  },
  {
    name: "NEON",
    draw: (c, t, W, H) => {
      c.fillStyle = "#0d0221";
      c.fillRect(0, 0, W, H);
      // rotating neon grid (spin transition target)
      c.save();
      c.translate(W / 2, H / 2);
      c.rotate(t * 0.6);
      c.strokeStyle = "#ff2bd6";
      c.lineWidth = 3;
      for (let i = -10; i <= 10; i++) {
        c.globalAlpha = 0.5;
        c.beginPath();
        c.moveTo(i * 60, -H);
        c.lineTo(i * 60, H);
        c.stroke();
      }
      c.strokeStyle = "#2bd6ff";
      for (let i = -10; i <= 10; i++) {
        c.beginPath();
        c.moveTo(-W, i * 60);
        c.lineTo(W, i * 60);
        c.stroke();
      }
      c.restore();
      // pulsing sun
      c.globalAlpha = 1;
      const r = 120 + Math.sin(t * 8) * 20;
      const sun = c.createLinearGradient(W / 2 - r, H / 2 - r, W / 2 + r, H / 2 + r);
      sun.addColorStop(0, "#ff2bd6");
      sun.addColorStop(1, "#ffb63c");
      c.fillStyle = sun;
      c.beginPath();
      c.arc(W / 2, H * 0.42, r, 0, Math.PI * 2);
      c.fill();
    },
  },
  {
    name: "SUNRISE",
    draw: (c, t, W, H) => {
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#2a1a4a");
      g.addColorStop(0.6, "#ff7e5f");
      g.addColorStop(1, "#feb47b");
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
      // sun rising (zoom-out reveal)
      c.save();
      const z = 1.3 - t * 0.3;
      c.translate(W / 2, H * 0.7);
      c.scale(z, z);
      const sun = c.createRadialGradient(0, 0, 0, 0, 0, 140);
      sun.addColorStop(0, "#fff7d6");
      sun.addColorStop(1, "rgba(255,247,214,0)");
      c.fillStyle = sun;
      c.beginPath();
      c.arc(0, -t * 100, 140, 0, Math.PI * 2);
      c.fill();
      c.restore();
      c.fillStyle = "#1a0f2e";
      hill(c, W, H, 0.85, 70, 0);
    },
  },
];

function hill(c: CanvasRenderingContext2D, W: number, H: number, base: number, amp: number, phase: number) {
  c.beginPath();
  c.moveTo(0, H);
  for (let x = 0; x <= W; x += 20) c.lineTo(x, H * base + Math.sin(x / 120 + phase / 60) * amp);
  c.lineTo(W, H);
  c.closePath();
  c.fill();
}

function label(c: CanvasRenderingContext2D, text: string, W: number, H: number) {
  c.font = "700 34px system-ui, sans-serif";
  c.textAlign = "center";
  c.fillStyle = "rgba(0,0,0,0.35)";
  c.fillText(text, W / 2 + 2, H * 0.92 + 2);
  c.fillStyle = "#ffffff";
  c.fillText(text, W / 2, H * 0.92);
}

async function captureScene(scene: { name: string; draw: Draw }, seconds: number): Promise<Blob> {
  const W = 540, H = 960;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const rec = new MediaRecorder(canvas.captureStream(30), {
    mimeType: "video/webm;codecs=vp8",
    videoBitsPerSecond: 4_000_000,
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
      label(ctx, scene.name, W, H);
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
  const videoRef = useRef<HTMLVideoElement>(null);

  async function run() {
    setStatus("drawing scenes…");
    const clips = new Map<string, Blob>();
    const segments: TimelineSegment[] = [];
    // a curated transition sequence showing off the smooth ones
    const seq: TimelineSegment["transitionAfter"][] = [
      "whip-pan", "zoom-in", "fade", "spin", "zoom-out", null,
    ];
    for (let i = 0; i < SCENES.length; i++) {
      setStatus(`capturing ${SCENES[i].name}… (${i + 1}/${SCENES.length})`);
      const blob = await captureScene(SCENES[i], 2.0);
      const id = uuid();
      clips.set(id, blob);
      segments.push({
        id: uuid(),
        clipId: id,
        start: 0,
        end: 1.8,
        transitionAfter: seq[i],
        speed: 1,
      });
    }
    setStatus("rendering with real transitions…");
    const out = await renderEdit(clips, segments, "cinematic", (pct, msg) =>
      setStatus(`${msg} (${pct}%)`)
    );
    const u = URL.createObjectURL(out);
    setUrl(u);
    setStatus("done");
    (window as unknown as { demoBytes: () => Promise<number[]> }).demoBytes = async () =>
      Array.from(new Uint8Array(await out.arrayBuffer()));
  }

  useEffect(() => {
    run().catch((e) => setStatus(`error: ${e}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="p-6">
      <h1 className="mb-2 text-lg font-bold">Transition showcase — {status}</h1>
      {url && <video ref={videoRef} src={url} controls loop className="w-72 rounded-xl" />}
    </main>
  );
}
