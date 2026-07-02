"use client";

// Preloaded viral templates — hand-built blueprints modeled on the most
// common viral reel formats. Pick one and jump straight to the editor
// without analyzing a reference reel first.
import type { EditBlueprint, DetectedTransition, TransitionType } from "./types";
import { buildGuide } from "./analyzer";

export interface ViralTemplate extends EditBlueprint {
  emoji: string;
  tagline: string;
}

function t(time: number, type: TransitionType, description: string, i: number): DetectedTransition {
  return { id: `tpl_t${i}`, time, type, confidence: 1, durationFrames: 9, description };
}

function makeTemplate(args: {
  id: string;
  emoji: string;
  name: string;
  tagline: string;
  bpm: number;
  energy: "low" | "medium" | "high";
  avgShotLength: number;
  pacing: "slow" | "medium" | "fast" | "frenetic";
  colorGrade: string;
  cuts: [number, TransitionType, string][];
  duration: number;
  notes: string[];
}): ViralTemplate {
  const beatLen = 60 / args.bpm;
  const beatTimes: number[] = [];
  for (let x = 0; x < args.duration; x += beatLen) beatTimes.push(Number(x.toFixed(2)));
  const partial = {
    id: args.id,
    sourceName: args.name,
    duration: args.duration,
    transitions: args.cuts.map(([time, type, desc], i) => t(time, type, desc, i)),
    beats: { bpm: args.bpm, beatTimes, energy: args.energy },
    style: {
      colorGrade: args.colorGrade,
      pacing: args.pacing,
      avgShotLength: args.avgShotLength,
      aspectRatio: "9:16",
      notes: args.notes,
    },
    createdAt: 0,
  };
  return { ...partial, guide: buildGuide(partial), emoji: args.emoji, tagline: args.tagline };
}

