"use client";

// The cinematic looks engine. Every filter string here passed the WASM core
// probe (/dev/filters), so anything composable below renders for real.
// A "look" is built from: base grade → film stock → optical layer → frame
// treatment, all collapsing into one -vf chain per segment.

export interface LookConfig {
  grade: string; // key of COLOR_GRADES or GENRE_LOOKS/FILM_STOCKS below
  letterbox: boolean; // 2.39-style cinema bars (drawbox, keeps 720x1280)
  grain: number; // 0..1
  vignette: number; // 0..1
  chromaticAberration: boolean;
  anamorphic: boolean; // oval-ish flare feel: lens stretch + aberration + vignette
  halation: boolean; // soft bloom on highlights
  denoise: boolean;
  sharpen: boolean;
  dayForNight: boolean;
  goldenHour: boolean;
  haze: boolean;
  autoNormalize: boolean; // per-clip WB/exposure correction (computed separately)
}

export const DEFAULT_LOOK: LookConfig = {
  grade: "none",
  letterbox: false,
  grain: 0,
  vignette: 0,
  chromaticAberration: false,
  anamorphic: false,
  halation: false,
  denoise: false,
  sharpen: false,
  dayForNight: false,
  goldenHour: false,
  haze: false,
  autoNormalize: false,
};

// --- Film stock emulation (#4) --------------------------------------------
export const FILM_STOCKS: Record<string, { label: string; filter: string }> = {
  "kodak-warm": {
    label: "Kodak Warm",
    filter:
      "colortemperature=temperature=5200,colorbalance=rm=0.05:gm=0.01:bm=-0.05,eq=saturation=1.12:contrast=1.06,vibrance=intensity=0.15",
  },
  "fuji-cool": {
    label: "Fuji Cool",
    filter:
      "colortemperature=temperature=7000,colorbalance=gm=0.04:bm=0.05,eq=saturation=1.05:contrast=1.04,curves=preset=lighter",
  },
  "vintage-16mm": {
    label: "Vintage 16mm",
    filter:
      "eq=saturation=0.82:gamma=1.06:contrast=1.02,colorbalance=rm=0.06:gm=0.03,hue=h=4,vignette=PI/4.5",
  },
  "bleach-bypass": {
    label: "Bleach Bypass",
    filter: "eq=saturation=0.45:contrast=1.35,curves=preset=strong_contrast,unsharp=5:5:0.4",
  },
  "noir-bw": {
    label: "Silver Noir",
    filter: "hue=s=0,curves=preset=strong_contrast,eq=contrast=1.2:brightness=-0.02,vignette=PI/4.2",
  },
};

// --- Genre looks (#50) ------------------------------------------------------
export const GENRE_LOOKS: Record<string, { label: string; filter: string; pairs: Partial<LookConfig> }> = {
  "neo-noir": {
    label: "Neo-Noir",
    filter:
      "eq=saturation=0.85:contrast=1.22:brightness=-0.03,colorbalance=bm=0.10:rm=-0.02,curves=preset=darker,vibrance=intensity=-0.1",
    pairs: { vignette: 0.7, grain: 0.25, letterbox: true },
  },
  "a24-indie": {
    label: "A24 Indie",
    filter:
      "colortemperature=temperature=5600,eq=saturation=0.92:gamma=1.05:contrast=0.98,colorbalance=gm=0.02:rm=0.02,curves=preset=lighter",
    pairs: { grain: 0.35, vignette: 0.25 },
  },
  blockbuster: {
    label: "Blockbuster",
    filter:
      "eq=contrast=1.15:saturation=1.15,colorbalance=rm=0.08:bm=0.08:gm=-0.03,unsharp=5:5:0.5,vibrance=intensity=0.2",
    pairs: { letterbox: true, vignette: 0.35 },
  },
  documentary: {
    label: "Documentary",
    filter: "colortemperature=temperature=6200,eq=saturation=0.98:contrast=1.03,hqdn3d=2:1:3:2",
    pairs: {},
  },
  horror: {
    label: "Horror",
    filter:
      "eq=saturation=0.6:contrast=1.18:brightness=-0.06,colorbalance=gm=0.05:bm=0.06,curves=preset=darker",
    pairs: { vignette: 0.85, grain: 0.4, dayForNight: false },
  },
};

