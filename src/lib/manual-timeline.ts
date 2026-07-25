// Pure logic for the manual (CapCut-style) timeline: reorder, trim, split,
// add/remove segments. No DOM — ManualTimeline.tsx owns the drag gestures
// and calls these to compute the next EditPlan.
import { v4 as uuid } from "uuid";
import type { EditPlan, TimelineSegment, UserClip } from "./types";

// Shortest a segment can be trimmed/split down to, in seconds.
export const MIN_SEGMENT = 0.2;

function withLastTransitionNull(segments: TimelineSegment[]): TimelineSegment[] {
  return segments.map((s, i, arr) => {
    if (i === arr.length - 1) return s.transitionAfter === null ? s : { ...s, transitionAfter: null };
    return s.transitionAfter === null ? { ...s, transitionAfter: "hard-cut" } : s;
  });
}

// Build a bare plan straight from the clip pool: one full-duration segment
// per clip, in upload order, hard cuts between them. The entry point into
// manual editing when no AI plan exists yet.
export function seedPlanFromClips(clips: UserClip[]): EditPlan {
  const segments: TimelineSegment[] = clips.map((c) => ({
    id: uuid(),
    clipId: c.id,
    start: 0,
    end: c.duration,
    transitionAfter: "hard-cut",
    speed: 1,
  }));
  return {
    segments: withLastTransitionNull(segments),
    colorGrade: "none",
    aiDirection: "",
    explanation: "Manual timeline",
  };
}

// Append a clip not yet on the timeline as a new full-duration segment.
export function appendClipToPlan(plan: EditPlan, clip: UserClip): EditPlan {
  const seg: TimelineSegment = {
    id: uuid(),
    clipId: clip.id,
    start: 0,
    end: clip.duration,
    transitionAfter: null,
    speed: 1,
  };
  return { ...plan, segments: withLastTransitionNull([...plan.segments, seg]) };
}

export function removeSegment(plan: EditPlan, segmentId: string): EditPlan {
  const segments = plan.segments.filter((s) => s.id !== segmentId);
  return { ...plan, segments: withLastTransitionNull(segments) };
}

// Move the segment at fromIndex to toIndex (both clamped to the array).
export function reorderSegments(plan: EditPlan, fromIndex: number, toIndex: number): EditPlan {
  const segments = [...plan.segments];
  const last = segments.length - 1;
  if (fromIndex < 0 || fromIndex > last || segments.length < 2) return plan;
  const clampedTo = Math.max(0, Math.min(toIndex, last));
  const [moved] = segments.splice(fromIndex, 1);
  segments.splice(clampedTo, 0, moved);
  return { ...plan, segments: withLastTransitionNull(segments) };
}

// Drag the left (start) or right (end) trim handle to newTime (seconds into
// the source clip). Clamped so the segment never drops below MIN_SEGMENT or
// exceeds the source clip's own duration.
export function trimSegment(
  plan: EditPlan,
  segmentId: string,
  clip: UserClip,
  edge: "start" | "end",
  newTime: number
): EditPlan {
  const segments = plan.segments.map((s) => {
    if (s.id !== segmentId) return s;
    if (edge === "start") {
      const start = Math.max(0, Math.min(newTime, s.end - MIN_SEGMENT));
      return { ...s, start };
    }
    const end = Math.min(clip.duration, Math.max(newTime, s.start + MIN_SEGMENT));
    return { ...s, end };
  });
  return { ...plan, segments };
}

export function totalTimelineDuration(segments: TimelineSegment[]): number {
  return segments.reduce((sum, s) => sum + (s.end - s.start), 0);
}

// Map a scrub position (seconds into the assembled sequence, i.e. matching
// the timeline blocks' proportional widths — NOT the shorter final render
// duration once transition overlaps are applied) to the segment playing at
// that instant and the corresponding time inside its source clip.
export function timeAtPlayhead(
  segments: TimelineSegment[],
  globalTime: number
): { segment: TimelineSegment; localTime: number } | null {
  if (segments.length === 0) return null;
  let acc = 0;
  for (const seg of segments) {
    const len = seg.end - seg.start;
    if (globalTime <= acc + len) {
      return { segment: seg, localTime: seg.start + Math.max(0, Math.min(len, globalTime - acc)) };
    }
    acc += len;
  }
  const last = segments[segments.length - 1];
  return { segment: last, localTime: last.end };
}

// Cut one segment into two at atTime (seconds into the source clip). No-op
// if atTime is too close to either edge to leave two valid segments.
export function splitSegment(plan: EditPlan, segmentId: string, atTime: number): EditPlan {
  const idx = plan.segments.findIndex((s) => s.id === segmentId);
  if (idx === -1) return plan;
  const seg = plan.segments[idx];
  if (atTime <= seg.start + MIN_SEGMENT || atTime >= seg.end - MIN_SEGMENT) return plan;
  // Left half keeps the original id — the selection (and any other UI
  // tracking this segment) stays anchored across the split.
  const left: TimelineSegment = { ...seg, end: atTime, transitionAfter: "hard-cut" };
  const right: TimelineSegment = { ...seg, id: uuid(), start: atTime };
  const segments = [...plan.segments];
  segments.splice(idx, 1, left, right);
  return { ...plan, segments };
}
