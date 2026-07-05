"use client";

// On-screen graphics beyond captions: counters, countdowns, location cards,
// progress bars, emoji reactions, and watermarks. Every generator here
// returns BurnCaption-compatible cues ({png, start, end}) so the whole set
// rides the EXISTING caption burn pipeline — no new renderer code paths, and
// they compose freely with captions/titles/credits.
import type { BurnCaption } from "./ffmpeg-client";
import type { TimelineSegment } from "./types";
import type { ClipAnalysis } from "./clip-analysis";

const W = 720;
const H = 1280;

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  return [c, c.getContext("2d")!];
}

function toPng(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res) => c.toBlob((b) => res(b!), "image/png"));
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// --- Animated counter ("Day 1" → "Day 7", "$0" → "$1,000") ---------------------
// One card per value, spread evenly across the edit. Capped at 30 steps so a
// typo like "count to 5000" can't generate thousands of PNGs.
export async function counterCues(opts: {
  prefix: string; // "Day ", "$"
  from: number;
  to: number;
  totalDuration: number;
}): Promise<BurnCaption[]> {
  const steps = Math.min(30, Math.abs(opts.to - opts.from) + 1);
  const dir = opts.to >= opts.from ? 1 : -1;
  const slot = opts.totalDuration / steps;
  const cues: BurnCaption[] = [];
  for (let i = 0; i < steps; i++) {
    const value = opts.from + i * dir;
    const [c, ctx] = canvas();
    ctx.font = "900 58px Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const label = `${opts.prefix}${value.toLocaleString()}`;
    const tw = ctx.measureText(label).width;
    const px = 36;
    const py = 84;
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    pill(ctx, px - 20, py - 44, tw + 40, 88, 20);
    ctx.fill();
    ctx.fillStyle = "#ff5c35";
    ctx.fillText(label, px, py + 2);
    cues.push({
      png: await toPng(c),
      start: Number((i * slot).toFixed(2)),
      end: Number(Math.min(opts.totalDuration, (i + 1) * slot).toFixed(2)),
    });
  }
  return cues;
}

// --- Countdown (3…2…1) ending exactly at `at` ------------------------------------
export async function countdownCues(at: number, from = 3): Promise<BurnCaption[]> {
  const cues: BurnCaption[] = [];
  const n = Math.min(5, Math.max(1, Math.round(from)));
  for (let i = n; i >= 1; i--) {
    const [c, ctx] = canvas();
    ctx.font = "900 260px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 22;
    ctx.strokeStyle = "#000";
    ctx.lineJoin = "round";
    ctx.strokeText(String(i), W / 2, H * 0.45);
    ctx.fillStyle = "#fff";
    ctx.fillText(String(i), W / 2, H * 0.45);
    const start = at - i;
    if (start + 1 <= 0) continue; // countdown would start before the video
    cues.push({
      png: await toPng(c),
      start: Number(Math.max(0, start).toFixed(2)),
      end: Number((start + 1).toFixed(2)),
    });
  }
  return cues;
}

// --- Location card ("📍 Bali, Indonesia") -------------------------------------------
export async function locationCard(text: string, totalDuration: number): Promise<BurnCaption> {
  const [c, ctx] = canvas();
  ctx.font = "700 40px Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const label = `📍 ${text}`;
  const tw = ctx.measureText(label).width;
  const px = 36;
  const py = 180;
  ctx.fillStyle = "rgba(0,0,0,0.62)";
  pill(ctx, px - 18, py - 36, tw + 36, 72, 36);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.fillText(label, px, py + 2);
  // shows during the first ~3s, like a travel-vlog lower third
  return { png: await toPng(c), start: 0.4, end: Math.min(3.6, totalDuration) };
}

