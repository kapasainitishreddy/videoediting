"use client";

// Auto-Edit: maps the user's clips onto the blueprint's cut pattern.
// Fully local; when a MiniMax key is present /api/edit refines the plan.
// Plain-English direction is NOT interpreted here — src/lib/prompt-compiler.ts
// (called from the editor page) owns that job. It's a strict superset of the
// regex rules this file used to carry, covering color grade, transition
// style, pacing, score mood, SFX, atmosphere, and captions from one direction
// string. Keeping direction-parsing in one place avoids two systems silently
// fighting over the same segment fields and printing contradictory summaries.
import { v4 as uuid } from "uuid";
import type { EditBlueprint, EditPlan, TimelineSegment, TransitionType, UserClip } from "./types";
import { analyzeClip, topHighlights, flowAt, type ClipAnalysis } from "./clip-analysis";
import { matchTransition } from "./motion-match";
import { snapToBeats, type BeatResult } from "./beats";

// ---------------------------------------------------------------------------
// Smart Auto-Edit — the real thing. Analyzes each clip to cut on its
// highlight moment, snaps shot boundaries to the music's real beats, and
// picks each transition from the actual motion across the cut.
// ---------------------------------------------------------------------------
export interface SmartEditArgs {
  blueprint: EditBlueprint | null;
  clips: UserClip[];
  clipBlobs: Map<string, Blob>;
  direction: string;
  beats?: BeatResult | null;
  onProgress?: (msg: string) => void;
}

export async function smartAutoEdit(args: SmartEditArgs): Promise<EditPlan> {
  const { blueprint, clips, clipBlobs, direction, beats, onProgress } = args;
  if (clips.length === 0) throw new Error("Add at least one clip first");

  // 1. Shot length: prefer the music's beat (or 2 beats for calmer edits),
  //    else the reference reel's average, else a sane default.
  const wantsCalm = /slow|calm|chill|aesthetic|cinematic/i.test(direction);
  let shotLen: number;
  let rhythmNote: string;
  if (beats && beats.bpm > 0) {
    const beatLen = 60 / beats.bpm;
    shotLen = wantsCalm ? beatLen * 2 : beatLen;
    rhythmNote = `cutting every ${wantsCalm ? "2 beats" : "beat"} at ${beats.bpm} BPM (detected from your music)`;
  } else if (blueprint) {
    shotLen = Math.max(0.5, blueprint.style.avgShotLength);
    rhythmNote = `matching the reference's ~${shotLen.toFixed(1)}s shots`;
  } else {
    shotLen = wantsCalm ? 2.2 : 1.3;
    rhythmNote = `a ${wantsCalm ? "calm" : "punchy"} ${shotLen.toFixed(1)}s rhythm`;
  }

  // 2. Analyze every clip once (motion + brightness curves).
  const analyses = new Map<string, ClipAnalysis>();
  for (let i = 0; i < clips.length; i++) {
    onProgress?.(`Analyzing clip ${i + 1}/${clips.length} for its best moment…`);
    const blob = clipBlobs.get(clips[i].id);
    if (blob) analyses.set(clips[i].id, await analyzeClip(blob));
  }

  // 3. Decide how many shots. Fill roughly the reference duration (or ~12s),
  //    reusing clips as needed.
  const targetTotal = blueprint?.duration ?? Math.max(8, clips.length * shotLen * 1.5);
  const shotCount = Math.max(clips.length, Math.min(24, Math.round(targetTotal / shotLen)));

  // Track how many times each clip has been used so reuses pull different
  // highlight windows.
  const usesByClip = new Map<string, number>();
  const highlightCache = new Map<string, { start: number; end: number }[]>();

  const segments: TimelineSegment[] = [];
  for (let i = 0; i < shotCount; i++) {
    const clip = clips[i % clips.length];
    const a = analyses.get(clip.id);
    const reuse = usesByClip.get(clip.id) ?? 0;
    usesByClip.set(clip.id, reuse + 1);

    let start = 0;
    let end = Math.min(clip.duration, shotLen);
    if (a) {
      if (!highlightCache.has(clip.id)) {
        highlightCache.set(clip.id, topHighlights(a, Math.min(shotLen, a.duration), 4));
      }
      const windows = highlightCache.get(clip.id)!;
      const w = windows[reuse % windows.length];
      start = w.start;
      end = w.end;
    }
    segments.push({
      id: uuid(),
      clipId: clip.id,
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
      transitionAfter: null, // filled in step 5
      speed: 1,
    });
  }

  // 4. Snap shot lengths onto the beat grid when we have music: adjust each
  //    shot's END so cumulative cut times land on real beats.
  if (beats && beats.beatTimes.length > 1) {
    onProgress?.("Snapping cuts to the beat…");
    let clock = 0;
    const cutTimes = segments.map((s) => (clock += s.end - s.start));
    const snapped = snapToBeats(cutTimes.slice(0, -1), beats.beatTimes);
    let prev = 0;
    for (let i = 0; i < segments.length - 1; i++) {
      const target = snapped[i] - prev;
      const s = segments[i];
      const dur = Math.max(0.35, Math.min(target, s.end - s.start + 0.8));
      s.end = Number(Math.min(clips.find((c) => c.id === s.clipId)!.duration, s.start + dur).toFixed(2));
      prev = snapped[i];
    }
  }

  // 5. Motion-matched transitions: read the flow leaving each clip and
  //    entering the next, pick the transition that carries it.
  onProgress?.("Choosing transitions from the motion…");
  const reasons: string[] = [];
  for (let i = 0; i < segments.length - 1; i++) {
    const a = segments[i];
    const b = segments[i + 1];
    const blobA = clipBlobs.get(a.clipId);
    const blobB = clipBlobs.get(b.clipId);
    let type: TransitionType = "hard-cut";
    let reason = "clean cut";
    if (blobA && blobB) {
      try {
        const [flowOut, flowIn] = await Promise.all([
          flowAt(blobA, a.end, "out"),
          flowAt(blobB, b.start, "in"),
        ]);
        const anaA = analyses.get(a.clipId);
        const energyOut = anaA ? avgMotionNear(anaA, a.end) : 0.1;
        const onBeat = !!beats; // beat-snapped edits are on-beat by construction
        const m = matchTransition({ flowOut, flowIn, onBeat, energyOut });
        type = m.type;
        reason = m.reason;
      } catch {
        type = "hard-cut";
      }
    }
    a.transitionAfter = type;
    if (i < 3) reasons.push(`${type} (${reason})`);
  }

  const plan: EditPlan = {
    segments,
    colorGrade: blueprint?.style.colorGrade ?? (wantsCalm ? "cinematic" : "none"),
    aiDirection: direction,
    explanation:
      `Smart edit: ${segments.length} shots, each cut on its highlight moment, ${rhythmNote}. ` +
      `Transitions chosen from the footage motion — e.g. ${reasons.slice(0, 2).join(", ")}.`,
  };

  // Plain-English direction is applied by the caller via prompt-compiler's
  // compileDirection()/applyPlanOps(), which covers grade, transitions,
  // pacing, score, SFX, atmosphere, and captions from the same string.
  return plan;
}

function avgMotionNear(a: ClipAnalysis, time: number): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.times.length; i++) {
    if (Math.abs(a.times[i] - time) < 0.3) {
      sum += a.motion[i];
      n++;
    }
  }
  return n ? sum / n : 0.1;
}
