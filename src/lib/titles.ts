"use client";

// Title & graphics suite (#40-#44): cinematic title cards, lower thirds,
// end-credit rolls, kinetic word-by-word typography. All canvas-rendered to
// PNGs and composited with the same time-gated overlay path as captions.
import type { BurnCaption } from "./ffmpeg-client";

const W = 720;
const H = 1280;

// --- #40: title card ----------------------------------------------------------
export async function renderTitleCard(opts: {
  title: string;
  subtitle?: string;
  style?: "minimal" | "epic" | "typewriter";
}): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const style = opts.style ?? "minimal";

  if (style === "epic") {
    // dark scrim so it reads over any footage
    const g = ctx.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, 900);
    g.addColorStop(0, "rgba(0,0,0,0.55)");
    g.addColorStop(1, "rgba(0,0,0,0.85)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.font = "900 92px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.letterSpacing = "10px";
    ctx.fillStyle = "#f5efe0";
    ctx.fillText(opts.title.toUpperCase(), W / 2, H * 0.46);
    ctx.letterSpacing = "0px";
    // gold rule
    ctx.fillStyle = "#c9a45c";
    ctx.fillRect(W / 2 - 120, H * 0.49, 240, 3);
  } else if (style === "typewriter") {
    ctx.fillStyle = "rgba(10,10,10,0.75)";
    ctx.fillRect(0, 0, W, H);
    ctx.font = "700 58px 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#e8e8e8";
    ctx.fillText(opts.title, W / 2, H * 0.47);
    ctx.fillText("▌", W / 2 + ctx.measureText(opts.title).width / 2 + 22, H * 0.47);
  } else {
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, W, H);
    ctx.font = "800 76px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(opts.title, W / 2, H * 0.47);
  }
  if (opts.subtitle) {
    ctx.font = "500 34px Arial, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.textAlign = "center";
    ctx.fillText(opts.subtitle, W / 2, H * 0.53);
  }
  return new Promise((res) => c.toBlob((b) => res(b!), "image/png"));
}

// --- #42: lower third ----------------------------------------------------------
export async function renderLowerThird(name: string, role?: string): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const y = H * 0.78;
  // accent bar + translucent plate
  ctx.fillStyle = "#ff5c35";
  ctx.fillRect(48, y, 6, role ? 96 : 64);
  ctx.fillStyle = "rgba(10,10,10,0.72)";
  ctx.fillRect(54, y, 380, role ? 96 : 64);
  ctx.font = "800 38px Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.fillStyle = "#fff";
  ctx.fillText(name, 74, y + 44);
  if (role) {
    ctx.font = "500 26px Arial, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText(role, 74, y + 80);
  }
  return new Promise((res) => c.toBlob((b) => res(b!), "image/png"));
}

// --- #43: end credits — a sequence of timed frames (crawl via paging) ----------
export async function renderCreditsPages(
  lines: string[],
  secondsPerPage = 2.2
): Promise<{ png: Blob; duration: number }[]> {
  const perPage = 8;
  const pages: { png: Blob; duration: number }[] = [];
  for (let p = 0; p * perPage < lines.length; p++) {
    const slice = lines.slice(p * perPage, (p + 1) * perPage);
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "rgba(0,0,0,0.82)";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    slice.forEach((line, i) => {
      const [left, right] = line.includes("|") ? line.split("|") : [line, ""];
      const y = H * 0.3 + i * 96;
      if (right) {
        ctx.font = "500 26px Arial, sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.fillText(left.trim().toUpperCase(), W / 2, y);
        ctx.font = "700 36px Arial, sans-serif";
        ctx.fillStyle = "#fff";
        ctx.fillText(right.trim(), W / 2, y + 40);
      } else {
        ctx.font = "700 36px Arial, sans-serif";
        ctx.fillStyle = "#fff";
        ctx.fillText(left.trim(), W / 2, y);
      }
    });
    pages.push({
      png: await new Promise((res) => c.toBlob((b) => res(b!), "image/png")),
      duration: secondsPerPage,
    });
  }
  return pages;
}

// --- #41: kinetic word-by-word typography ---------------------------------------
// Split a line into words, each word gets its own PNG + time slice, with the
// current word emphasized — the trailer/TikTok "word pop" style.
export async function kineticWordCues(
  line: string,
  start: number,
  end: number
): Promise<BurnCaption[]> {
  const words = line.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const slice = (end - start) / words.length;
  const cues: BurnCaption[] = [];
  for (let i = 0; i < words.length; i++) {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d")!;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // context words (dim) with the active word big + accent
    const y = H * 0.75;
    ctx.font = "900 86px Arial, sans-serif";
    const word = words[i].toUpperCase();
    ctx.lineWidth = 14;
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#000";
    ctx.strokeText(word, W / 2, y);
    ctx.fillStyle = i % 3 === 2 ? "#ff5c35" : "#ffffff";
    ctx.fillText(word, W / 2, y);
    cues.push({
      png: await new Promise<Blob>((res) => c.toBlob((b) => res(b!), "image/png")),
      start: Number((start + i * slice).toFixed(2)),
      end: Number((start + (i + 1) * slice).toFixed(2)),
    });
  }
  return cues;
}
