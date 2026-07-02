"use client";

// Insights: virality score with breakdown, one-tap edit variations, and
// blueprint share codes. Rendered under the timeline once a plan exists.
import { useMemo, useState } from "react";
import { BarChart3, Copy, Check, Shuffle } from "lucide-react";
import { useProject } from "@/store/project";
import { viralityScore, editVariations, blueprintToCode } from "@/lib/intelligence";

export default function InsightsPanel() {
  const { plan, setPlan, blueprint } = useProject();
  const [copied, setCopied] = useState(false);

  const score = useMemo(() => (plan ? viralityScore(plan, blueprint) : null), [plan, blueprint]);
  const variations = useMemo(() => (plan ? editVariations(plan) : []), [plan]);

  if (!plan || !score) return null;

  const tone = score.score >= 75 ? "text-green-400" : score.score >= 50 ? "text-yellow-400" : "text-red-400";

  return (
    <section className="card mt-4 p-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-bold">
          <BarChart3 size={15} className="text-accent" /> Virality score
        </span>
        <span className={`text-2xl font-extrabold ${tone}`}>{score.score}</span>
      </div>
      <div className="mt-3 flex flex-col gap-1.5">
        {score.breakdown.map((b) => (
          <div key={b.label}>
            <div className="flex justify-between text-[11px] text-neutral-400">
              <span>{b.label}</span>
              <span>{b.pts}/{b.max}</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-neutral-800">
              <div className="h-full bg-accent" style={{ width: `${(b.pts / b.max) * 100}%` }} />
            </div>
            <p className="mt-0.5 text-[10px] text-neutral-600">{b.tip}</p>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-neutral-400">
          <Shuffle size={12} /> Try a different take
        </p>
        <div className="flex gap-1.5">
          {variations.map((v) => (
            <button
              key={v.name}
              onClick={() => setPlan(v.plan)}
              className="rounded-full border border-card-border px-3 py-1.5 text-xs text-neutral-300 active:border-accent"
            >
              {v.name}
            </button>
          ))}
        </div>
      </div>

      {blueprint && (
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(blueprintToCode(blueprint));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border border-card-border py-2.5 text-xs text-neutral-300"
        >
          {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
          {copied ? "Copied!" : "Copy blueprint share code (no video, just the recipe)"}
        </button>
      )}
    </section>
  );
}