// --- Effect layers -----------------------------------------------------------
export function dayForNightFilter(): string {
  // #3: desaturate, blue shift, crush blacks, drop exposure
  return "eq=saturation=0.55:brightness=-0.14:contrast=1.12,colorbalance=bm=0.22:rm=-0.10,curves=preset=darker";
}

export function goldenHourFilter(): string {
  // #20: warm temp, lifted gamma, soft magenta in shadows
  return "colortemperature=temperature=4300,eq=gamma=1.08:saturation=1.15,colorbalance=rm=0.10:bm=-0.08,vibrance=intensity=0.25";
}

export function hazeFilter(): string {
  // #18: lifted blacks + slight blur bloom = atmospheric depth
  return "curves=all='0/0.08 0.5/0.55 1/0.98',gblur=sigma=0.6,eq=saturation=0.92";
}

export function anamorphicFilter(): string {
  // #31: subtle horizontal squeeze-release + aberration + oval vignette
  return "lenscorrection=k1=-0.05:k2=-0.01,rgbashift=rh=2:bh=-2,vignette=PI/4.6";
}

// Build the complete -vf chain for a segment (before format=yuv420p).
export function buildLookFilter(look: LookConfig, gradeFilter: string): string {
  const parts: string[] = [];

  if (look.denoise) parts.push("hqdn3d=3:2:4:3"); // #45 before grading
  if (look.autoNormalize) {
    /* per-clip normalize filter is injected separately (needs measurement) */
  }

  // base grade: COLOR_GRADES value, or a stock/genre chain
  const stock = FILM_STOCKS[look.grade];
  const genre = GENRE_LOOKS[look.grade];
  if (stock) parts.push(stock.filter);
  else if (genre) parts.push(genre.filter);
  else if (gradeFilter) parts.push(gradeFilter);

  if (look.goldenHour) parts.push(goldenHourFilter());
  if (look.dayForNight) parts.push(dayForNightFilter());
  if (look.haze) parts.push(hazeFilter());
  if (look.anamorphic) parts.push(anamorphicFilter());
  else if (look.chromaticAberration) parts.push("rgbashift=rh=2:bh=-2"); // #32

  if (look.halation) parts.push("gblur=sigma=0.4,unsharp=7:7:-0.3,eq=contrast=1.03"); // soft bloom
  if (look.sharpen) parts.push("unsharp=5:5:0.6");
  if (look.vignette > 0) {
    const angle = (Math.PI / 5) * Math.min(1, look.vignette) + Math.PI / 20;
    parts.push(`vignette=${angle.toFixed(3)}`);
  }
  if (look.grain > 0) {
    const amt = Math.round(6 + look.grain * 18);
    parts.push(`noise=alls=${amt}:allf=t+u`); // #4/#32 film grain
  }
  if (look.letterbox) {
    // #13/#34: 2.39-flavored cinema bars on the 720x1280 canvas (11.5% each)
    parts.push(
      "drawbox=x=0:y=0:w=720:h=148:color=black:t=fill,drawbox=x=0:y=1132:w=720:h=148:color=black:t=fill"
    );
  }
  return parts.join(",");
}

// --- Per-clip color measurement for auto WB / exposure matching (#5, #46) ---
export interface ColorStats {
  luma: number; // 0..1
  r: number;
  g: number;
  b: number;
}

