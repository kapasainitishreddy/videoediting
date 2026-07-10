"use client";

// Conversational editing panel — steer the edit one instruction at a time.
// Each turn is classified by chat-edit.interpretTurn (pure, no key needed)
// and executed here against the CURRENT plan/studio. Every turn goes through
// setPlan, so the store's plan-history powers "undo" for free. Fully
// on-device: the same deterministic compiler + plan-surgery the one-shot
// auto-edit uses, driven a step at a time.
import { useEffect, useRef, useState } from "react";
import { MessageSquare, Send, RotateCcw } from "lucide-react";
import { useProject } from "@/store/project";
import { getVideo } from "@/lib/storage";
import { interpretTurn, CHAT_GREETING, type ChatOp } from "@/lib/chat-edit";
import { applyPlanOps } from "@/lib/prompt-compiler";
import { tightenSilences, insertCutaways, activeSpeakerCut, type Range, type SpeakerTrack } from "@/lib/plan-surgery";
import { hookVariants, callbackEnding, lengthVariants } from "@/lib/retention";
import { silenceRanges } from "@/lib/audio-polish";
import type { CompiledDirection } from "@/lib/prompt-compiler";
import type { EditPlan } from "@/lib/types";

interface Msg {
  role: "user" | "bot";
  text: string;
  suggestions?: string[];
}

interface Props {
  onRender: () => void;
  busy: string | null;
  setBusy: (b: string | null) => void;
}

async function decodeAudio(blob: Blob): Promise<{ data: Float32Array; sampleRate: number } | null> {
  try {
    const AC: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new AC();
    try {
      const buf = await ac.decodeAudioData(await blob.arrayBuffer());
      return { data: buf.getChannelData(0), sampleRate: buf.sampleRate };
    } finally {
      ac.close();
    }
  } catch {
    return null;
  }
}

