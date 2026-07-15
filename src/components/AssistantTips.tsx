"use client";

import { Lightbulb } from "lucide-react";
import type { Tip, TipActionKind } from "@/lib/assistant-tips";

interface Props {
  tips: Tip[];
  onAction: (kind: TipActionKind) => void;
}

export default function AssistantTips({ tips, onAction }: Props) {
  if (tips.length === 0) return null;
  return (
    <div className="card mt-3 p-4">
      <div className="flex items-center gap-2 text-sm font-bold">
        <Lightbulb size={15} className="text-accent" /> Suggestions
      </div>
      <p className="mt-1 text-[11px] text-neutral-500">
        Based on what&apos;s on your timeline right now — not a scan of your screen.
      </p>
      <ul className="mt-3 flex flex-col gap-2.5">
        {tips.map((tip) => (
          <li key={tip.id} className="flex items-start justify-between gap-2 text-xs leading-5 text-neutral-300">
            <span>{tip.message}</span>
            {tip.action && (
              <button
                onClick={() => onAction(tip.action!.kind)}
                className="shrink-0 rounded-full bg-accent/15 px-3 py-1 text-[11px] font-semibold text-accent"
              >
                {tip.action.label}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
