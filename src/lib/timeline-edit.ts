// Manual timeline operations — the pure counterpart to smartAutoEdit. Every
// op here takes an EditPlan (or null) and a patch, and returns a new
// EditPlan, so the editor's "add to timeline / drag / trim / split / delete"
// interactions and the AI auto-edit pass write to the exact same data model.
import { v4 as uuid } from "uuid";
import type { EditPlan, TimelineSegment, UserClip } from "./types";

// Anything shorter than this (seconds) isn't a usable shot — trims and
// splits are clamped so a segment never collapses below it.
export const MIN_SEGMENT_SECONDS = 0.15;

export function planFromClips(clips: UserClip[]): EditPlan {
  return {
    segments: clips.map((c) => ({
      id: uuid(),
      clipId: c.id,
      start: 0,
      end: c.duration,
      transitionAfter: "hard-cut",
      speed: 1,
    })),
    colorGrade: "none",
    aiDirection: "",
    explanation: "Manual edit — clips added directly to the timeline.",
  };
}

// Appends one full-length segment for `clip`. Builds a fresh plan from just
// this clip if there isn't one yet.
export function addClipAsSegment(plan: EditPlan | null, clip: UserClip): EditPlan {
  const segment: TimelineSegment = {
    id: uuid(),
    clipId: clip.id,
    start: 0,
    end: clip.duration,
    transitionAfter: "hard-cut",
    speed: 1,
  };
  if (!plan) return { ...planFromClips([]), segments: [segment] };
  return { ...plan, segments: [...plan.segments, segment] };
}

export function moveSegment(plan: EditPlan, fromIndex: number, toIndex: number): EditPlan {
  const segments = [...plan.segments];
  if (
    fromIndex < 0 || fromIndex >= segments.length ||
    toIndex < 0 || toIndex >= segments.length ||
    fromIndex === toIndex
  ) {
    return plan;
  }
  const [moved] = segments.splice(fromIndex, 1);
  segments.splice(toIndex, 0, moved);
  return { ...plan, segments };
}

// Reorders segments to match an explicit list of ids (what framer-motion's
// Reorder.Group hands back on every drag frame).
export function reorderSegmentsByIds(plan: EditPlan, orderedIds: string[]): EditPlan {
  const byId = new Map(plan.segments.map((s) => [s.id, s]));
  const segments = orderedIds.map((id) => byId.get(id)).filter((s): s is TimelineSegment => !!s);
  if (segments.length !== plan.segments.length) return plan; // ids didn't round-trip cleanly
  return { ...plan, segments };
}

export function trimSegment(
  plan: EditPlan,
  segId: string,
  patch: { start?: number; end?: number },
  clipDuration: number
): EditPlan {
  const segments = plan.segments.map((s) => {
    if (s.id !== segId) return s;
    let start = patch.start ?? s.start;
    let end = patch.end ?? s.end;
    start = Math.max(0, Math.min(start, clipDuration - MIN_SEGMENT_SECONDS));
    end = Math.max(start + MIN_SEGMENT_SECONDS, Math.min(end, clipDuration));
    return { ...s, start, end };
  });
  return { ...plan, segments };
}

export function setSegmentSpeed(plan: EditPlan, segId: string, speed: number): EditPlan {
  const clamped = Math.max(0.25, Math.min(4, speed));
  return {
    ...plan,
    segments: plan.segments.map((s) => (s.id === segId ? { ...s, speed: clamped } : s)),
  };
}

// Splits one segment into two at an absolute source-clip time. The first
// half keeps the original's transition slot as "hard-cut" (a real cut now
// sits between the two halves); the second half keeps the original
// transitionAfter (into whatever followed it). A genuine no-op (returns the
// same plan reference) when `sourceTime` doesn't leave both halves at least
// MIN_SEGMENT_SECONDS long — no silent snapping to a barely-valid position.
export function splitSegmentAt(plan: EditPlan, segId: string, sourceTime: number): EditPlan {
  const i = plan.segments.findIndex((s) => s.id === segId);
  if (i === -1) return plan;
  const seg = plan.segments[i];
  if (sourceTime <= seg.start + MIN_SEGMENT_SECONDS || sourceTime >= seg.end - MIN_SEGMENT_SECONDS) return plan;
  const cut = sourceTime;
  const first: TimelineSegment = { ...seg, id: uuid(), end: cut, transitionAfter: "hard-cut" };
  const second: TimelineSegment = { ...seg, id: uuid(), start: cut };
  const segments = [...plan.segments];
  segments.splice(i, 1, first, second);
  return { ...plan, segments };
}

// Removes a segment. Returns null when it was the last one — mirrors the
// "no plan" state the rest of the editor already treats as "nothing to render".
export function deleteSegment(plan: EditPlan, segId: string): EditPlan | null {
  const segments = plan.segments.filter((s) => s.id !== segId);
  if (segments.length === 0) return null;
  return { ...plan, segments };
}

// --- output-timeline <-> source-time mapping --------------------------------
// Shared by the preview player and the timeline UI so "where the playhead
// is" always means the same thing in both places.

export function totalOutputDuration(segments: TimelineSegment[]): number {
  return segments.reduce((sum, s) => sum + (s.end - s.start) / s.speed, 0);
}

export interface LocatedSegment {
  segment: TimelineSegment;
  index: number;
  offset: number; // seconds into this segment's OUTPUT duration (post-speed)
  outputStart: number; // where this segment starts on the OUTPUT timeline
}

// Maps a position on the concatenated OUTPUT timeline to the segment
// playing there, clamping to the first/last segment outside [0, duration].
export function locateAtOutputTime(segments: TimelineSegment[], t: number): LocatedSegment | null {
  let acc = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const dur = (seg.end - seg.start) / seg.speed;
    if (t <= acc + dur || i === segments.length - 1) {
      return { segment: seg, index: i, offset: Math.max(0, Math.min(t - acc, dur)), outputStart: acc };
    }
    acc += dur;
  }
  return null;
}

// The absolute source-clip time under the playhead when it's within `segId`,
// or null if the playhead isn't currently in that segment.
export function sourceTimeInSegment(segments: TimelineSegment[], segId: string, outputTime: number): number | null {
  const loc = locateAtOutputTime(segments, outputTime);
  if (!loc || loc.segment.id !== segId) return null;
  return loc.segment.start + loc.offset * loc.segment.speed;
}