export default function ChatEdit({ onRender, busy, setBusy }: Props) {
  const { plan, setPlan, undoPlan, studio, setStudio, clips } = useProject();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "bot", text: CHAT_GREETING }]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  // snapshot of the plan when the panel first sees one — powers "start over"
  const originalRef = useRef<EditPlan | null>(null);
  useEffect(() => {
    if (plan && !originalRef.current) originalRef.current = JSON.parse(JSON.stringify(plan));
  }, [plan]);
  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [msgs]);

  const say = (m: Msg) => setMsgs((prev) => [...prev, m]);

  // Apply a compiled style direction to the CURRENT plan + studio (mirrors
  // the editor's applyDirectionToStudio, but for an existing plan).
  function applyStyle(c: CompiledDirection) {
    if (plan) setPlan({ ...plan, segments: applyPlanOps(plan.segments, c.plan), colorGrade: c.plan.colorGrade ?? plan.colorGrade });
    const cur = studio;
    const st = c.studio;
    const patch: Partial<typeof cur> = {};
    if (st.motionDefault !== undefined) patch.motionDefault = st.motionDefault;
    if (st.autoKenBurns !== undefined) patch.autoKenBurns = st.autoKenBurns;
    if (st.autoReframe !== undefined) patch.autoReframe = st.autoReframe;
    if (st.overlay !== undefined) patch.overlay = st.overlay;
    if (st.overlayOpacity !== undefined) patch.overlayOpacity = st.overlayOpacity;
    if (st.scoreMood !== undefined) patch.scoreMood = st.scoreMood;
    if (st.autoSfx !== undefined) patch.autoSfx = st.autoSfx;
    if (st.kineticCaptions !== undefined) patch.kineticCaptions = st.kineticCaptions;
    if (Object.keys(st.look).length) patch.look = { ...cur.look, ...st.look };
    if (Object.keys(patch).length) setStudio(patch);
  }

  async function execute(op: ChatOp): Promise<string | null> {
    // returns an extra detail line to append, or null. Throws on hard failure.
    switch (op.kind) {
      case "style":
        if (!plan) return "Auto-edit first, then I can restyle it.";
        applyStyle(op.compiled);
        return null;

      case "pace":
        if (!plan) return "Auto-edit first — there's no timeline to tighten yet.";
        setPlan({ ...plan, segments: applyPlanOps(plan.segments, { tightenTo: op.tightenTo }) });
        return null;

      case "hook": {
        if (!plan) return "Auto-edit first, then I can reshape the hook.";
        const idx = op.variant === "tight" ? 0 : op.variant === "swapped" ? 1 : 2;
        const v = hookVariants(plan)[idx];
        if (!v) return "This edit is too short to reshape the hook (needs at least two shots).";
        setPlan(v.plan);
        return null;
      }

      case "callback":
        if (!plan) return "Auto-edit first, then I can add a callback ending.";
        setPlan(callbackEnding(plan));
        return null;

      case "length": {
        if (!plan) return "Auto-edit first, then I can cut a shorter version.";
        const v = lengthVariants(plan, [op.seconds])[0];
        setPlan(v.plan);
        return v.fits ? "It already fits — nothing to trim." : null;
      }

      case "tighten": {
        if (!plan) return "Auto-edit first, then I can tighten it.";
        setBusy("Listening for dead air…");
        const silences = new Map<string, Range[]>();
        let audible = 0;
        for (const id of new Set(plan.segments.map((s) => s.clipId))) {
          const vv = await getVideo(id);
          if (!vv) continue;
          const a = await decodeAudio(vv.blob);
          if (!a) continue;
          audible++;
          silences.set(id, silenceRanges(a.data, a.sampleRate));
        }
        if (audible === 0) return "None of the timeline clips have audio to trim.";
        const res = tightenSilences(plan, silences);
        if (res.removedSeconds < 0.1) return "No dead air worth cutting — it's already tight.";
        setPlan(res.plan);
        return `Removed ${res.removedSeconds.toFixed(1)}s across ${res.cuts} jump cut${res.cuts === 1 ? "" : "s"}.`;
      }

      case "cutaways": {
        if (!plan) return "Auto-edit first, then I can add cutaways.";
        setBusy("Finding speech gaps…");
        const hostIds = new Set(plan.segments.map((s) => s.clipId));
        const opportunities: { clipId: string; at: number }[] = [];
        for (const id of hostIds) {
          const vv = await getVideo(id);
          if (!vv) continue;
          const a = await decodeAudio(vv.blob);
          if (!a) continue;
          for (const r of silenceRanges(a.data, a.sampleRate, { minLen: 0.4 }))
            opportunities.push({ clipId: id, at: Number(((r.start + r.end) / 2).toFixed(2)) });
        }
        const broll = clips
          .filter((c) => !hostIds.has(c.id) && c.duration > 1.6)
          .map((c) => ({ clipId: c.id, start: 0.3, end: Math.min(c.duration - 0.1, 3.5) }));
        if (broll.length === 0) return "No spare clips to cut away to — add B-roll that isn't already on the timeline.";
        if (opportunities.length === 0) return "No natural speech gaps to hide a cutaway in.";
        const res = insertCutaways(plan, opportunities, broll);
        if (res.inserted === 0) return "No gap was wide enough for a clean cutaway.";
        setPlan(res.plan);
        return `Placed ${res.inserted} cutaway${res.inserted > 1 ? "s" : ""}.`;
      }

      case "speakerCut": {
        if (clips.length < 2) return "Speaker cut needs at least two camera clips of the same conversation.";
        setBusy("Reading who's talking…");
        const tracks: SpeakerTrack[] = [];
        for (const c of clips.slice(0, 4)) {
          const vv = await getVideo(c.id);
          if (!vv) continue;
          const a = await decodeAudio(vv.blob);
          if (!a) continue;
          const hop = Math.floor(a.sampleRate * 0.25);
          const times: number[] = [];
          const rms: number[] = [];
          for (let i = 0; i + hop <= a.data.length; i += hop) {
            let e = 0;
            for (let k = 0; k < hop; k++) e += a.data[i + k] ** 2;
            times.push(Number((i / a.sampleRate).toFixed(2)));
            rms.push(Math.sqrt(e / hop));
          }
          tracks.push({ clipId: c.id, times, rms });
        }
        if (tracks.length < 2) return "Fewer than two clips have readable audio.";
        const n = Math.min(...tracks.map((t) => t.times.length));
        for (const t of tracks) {
          t.times = t.times.slice(0, n);
          t.rms = t.rms.slice(0, n);
        }
        const res = activeSpeakerCut(tracks);
        if (res.segments.length < 2) return "Couldn't find alternating speech — are these the same conversation?";
        setPlan({ segments: res.segments, colorGrade: plan?.colorGrade ?? "none", aiDirection: plan?.aiDirection ?? "", explanation: res.explanation });
        return `${res.segments.length} shots across ${tracks.length} cameras.`;
      }

      case "undo":
        undoPlan();
        return null;

      case "reset":
        if (originalRef.current) setPlan(JSON.parse(JSON.stringify(originalRef.current)));
        return null;

      case "render":
        onRender();
        return null;
    }
  }

  async function submit() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    say({ role: "user", text });
    const turn = interpretTurn(text);
    say({ role: "bot", text: turn.reply, suggestions: turn.suggestions });
    if (!turn.op) return;
    try {
      const detail = await execute(turn.op);
      if (detail) say({ role: "bot", text: detail });
    } catch (e) {
      say({ role: "bot", text: `That didn't work — ${e instanceof Error ? e.message : "try rephrasing."}` });
    } finally {
      if (turn.op.kind !== "render") setBusy(null);
    }
  }

  return (
    <section className="card mt-5 px-4 py-1">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between py-3 text-sm font-bold">
        <span className="flex items-center gap-2">
          <MessageSquare size={15} className="text-accent" /> Chat edit — steer it one step at a time
        </span>
        <span className="text-[10px] text-neutral-600">{open ? "hide" : "open"}</span>
      </button>
      {open && (
        <div className="pb-4">
          <div ref={scrollRef} className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-card-border bg-black/40 p-3">
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-right" : ""}>
                <span
                  className={`inline-block max-w-[85%] rounded-2xl px-3 py-1.5 text-xs leading-5 ${
                    m.role === "user" ? "bg-accent/20 text-neutral-100" : "bg-white/5 text-neutral-300"
                  }`}
                >
                  {m.text}
                </span>
                {m.suggestions && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {m.suggestions.map((sug) => (
                      <button
                        key={sug}
                        onClick={() => setInput(sug)}
                        className="rounded-full border border-card-border px-2.5 py-1 text-[11px] text-neutral-400 hover:border-accent"
                      >
                        {sug}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <button
              onClick={() => {
                undoPlan();
                say({ role: "bot", text: "Reverted the last change." });
              }}
              disabled={!!busy}
              className="shrink-0 rounded-full border border-card-border p-2 text-neutral-400 disabled:opacity-40"
              aria-label="Undo last change"
            >
              <RotateCcw size={14} />
            </button>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              disabled={!!busy}
              placeholder="e.g. cut the silences, then make it moody…"
              className="w-full rounded-full border border-card-border bg-black px-4 py-2 text-xs outline-none placeholder:text-neutral-700 focus:border-accent disabled:opacity-50"
              aria-label="Type an editing instruction"
            />
            <button
              onClick={submit}
              disabled={!!busy || !input.trim()}
              className="shrink-0 rounded-full bg-accent p-2 text-white disabled:opacity-40"
              aria-label="Send instruction"
            >
              <Send size={14} />
            </button>
          </div>
          <p className="mt-2 text-[10px] leading-4 text-neutral-600">
            Every turn is one reversible change to your current timeline — no key needed, all on your device. Say “undo” or hit ↺ to step back.
          </p>
        </div>
      )}
    </section>
  );
}
