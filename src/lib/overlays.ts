"use client";

// Atmosphere overlays (#17/#19/#37-alike/#39): rain, embers, dust, fog,
// light-leak, lens flare — each generated as a short canvas-drawn clip and
// composited over the final edit with blend=screen (verified in the probe).
// Everything is procedural: no assets to download, works offline.

export type OverlayType = "rain" | "embers" | "dust" | "fog" | "light-leak" | "lens-flare";

export const OVERLAY_LABELS: Record<OverlayType, { label: string; emoji: string; hint: string }> = {
  rain: { label: "Rain", emoji: "🌧️", hint: "streaking rainfall with depth layers" },
  embers: { label: "Embers", emoji: "🔥", hint: "drifting sparks rising through frame" },
  dust: { label: "Dust Motes", emoji: "✨", hint: "floating particles in a light beam" },
  fog: { label: "Fog", emoji: "🌫️", hint: "slow volumetric drift across the frame" },
  "light-leak": { label: "Light Leak", emoji: "🌅", hint: "warm leak sweeping the edge" },
  "lens-flare": { label: "Lens Flare", emoji: "🔆", hint: "tracked flare with drift" },
};

const W = 720;
const H = 1280;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
}

function drawOverlayFrame(type: OverlayType, ctx: CanvasRenderingContext2D, t: number, parts: Particle[]) {
  // black background: blend=screen makes pure black transparent
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);

  if (type === "rain") {
    ctx.strokeStyle = "rgba(210,225,245,0.8)";
    for (const p of parts) {
      ctx.lineWidth = p.size;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + p.vx * 0.04, p.y + p.vy * 0.04);
      ctx.stroke();
      p.x += p.vx * 0.016;
      p.y += p.vy * 0.016;
      if (p.y > H) {
        p.y = -20;
        p.x = Math.random() * W;
      }
    }
  } else if (type === "embers") {
    for (const p of parts) {
      const a = 0.7 + 0.3 * Math.sin(t * 6 + p.life);
      // glow halo first, hot core second — reads through compression
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 3.5);
      g.addColorStop(0, `rgba(255,190,90,${a})`);
      g.addColorStop(0.4, `rgba(255,120,40,${a * 0.5})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255,230,170,${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      p.x += p.vx * 0.016 + Math.sin(t * 2 + p.life) * 0.6;
      p.y += p.vy * 0.016;
      if (p.y < -10) {
        p.y = H + 10;
        p.x = Math.random() * W;
      }
    }
  } else if (type === "dust") {
    for (const p of parts) {
      const a = 0.3 + 0.2 * Math.sin(t * 1.5 + p.life);
      ctx.fillStyle = `rgba(255,250,235,${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      p.x += Math.sin(t * 0.8 + p.life) * 0.4;
      p.y += p.vy * 0.016;
      if (p.y > H) p.y = -5;
    }
    // faint diagonal beam
    const grad = ctx.createLinearGradient(W * 0.7, 0, W * 0.2, H);
    grad.addColorStop(0, "rgba(255,244,214,0.10)");
    grad.addColorStop(1, "rgba(255,244,214,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  } else if (type === "fog") {
    // three drifting soft blobs layered = volumetric-ish drift
    for (let i = 0; i < 3; i++) {
      const cx = ((t * (12 + i * 7) + i * 400) % (W + 800)) - 400;
      const cy = H * (0.3 + i * 0.25) + Math.sin(t * 0.4 + i) * 60;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 420);
      g.addColorStop(0, `rgba(200,205,215,${0.10 - i * 0.02})`);
      g.addColorStop(1, "rgba(200,205,215,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  } else if (type === "light-leak") {
    const sweep = (Math.sin(t * 0.5) + 1) / 2; // slow in-out
    const cx = W * (1.1 - sweep * 0.5);
    const g = ctx.createRadialGradient(cx, H * 0.2, 0, cx, H * 0.2, 700);
    g.addColorStop(0, `rgba(255,120,60,${0.25 + sweep * 0.2})`);
    g.addColorStop(0.5, `rgba(255,60,120,${0.10 + sweep * 0.08})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  } else if (type === "lens-flare") {
    // flare anchor drifts slowly around upper third (#19 "tracked" feel)
    const fx = W * (0.65 + 0.1 * Math.sin(t * 0.6));
    const fy = H * (0.22 + 0.05 * Math.sin(t * 0.45));
    const core = ctx.createRadialGradient(fx, fy, 0, fx, fy, 130);
    core.addColorStop(0, "rgba(255,245,220,0.85)");
    core.addColorStop(0.4, "rgba(255,200,140,0.25)");
    core.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = core;
    ctx.fillRect(0, 0, W, H);
    // ghost dots along the lens axis through frame center
    for (let i = 1; i <= 4; i++) {
      const gx = fx + (W / 2 - fx) * (i * 0.55);
      const gy = fy + (H / 2 - fy) * (i * 0.55);
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, 26 + i * 12);
      const hue = i % 2 ? "160,220,255" : "255,190,150";
      g.addColorStop(0, `rgba(${hue},0.22)`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    // anamorphic-style horizontal streak
    const streak = ctx.createLinearGradient(0, fy, W, fy);
    streak.addColorStop(0, "rgba(120,180,255,0)");
    streak.addColorStop(0.5, "rgba(150,200,255,0.28)");
    streak.addColorStop(1, "rgba(120,180,255,0)");
    ctx.fillStyle = streak;
    ctx.fillRect(0, fy - 3, W, 6);
  }
}

function seedParticles(type: OverlayType): Particle[] {
  const parts: Particle[] = [];
  const count = type === "rain" ? 140 : type === "embers" ? 60 : type === "dust" ? 80 : 0;
  for (let i = 0; i < count; i++) {
    parts.push({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: type === "rain" ? -120 : type === "embers" ? (Math.random() - 0.5) * 30 : 0,
      vy: type === "rain" ? 1900 + Math.random() * 700 : type === "embers" ? -(60 + Math.random() * 90) : 14 + Math.random() * 18,
      size: type === "rain" ? 1.5 + Math.random() * 2 : type === "embers" ? 2.5 + Math.random() * 3.5 : 1.5 + Math.random() * 2.8,
      life: Math.random() * 10,
    });
  }
  return parts;
}

// Record `seconds` of the overlay as a webm clip ready for blend-compositing.
export async function generateOverlayClip(type: OverlayType, seconds: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const rec = new MediaRecorder(canvas.captureStream(24), {
    mimeType: "video/webm;codecs=vp8",
    videoBitsPerSecond: 2_000_000,
  });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
  const parts = seedParticles(type);
  rec.start(100);
  const t0 = performance.now();
  await new Promise<void>((done) => {
    function frame() {
      const t = (performance.now() - t0) / 1000;
      if (t >= seconds) return done();
      drawOverlayFrame(type, ctx, t, parts);
      requestAnimationFrame(frame);
    }
    frame();
  });
  rec.stop();
  await stopped;
  return new Blob(chunks, { type: "video/webm" });
}
