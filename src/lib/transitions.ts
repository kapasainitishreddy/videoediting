import type { TransitionType } from "./types";

export interface TransitionRecipe {
  type: TransitionType;
  label: string;
  emoji: string;
  description: string;
  // ffmpeg xfade transition name (or custom filter strategy)
  xfade: string | null;
  defaultDuration: number; // seconds
  beginnerTip: string;
}

// The transition library — every recipe here can actually be rendered by
// FFmpeg WASM via xfade, so the preview and the export always match.
export const TRANSITIONS: TransitionRecipe[] = [
  {
    type: "hard-cut",
    label: "Hard Cut",
    emoji: "✂️",
    description: "Instant switch between clips. The backbone of every viral edit.",
    xfade: null, // plain concat, no blend
    defaultDuration: 0,
    beginnerTip: "Cut exactly on the beat — even 3 frames late feels off.",
  },
  {
    type: "whip-pan",
    label: "Whip Pan",
    emoji: "💨",
    description: "Fast horizontal blur-slide, like the camera whipped sideways.",
    xfade: "slideleft",
    defaultDuration: 0.25,
    beginnerTip: "End clip A panning left, start clip B panning left — the motion hides the cut.",
  },
  {
    type: "zoom-in",
    label: "Zoom Punch",
    emoji: "🔍",
    description: "Punch-in zoom burst into the next clip.",
    xfade: "zoomin",
    defaultDuration: 0.3,
    beginnerTip: "Zoom toward the subject's face or the action point, never dead center.",
  },
  {
    type: "zoom-out",
    label: "Zoom Out",
    emoji: "🔭",
    description: "Pull back reveal into the next scene.",
    xfade: "smoothdown",
    defaultDuration: 0.35,
    beginnerTip: "Great for reveals — start tight on a detail, pull out to the full scene.",
  },
  {
    type: "flash",
    label: "Flash Cut",
    emoji: "⚡",
    description: "White flash frame between clips. Hits hard on bass drops.",
    xfade: "fadewhite",
    defaultDuration: 0.15,
    beginnerTip: "Save these for the drop — more than 3 per edit loses the impact.",
  },
  {
    type: "fade",
    label: "Cross Fade",
    emoji: "🌫️",
    description: "Soft blend between clips. Calm, cinematic.",
    xfade: "fade",
    defaultDuration: 0.5,
    beginnerTip: "Use for mood shifts or time passing, not for energy.",
  },
  {
    type: "glitch",
    label: "Glitch",
    emoji: "📺",
    description: "Digital distortion rip into the next clip.",
    xfade: "pixelize",
    defaultDuration: 0.2,
    beginnerTip: "Pair with a glitch sound effect — the audio sells it.",
  },
  {
    type: "spin",
    label: "Spin",
    emoji: "🌀",
    description: "Rotational whip into the next shot.",
    xfade: "circleopen",
    defaultDuration: 0.3,
    beginnerTip: "Match rotation direction across both clips for a seamless feel.",
  },
  {
    type: "slide-left",
    label: "Slide Left",
    emoji: "⬅️",
    description: "Next clip pushes in from the right.",
    xfade: "slideleft",
    defaultDuration: 0.3,
    beginnerTip: "Keep subjects on opposite sides so the slide reveals, not covers.",
  },
  {
    type: "slide-right",
    label: "Slide Right",
    emoji: "➡️",
    description: "Next clip pushes in from the left.",
    xfade: "slideright",
    defaultDuration: 0.3,
    beginnerTip: "Alternate slide directions between cuts to keep rhythm.",
  },
  {
    type: "blur",
    label: "Blur Dissolve",
    emoji: "😵‍💫",
    description: "Defocus out, refocus into the next clip.",
    xfade: "hblur",
    defaultDuration: 0.4,
    beginnerTip: "Works best between two visually busy shots.",
  },
  {
    type: "light-leak",
    label: "Light Leak",
    emoji: "🌅",
    description: "Warm light wash between clips. Travel-vlog classic.",
    xfade: "fadegrays",
    defaultDuration: 0.45,
    beginnerTip: "Use on golden-hour footage — it amplifies warm tones.",
  },
];

export const transitionByType = (t: TransitionType): TransitionRecipe =>
  TRANSITIONS.find((r) => r.type === t) ?? TRANSITIONS[0];

// Color grade presets rendered with ffmpeg eq/colorbalance filters
export const COLOR_GRADES: Record<string, { label: string; filter: string }> = {
  none: { label: "Original", filter: "" },
  warm: { label: "Warm / Golden", filter: "eq=saturation=1.15:gamma=1.05,colorbalance=rm=0.06:bm=-0.06" },
  cool: { label: "Cool / Moody", filter: "eq=saturation=0.95:gamma=0.98,colorbalance=bm=0.08:rm=-0.04" },
  "high-contrast": { label: "Punchy", filter: "eq=contrast=1.2:saturation=1.2" },
  vintage: { label: "Vintage Film", filter: "eq=saturation=0.85:gamma=1.08,colorbalance=rm=0.05:gm=0.02" },
  cinematic: { label: "Cinematic Teal-Orange", filter: "eq=contrast=1.1:saturation=1.1,colorbalance=rm=0.05:bm=0.05" },
  bw: { label: "Black & White", filter: "hue=s=0,eq=contrast=1.15" },
};
