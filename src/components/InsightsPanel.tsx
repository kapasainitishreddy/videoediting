"use client";

// Insights: virality score with breakdown, retention heatmap, hook A/B
// variants, loopability, length cuts, one-tap edit variations, and blueprint
// share codes. Rendered under the timeline once a plan exists.
import { useMemo, useState } from "react";
import { BarChart3, Copy, Check, Clock, Flame, Repeat, Shuffle, Zap } from "lucide-react";
import { useProject } from "@/store/project";
import { viralityScore, editVariations, blueprintToCode } from "@/lib/intelligence";
import { retentionHeatmap, deadIntroCheck, hookVariants, callbackEnding, lengthVariants, loopabilityCheck, planDuration } from "@/lib/retention";

export default function InsightsPanel() {
  const { plan, setPlan, blueprint } = useProject();
  const [copied, setCopied] = useState(false);

  const score = useMemo(() => (plan ? viralityScore(plan, blueprint) : null), [plan, blueprint]);
  const variations = useMemo(() => (plan ? editVariations(plan) : []), [plan]);
  const heat = useMemo(() => (plan ? retentionHeatmap(plan) : null), [plan]);
  const intro = useMemo(() => (plan ? deadIntroCheck(plan) : null), [plan]);
  const hooks = useMemo(() => (plan ? hookVariants(plan) : []), [plan]);
  const loop = useMemo(() => (plan ? loopabilityCheck(plan) : null), [plan]);
  const lengths = useMemo(() => (plan ? lengthVariants(plan) : []), [plan]);
  const duration = useMemo(() => (plan ? planDuration(plan) : 0), [plan]);

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

      {/* Retention heatmap — where viewers are most likely to swipe away */}
      {heat && heat.points.length > 1 && (
        <div className="mt-4">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-neutral-400">
            <Flame size={12} /> Retention risk map
          </p>
          <div className="flex h-6 overflow-hidden rounded-md">
            {heat.points.map((p, i) => (
              <div
                key={i}
                className="h-full flex-1"
                title={`${p.t}s — risk ${(p.risk * 100).toFixed(0)}%`}
                style={{ backgroundColor: `rgba(255, 92, 53, ${0.08 + p.risk * 0.85})` }}
              />
            ))}
          </div>
          <div className="mt-0.5 flex justify-between text-[9px] text-neutral-600">
            <span>0s</span>
            <span>{duration.toFixed(0)}s</span>
          </div>
          <p className="mt-1 text-[10px] leading-4 text-neutral-500">{heat.summary}</p>
          {intro && !intro.pass && <p className="mt-1 text-[10px] leading-4 text-yellow-500">{intro.message}</p>}
        </div>
      )}

      {/* Hook A/B variants */}
      {hooks.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-neutral-400">
            <Zap size={12} /> Try a different hook
          </p>
          <div className="flex flex-wrap gap-1.5">
            {hooks.map((h) => (
              <button
                key={h.name}
                onClick={() => setPlan(h.plan)}
                title={h.why}
                className="rounded-full border border-card-border px-3 py-1.5 text-xs text-neutral-300 active:border-accent"
              >
                {h.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loopability + callback ending */}
      {loop && (
        <div className="mt-4">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-neutral-400">
            <Repeat size={12} /> Loopability {loop.score}/100
          </p>
          <p className="text-[10px] leading-4 text-neutral-500">{loop.tips[0]}</p>
          <button
            onClick={() => setPlan(callbackEnding(plan))}
            className="mt-1.5 rounded-full border border-card-border px-3 py-1.5 text-xs text-neutral-300 active:border-accent"
          >
            + Add callback ending (hook returns at the end)
          </button>
        </div>
      )}

      {/* Length variants */}
      <div className="mt-4">
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-neutral-400">
          <Clock size={12} /> Cut to length — currently {duration.toFixed(0)}s
        </p>
        <div className="flex gap-1.5">
          {lengths.map((l) => (
            <button
              key={l.target}
              onClick={() => setPlan(l.plan)}
              disabled={l.fits}
              className="flex-1 rounded-full border border-card-border py-1.5 text-xs text-neutral-300 active:border-accent disabled:opacity-40"
            >
              {l.target}s {l.fits ? "✓" : ""}
            </button>
          ))}
        </div>
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
