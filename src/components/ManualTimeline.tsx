"use client";

// CapCut-style manual timeline: duration-proportional clip blocks you can
// drag to reorder, trim from either edge, split, and delete — on top of the
// same EditPlan the AI auto-edit path produces, so both roads lead to the
// same renderer.
import { useEffect, useRef, useState } from "react";
import { GripVertical, Plus, Scissors, Trash2 } from "lucide-react";
import type { EditPlan, TimelineSegment, UserClip } from "@/lib/types";
import { transitionByType } from "@/lib/transitions";
import { getVideo } from "@/lib/storage";
import {
  appendClipToPlan, reorderSegments, removeSegment, splitSegment, trimSegment,
  totalTimelineDuration, timeAtPlayhead,
} from "@/lib/manual-timeline";

const PPS = 46; // pixels per second of source footage — the timeline's zoom level
const MIN_BLOCK_W = 34; // px floor so a heavily-trimmed segment stays tappable

// Thin amplitude-bar strip along a segment's bottom edge, redrawn whenever
// its slice of the clip's peaks or its on-screen width changes.
function SegmentWaveform({ peaks, width, height }: { peaks: Float32Array; width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || peaks.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, width * dpr);
    canvas.height = Math.max(1, height * dpr);
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    const barW = width / peaks.length;
    for (let i = 0; i < peaks.length; i++) {
      const h = Math.max(1, peaks[i] * height);
      ctx.fillRect(i * barW, height - h, Math.max(1, barW - 0.5), h);
    }
  }, [peaks, width, height]);
  return (
    <canvas ref={canvasRef} style={{ width, height }} className="pointer-events-none absolute bottom-0 left-0 opacity-70" />
  );
}

interface Props {
  plan: EditPlan;
  clips: UserClip[];
  setPlan: (plan: EditPlan) => void;
  onPickTransition: (index: number) => void;
}

