"use client";

// Virtual set library — procedural green-screen backgrounds drawn on a
// canvas at render time. No downloads, no stock-asset licenses to track,
// works offline, and each set is generated at the exact output size so the
// keyed subject sits in front of a clean plate.

export interface VirtualSet {
  id: string;
  label: string;
  hint: string;
}

export const VIRTUAL_SETS: VirtualSet[] = [
  { id: "vset:studio-glow", label: "Studio glow", hint: "soft key light on a dark stage" },
  { id: "vset:bokeh-night", label: "Bokeh night", hint: "defocused city lights" },
  { id: "vset:sunset-haze", label: "Sunset haze", hint: "warm gradient sky" },
  { id: "vset:loft-window", label: "Loft window", hint: "cool daylight panels" },
  { id: "vset:neon-grid", label: "Neon grid", hint: "retro synth stage" },
];

// Deterministic PRNG so a set looks identical between preview and render.
function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export function isVirtualSet(bg: string | undefined | null): boolean {
  return typeof bg === "string" && bg.startsWith("vset:");
}

export async function renderVirtualSet(id: string, w = 720, h = 1280): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  const rnd = lcg([...id].reduce((s, ch) => s + ch.charCodeAt(0), 7));

  const grad = (stops: [number, string][], vertical = true) => {
    const g = vertical ? ctx.createLinearGradient(0, 0, 0, h) : ctx.createLinearGradient(0, 0, w, 0);
    for (const [at, col] of stops) g.addColorStop(at, col);
    return g;
  };

  switch (id) {
    case "vset:bokeh-night": {
      ctx.fillStyle = grad([[0, "#0a0f1e"], [1, "#141024"]]);
      ctx.fillRect(0, 0, w, h);
      const palette = ["#ffb347", "#ff6b9d", "#4fc3f7", "#ffd54f", "#9575cd"];
      for (let i = 0; i < 42; i++) {
        const r = 14 + rnd() * 55;
        ctx.beginPath();
        ctx.arc(rnd() * w, rnd() * h, r, 0, Math.PI * 2);
        ctx.fillStyle = palette[Math.floor(rnd() * palette.length)];
        ctx.globalAlpha = 0.08 + rnd() * 0.22;
        ctx.filter = `blur(${(6 + rnd() * 14).toFixed(0)}px)`;
        ctx.fill();
      }
      ctx.filter = "none";
      ctx.globalAlpha = 1;
      break;
    }
    case "vset:sunset-haze": {
      ctx.fillStyle = grad([[0, "#2a1a3a"], [0.45, "#c2571b"], [0.7, "#f2a65a"], [1, "#3a2020"]]);
      ctx.fillRect(0, 0, w, h);
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.58, w * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = "#ffd9a0";
      ctx.globalAlpha = 0.85;
      ctx.filter = "blur(18px)";
      ctx.fill();
      ctx.filter = "none";
      ctx.globalAlpha = 1;
      break;
    }
    case "vset:loft-window": {
      ctx.fillStyle = grad([[0, "#2b3138"], [1, "#171b20"]]);
      ctx.fillRect(0, 0, w, h);
      const panelW = w * 0.16;
      ctx.filter = "blur(10px)";
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = "rgba(190,215,235,0.28)";
        ctx.fillRect(w * 0.12 + i * panelW * 1.25, h * 0.06, panelW, h * 0.55);
      }
      ctx.filter = "none";
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(0, h * 0.72, w, h * 0.28);
      break;
    }
    case "vset:neon-grid": {
      ctx.fillStyle = grad([[0, "#12041f"], [1, "#1c0a33"]]);
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(255,0,180,0.5)";
      ctx.lineWidth = 2;
      const horizon = h * 0.62;
      for (let i = 0; i <= 12; i++) {
        const x = (i / 12) * w;
        ctx.beginPath();
        ctx.moveTo(w / 2 + (x - w / 2) * 0.15, horizon);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let i = 0; i < 9; i++) {
        const y = horizon + (h - horizon) * (i / 9) ** 1.8;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(80,220,255,0.16)";
      ctx.filter = "blur(26px)";
      ctx.beginPath();
      ctx.arc(w / 2, horizon - h * 0.1, w * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.filter = "none";
      break;
    }
    default: {
      // studio-glow (also the fallback for unknown ids)
      ctx.fillStyle = grad([[0, "#17181d"], [1, "#0c0c10"]]);
      ctx.fillRect(0, 0, w, h);
      const glow = ctx.createRadialGradient(w / 2, h * 0.34, 10, w / 2, h * 0.34, w * 0.75);
      glow.addColorStop(0, "rgba(255,236,200,0.32)");
      glow.addColorStop(1, "rgba(255,236,200,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, h * 0.86, w, h * 0.14);
    }
  }

  return new Promise((res) => c.toBlob((b) => res(b!), "image/png"));
}
