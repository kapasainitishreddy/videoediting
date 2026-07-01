"use client";

// Turns raw cut-detection samples into a full EditBlueprint.
// Works 100% locally with no API key; when a MiniMax key is added the
// /api/analyze route enriches the same data with smarter labels.
import type {
  DetectedTransition,
  EditBlueprint,
  BeatInfo,
  StyleProfile,
  GuideStep,
  TransitionType,
} from "./types";
import { transitionByType } from "./transitions";

interface Sample {
  time: number;
  delta: number;
  brightness: number;
}

export function buildTransitions(samples: Sample[]): DetectedTransition[] {
  if (samples.length < 3) return [];
  const deltas = samples.map((s) => s.delta).sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)];
  const threshold = Math.max(0.12, median * 3.5);

  const transitions: DetectedTransition[] = [];
  let lastCut = -1;

  for (let i = 1; i < samples.length - 1; i++) {
    const s = samples[i];
    if (s.delta < threshold) continue;
    if (s.time - lastCut < 0.3) continue; // debounce
    lastCut = s.time;

    const prevB = samples[i - 1].brightness;
    const nextB = samples[i + 1]?.brightness ?? prevB;

    let type: TransitionType = "hard-cut";
    let description = "Hard cut";
    // flash: brightness spikes way up at the cut
    if (s.brightness > 0.82 && prevB < 0.6) {
      type = "flash";
      description = "White flash cut — brightness spikes to full for 2-4 frames";
    } else if (s.delta > threshold * 2.2) {
      type = "whip-pan";
      description = "Very high motion across the cut — likely a whip pan or camera whip";
    } else if (Math.abs(nextB - prevB) < 0.08 && s.delta < threshold * 1.4) {
      type = "fade";
      description = "Gradual blend — soft dissolve between shots";
    }

    transitions.push({
      id: `t_${transitions.length}`,
      time: Number(s.time.toFixed(2)),
      type,
      confidence: Math.min(0.95, 0.5 + s.delta),
      durationFrames: type === "hard-cut" ? 1 : Math.round((type === "fade" ? 0.5 : 0.25) * 30),
      description,
    });
  }
  return transitions;
}

// Estimate pacing/energy from cut density; estimate BPM from cut intervals
// (viral edits cut on beat, so inter-cut intervals cluster around beat length).
export function estimateBeats(transitions: DetectedTransition[], duration: number): BeatInfo | null {
  if (transitions.length < 3) return null;
  const intervals: number[] = [];
  for (let i = 1; i < transitions.length; i++) {
    intervals.push(transitions[i].time - transitions[i - 1].time);
  }
  intervals.sort((a, b) => a - b);
  const medianInterval = intervals[Math.floor(intervals.length / 2)];
  // assume cuts land on 1, 2, or 4 beat boundaries; pick bpm in 80-160
  let bpm = 60 / medianInterval;
  while (bpm < 80) bpm *= 2;
  while (bpm > 160) bpm /= 2;
  bpm = Math.round(bpm);

  const beatLen = 60 / bpm;
  const beatTimes: number[] = [];
  for (let t = 0; t < duration; t += beatLen) beatTimes.push(Number(t.toFixed(2)));

  const cutsPerSec = transitions.length / duration;
  const energy = cutsPerSec > 0.8 ? "high" : cutsPerSec > 0.35 ? "medium" : "low";
  return { bpm, beatTimes, energy };
}

export function buildStyle(
  samples: Sample[],
  transitions: DetectedTransition[],
  duration: number
): StyleProfile {
  const avgBrightness = samples.reduce((a, s) => a + s.brightness, 0) / Math.max(1, samples.length);
  const avgShot = transitions.length > 0 ? duration / (transitions.length + 1) : duration;
  const pacing = avgShot < 0.8 ? "frenetic" : avgShot < 1.6 ? "fast" : avgShot < 3.5 ? "medium" : "slow";

  const notes: string[] = [];
  if (avgBrightness > 0.6) notes.push("Bright, high-key footage — keep exposure up when shooting yours");
  else if (avgBrightness < 0.35) notes.push("Dark, moody footage — underexpose slightly and lift shadows in the grade");
  const flashes = transitions.filter((t) => t.type === "flash").length;
  if (flashes > 0) notes.push(`${flashes} flash cut${flashes > 1 ? "s" : ""} — these land on the loudest beats`);
  const whips = transitions.filter((t) => t.type === "whip-pan").length;
  if (whips > 1) notes.push(`${whips} whip-motion cuts — shoot each clip with a fast pan out/in so they chain`);
  if (avgShot < 1.5) notes.push(`Average shot is only ${avgShot.toFixed(1)}s — keep every clip short and punchy`);

  return {
    colorGrade: avgBrightness > 0.55 ? "warm" : "cinematic",
    pacing,
    avgShotLength: Number(avgShot.toFixed(2)),
    aspectRatio: "9:16",
    notes,
  };
}

export function buildGuide(bp: Omit<EditBlueprint, "guide">): GuideStep[] {
  const steps: GuideStep[] = [];
  let n = 1;
  steps.push({
    step: n++,
    title: "Shoot your clips",
    detail: `You need about ${bp.transitions.length + 1} clips, each at least ${Math.max(
      1,
      Math.ceil(bp.style.avgShotLength + 1)
    )}s long. Film vertical (9:16). ${bp.style.notes[0] ?? ""}`,
  });
  if (bp.beats) {
    steps.push({
      step: n++,
      title: `Lock the tempo — ${bp.beats.bpm} BPM`,
      detail: `This edit cuts to a ${bp.beats.bpm} BPM track with ${bp.beats.energy} energy. Pick a song at the same tempo, or use the original audio.`,
    });
  }
  const counts = new Map<string, number>();
  for (const t of bp.transitions) counts.set(t.type, (counts.get(t.type) ?? 0) + 1);
  for (const [type, count] of counts) {
    const recipe = transitionByType(type as TransitionType);
    steps.push({
      step: n++,
      title: `${recipe.emoji} ${count}× ${recipe.label}`,
      detail: `${recipe.description} Tip: ${recipe.beginnerTip}`,
    });
  }
  steps.push({
    step: n++,
    title: "Match the pacing",
    detail: `Average shot length is ${bp.style.avgShotLength}s (${bp.style.pacing} pacing). Trim every clip to roughly that length — the app does this automatically in Auto-Edit.`,
  });
  steps.push({
    step: n++,
    title: "Grade it",
    detail: `Apply the "${bp.style.colorGrade}" color grade preset in the editor to match the reference look.`,
  });
  return steps;
}

export function assembleBlueprint(args: {
  id: string;
  sourceName: string;
  sourceUrl?: string;
  duration: number;
  samples: Sample[];
}): EditBlueprint {
  const transitions = buildTransitions(args.samples);
  const beats = estimateBeats(transitions, args.duration);
  const style = buildStyle(args.samples, transitions, args.duration);
  const partial = {
    id: args.id,
    sourceName: args.sourceName,
    sourceUrl: args.sourceUrl,
    duration: args.duration,
    transitions,
    beats,
    style,
    createdAt: Date.now(),
  };
  return { ...partial, guide: buildGuide(partial) };
}
