"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Captions, Music, Plus, Sparkles, Trash2, Wand2, X } from "lucide-react";
import { v4 as uuid } from "uuid";
import { saveVideo, getVideo, saveClipMeta, deleteClipMeta, listClipMetas, deleteVideo, savePlan } from "@/lib/storage";
import { probeDuration, makeThumbnail, renderEdit, type BurnCaption } from "@/lib/ffmpeg-client";
import { smartAutoEdit } from "@/lib/auto-edit";
import { detectBeats, type BeatResult } from "@/lib/beats";
import { CAPTION_STYLES, type CaptionStyleId, layoutCaptions, renderCuePng } from "@/lib/captions";
import { TRANSITIONS, transitionByType, COLOR_GRADES } from "@/lib/transitions";
import { useProject } from "@/store/project";
import type { TransitionType, UserClip } from "@/lib/types";

const PROMPT_IDEAS = [
  "make it cinematic",
  "fast cuts, high energy",
  "smooth zoom transitions",
  "warm travel vibe",
  "calm & aesthetic",
  "edgy glitch style",
];

export default function EditorPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const musicRef = useRef<HTMLInputElement>(null);
  const { blueprint, clips, setClips, addClip, removeClip, plan, setPlan, setRenderedUrl } = useProject();

  const [music, setMusic] = useState<{ name: string; blob: Blob } | null>(null);
  const [beats, setBeats] = useState<BeatResult | null>(null);
  const [captionText, setCaptionText] = useState("");
  const [captionStyle, setCaptionStyle] = useState<CaptionStyleId>("bold");
  const [direction, setDirection] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [renderPct, setRenderPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<number | null>(null); // segment index

  // Restore clips saved in IndexedDB on reload
  useEffect(() => {
    if (clips.length === 0) {
      listClipMetas().then((metas) => metas.length && setClips(metas)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleFiles(files: FileList) {
    setError(null);
    for (const f of Array.from(files)) {
      setBusy(`Adding ${f.name}…`);
      try {
        const id = uuid();
        const [duration, thumbnail] = await Promise.all([probeDuration(f), makeThumbnail(f)]);
        await saveVideo(id, f, f.name);
        const clip: UserClip = { id, name: f.name, duration, thumbnail };
        await saveClipMeta(clip);
        addClip(clip);
      } catch {
        setError(`Couldn't read ${f.name}`);
      }
    }
    setBusy(null);
  }

  async function handleRemoveClip(id: string) {
    removeClip(id);
    await Promise.all([deleteClipMeta(id), deleteVideo(id)]);
  }

  async function handleAutoEdit() {
    setError(null);
    try {
      // Pull every clip's actual bytes so we can analyze motion + highlights
      setBusy("Loading clips…");
      const clipBlobs = new Map<string, Blob>();
      for (const c of clips) {
        const v = await getVideo(c.id);
        if (v) clipBlobs.set(c.id, v.blob);
      }

      // Detect real beats from the attached music (once)
      let beats: BeatResult | null = null;
      if (music) {
        setBusy("Listening to your music for the beat…");
        try {
          beats = await detectBeats(music.blob);
          setBeats(beats);
        } catch {
          beats = null; // fall back to reference/estimated rhythm
        }
      }

      const p = await smartAutoEdit({
        blueprint,
        clips,
        clipBlobs,
        direction,
        beats,
        onProgress: (msg) => setBusy(msg),
      });

      // Optional AI refinement — works identically no matter which key
      // (MiniMax/Anthropic/OpenAI) is configured in .env.local, since the
      // API route normalizes every provider's reply to the same schema.
      setBusy("Refining…");
      try {
        const res = await fetch("/api/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task: "edit-directions", payload: { direction, plan: p } }),
        });
        const j = await res.json();
        if (j.available && j.result?.segments?.length) {
          p.segments = j.result.segments;
          p.colorGrade = j.result.colorGrade ?? p.colorGrade;
          p.explanation += ` Refined by AI (${j.provider}).`;
        }
      } catch {
        // best-effort
      }

      setPlan(p);
      await savePlan("current", p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Auto-edit failed");
    } finally {
      setBusy(null);
    }
  }

  // Mirror renderEdit's duration math so captions line up with the output.
  function estimateOutputDuration(segments: typeof plan extends null ? never : NonNullable<typeof plan>["segments"]): number {
    let total = 0;
    for (const s of segments) total += (s.end - s.start) / s.speed;
    for (let i = 0; i < segments.length - 1; i++) {
      const r = transitionByType(segments[i].transitionAfter ?? "hard-cut");
      if (r.xfade && r.defaultDuration > 0) total -= r.defaultDuration;
    }
    return Math.max(0.5, total);
  }

  function setTransition(segIndex: number, t: TransitionType) {
    if (!plan) return;
    const segments = plan.segments.map((s, i) => (i === segIndex ? { ...s, transitionAfter: t } : s));
    setPlan({ ...plan, segments });
    setPickerFor(null);
  }

  async function handleRender() {
    if (!plan) return;
    setError(null);
    setBusy("Rendering…");
    setRenderPct(0);
    try {
      const blobs = new Map<string, Blob>();
      for (const seg of plan.segments) {
        if (!blobs.has(seg.clipId)) {
          const v = await getVideo(seg.clipId);
          if (!v) throw new Error("A clip is missing from storage");
          blobs.set(seg.clipId, v.blob);
        }
      }
      // Build burned-in captions from the typed lines, timed across the
      // final edit (snapped to beats when we have them).
      let burnCaptions: BurnCaption[] | undefined;
      const lines = captionText.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length > 0) {
        setBusy("Styling captions…");
        const outDur = estimateOutputDuration(plan.segments);
        const cues = layoutCaptions(lines, outDur, beats?.beatTimes);
        burnCaptions = [];
        for (const cue of cues) {
          burnCaptions.push({ png: await renderCuePng(cue.text, captionStyle), start: cue.start, end: cue.end });
        }
      }

      const out = await renderEdit(
        blobs,
        plan.segments,
        plan.colorGrade,
        (pct, msg) => {
          setRenderPct(pct);
          setBusy(msg);
        },
        music?.blob,
        burnCaptions
      );
      const url = URL.createObjectURL(out);
      setRenderedUrl(url);
      router.push("/export");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Render failed — try shorter clips");
      setBusy(null);
    }
  }

  return (
    <main className="flex flex-1 flex-col px-6 pb-10 pt-12">
      <header className="mb-6">
        <p className="text-xs font-bold uppercase tracking-widest text-accent">Step 2 — your clips</p>
        <h1 className="mt-1 text-2xl font-extrabold">Build your edit</h1>
        {blueprint ? (
          <p className="mt-1 text-sm text-neutral-400">
            Matching “{blueprint.sourceName}” — {blueprint.transitions.length} transitions, {blueprint.style.pacing} pacing
          </p>
        ) : (
          <p className="mt-1 text-sm text-neutral-400">No reference loaded — I'll use a classic viral pattern.</p>
        )}
      </header>

      {/* Clips shelf */}
      <section>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {clips.map((c) => (
            <div key={c.id} className="relative shrink-0">
              {c.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.thumbnail} alt={c.name} className="h-28 w-20 rounded-xl object-cover" />
              ) : (
                <div className="stripes h-28 w-20 rounded-xl" />
              )}
              <button
                onClick={() => handleRemoveClip(c.id)}
                className="absolute -right-1.5 -top-1.5 rounded-full bg-neutral-800 p-1"
                aria-label={`Remove ${c.name}`}
              >
                <X size={12} />
              </button>
              <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 font-mono text-[10px]">
                {c.duration.toFixed(1)}s
              </span>
            </div>
          ))}
          <button
            onClick={() => fileRef.current?.click()}
            className="flex h-28 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-neutral-700 text-neutral-500 active:border-accent"
          >
            <Plus size={20} className="text-accent" />
            <span className="text-[10px]">Add clip</span>
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          multiple
          hidden
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </section>

      {/* AI direction */}
      <section className="card mt-5 p-4">
        <div className="flex items-center gap-2 text-sm font-bold">
          <Sparkles size={15} className="text-accent" /> Direct the AI
        </div>
        <textarea
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
          placeholder="e.g. make it cinematic with smooth transitions, cut on every beat…"
          rows={2}
          className="mt-3 w-full resize-none rounded-xl border border-card-border bg-black px-4 py-3 text-sm outline-none placeholder:text-neutral-600 focus:border-accent"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PROMPT_IDEAS.map((p) => (
            <button
              key={p}
              onClick={() => setDirection(p)}
              className="rounded-full border border-card-border px-3 py-1 text-xs text-neutral-400 active:border-accent"
            >
              {p}
            </button>
          ))}
        </div>
        <button
          onClick={handleAutoEdit}
          disabled={!!busy || clips.length === 0}
          className="btn-primary mt-4 flex w-full items-center justify-center gap-2 py-3.5"
        >
          <Wand2 size={17} /> {plan ? "Re-edit with AI" : "Auto-edit my clips"}
        </button>
      </section>

      {/* Timeline */}
      {plan && (
        <section className="mt-5">
          <h2 className="mb-2 text-sm font-bold">Timeline — tap a transition to change it</h2>
          <p className="mb-3 text-xs leading-5 text-neutral-500">{plan.explanation}</p>
          <div className="flex items-center gap-1 overflow-x-auto pb-2">
            {plan.segments.map((seg, i) => {
              const clip = clips.find((c) => c.id === seg.clipId);
              return (
                <div key={seg.id} className="flex shrink-0 items-center gap-1">
                  <div className="relative">
                    {clip?.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={clip.thumbnail} alt="" className="h-16 w-12 rounded-lg object-cover" />
                    ) : (
                      <div className="stripes h-16 w-12 rounded-lg" />
                    )}
                    <span className="absolute bottom-0.5 left-0.5 rounded bg-black/70 px-0.5 font-mono text-[9px]">
                      {(seg.end - seg.start).toFixed(1)}s
                    </span>
                  </div>
                  {seg.transitionAfter !== null && (
                    <button
                      onClick={() => setPickerFor(i)}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-card-border bg-card text-base active:border-accent"
                      aria-label="Change transition"
                    >
                      {transitionByType(seg.transitionAfter).emoji}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Music */}
          <div className="mt-3">
            <label className="text-xs font-semibold text-neutral-500">Music</label>
            <div className="mt-1.5 flex items-center gap-2">
              <button
                onClick={() => musicRef.current?.click()}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs ${
                  music ? "bg-accent/15 font-semibold text-accent" : "border border-card-border text-neutral-400"
                }`}
              >
                <Music size={13} />
                {music ? music.name.slice(0, 28) : "Add a music track"}
              </button>
              {music && (
                <button onClick={() => setMusic(null)} className="text-neutral-600" aria-label="Remove music">
                  <X size={14} />
                </button>
              )}
            </div>
            <input
              ref={musicRef}
              type="file"
              accept="audio/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setMusic({ name: f.name, blob: f });
              }}
            />
          </div>

          {/* Captions */}
          <div className="mt-3">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-neutral-500">
              <Captions size={13} /> Captions <span className="text-neutral-600">— one line per caption</span>
            </label>
            <textarea
              value={captionText}
              onChange={(e) => setCaptionText(e.target.value)}
              rows={2}
              placeholder={"POV: you finally tried it\nwait for it…\nno way 🤯"}
              className="mt-1.5 w-full resize-none rounded-xl border border-card-border bg-black px-4 py-3 text-sm outline-none placeholder:text-neutral-600 focus:border-accent"
            />
            {captionText.trim() && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.values(CAPTION_STYLES).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setCaptionStyle(s.id)}
                    className={`rounded-full px-3 py-1 text-xs ${
                      captionStyle === s.id ? "bg-accent font-semibold text-white" : "border border-card-border text-neutral-400"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-1 text-[10px] text-neutral-600">
              {beats ? "Timed to your music's beats." : "Spread evenly across the edit. Add music to time them to the beat."}
            </p>
          </div>

          {/* Color grade */}
          <div className="mt-3">
            <label className="text-xs font-semibold text-neutral-500">Color grade</label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {Object.entries(COLOR_GRADES).map(([key, g]) => (
                <button
                  key={key}
                  onClick={() => setPlan({ ...plan, colorGrade: key })}
                  className={`rounded-full px-3 py-1 text-xs ${
                    plan.colorGrade === key
                      ? "bg-accent font-semibold text-white"
                      : "border border-card-border text-neutral-400"
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleRender}
            disabled={!!busy}
            className="btn-primary mt-5 w-full py-4 text-lg"
          >
            Render my edit →
          </button>
        </section>
      )}

      {busy && (
        <div className="mt-5">
          <div className="pulse-soft rounded-xl bg-accent/10 px-4 py-3 text-center text-sm font-medium text-accent">
            {busy}
          </div>
          {renderPct > 0 && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-800">
              <div className="h-full bg-accent transition-all" style={{ width: `${renderPct}%` }} />
            </div>
          )}
        </div>
      )}
      {error && (
        <div className="mt-5 rounded-xl bg-red-500/10 px-4 py-3 text-center text-sm text-red-400">{error}</div>
      )}

      {/* Transition picker sheet */}
      {pickerFor !== null && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/70" onClick={() => setPickerFor(null)}>
          <div
            className="slide-up mx-auto w-full max-w-md rounded-t-3xl border-t border-card-border bg-card p-5 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 text-center text-sm font-bold">Pick a transition</h3>
            <div className="grid grid-cols-3 gap-2">
              {TRANSITIONS.map((t) => (
                <button
                  key={t.type}
                  onClick={() => setTransition(pickerFor, t.type)}
                  className="flex flex-col items-center gap-1 rounded-xl border border-card-border px-2 py-3 active:border-accent"
                >
                  <span className="text-2xl">{t.emoji}</span>
                  <span className="text-[11px] font-medium">{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {clips.length > 0 && !plan && !busy && (
        <button
          onClick={() => clips.forEach((c) => handleRemoveClip(c.id))}
          className="mt-6 flex items-center justify-center gap-1 text-xs text-neutral-600"
        >
          <Trash2 size={12} /> Clear all clips
        </button>
      )}
    </main>
  );
}
