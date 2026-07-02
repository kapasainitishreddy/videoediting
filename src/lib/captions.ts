"use client";

// Auto-captions, burned in. The bundled FFmpeg core has no freetype (so no
// drawtext), so we render each caption to a transparent PNG with the Canvas
// API — which also gives us real viral styling (heavy stroke, highlight
// pills, pop-in) — then composite them onto the video with time-gated
// `overlay` filters at render time.

export interface CaptionCue {
  start: number; // seconds in the FINAL edit
  end: number;
  text: string;
}

export type CaptionStyleId = "bold" | "highlight" | "subtitle" | "hook";

export interface CaptionStyle {
  id: CaptionStyleId;
  label: string;
  render: (ctx: CanvasRenderingContext2D, text: string, W: number, H: number) => void;
}

// Render dimensions match the export (720x1280).
export const CAPTION_W = 720;
export const CAPTION_H = 1280;

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export const CAPTION_STYLES: Record<CaptionStyleId, CaptionStyle> = {
  bold: {
    id: "bold",
    label: "Bold Stroke",
    render: (ctx, text, W, H) => {
      ctx.font = "800 66px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lines = wrap(ctx, text.toUpperCase(), W * 0.86);
      const lh = 78;
      const y0 = H * 0.8 - ((lines.length - 1) * lh) / 2;
      lines.forEach((ln, i) => {
        const y = y0 + i * lh;
        ctx.lineWidth = 12;
        ctx.strokeStyle = "#000";
        ctx.lineJoin = "round";
        ctx.strokeText(ln, W / 2, y);
        ctx.fillStyle = "#fff";
        ctx.fillText(ln, W / 2, y);
      });
    },
  },
  highlight: {
    id: "highlight",
    label: "Highlight Pill",
    render: (ctx, text, W, H) => {
      ctx.font = "800 60px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lines = wrap(ctx, text.toUpperCase(), W * 0.78);
      const lh = 84;
      const y0 = H * 0.78 - ((lines.length - 1) * lh) / 2;
      lines.forEach((ln, i) => {
        const y = y0 + i * lh;
        const w = ctx.measureText(ln).width;
        // rounded highlight pill
        const px = W / 2 - w / 2 - 22;
        const pw = w + 44;
        const ph = 70;
        const py = y - ph / 2;
        ctx.fillStyle = "#ff5c35";
        roundRect(ctx, px, py, pw, ph, 14);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.fillText(ln, W / 2, y);
      });
    },
  },
  subtitle: {
    id: "subtitle",
    label: "Clean Subtitle",
    render: (ctx, text, W, H) => {
      ctx.font = "600 44px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lines = wrap(ctx, text, W * 0.9);
      const lh = 56;
      const y0 = H * 0.88 - ((lines.length - 1) * lh) / 2;
      lines.forEach((ln, i) => {
        const y = y0 + i * lh;
        ctx.lineWidth = 6;
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.strokeText(ln, W / 2, y);
        ctx.fillStyle = "#fff";
        ctx.fillText(ln, W / 2, y);
      });
    },
  },
  hook: {
    id: "hook",
    label: "Center Hook",
    render: (ctx, text, W, H) => {
      ctx.font = "900 80px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lines = wrap(ctx, text.toUpperCase(), W * 0.8);
      const lh = 96;
      const y0 = H * 0.42 - ((lines.length - 1) * lh) / 2;
      lines.forEach((ln, i) => {
        const y = y0 + i * lh;
        ctx.lineWidth = 16;
        ctx.strokeStyle = "#000";
        ctx.lineJoin = "round";
        ctx.strokeText(ln, W / 2, y);
        ctx.fillStyle = "#ffe14d";
        ctx.fillText(ln, W / 2, y);
      });
    },
  },
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Render one caption cue to a transparent PNG blob.
export async function renderCuePng(text: string, styleId: CaptionStyleId): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = CAPTION_W;
  c.height = CAPTION_H;
  const ctx = c.getContext("2d")!;
  CAPTION_STYLES[styleId].render(ctx, text, CAPTION_W, CAPTION_H);
  return new Promise((res) => c.toBlob((b) => res(b!), "image/png"));
}

// Distribute typed lines across the timeline, snapping to beats when given.
export function layoutCaptions(
  lines: string[],
  totalDuration: number,
  beatTimes?: number[]
): CaptionCue[] {
  const clean = lines.map((l) => l.trim()).filter(Boolean);
  if (clean.length === 0) return [];
  const slot = totalDuration / clean.length;
  return clean.map((text, i) => {
    let start = i * slot;
    let end = start + slot;
    if (beatTimes && beatTimes.length > 1) {
      start = nearest(beatTimes, start);
      end = nearest(beatTimes, end);
      if (end <= start) end = start + slot;
    }
    return { start: Number(start.toFixed(2)), end: Number(Math.min(totalDuration, end).toFixed(2)), text };
  });
}

function nearest(arr: number[], t: number): number {
  let best = arr[0];
  let bd = Infinity;
  for (const v of arr) {
    const d = Math.abs(v - t);
    if (d < bd) {
      bd = d;
      best = v;
    }
  }
  return best;
}
