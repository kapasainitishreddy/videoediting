"use client";

// Segment-accurate preview player: plays the current manual-edit timeline
// (trims + order) through a single <video> element, swapping source and
// seeking whenever the shared playhead crosses a segment boundary. This is
// a preview of the CUT only — filters/transitions/captions are what the
// real render (ffmpeg.wasm) and the "Quick draft preview" button show; this
// player exists so trimming/splitting/reordering has instant feedback
// without waiting on a render.
import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { getVideo } from "@/lib/storage";
import { locateAtOutputTime, totalOutputDuration } from "@/lib/timeline-edit";
import type { TimelineSegment } from "@/lib/types";

interface Props {
  segments: TimelineSegment[];
  time: number; // seconds, position along the OUTPUT (concatenated) timeline
  playing: boolean;
  onTimeChange: (t: number) => void;
  onPlayingChange: (playing: boolean) => void;
}

export default function PreviewPlayer({ segments, time, playing, onTimeChange, onPlayingChange }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const urlsRef = useRef<Map<string, string>>(new Map());
  const currentClipIdRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const duration = totalOutputDuration(segments);

  // Revoke every object URL on unmount.
  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
    };
  }, []);

  async function urlFor(clipId: string): Promise<string | null> {
    const cached = urlsRef.current.get(clipId);
    if (cached) return cached;
    const v = await getVideo(clipId);
    if (!v) return null;
    const url = URL.createObjectURL(v.blob);
    urlsRef.current.set(clipId, url);
    return url;
  }

  // Whenever the shared `time` moves (scrub, or a segment selection seeking
  // us), make sure the <video> element is showing the right clip at the
  // right offset.
  useEffect(() => {
    let cancelled = false;
    async function sync() {
      const loc = locateAtOutputTime(segments, time);
      const el = videoRef.current;
      if (!loc || !el) return;
      if (currentClipIdRef.current !== loc.segment.clipId) {
        const url = await urlFor(loc.segment.clipId);
        if (cancelled || !url) {
          if (!url) setError("A clip is missing from storage");
          return;
        }
        currentClipIdRef.current = loc.segment.clipId;
        el.src = url;
        await new Promise<void>((res) => {
          el.onloadedmetadata = () => res();
        });
      }
      const target = loc.segment.start + loc.offset * loc.segment.speed;
      if (Math.abs(el.currentTime - target) > 0.12) el.currentTime = target;
      setReady(true);
    }
    sync();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments.length > 0 ? segments[0]?.clipId : null, Math.round(time * 5)]);

  // Drive playback: while `playing`, advance the shared `time` from the
  // <video>'s real playback clock (rAF loop), and stop at the last segment's
  // end or a segment boundary that needs a source swap.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (!playing) {
      el.pause();
      return;
    }
    el.play().catch(() => {});
    let lastLoc = locateAtOutputTime(segments, time);
    function tick() {
      if (!el || !lastLoc) return;
      const elapsedInSeg = (el.currentTime - lastLoc.segment.start) / lastLoc.segment.speed;
      const t = lastLoc.outputStart + Math.max(0, elapsedInSeg);
      if (t >= duration - 0.02) {
        onTimeChange(duration);
        onPlayingChange(false);
        return;
      }
      onTimeChange(t);
      lastLoc = locateAtOutputTime(segments, t);
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  if (segments.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-2xl border border-card-border bg-black">
      <div className="relative flex aspect-[9/16] max-h-[50vh] items-center justify-center bg-neutral-950">
        <video ref={videoRef} playsInline muted className="h-full w-full object-contain" />
        {!ready && !error && (
          <span className="absolute text-xs text-neutral-500">Loading preview…</span>
        )}
        {error && <span className="absolute px-4 text-center text-xs text-red-400">{error}</span>}
        <button
          onClick={() => onPlayingChange(!playing)}
          aria-label={playing ? "Pause preview" : "Play preview"}
          className="absolute bottom-2 left-2 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white"
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-neutral-300">
          {time.toFixed(1)}s / {duration.toFixed(1)}s
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={duration}
        step={0.05}
        value={Math.min(time, duration)}
        onChange={(e) => onTimeChange(Number(e.target.value))}
        aria-label="Scrub preview"
        className="w-full accent-accent"
      />
      <p className="px-3 pb-2 text-[10px] text-neutral-600">
        Preview shows trims and order only — filters, transitions, and text show up in Render or Quick draft preview.
      </p>
    </div>
  );
}