export const VIRAL_TEMPLATES: ViralTemplate[] = [
  makeTemplate({
    id: "tpl-beat-drop",
    emoji: "🔥",
    name: "Beat Drop",
    tagline: "Hard cuts on every beat, flash on the drop",
    bpm: 128,
    energy: "high",
    avgShotLength: 0.94,
    pacing: "fast",
    colorGrade: "high-contrast",
    duration: 12,
    cuts: [
      [0.94, "hard-cut", "Cut exactly on beat 2"],
      [1.88, "hard-cut", "Cut on beat 4"],
      [2.81, "whip-pan", "Whip left into the build-up"],
      [3.75, "hard-cut", "Cut on the snare"],
      [4.69, "flash", "White flash ON the drop — the money moment"],
      [5.63, "zoom-in", "Zoom punch straight after the drop"],
      [6.56, "hard-cut", "Back to rhythm cuts"],
      [7.5, "whip-pan", "Whip right — alternate directions"],
      [8.44, "hard-cut", "Keep the pulse"],
      [9.38, "zoom-in", "Second punch for the outro build"],
      [10.31, "flash", "Final flash into your logo/outro shot"],
    ],
    notes: [
      "Shoot 6+ clips with fast motion in each",
      "The flash cuts MUST land on the two loudest beats",
      "Keep every shot under 1 second",
    ],
  }),
  makeTemplate({
    id: "tpl-travel",
    emoji: "🌅",
    name: "Travel Vlog",
    tagline: "Warm light leaks and dreamy smooth blends",
    bpm: 95,
    energy: "medium",
    avgShotLength: 2.2,
    pacing: "medium",
    colorGrade: "warm",
    duration: 16,
    cuts: [
      [2.2, "light-leak", "Golden wash into the landscape reveal"],
      [4.4, "fade", "Soft dissolve — time passing"],
      [6.6, "whip-pan", "Whip with the direction of travel"],
      [8.8, "light-leak", "Second leak on a sun flare moment"],
      [11.0, "zoom-out", "Pull-back reveal of the location"],
      [13.2, "fade", "Gentle close toward the final shot"],
    ],
    notes: [
      "Shoot at golden hour whenever possible",
      "Pan slowly WITH your walking direction",
      "End clips on a static hold for the dissolves",
    ],
  }),
  makeTemplate({
    id: "tpl-glitch",
    emoji: "📺",
    name: "Glitch Hype",
    tagline: "Distortion rips + cool grade for edgy edits",
    bpm: 140,
    energy: "high",
    avgShotLength: 0.86,
    pacing: "frenetic",
    colorGrade: "cool",
    duration: 10,
    cuts: [
      [0.86, "glitch", "Glitch rip — pair with a static SFX"],
      [1.71, "hard-cut", "Straight cut to reset the eye"],
      [2.57, "glitch", "Second rip, harder"],
      [3.43, "whip-pan", "Whip to break the pattern"],
      [4.29, "glitch", "Glitch into the hook moment"],
      [5.14, "flash", "Flash on the bass hit"],
      [6.0, "hard-cut", "Cut"],
      [6.86, "glitch", "Rip into the finale"],
      [7.71, "zoom-in", "Punch-in for the last line"],
    ],
    notes: [
      "Underexpose slightly — the cool grade lifts it",
      "Every glitch needs a matching audio glitch/static hit",
      "Shoot handheld, embrace the shake",
    ],
  }),
  makeTemplate({
    id: "tpl-cinematic",
    emoji: "🎬",
    name: "Cinematic Slow",
    tagline: "Teal-orange grade, slow blends, film feel",
    bpm: 80,
    energy: "low",
    avgShotLength: 3.2,
    pacing: "slow",
    colorGrade: "cinematic",
    duration: 16,
    cuts: [
      [3.2, "fade", "Long dissolve — let the shots breathe"],
      [6.4, "blur", "Defocus blend on a movement match"],
      [9.6, "fade", "Dissolve on the emotional beat"],
      [12.8, "zoom-out", "Slow pull-back for the final reveal"],
    ],
    notes: [
      "Shoot in the highest resolution you have and move SLOWLY",
      "Match motion between shots — end panning left, start panning left",
      "Less is more: 5 great shots beat 12 average ones",
    ],
  }),
  makeTemplate({
    id: "tpl-zoom-punch",
    emoji: "🔍",
    name: "Zoom Punch",
    tagline: "Alternating zoom bursts that never let go",
    bpm: 120,
    energy: "high",
    avgShotLength: 1.0,
    pacing: "fast",
    colorGrade: "high-contrast",
    duration: 10,
    cuts: [
      [1.0, "zoom-in", "Punch IN toward the subject"],
      [2.0, "zoom-out", "Pull OUT — the alternation is the hook"],
      [3.0, "zoom-in", "In again, tighter"],
      [4.0, "zoom-out", "Out — keep the rhythm mechanical"],
      [5.0, "zoom-in", "In on the key moment"],
      [6.0, "flash", "Flash to break the pattern at the climax"],
      [7.0, "zoom-in", "Resume the punch loop"],
      [8.0, "zoom-out", "Final pull-back to close"],
    ],
    notes: [
      "Center your subject in EVERY shot — zooms live or die on framing",
      "Shoot slightly wide; the zoom crop needs headroom",
    ],
  }),
  makeTemplate({
    id: "tpl-smooth-flow",
    emoji: "🌊",
    name: "Smooth Flow",
    tagline: "Every cut hidden inside silky motion blends",
    bpm: 100,
    energy: "medium",
    avgShotLength: 1.8,
    pacing: "medium",
    colorGrade: "cinematic",
    duration: 13,
    cuts: [
      [1.8, "whip-pan", "Eased whip — end shot A panning, start B panning"],
      [3.6, "blur", "Blur dissolve on matched movement"],
      [5.4, "whip-pan", "Whip the other way"],
      [7.2, "zoom-in", "Smooth zoom on a forward push"],
      [9.0, "blur", "Defocus blend"],
      [10.8, "whip-pan", "Final whip into the closer"],
    ],
    notes: [
      "Motion is the glue: never cut from a static shot to a static shot",
      "Follow-through: let camera movement finish INSIDE the next clip",
    ],
  }),
];

export const templateById = (id: string) => VIRAL_TEMPLATES.find((t) => t.id === id);
