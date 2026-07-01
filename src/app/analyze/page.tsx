"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Music, Palette, Scissors, ListChecks, RotateCcw } from "lucide-react";
import { getVideo, getBlueprint, saveBlueprint } from "@/lib/storage";
import { detectCutsHeuristic } from "@/lib/ffmpeg-client";
import { probeDuration } from "@/lib/ffmpeg-client";
import { assembleBlueprint } from "@/lib/analyzer";
import { transitionByType } from "@/lib/transitions";
import { useProject } from "@/store/project";
import type { EditBlueprint } from "@/lib/types";

function AnalyzeInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { setBlueprint } = useProject();
  const [progress, setProgress] = useState({ pct: 0, msg: "Starting…" });
  const [bp, setBp] = useState<EditBlueprint | null>(null);
  const [error, setError] = useState<string | null>(null);
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

        setProgress({ pct: 5, msg: "Reading video…" });
        const duration = await probeDuration(stored.blob);

        const samples = await detectCutsHeuristic(stored.blob, (pct, msg) =>
          setProgress({ pct: 5 + Math.round(pct * 0.85), msg })
        );

        setProgress({ pct: 92, msg: "Building your blueprint…" });
        const blueprint = assembleBlueprint({
          id: videoId,
          sourceName: name,
          sourceUrl,
          duration,
          samples,
        });

        // Optional AI enrichment when a MiniMax key is configured
        try {
          const res = await fetch("/api/ai", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              task: "label-transitions",
              payload: { samples: samples.filter((s) => s.delta > 0.1).slice(0, 60), duration },
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
        <div className="mt-1 flex justify-between text-[10px] text-neutral-600">
          <span>0:00</span>
          <span>{Math.floor(bp.duration / 60)}:{String(Math.round(bp.duration % 60)).padStart(2, "0")}</span>
        </div>
      </section>

      {/* Transitions found */}
      <section className="mt-4 flex flex-col gap-2">
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
          <p className="text-center text-xs text-neutral-600">+{bp.transitions.length - 12} more</p>
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