// --- Progress / XP bar -----------------------------------------------------------------
// Thin bar along the bottom that fills across the edit — a subtle "stay to
// the end" cue for tutorials and challenges. 12 steps keeps the PNG count low.
export async function progressBarCues(totalDuration: number, steps = 12): Promise<BurnCaption[]> {
  const cues: BurnCaption[] = [];
  const slot = totalDuration / steps;
  const barY = H - 14;
  for (let i = 0; i < steps; i++) {
    const [c, ctx] = canvas();
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(0, barY, W, 8);
    ctx.fillStyle = "#ff5c35";
    ctx.fillRect(0, barY, W * ((i + 1) / steps), 8);
    cues.push({
      png: await toPng(c),
      start: Number((i * slot).toFixed(2)),
      end: Number(Math.min(totalDuration, (i + 1) * slot).toFixed(2)),
    });
  }
  return cues;
}

// --- Emoji reactions on excitement spikes ----------------------------------------------
// Pure part: map each segment's biggest motion peak (source time) into output
// time. Exported separately so it's Node-testable.
export function emojiCueTimes(
  segments: TimelineSegment[],
  analyses: Map<string, ClipAnalysis>,
  maxCues = 3
): number[] {
  const candidates: { outTime: number; energy: number }[] = [];
  let clock = 0;
  for (const seg of segments) {
    const a = analyses.get(seg.clipId);
    const segLen = (seg.end - seg.start) / seg.speed;
    if (a) {
      let peakE = 0;
      let peakT = seg.start;
      for (let i = 0; i < a.times.length; i++) {
        if (a.times[i] >= seg.start && a.times[i] <= seg.end && a.motion[i] > peakE) {
          peakE = a.motion[i];
          peakT = a.times[i];
        }
      }
      if (peakE > 0.06) {
        candidates.push({ outTime: clock + (peakT - seg.start) / seg.speed, energy: peakE });
      }
    }
    clock += segLen;
  }
  return candidates
    .sort((a, b) => b.energy - a.energy)
    .slice(0, maxCues)
    .map((c) => Number(c.outTime.toFixed(2)))
    .sort((a, b) => a - b);
}

const REACTION_EMOJI = ["🔥", "🤯", "😮"];

export async function emojiReactionCues(times: number[], totalDuration: number): Promise<BurnCaption[]> {
  const cues: BurnCaption[] = [];
  for (let i = 0; i < times.length; i++) {
    const [c, ctx] = canvas();
    ctx.font = "150px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // alternate corners so repeats don't stack in one spot
    const x = i % 2 === 0 ? W * 0.8 : W * 0.2;
    ctx.fillText(REACTION_EMOJI[i % REACTION_EMOJI.length], x, H * 0.3);
    cues.push({
      png: await toPng(c),
      start: times[i],
      end: Number(Math.min(totalDuration, times[i] + 1.1).toFixed(2)),
    });
  }
  return cues;
}

// --- Watermark / logo overlay -------------------------------------------------------------
// Pre-composites the user's logo into a full-frame transparent PNG at the
// chosen corner and opacity — so at render time it's just one more caption
// cue spanning the whole edit. No new FFmpeg filter path, alpha handled by
// the canvas, opacity applied here via globalAlpha.
export type WatermarkCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export async function watermarkCue(
  logo: Blob,
  totalDuration: number,
  opts: { corner?: WatermarkCorner; opacity?: number; widthPx?: number } = {}
): Promise<BurnCaption> {
  const corner = opts.corner ?? "bottom-right";
  const opacity = Math.max(0.1, Math.min(1, opts.opacity ?? 0.55));
  const targetW = Math.max(60, Math.min(280, opts.widthPx ?? 150));

  const url = URL.createObjectURL(logo);
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
    img.src = url;
  });
  const scale = targetW / img.width;
  const w = targetW;
  const h = img.height * scale;
  const margin = 28;
  const x = corner.includes("left") ? margin : W - w - margin;
  // keep clear of the caption zone at the bottom and the notch zone up top
  const y = corner.includes("top") ? margin + 40 : H - h - margin - 150;

  const [c, ctx] = canvas();
  ctx.globalAlpha = opacity;
  ctx.drawImage(img, x, y, w, h);
  URL.revokeObjectURL(url);
  return { png: await toPng(c), start: 0, end: totalDuration };
}
