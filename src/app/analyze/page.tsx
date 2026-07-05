"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Music, Palette, Scissors, ListChecks, RotateCcw, Activity, Camera, Heart, Send } from "lucide-react";
import { getVideo, getBlueprint, saveBlueprint, saveFingerprint } from "@/lib/storage";
import { paceAnalysis, shotList, fingerprintOf, migrateFormat } from "@/lib/intelligence";
import { detectTransitionsV2 } from "@/lib/detect";
import { assembleBlueprintV2 } from "@/lib/analyzer";
import { transitionByType } from "@/lib/transitions";
import { classifyNicheLocal, nicheEmoji, type StyleHints } from "@/lib/niche";
import { useProject } from "@/store/project";
import type { EditBlueprint } from "@/lib/types";

// Grab a few evenly-spaced frames as JPEG data URIs for the vision niche
// classifier. Uses <video>+canvas (no FFmpeg) so it's cheap — the detector
// already read the file, and we only reach here when the title is inconclusive.
async function grabFrameDataUrls(blob: Blob, count = 4): Promise<string[]> {
  const url = URL.createObjectURL(blob);
  const v = document.createElement("video");
  v.preload = "auto";
  v.muted = true;
  v.src = url;
  try {
    await new Promise<void>((res, rej) => {
      v.onloadeddata = () => res();
      v.onerror = () => rej(new Error("frame load failed"));
    });
    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 3;
    const W = 320;
    const H = v.videoWidth ? Math.round((v.videoHeight / v.videoWidth) * W) : 568;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d")!;
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      const t = ((i + 0.5) / count) * dur;
      await new Promise<void>((res) => {
        v.onseeked = () => res();
        v.currentTime = Math.min(dur - 0.05, t);
      });
      ctx.drawImage(v, 0, 0, W, H);
      out.push(c.toDataURL("image/jpeg", 0.7));
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const NICHE_SOURCE_LABEL: Record<string, string> = {
  title: "from the caption",
  style: "from the edit style",
  ai: "AI vision analysis",
  fallback: "best guess",
};

function AnalyzeInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { setBlueprint } = useProject();
  const [progress, setProgress] = useState({ pct: 0, msg: "Starting…" });
  const [bp, setBp] = useState<EditBlueprint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tasteSaved, setTasteSaved] = useState(false);
  const started = useRef(false);

  const videoId = params.get("video");
  const blueprintId = params.get("blueprint");
  const name = params.get("name") ?? "reel";
  const sourceUrl = params.get("url") ?? undefined;

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      try {
        // Re-open a saved breakdown
        if (blueprintId) {
          const saved = await getBlueprint(blueprintId);
          if (saved) {
            setBp(saved);
            setBlueprint(saved);
            return;
          }
          throw new Error("Breakdown not found");
        }
        if (!videoId) throw new Error("No video selected");

        const stored = await getVideo(videoId);
        if (!stored) throw new Error("Video not found in local storage");

        setProgress({ pct: 3, msg: "Reading video…" });
        const detection = await detectTransitionsV2(stored.blob, (pct, msg) =>
          setProgress({ pct: 3 + Math.round(pct * 0.89), msg })
        );

        setProgress({ pct: 94, msg: "Building your blueprint…" });
        const blueprint = assembleBlueprintV2({
          id: videoId,
          sourceName: name,
          sourceUrl,
          duration: detection.duration,
          transitions: detection.transitions,
          samples: detection.samples,
        });

        // Optional AI enrichment — same normalized shape regardless of
        // whether MiniMax, Anthropic, or OpenAI is configured
        try {
          const res = await fetch("/api/ai", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              task: "label-transitions",
              payload: {
                // v2 evidence: the model gets our confident local labels and
                // only refines wording/borderline types — a weak model can't
                // drag quality down below the deterministic floor.
                detected: blueprint.transitions.map((t) => ({
                  time: t.time,
                  type: t.type,
                  confidence: t.confidence,
                  evidence: t.description,
                })),
                duration: detection.duration,
              },
            }),
          });
          const j = await res.json();
          if (j.available && j.result?.transitions) {
            for (const t of blueprint.transitions) {
              const ai = j.result.transitions.find(
                (a: { time: number }) => Math.abs(a.time - t.time) < 0.3
              );
              if (ai?.description) t.description = ai.description;
            }
          }
        } catch {
          // AI enrichment is best-effort
        }

        // Niche / category extraction. Deterministic local classify from the
        // title + edit-style stats always runs (the floor). When the title
        // alone is inconclusive, refine with vision AI on a few frames — this
        // is what handles uploads whose filename says nothing ("IMG_1234.mov").
        const styleHints: StyleHints = {
          pacing: blueprint.style.pacing,
          colorGrade: blueprint.style.colorGrade,
          avgShotLength: blueprint.style.avgShotLength,
          transitionCount: blueprint.transitions.length,
        };
        let niche = classifyNicheLocal(name, styleHints);
        if (niche.confidence < 0.6) {
          try {
            setProgress({ pct: 96, msg: "Detecting the niche…" });
            const frames = await grabFrameDataUrls(stored.blob, 4);
            const res = await fetch("/api/ai", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                task: "classify-niche",
                payload: { title: name, style: styleHints, frames },
              }),
            });
            const j = await res.json();
            // Only take the AI answer if it's at least as confident and not a
            // "general" cop-out over a real local guess.
            if (j.available && j.result && j.result.id !== "general" && (j.result.confidence ?? 0) >= niche.confidence) {
              niche = j.result;
            }
          } catch {
            // vision niche is best-effort — the local result stands
          }
        }
        blueprint.niche = niche;

        await saveBlueprint(blueprint);
        setBp(blueprint);
        setBlueprint(blueprint);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Analysis failed");
      }
    })();
  }, [videoId, blueprintId, name, sourceUrl, setBlueprint]);

  if (error) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-8 text-center">
        <p className="text-red-400">{error}</p>
        <button onClick={() => router.push("/home")} className="btn-primary flex items-center gap-2 px-6 py-3">
          <RotateCcw size={16} /> Try again
        </button>
      </main>
    );
  }

  if (!bp) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-8 px-10">
        <div className="stripes pulse-soft flex h-52 w-40 items-center justify-center rounded-2xl">
          <Scissors className="text-accent" />
        </div>
        <div className="w-full">
          <div className="mb-2 flex justify-between text-sm">
            <span className="font-semibold">Analyzing frame by frame</span>
            <span className="text-accent">{progress.pct}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-neutral-800">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress.pct}%` }} />
          </div>
          <p className="mt-3 text-center text-xs text-neutral-500">{progress.msg}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col px-6 pb-10 pt-12">
      <header className="mb-6">
        <p className="text-xs font-bold uppercase tracking-widest text-accent">Edit blueprint</p>
        <h1 className="mt-1 truncate text-2xl font-extrabold">{bp.sourceName}</h1>
        <p className="mt-1 text-sm text-neutral-400">
          {bp.duration.toFixed(1)}s · {bp.transitions.length} transitions · {bp.style.pacing} pacing
          {bp.beats ? ` · ~${bp.beats.bpm} BPM` : ""}
        </p>
      </header>

      {/* Niche / category */}
      {bp.niche && (
        <section className="card mb-4 flex items-center gap-3 px-4 py-3">
          <span className="text-2xl" aria-hidden>{nicheEmoji(bp.niche.id)}</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold">
              {bp.niche.label} <span className="font-normal text-neutral-500">niche</span>
            </div>
            <div className="text-xs text-neutral-500">
              {Math.round(bp.niche.confidence * 100)}% confidence · {NICHE_SOURCE_LABEL[bp.niche.source] ?? bp.niche.source}
            </div>
          </div>
        </section>
      )}

      {/* Cut map */}
      <section className="card p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold">
          <Scissors size={15} className="text-accent" /> Cut map
        </h2>
        <div className="relative h-10 rounded-lg bg-black">
          {bp.transitions.map((t) => (
            <span
              key={t.id}
              title={`${t.time}s ${t.type}`}
              className="absolute top-1 bottom-1 w-0.5 rounded bg-accent"
              style={{ left: `${(t.time / bp.duration) * 100}%` }}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-neutral-500">
          <span>0:00</span>
          <span>{Math.floor(bp.duration / 60)}:{String(Math.round(bp.duration % 60)).padStart(2, "0")}</span>
        </div>
      </section>

      {/* Transitions found */}
      <section className="mt-4 flex flex-col gap-2">
        {bp.transitions.length === 0 && (
          <div className="card px-4 py-5 text-center">
            <p className="text-sm font-semibold">No hard cuts detected</p>
            <p className="mt-1 text-xs leading-5 text-neutral-500">
              This looks like one continuous shot — a single steady take rather than a multi-clip edit. Nothing to
              recreate here except the camera work itself. Try a different reel, or head straight to the editor
              to build something from scratch.
            </p>
          </div>
        )}
        {bp.transitions.slice(0, 12).map((t) => {
          const r = transitionByType(t.type);
          return (
            <div key={t.id} className="card flex items-center gap-3 px-4 py-3">
              <span className="text-xl">{r.emoji}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">
                  {r.label} <span className="ml-1 font-mono text-xs text-accent">@{t.time.toFixed(1)}s</span>
                </div>
                <div className="truncate text-xs text-neutral-500">{t.description}</div>
              </div>
            </div>
          );
        })}
        {bp.transitions.length > 12 && (
          <p className="text-center text-xs text-neutral-500">+{bp.transitions.length - 12} more</p>
        )}
      </section>

      {/* Style */}
      <section className="mt-4 grid grid-cols-2 gap-2">
        <div className="card px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-neutral-500"><Music size={12} /> Tempo</div>
          <div className="mt-1 font-bold">{bp.beats ? `${bp.beats.bpm} BPM` : "—"}</div>
        </div>
        <div className="card px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-neutral-500"><Palette size={12} /> Grade</div>
          <div className="mt-1 font-bold capitalize">{bp.style.colorGrade}</div>
        </div>
      </section>

      {/* Guide */}
      <section className="mt-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold">
          <ListChecks size={15} className="text-accent" /> How to recreate it
        </h2>
        <ol className="flex flex-col gap-2">
          {bp.guide.map((s) => (
            <li key={s.step} className="card px-4 py-3">
              <div className="text-sm font-semibold">
                <span className="mr-2 text-accent">{s.step}.</span>
                {s.title}
              </div>
              <p className="mt-1 text-xs leading-5 text-neutral-400">{s.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Pacing structure (#26) */}
      <section className="mt-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold">
          <Activity size={15} className="text-accent" /> Pacing structure
        </h2>
        <div className="flex flex-col gap-2">
          {paceAnalysis(bp).acts.map((a) => (
            <div key={a.act} className="card px-4 py-3">
              <div className="flex justify-between text-sm font-semibold capitalize">
                {a.act}
                <span className="font-mono text-xs text-accent">{a.cutsPerSecond} cuts/s</span>
              </div>
              <p className="mt-1 text-xs text-neutral-400">{a.verdict}</p>
            </div>
          ))}
          <p className="text-xs text-neutral-500">{paceAnalysis(bp).overall}</p>
        </div>
      </section>

      {/* Shot list (#9 uniqueness) */}
      <section className="mt-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold">
          <Camera size={15} className="text-accent" /> Shot list — film these
        </h2>
        <ol className="flex flex-col gap-1.5">
          {shotList(bp).map((s) => (
            <li key={s.n} className="card px-4 py-2.5 text-xs leading-5 text-neutral-300">
              <span className="mr-2 font-bold text-accent">{s.n}.</span>
              {s.text}
            </li>
          ))}
        </ol>
      </section>

      {/* Taste profile + format migration */}
      <section className="mt-4 flex flex-col gap-2">
        <button
          onClick={async () => {
            await saveFingerprint(fingerprintOf(bp));
            setTasteSaved(true);
          }}
          className="card flex items-center justify-center gap-2 py-3 text-xs font-semibold text-neutral-300 active:border-accent"
        >
          <Heart size={13} className={tasteSaved ? "text-accent" : ""} />
          {tasteSaved ? "Saved to your taste profile" : "Save style to my taste profile"}
        </button>
        <div className="card p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-neutral-400">
            <Send size={12} /> Adapt this style for another platform
          </p>
          <div className="flex gap-1.5">
            {(["tiktok", "reels", "shorts"] as const).map((p) => (
              <button
                key={p}
                onClick={async () => {
                  const migrated = migrateFormat(bp, p);
                  await saveBlueprint(migrated);
                  router.push(`/analyze?blueprint=${migrated.id}`);
                  window.location.href = `/analyze?blueprint=${migrated.id}`;
                }}
                className="flex-1 rounded-full border border-card-border py-2 text-xs capitalize text-neutral-300 active:border-accent"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="sticky bottom-4 mt-8">
        <button
          onClick={() => router.push("/editor")}
          className="btn-primary flex w-full items-center justify-center gap-2 py-4 text-lg"
        >
          Recreate with my clips <ArrowRight size={18} />
        </button>
      </div>
    </main>
  );
}

export default function AnalyzePage() {
  return (
    <Suspense>
      <AnalyzeInner />
    </Suspense>
  );
}