export async function measureColor(blob: Blob, samples = 5): Promise<ColorStats> {
  const url = URL.createObjectURL(blob);
  const v = document.createElement("video");
  v.preload = "auto";
  v.muted = true;
  v.src = url;
  await new Promise<void>((res, rej) => {
    v.onloadeddata = () => res();
    v.onerror = () => rej(new Error("measure load failed"));
  });
  const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 3;
  const S = 32;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < samples; i++) {
    const t = ((i + 0.5) / samples) * dur;
    await new Promise<void>((res) => {
      v.onseeked = () => res();
      v.currentTime = Math.min(dur - 0.05, t);
    });
    ctx.drawImage(v, 0, 0, S, S);
    const d = ctx.getImageData(0, 0, S, S).data;
    for (let p = 0; p < d.length; p += 4) {
      r += d[p];
      g += d[p + 1];
      b += d[p + 2];
      n++;
    }
  }
  URL.revokeObjectURL(url);
  r /= n * 255;
  g /= n * 255;
  b /= n * 255;
  return { luma: 0.2126 * r + 0.7152 * g + 0.0722 * b, r, g, b };
}

// Compute a corrective filter that neutralizes a clip's cast and pulls its
// exposure toward the group target — shots stop jumping at every cut.
export function normalizeFilter(stats: ColorStats, targetLuma: number): string {
  const gray = (stats.r + stats.g + stats.b) / 3;
  const castR = stats.r - gray;
  const castB = stats.b - gray;
  const brightness = Math.max(-0.25, Math.min(0.25, (targetLuma - stats.luma) * 0.9));
  const parts: string[] = [];
  if (Math.abs(castR) > 0.015 || Math.abs(castB) > 0.015) {
    const rm = Math.max(-0.3, Math.min(0.3, -castR * 1.6));
    const bm = Math.max(-0.3, Math.min(0.3, -castB * 1.6));
    parts.push(`colorbalance=rm=${rm.toFixed(3)}:bm=${bm.toFixed(3)}`);
  }
  if (Math.abs(brightness) > 0.02) parts.push(`eq=brightness=${brightness.toFixed(3)}`);
  return parts.join(",");
}

// --- Reference-match grading from an image (#2) ------------------------------
export async function gradeFromImage(img: Blob): Promise<{ filter: string; summary: string }> {
  const url = URL.createObjectURL(img);
  const el = new Image();
  await new Promise((res, rej) => {
    el.onload = res;
    el.onerror = rej;
    el.src = url;
  });
  const S = 48;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(el, 0, 0, S, S);
  const d = ctx.getImageData(0, 0, S, S).data;
  URL.revokeObjectURL(url);

  let r = 0, g = 0, b = 0;
  const lumas: number[] = [];
  for (let p = 0; p < d.length; p += 4) {
    r += d[p];
    g += d[p + 1];
    b += d[p + 2];
    lumas.push((0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) / 255);
  }
  const n = d.length / 4;
  r /= n * 255;
  g /= n * 255;
  b /= n * 255;
  lumas.sort((a, x) => a - x);
  const p10 = lumas[Math.floor(n * 0.1)];
  const p90 = lumas[Math.floor(n * 0.9)];
  const contrast = Math.max(0.85, Math.min(1.35, 0.9 + (p90 - p10)));
  const gray = (r + g + b) / 3;
  const sat = Math.max(0.6, Math.min(1.4, 0.7 + (Math.abs(r - gray) + Math.abs(g - gray) + Math.abs(b - gray)) * 4));
  const warm = r - b; // >0 warm, <0 cool

  const filter = [
    `eq=contrast=${contrast.toFixed(2)}:saturation=${sat.toFixed(2)}`,
    `colorbalance=rm=${(warm * 0.8).toFixed(3)}:bm=${(-warm * 0.8).toFixed(3)}`,
  ].join(",");
  const summary = `${warm > 0.02 ? "warm" : warm < -0.02 ? "cool" : "neutral"}, ${
    contrast > 1.1 ? "high" : "soft"
  } contrast, ${sat > 1.1 ? "rich" : "muted"} color`;
  return { filter, summary };
}

// --- One-tap Cinematic-ify (#48) --------------------------------------------
export function cinematicify(): LookConfig {
  return {
    ...DEFAULT_LOOK,
    grade: "blockbuster",
    letterbox: true,
    grain: 0.25,
    vignette: 0.4,
    halation: true,
    autoNormalize: true,
    chromaticAberration: false,
    anamorphic: false,
    denoise: false,
    sharpen: false,
    dayForNight: false,
    goldenHour: false,
    haze: false,
  };
}