export default function ManualTimeline({ plan, clips, setPlan, onPickTransition }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [order, setOrder] = useState<TimelineSegment[]>(plan.segments);
  const [dragId, setDragId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // The authoritative drag state lives in refs, not React state: pointerdown
  // → pointermove can fire before a state update commits/re-renders, so
  // gating the move handler on state (`dragId`) can miss a fast drag's
  // first move. `dragId`/`order` state still exist purely to repaint.
  const dragBase = useRef<{ id: string; others: TimelineSegment[]; widthById: Map<string, number> } | null>(null);
  const liveOrder = useRef<TimelineSegment[]>(plan.segments);
  const trimState = useRef<{ id: string; edge: "start" | "end"; startX: number; startValue: number } | null>(null);

  // Live preview: a real <video> seeked to whatever's under the scrubber or
  // a trim handle, so dragging shows the actual frame instead of just a
  // number. `previewActive` gates the poster fallback (the clip thumbnail)
  // before the first real seek.
  const videoRef = useRef<HTMLVideoElement>(null);
  const urlCache = useRef<Map<string, string>>(new Map());
  const [previewTime, setPreviewTime] = useState(0);
  const [previewActive, setPreviewActive] = useState(false);

  // Pinch-to-zoom: track every active pointer on the strip by id. Once two
  // are down, scale `zoom` by how the distance between them changes.
  const [zoom, setZoom] = useState(1);
  const effectivePPS = PPS * zoom;
  const activePointers = useRef<Map<number, number>>(new Map());
  const pinchStart = useRef<{ dist: number; zoom: number } | null>(null);

  useEffect(() => {
    const cache = urlCache.current;
    return () => {
      for (const url of cache.values()) URL.revokeObjectURL(url);
    };
  }, []);

  // Waveforms: decode each clip's audio once (Web Audio), cache peaks by
  // clip id. `decodingIds` just prevents kicking off the same decode twice;
  // the actual peak data lives in `waveforms` state so a block re-renders
  // once its clip's decode resolves.
  const decodingIds = useRef<Set<string>>(new Set());
  const [waveforms, setWaveforms] = useState<Map<string, Float32Array>>(new Map());

  async function decodeWaveform(clipId: string) {
    try {
      const stored = await getVideo(clipId);
      if (!stored) return;
      const AudioCtx = window.AudioContext;
      const ctx = new AudioCtx();
      const audioBuf = await ctx.decodeAudioData(await stored.blob.arrayBuffer());
      const raw = audioBuf.getChannelData(0);
      const BARS = 200;
      const blockSize = Math.max(1, Math.floor(raw.length / BARS));
      const peaks = new Float32Array(BARS);
      for (let i = 0; i < BARS; i++) {
        let max = 0;
        const start = i * blockSize;
        for (let j = 0; j < blockSize && start + j < raw.length; j++) {
          const v = Math.abs(raw[start + j]);
          if (v > max) max = v;
        }
        peaks[i] = max;
      }
      void ctx.close();
      setWaveforms((prev) => new Map(prev).set(clipId, peaks));
    } catch {
      // No audio track, unsupported format, or decode failure — the block
      // just renders without a waveform, same as any clip we never decoded.
    }
  }

  useEffect(() => {
    for (const seg of plan.segments) {
      if (!decodingIds.current.has(seg.clipId)) {
        decodingIds.current.add(seg.clipId);
        void decodeWaveform(seg.clipId);
      }
    }
  }, [plan.segments]);

  const clipOf = (seg: TimelineSegment) => clips.find((c) => c.id === seg.clipId);
  const widthOf = (seg: TimelineSegment) => Math.max(MIN_BLOCK_W, (seg.end - seg.start) * effectivePPS);

  function handleStripPointerDown(e: React.PointerEvent) {
    activePointers.current.set(e.pointerId, e.clientX);
    if (activePointers.current.size === 2) {
      const [a, b] = Array.from(activePointers.current.values());
      pinchStart.current = { dist: Math.abs(a - b), zoom };
    }
  }

  function handleStripPointerMove(e: React.PointerEvent) {
    if (!activePointers.current.has(e.pointerId)) return;
    activePointers.current.set(e.pointerId, e.clientX);
    if (activePointers.current.size === 2 && pinchStart.current) {
      const [a, b] = Array.from(activePointers.current.values());
      const dist = Math.abs(a - b);
      if (pinchStart.current.dist > 0) {
        const ratio = dist / pinchStart.current.dist;
        setZoom(Math.max(0.4, Math.min(3, pinchStart.current.zoom * ratio)));
      }
    }
  }

  function handleStripPointerUp(e: React.PointerEvent) {
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size < 2) pinchStart.current = null;
  }

  async function showFrame(clipId: string, localTime: number) {
    let url = urlCache.current.get(clipId);
    if (!url) {
      const stored = await getVideo(clipId);
      if (!stored) return;
      url = URL.createObjectURL(stored.blob);
      urlCache.current.set(clipId, url);
    }
    const v = videoRef.current;
    if (!v) return;
    setPreviewActive(true);
    if (v.src !== url) {
      v.src = url;
      await new Promise<void>((resolve) => {
        const onReady = () => {
          v.removeEventListener("loadedmetadata", onReady);
          resolve();
        };
        v.addEventListener("loadedmetadata", onReady);
      });
    }
    v.currentTime = localTime;
  }

  function scrubTo(globalTime: number) {
    const hit = timeAtPlayhead(plan.segments, globalTime);
    if (!hit) return;
    setPreviewTime(globalTime);
    void showFrame(hit.segment.clipId, hit.localTime);
  }

  const usedClipIds = new Set(plan.segments.map((s) => s.clipId));
  const unusedClips = clips.filter((c) => !usedClipIds.has(c.id));

  function handleGripDown(e: React.PointerEvent, seg: TimelineSegment) {
    e.stopPropagation();
    // Capture is best-effort (keeps the drag alive if the pointer leaves the
    // small grip); a rare capture failure shouldn't block the drag itself.
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {}
    const others = plan.segments.filter((s) => s.id !== seg.id);
    const widthById = new Map(plan.segments.map((s) => [s.id, widthOf(s)] as const));
    dragBase.current = { id: seg.id, others, widthById };
    liveOrder.current = plan.segments;
    setOrder(plan.segments);
    setDragId(seg.id);
  }

  function handleGripMove(e: React.PointerEvent, seg: TimelineSegment) {
    const base = dragBase.current;
    const container = containerRef.current;
    if (!base || !container || base.id !== seg.id) return;
    const rect = container.getBoundingClientRect();
    const contentX = e.clientX - rect.left + container.scrollLeft;

    // Recompute the target slot fresh every move (no incremental drift):
    // walk the OTHER segments' cumulative left edges and find where the
    // pointer sits relative to each one's midpoint.
    let left = 0;
    let targetIndex = base.others.length;
    for (let i = 0; i < base.others.length; i++) {
      const w = base.widthById.get(base.others[i].id) ?? MIN_BLOCK_W;
      if (contentX < left + w / 2) {
        targetIndex = i;
        break;
      }
      left += w;
    }
    const next = [...base.others];
    next.splice(targetIndex, 0, seg);
    liveOrder.current = next;
    setOrder(next);
  }

  function handleGripUp(seg: TimelineSegment) {
    const base = dragBase.current;
    if (!base || base.id !== seg.id) return;
    const fromIndex = plan.segments.findIndex((s) => s.id === seg.id);
    const toIndex = liveOrder.current.findIndex((s) => s.id === seg.id);
    dragBase.current = null;
    setDragId(null);
    if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
      setPlan(reorderSegments(plan, fromIndex, toIndex));
    }
  }

  function handleTrimDown(e: React.PointerEvent, seg: TimelineSegment, edge: "start" | "end") {
    e.stopPropagation();
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {}
    trimState.current = { id: seg.id, edge, startX: e.clientX, startValue: edge === "start" ? seg.start : seg.end };
  }

  function handleTrimMove(e: React.PointerEvent, seg: TimelineSegment) {
    const t = trimState.current;
    const clip = clipOf(seg);
    if (!t || t.id !== seg.id || !clip) return;
    const dx = e.clientX - t.startX;
    const newTime = t.startValue + dx / effectivePPS;
    const nextPlan = trimSegment(plan, seg.id, clip, t.edge, newTime);
    setPlan(nextPlan);
    // Show the real frame at the edge being dragged, not just the number.
    const updated = nextPlan.segments.find((s) => s.id === seg.id);
    if (updated) void showFrame(clip.id, t.edge === "start" ? updated.start : updated.end);
  }

  function handleTrimUp() {
    trimState.current = null;
  }

  function handleSplit(seg: TimelineSegment) {
    // Split at the scrubber's current position when it's actually parked
    // inside this segment; otherwise fall back to the midpoint (e.g. the
    // user never touched the scrubber, or it's sitting on a different shot).
    const hit = previewActive ? timeAtPlayhead(plan.segments, previewTime) : null;
    const at = hit && hit.segment.id === seg.id ? hit.localTime : (seg.start + seg.end) / 2;
    setPlan(splitSegment(plan, seg.id, at));
  }

  function handleDelete(seg: TimelineSegment) {
    setSelectedId(null);
    setPlan(removeSegment(plan, seg.id));
  }

  const displaySegments = dragId ? order : plan.segments;
  const duration = totalTimelineDuration(plan.segments);
  const firstClip = clipOf(plan.segments[0]);

  return (
    <div>
      <video
        ref={videoRef}
        muted
        playsInline
        poster={!previewActive ? firstClip?.thumbnail : undefined}
        className="mb-1.5 h-40 w-full rounded-lg bg-black object-contain"
      />
      <input
        type="range"
        min={0}
        max={duration}
        step={0.05}
        value={Math.min(previewTime, duration)}
        onChange={(e) => scrubTo(Number(e.target.value))}
        aria-label="Scrub the timeline"
        className="mb-2 w-full accent-accent"
      />
      <div
        ref={containerRef}
        onPointerDown={handleStripPointerDown}
        onPointerMove={handleStripPointerMove}
        onPointerUp={handleStripPointerUp}
        onPointerCancel={handleStripPointerUp}
        className="flex items-stretch gap-0.5 overflow-x-auto pb-2"
        style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-x" }}
      >
        {displaySegments.map((seg, i) => {
          const clip = clipOf(seg);
          const selected = selectedId === seg.id;
          const dragging = dragId === seg.id;
          const w = widthOf(seg);
          return (
            <div key={seg.id} className="flex shrink-0 items-stretch gap-0.5">
              <div
                role="button"
                tabIndex={0}
                onClick={() => setSelectedId(selected ? null : seg.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedId(selected ? null : seg.id);
                  }
                }}
                aria-pressed={selected}
                aria-label={`Shot ${i + 1}, ${(seg.end - seg.start).toFixed(1)} seconds${selected ? ", selected" : ""}`}
                className={`relative h-20 shrink-0 overflow-hidden rounded-lg border transition-transform ${
                  selected ? "border-accent ring-2 ring-accent" : "border-card-border"
                } ${dragging ? "z-10 scale-105 opacity-90 shadow-lg" : ""}`}
                style={{ width: w, transitionProperty: dragging ? "none" : "width, transform" }}
              >
                {clip?.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={clip.thumbnail}
                    alt=""
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                ) : (
                  <div className="stripes h-full w-full" />
                )}
                {(() => {
                  const peaks = clip ? waveforms.get(clip.id) : undefined;
                  if (!peaks || !clip || clip.duration <= 0) return null;
                  const startIdx = Math.max(0, Math.floor((seg.start / clip.duration) * peaks.length));
                  const endIdx = Math.min(peaks.length, Math.ceil((seg.end / clip.duration) * peaks.length));
                  const slice = peaks.slice(startIdx, Math.max(startIdx + 1, endIdx));
                  return <SegmentWaveform peaks={slice} width={w} height={18} />;
                })()}
                <span className="absolute bottom-0.5 left-0.5 rounded bg-black/70 px-1 font-mono text-[9px]">
                  {(seg.end - seg.start).toFixed(1)}s
                </span>

                {selected && (
                  <>
                    <div
                      onPointerDown={(e) => handleTrimDown(e, seg, "start")}
                      onPointerMove={(e) => handleTrimMove(e, seg)}
                      onPointerUp={handleTrimUp}
                      style={{ touchAction: "none" }}
                      className="absolute inset-y-0 left-0 flex w-3.5 cursor-ew-resize items-center justify-center bg-accent/80"
                      aria-label={`Trim start of shot ${i + 1}`}
                    >
                      <div className="h-6 w-0.5 rounded bg-white" />
                    </div>
                    <div
                      onPointerDown={(e) => handleTrimDown(e, seg, "end")}
                      onPointerMove={(e) => handleTrimMove(e, seg)}
                      onPointerUp={handleTrimUp}
                      style={{ touchAction: "none" }}
                      className="absolute inset-y-0 right-0 flex w-3.5 cursor-ew-resize items-center justify-center bg-accent/80"
                      aria-label={`Trim end of shot ${i + 1}`}
                    >
                      <div className="h-6 w-0.5 rounded bg-white" />
                    </div>
                    <div
                      onPointerDown={(e) => handleGripDown(e, seg)}
                      onPointerMove={(e) => handleGripMove(e, seg)}
                      onPointerUp={() => handleGripUp(seg)}
                      style={{ touchAction: "none" }}
                      className="absolute inset-x-0 top-0 flex h-4 cursor-grab items-center justify-center bg-black/50 active:cursor-grabbing"
                      aria-label={`Drag to reorder shot ${i + 1}`}
                    >
                      <GripVertical size={11} className="rotate-90 text-white" />
                    </div>
                  </>
                )}
              </div>

              {seg.transitionAfter !== null && (
                <button
                  onClick={() => onPickTransition(i)}
                  className="flex h-20 w-8 shrink-0 items-center justify-center rounded-lg border border-card-border bg-card text-sm active:border-accent"
                  aria-label={`Change transition after shot ${i + 1}, currently ${transitionByType(seg.transitionAfter).label}`}
                >
                  {transitionByType(seg.transitionAfter).emoji}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {selectedId && (
        <div className="mt-2 flex items-center justify-center gap-2">
          {(() => {
            const seg = plan.segments.find((s) => s.id === selectedId);
            if (!seg) return null;
            return (
              <>
                <button
                  onClick={() => handleSplit(seg)}
                  className="flex items-center gap-1.5 rounded-full border border-card-border px-3 py-1.5 text-xs font-semibold text-neutral-300 active:border-accent"
                >
                  <Scissors size={13} /> Split
                </button>
                <button
                  onClick={() => handleDelete(seg)}
                  disabled={plan.segments.length <= 1}
                  className="flex items-center gap-1.5 rounded-full border border-card-border px-3 py-1.5 text-xs font-semibold text-red-400 disabled:opacity-40"
                >
                  <Trash2 size={13} /> Delete
                </button>
              </>
            );
          })()}
        </div>
      )}

      {unusedClips.length > 0 && (
        <div className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-1">
          <span className="shrink-0 text-[10px] text-neutral-600">Add to timeline:</span>
          {unusedClips.map((c) => (
            <button
              key={c.id}
              onClick={() => setPlan(appendClipToPlan(plan, c))}
              className="flex shrink-0 items-center gap-1 rounded-full border border-card-border px-2.5 py-1 text-[11px] text-neutral-300 active:border-accent"
            >
              <Plus size={11} /> {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
