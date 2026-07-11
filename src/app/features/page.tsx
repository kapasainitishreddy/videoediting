"use client";

// The honest capability list — what works now, what needs a key, what's
// still roadmap. No fake buttons anywhere in this app.
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, KeyRound, Hourglass, Rocket } from "lucide-react";
import { FEATURES, featureCounts } from "@/lib/features-manifest";

const BADGE = {
  working: { icon: CheckCircle2, cls: "text-green-400", label: "works now, on-device" },
  key: { icon: KeyRound, cls: "text-yellow-400", label: "wired — add an API key" },
  "coming-soon": { icon: Rocket, cls: "text-accent", label: "coming soon — in progress" },
  roadmap: { icon: Hourglass, cls: "text-neutral-600", label: "roadmap — needs an ML model" },
} as const;

export default function FeaturesPage() {
  const router = useRouter();
  const counts = featureCounts();
  const groups = [...new Set(FEATURES.map((f) => f.group))];

  return (
    <main className="flex flex-1 flex-col px-6 pb-10 pt-12">
      <button onClick={() => router.back()} className="mb-4 flex items-center gap-1 text-sm text-neutral-500">
        <ArrowLeft size={14} /> Back
      </button>
      <h1 className="text-2xl font-extrabold">
        Everything it does<span className="text-accent">.</span>
      </h1>
      <p className="mt-1 text-sm text-neutral-400">
        {counts.working} working on-device · {counts.key} unlock with an API key · {counts.comingSoon} coming soon ·{" "}
        {counts.roadmap} on the roadmap
      </p>
      <div className="mt-3 flex flex-col gap-1 text-[11px] text-neutral-500">
        {(Object.keys(BADGE) as (keyof typeof BADGE)[]).map((k) => {
          const B = BADGE[k];
          return (
            <span key={k} className="flex items-center gap-1.5">
              <B.icon size={12} className={B.cls} /> {B.label}
            </span>
          );
        })}
      </div>

      {groups.map((g) => (
        <section key={g} className="mt-6">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-neutral-500">{g}</h2>
          <div className="flex flex-col gap-1.5">
            {FEATURES.filter((f) => f.group === g).map((f) => {
              const B = BADGE[f.status];
              return (
                <div key={f.name} className="card flex items-start gap-2.5 px-3.5 py-2.5">
                  <B.icon size={15} className={`mt-0.5 shrink-0 ${B.cls}`} />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold leading-4">{f.name}</div>
                    <div className="text-[10px] leading-4 text-neutral-500">{f.where}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </main>
  );
}
