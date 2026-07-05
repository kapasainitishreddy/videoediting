// Pure data for the cinematic looks engine — no "use client", no DOM — so
// both the browser (cinematic.ts, StudioPanel) and the server (the
// prompt-compiler normalizer inside /api/ai) can import the same tables.
// Every filter string here passed the WASM core probe (/dev/filters).

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
