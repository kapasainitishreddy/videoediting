"use client";

// The manual timeline: reorder, trim, split, delete, and speed-ramp shots by
// hand. Segments are the exact same TimelineSegment[] the AI auto-edit pass
// writes — this is just a second way to produce/adjust the same data.
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { ArrowLeft, ArrowRight, GripVertical, Scissors, Trash2 } from "lucide-react";
import {
  deleteSegment,
  moveSegment,
  setSegmentSpeed,
  sourceTimeInSegment,
  splitSegmentAt,
  trimSegment,
} from "@/lib/timeline-edit";
import { transitionByType, COLOR_GRADES } from "@/lib/transitions";
import type { EditPlan, TimelineSegment, UserClip } from "@/lib/types";

interface Props {
  plan: EditPlan;
  clips: UserClip[];
  onPlan: (plan: EditPlan | null) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  playheadTime: number;
  onScrubTo: (outputTime: number) => void;
  onOpenTransitionPicker: (segIndex: number) => void;
}

const MIN_PX_PER_SEC = 12;
const MAX_PX_PER_SEC = 80;

export default function Timeline({
  plan,
  clips,
  onPlan,
  selectedId,
  onSelect,
  playheadTime,
  onScrubTo,
  onOpenTransitionPicker,
}: Props) {
  const [pxPerSec, setPxPerSec] = useState(28);
  const dragState = useRef<{ segId: string; edge: "start" | "end"; startX: number; startValue: number } | null>(null);

  const clipById = new Map(clips.map((c) => [c.id, c]));
  const segments = plan.segments;

  function outputStartOf(segIndex: number): number {
    let acc = 0;
    for (let i = 0; i < segIndex; i++) acc += (segments[i].end - segments[i].start) / segments[i].speed;
    return acc;
  }

  function handleReorderIds(ids: string[]) {
    const byId = new Map(segments.map((s) => [s.id, s]));
    const reordered = ids.map((id) => byId.get(id)!).filter(Boolean);
    if (reordered.length === segments.length) onPlan({ ...plan, segments: reordered });
  }

  function beginTrim(e: ReactPointerEvent, seg: TimelineSegment, edge: "start" | "end") {
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragState.current = { segId: seg.id, edge, startX: e.clientX, startValue: edge === "start" ? seg.start : seg.end };
  }

  function onTrimMove(e: ReactPointerEvent) {
    const drag = dragState.current;
    if (!drag) return;
    const seg = segments.find((s) => s.id === drag.segId);
    const clip = seg && clipById.get(seg.clipId);
    if (!seg || !clip) return;
    const deltaSeconds = (e.clientX - drag.startX) / pxPerSec;
    const patch = drag.edge === "start" ? { start: drag.startValue + deltaSeconds } : { end: drag.startValue + deltaSeconds };
    onPlan(trimSegment(plan, seg.id, patch, clip.duration));
  }

  function endTrim(e: ReactPointerEvent) {
    if (dragState.current) (e.target as Element).releasePointerCapture(e.pointerId);
    dragState.current = null;
  }

  function selectAndSeek(segIndex: number) {
    onSelect(segments[segIndex].id);
    onScrubTo(outputStartOf(segIndex));
  }

  const selectedIndex = segments.findIndex((s) => s.id === selectedId);
  const selected = selectedIndex >= 0 ? segments[selectedIndex] : null;
  const selectedClip = selected ? clipById.get(selected.clipId) : null;
  const splitSourceTime = selected ? sourceTimeInSegment(segments, selected.id, playheadTime) : null;

  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center justify-between">
        <h2 className="text-sm font-bold">Timeline</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPxPerSec((p) => Math.max(MIN_PX_PER_SEC, p - 8))}
            className="rounded-full border border-card-border px-2 py-0.5 text-xs text-neutral-400"
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            onClick={() => setPxPerSec((p) => Math.min(MAX_PX_PER_SEC, p + 8))}
            className="rounded-full border border-card-border px-2 py-0.5 text-xs text-neutral-400"
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      </div>

      <div className="overflow-x-auto pb-2">
        <Reorder.Group
          as="div"
          axis="x"
          values={segments.map((s) => s.id)}
          onReorder={handleReorderIds}
          className="flex items-start gap-0.5"
        >
          {segments.map((seg, i) => {
            const clip = clipById.get(seg.clipId);
            const dur = (seg.end - seg.start) / seg.speed;
            const width = Math.max(48, dur * pxPerSec);
            const isSelected = seg.id === selectedId;
            return (
              <SegmentBlock
                key={seg.id}
                seg={seg}
                index={i}
                clip={clip}
                width={width}
                isSelected={isSelected}
                onSelect={() => selectAndSeek(i)}
                onTrimStart={(e) => beginTrim(e, seg, "start")}
                onTrimEnd={(e) => beginTrim(e, seg, "end")}
                onTrimMove={onTrimMove}
                onTrimUp={endTrim}
                onOpenTransitionPicker={() => onOpenTransitionPicker(i)}
                isLast={i === segments.length - 1}
              />
            );
          })}
        </Reorder.Group>
      </div>

      {selected && selectedClip && (
        <div className="card mt-2 p-3">
          <div className="flex items-center justify-between">
            <span className="truncate text-xs font-semibold text-neutral-300">
              Shot {selectedIndex + 1} — {selectedClip.name}
            </span>
            <button
              onClick={() => onSelect(null)}
              className="shrink-0 text-[11px] text-neutral-500 underline"
            >
              close
            </button>
          </div>

          <div className="mt-2 flex items-center gap-1.5">
            <button
              onClick={() => onPlan(moveSegment(plan, selectedIndex, selectedIndex - 1))}
              disabled={selectedIndex === 0}
              className="flex items-center gap-1 rounded-full border border-card-border px-2.5 py-1 text-[11px] text-neutral-300 disabled:opacity-30"
            >
              <ArrowLeft size={11} /> Move earlier
            </button>
            <button
              onClick={() => onPlan(moveSegment(plan, selectedIndex, selectedIndex + 1))}
              disabled={selectedIndex === segments.length - 1}
              className="flex items-center gap-1 rounded-full border border-card-border px-2.5 py-1 text-[11px] text-neutral-300 disabled:opacity-30"
            >
              Move later <ArrowRight size={11} />
            </button>
          </div>

          <div className="mt-2 flex items-center gap-2 text-[11px] text-neutral-500">
            <span className="font-mono">
              {selected.start.toFixed(1)}s–{selected.end.toFixed(1)}s of {selectedClip.duration.toFixed(1)}s
            </span>
            <span className="text-neutral-700">·</span>
            <span>{((selected.end - selected.start) / selected.speed).toFixed(1)}s on the timeline</span>
          </div>

          <div className="mt-2">
            <label className="text-[11px] font-semibold text-neutral-500">Speed: {selected.speed.toFixed(2)}×</label>
            <input
              type="range"
              min={0.25}
              max={4}
              step={0.05}
              value={selected.speed}
              onChange={(e) => onPlan(setSegmentSpeed(plan, selected.id, Number(e.target.value)))}
              className="mt-1 w-full accent-accent"
              aria-label="Segment speed"
            />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => {
                if (splitSourceTime == null) return;
                onPlan(splitSegmentAt(plan, selected.id, splitSourceTime));
                onSelect(null);
              }}
              disabled={splitSourceTime == null}
              className="flex items-center gap-1 rounded-full border border-card-border px-2.5 py-1 text-[11px] text-neutral-300 disabled:opacity-30"
              title={splitSourceTime == null ? "Scrub the preview into this shot first" : "Split at the playhead"}
            >
              <Scissors size={11} /> Split here
            </button>
            {!isLastIndex(selectedIndex, segments.length) && (
              <button
                onClick={() => onOpenTransitionPicker(selectedIndex)}
                className="flex items-center gap-1 rounded-full border border-card-border px-2.5 py-1 text-[11px] text-neutral-300"
              >
                {transitionByType(selected.transitionAfter ?? "hard-cut").emoji} Transition
              </button>
            )}
            <select
              value={selected.look ?? ""}
              onChange={(e) =>
                onPlan({
                  ...plan,
                  segments: plan.segments.map((s) => (s.id === selected.id ? { ...s, look: e.target.value || undefined } : s)),
                })
              }
              aria-label="Shot look"
              className="rounded-full border border-card-border bg-black px-2.5 py-1 text-[11px] text-neutral-400"
            >
              <option value="">Studio grade</option>
              {Object.entries(COLOR_GRADES)
                .filter(([key]) => key !== "none")
                .map(([key, g]) => (
                  <option key={key} value={key}>
                    {g.label}
                  </option>
                ))}
            </select>
            <button
              onClick={() => onPlan(deleteSegment(plan, selected.id))}
              className="ml-auto flex items-center gap-1 rounded-full border border-red-900/50 px-2.5 py-1 text-[11px] text-red-400"
            >
              <Trash2 size={11} /> Delete shot
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function isLastIndex(i: number, len: number) {
  return i === len - 1;
}

function SegmentBlock({
  seg,
  index,
  clip,
  width,
  isSelected,
  onSelect,
  onTrimStart,
  onTrimEnd,
  onTrimMove,
  onTrimUp,
  onOpenTransitionPicker,
  isLast,
}: {
  seg: TimelineSegment;
  index: number;
  clip: UserClip | undefined;
  width: number;
  isSelected: boolean;
  onSelect: () => void;
  onTrimStart: (e: ReactPointerEvent) => void;
  onTrimEnd: (e: ReactPointerEvent) => void;
  onTrimMove: (e: ReactPointerEvent) => void;
  onTrimUp: (e: ReactPointerEvent) => void;
  onOpenTransitionPicker: () => void;
  isLast: boolean;
}) {
  const controls = useDragControls();
  const dur = (seg.end - seg.start) / seg.speed;

  return (
    <Reorder.Item
      as="div"
      value={seg.id}
      dragListener={false}
      dragControls={controls}
      className="relative shrink-0"
      style={{ width }}
    >
      <div
        onPointerDown={(e) => controls.start(e)}
        className="flex h-4 w-full cursor-grab items-center justify-center rounded-t-md border border-b-0 border-card-border bg-neutral-900 text-neutral-600 active:cursor-grabbing"
        aria-label={`Drag to reorder shot ${index + 1}`}
      >
        <GripVertical size={11} />
      </div>
      <button
        onClick={onSelect}
        className={`relative block h-16 w-full overflow-hidden border ${isSelected ? "border-2 border-accent" : "border-card-border"}`}
      >
        {clip?.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={clip.thumbnail} alt={`Shot ${index + 1}`} className="h-full w-full object-cover" />
        ) : (
          <div className="stripes h-full w-full" />
        )}
        <span className="absolute bottom-0.5 left-0.5 rounded bg-black/70 px-1 font-mono text-[9px] text-white">
          {dur.toFixed(1)}s
        </span>
        {seg.speed !== 1 && (
          <span className="absolute right-0.5 top-0.5 rounded bg-black/70 px-1 text-[9px] text-white">{seg.speed}×</span>
        )}
      </button>
      {/* Trim handles */}
      <div
        onPointerDown={onTrimStart}
        onPointerMove={onTrimMove}
        onPointerUp={onTrimUp}
        title={`Trim the start of shot ${index + 1}`}
        className="absolute bottom-0 left-0 top-4 z-10 w-2 cursor-ew-resize touch-none bg-accent/0 hover:bg-accent/40"
        aria-hidden
      />
      <div
        onPointerDown={onTrimEnd}
        onPointerMove={onTrimMove}
        onPointerUp={onTrimUp}
        title={`Trim the end of shot ${index + 1}`}
        className="absolute bottom-0 right-0 top-4 z-10 w-2 cursor-ew-resize touch-none bg-accent/0 hover:bg-accent/40"
        aria-hidden
      />
      {!isLast && (
        <button
          onClick={onOpenTransitionPicker}
          // Sits below the whole block (grip + thumbnail + trim handles all
          // live above y=100%), so it never competes with either for clicks.
          className="absolute -right-3 top-full z-20 mt-1 flex h-6 w-6 items-center justify-center rounded-full border border-card-border bg-card text-[13px]"
          aria-label={`Transition after shot ${index + 1}`}
        >
          {transitionByType(seg.transitionAfter ?? "hard-cut").emoji}
        </button>
      )}
    </Reorder.Item>
  );
}
