"use client";

// Cinematic Studio — the control surface for looks, motion, atmosphere,
// score, and titles. Compact chip/toggle UI; all state lives in the store
// and flows into renderEdit.
//
// Two tiers: Simple (default) shows the ~10 controls a beginner actually
// needs; Pro reveals film stocks, the full optics toggle list, brand colors,
// and Studio share codes. The tier choice sticks via localStorage.
import { useState, useSyncExternalStore } from "react";
import { Clapperboard, Check, ChevronDown, Copy, Film, Move3d, CloudFog, Music2, Type, Wand2 } from "lucide-react";
import { useProject } from "@/store/project";
import { COLOR_GRADES } from "@/lib/transitions";
import { FILM_STOCKS, GENRE_LOOKS, cinematicify, DEFAULT_LOOK } from "@/lib/cinematic";
import { OVERLAY_LABELS, type OverlayType } from "@/lib/overlays";
import { studioToCode, studioFromCode } from "@/lib/creator-kit";
import type { MotionEffect } from "@/lib/motion";
import type { ScoreMood } from "@/lib/audio-cinema";

const MOTION_OPTIONS: { id: MotionEffect; label: string }[] = [
  { id: "none", label: "None" },
  { id: "ken-burns-in", label: "Push In" },
  { id: "ken-burns-out", label: "Pull Out" },
  { id: "drift", label: "Drift" },
  { id: "shake", label: "Handheld" },
  { id: "stabilize", label: "Stabilize" },
];

const MOODS: { id: ScoreMood; label: string }[] = [
  { id: "epic", label: "Epic" },
  { id: "chill", label: "Chill" },
  { id: "dark", label: "Dark" },
  { id: "uplift", label: "Uplift" },
];

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-card-border last:border-0">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between py-3 text-sm font-semibold">
        <span className="flex items-center gap-2">{icon} {title}</span>
        <ChevronDown size={14} className={`text-neutral-600 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="pb-4">{children}</div>}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs ${active ? "bg-accent font-semibold text-white" : "border border-card-border text-neutral-400"}`}
    >
      {children}
    </button>
  );
}

// Simple/Pro tier flag, persisted in localStorage. useSyncExternalStore keeps
// the read outside render effects (SSR sees the server snapshot = false, the
// client subscribes to changes) — no setState-in-effect, no hydration flash
// beyond the first paint.
const proListeners = new Set<() => void>();
const subscribePro = (cb: () => void) => {
  proListeners.delete(cb);
  proListeners.add(cb);
  return () => proListeners.delete(cb);
};
const readPro = () => localStorage.getItem("viraledit-studio-pro") === "1";
const writePro = (v: boolean) => {
  localStorage.setItem("viraledit-studio-pro", v ? "1" : "0");
  proListeners.forEach((cb) => cb());
};

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)} className="flex w-full items-center justify-between py-1.5 text-xs text-neutral-300">
      {label}
      <span className={`h-5 w-9 rounded-full p-0.5 transition-colors ${value ? "bg-accent" : "bg-neutral-700"}`}>
        <span className={`block h-4 w-4 rounded-full bg-white transition-transform ${value ? "translate-x-4" : ""}`} />
      </span>
    </button>
  );
}

export default function StudioPanel() {
  const { studio, setStudio } = useProject();
  const look = studio.look;
  const setLook = (patch: Partial<typeof look>) => setStudio({ look: { ...look, ...patch } });
  const pro = useSyncExternalStore(subscribePro, readPro, () => false);
  const [copied, setCopied] = useState(false);
  const [importCode, setImportCode] = useState("");
  const [importNote, setImportNote] = useState<string | null>(null);

  const togglePro = () => writePro(!pro);

  async function copyStudioCode() {
    const code = studioToCode({
      grade: look.grade,
      letterbox: look.letterbox,
      grain: look.grain,
      vignette: look.vignette,
      halation: look.halation,
      goldenHour: look.goldenHour,
      dayForNight: look.dayForNight,
      anamorphic: look.anamorphic,
      haze: look.haze,
      sharpen: look.sharpen,
      scoreMood: studio.scoreMood,
      autoSfx: studio.autoSfx,
      autoKenBurns: studio.autoKenBurns,
      autoReframe: studio.autoReframe,
      kineticCaptions: studio.kineticCaptions,
      overlay: studio.overlay,
      overlayOpacity: studio.overlayOpacity,
      motion: studio.motionDefault,
    });
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function importStudioCode() {
    const patch = studioFromCode(importCode.trim());
    if (!patch) {
      setImportNote("That doesn't look like a valid VES1 studio code.");
      return;
    }
    const s = patch.studio ?? { look: {} };
    setStudio({
      ...(s.scoreMood !== undefined ? { scoreMood: s.scoreMood } : {}),
      ...(s.autoSfx !== undefined ? { autoSfx: s.autoSfx } : {}),
      ...(s.autoKenBurns !== undefined ? { autoKenBurns: s.autoKenBurns } : {}),
      ...(s.autoReframe !== undefined ? { autoReframe: s.autoReframe } : {}),
      ...(s.kineticCaptions !== undefined ? { kineticCaptions: s.kineticCaptions } : {}),
      ...(s.overlay !== undefined ? { overlay: s.overlay } : {}),
      ...(s.overlayOpacity !== undefined ? { overlayOpacity: s.overlayOpacity } : {}),
      ...(s.motionDefault !== undefined ? { motionDefault: s.motionDefault } : {}),
      look: { ...look, ...s.look },
    });
    setImportCode("");
    setImportNote("Studio setup imported ✓");
    setTimeout(() => setImportNote(null), 2000);
  }

  return (
    <section className="card mt-5 px-4 py-1">
      <div className="flex items-center justify-between py-3">
        <span className="flex items-center gap-2 text-sm font-bold">
          <Clapperboard size={15} className="text-accent" /> Cinematic Studio
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={togglePro}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${pro ? "bg-accent text-white" : "border border-card-border text-neutral-400"}`}
          >
            {pro ? "Pro" : "Simple"}
          </button>
          <button
            onClick={() => setStudio({ look: cinematicify() })}
            className="flex items-center gap-1 rounded-full bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent"
          >
            <Wand2 size={12} /> Cinematic-ify
          </button>
        </div>
      </div>

      <Section icon={<Film size={14} className="text-accent" />} title="Look & Grade">
        <p className="mb-1.5 text-[10px] uppercase tracking-wider text-neutral-600">Genre looks</p>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(GENRE_LOOKS).map(([k, g]) => (
            <Chip key={k} active={look.grade === k} onClick={() => setLook({ grade: k, ...g.pairs })}>{g.label}</Chip>
          ))}
        </div>
        {pro && (
          <>
            <p className="mb-1.5 mt-3 text-[10px] uppercase tracking-wider text-neutral-600">Film stocks</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(FILM_STOCKS).map(([k, s]) => (
                <Chip key={k} active={look.grade === k} onClick={() => setLook({ grade: k })}>{s.label}</Chip>
              ))}
            </div>
          </>
        )}
        <p className="mb-1.5 mt-3 text-[10px] uppercase tracking-wider text-neutral-600">Simple grades</p>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(COLOR_GRADES).map(([k, g]) => (
            <Chip key={k} active={look.grade === k} onClick={() => setLook({ grade: k })}>{g.label}</Chip>
          ))}
        </div>
        <div className="mt-3">
          <Toggle label="Cinema letterbox bars" value={look.letterbox} onChange={(v) => setLook({ letterbox: v })} />
          <Toggle label="Film grain" value={look.grain > 0} onChange={(v) => setLook({ grain: v ? 0.3 : 0 })} />
          <Toggle label="Vignette" value={look.vignette > 0} onChange={(v) => setLook({ vignette: v ? 0.45 : 0 })} />
          {pro && (
            <>
              <Toggle label="Halation bloom" value={look.halation} onChange={(v) => setLook({ halation: v })} />
              <Toggle label="Anamorphic lens" value={look.anamorphic} onChange={(v) => setLook({ anamorphic: v })} />
              <Toggle label="Chromatic aberration" value={look.chromaticAberration} onChange={(v) => setLook({ chromaticAberration: v })} />
              <Toggle label="Golden hour warmth" value={look.goldenHour} onChange={(v) => setLook({ goldenHour: v })} />
              <Toggle label="Day-for-night" value={look.dayForNight} onChange={(v) => setLook({ dayForNight: v })} />
              <Toggle label="Atmospheric haze" value={look.haze} onChange={(v) => setLook({ haze: v })} />
              <Toggle label="Denoise footage" value={look.denoise} onChange={(v) => setLook({ denoise: v })} />
              <Toggle label="Sharpen" value={look.sharpen} onChange={(v) => setLook({ sharpen: v })} />
              <Toggle label="Auto color/exposure match" value={look.autoNormalize} onChange={(v) => setLook({ autoNormalize: v })} />
              <Toggle label="Beauty skin-smoothing" value={studio.beauty > 0} onChange={(v) => setStudio({ beauty: v ? 0.5 : 0 })} />
            </>
          )}
          {!pro && (
            <p className="mt-1 text-[10px] text-neutral-600">
              9 more optics controls in <button onClick={togglePro} className="underline">Pro mode</button> — or just describe the look in the prompt.
            </p>
          )}
          <button onClick={() => setStudio({ look: DEFAULT_LOOK })} className="mt-1 text-[10px] text-neutral-600 underline">
            reset look
          </button>
        </div>
        {pro && (
          <div className="mt-3 border-t border-card-border pt-3">
            <label className="block text-xs text-neutral-400">
              Brand colors — hex codes, footage gets nudged toward them
              <input
                value={studio.brandHex ?? ""}
                onChange={(e) => setStudio({ brandHex: e.target.value })}
                placeholder="#FF5C35 #0D0D0D"
                className="mt-1 w-full rounded-lg border border-card-border bg-black px-3 py-2 font-mono text-xs outline-none placeholder:text-neutral-700 focus:border-accent"
              />
            </label>
          </div>
        )}
      </Section>

      <Section icon={<Move3d size={14} className="text-accent" />} title="Camera Motion">
        <div className="flex flex-wrap gap-1.5">
          {MOTION_OPTIONS.map((m) => (
            <Chip key={m.id} active={studio.motionDefault === m.id} onClick={() => setStudio({ motionDefault: m.id })}>
              {m.label}
            </Chip>
          ))}
        </div>
        <div className="mt-2">
          <Toggle label="Auto Ken Burns on static shots" value={studio.autoKenBurns} onChange={(v) => setStudio({ autoKenBurns: v })} />
          <Toggle label="Subject-aware reframe (landscape clips)" value={studio.autoReframe} onChange={(v) => setStudio({ autoReframe: v })} />
          <Toggle label="Auto punch-in on faces" value={studio.autoFacePunch} onChange={(v) => setStudio({ autoFacePunch: v })} />
          {studio.autoFacePunch && (
            <p className="mt-1 text-[10px] text-neutral-600">
              Finds the face in each shot (on-device ML) and zooms the camera toward it — CapCut-style auto zoom.
            </p>
          )}
        </div>
      </Section>

      <Section icon={<CloudFog size={14} className="text-accent" />} title="Atmosphere">
        <div className="flex flex-wrap gap-1.5">
          <Chip active={studio.overlay === null} onClick={() => setStudio({ overlay: null })}>None</Chip>
          {(Object.keys(OVERLAY_LABELS) as OverlayType[]).map((k) => (
            <Chip key={k} active={studio.overlay === k} onClick={() => setStudio({ overlay: k })}>
              {OVERLAY_LABELS[k].emoji} {OVERLAY_LABELS[k].label}
            </Chip>
          ))}
        </div>
        {studio.overlay && (
          <label className="mt-3 block text-xs text-neutral-400">
            Intensity
            <input
              type="range"
              min={10}
              max={100}
              value={Math.round(studio.overlayOpacity * 100)}
              onChange={(e) => setStudio({ overlayOpacity: Number(e.target.value) / 100 })}
              className="mt-1 w-full accent-[#ff5c35]"
            />
          </label>
        )}
      </Section>

      <Section icon={<Music2 size={14} className="text-accent" />} title="Score & Sound">
        <p className="mb-1.5 text-[10px] uppercase tracking-wider text-neutral-600">Compose an original score</p>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={studio.scoreMood === null} onClick={() => setStudio({ scoreMood: null })}>Off</Chip>
          {MOODS.map((m) => (
            <Chip key={m.id} active={studio.scoreMood === m.id} onClick={() => setStudio({ scoreMood: m.id })}>{m.label}</Chip>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-neutral-600">Synthesized on-device, matched to your edit&apos;s BPM. Uploaded music wins if both are set.</p>
        <div className="mt-2">
          <Toggle label="Auto sound FX on transitions" value={studio.autoSfx} onChange={(v) => setStudio({ autoSfx: v })} />
        </div>
      </Section>

      <Section icon={<Type size={14} className="text-accent" />} title="Titles & Credits">
        <Toggle
          label="Opening title card"
          value={!!studio.titleCard}
          onChange={(v) => setStudio({ titleCard: v ? { title: "MY EDIT", subtitle: "", style: "epic" } : null })}
        />
        {studio.titleCard && (
          <div className="mt-2 flex flex-col gap-2">
            <input
              value={studio.titleCard.title}
              onChange={(e) => setStudio({ titleCard: { ...studio.titleCard!, title: e.target.value } })}
              placeholder="Title"
              className="rounded-lg border border-card-border bg-black px-3 py-2 text-xs outline-none focus:border-accent"
            />
            <input
              value={studio.titleCard.subtitle}
              onChange={(e) => setStudio({ titleCard: { ...studio.titleCard!, subtitle: e.target.value } })}
              placeholder="Subtitle (optional)"
              className="rounded-lg border border-card-border bg-black px-3 py-2 text-xs outline-none focus:border-accent"
            />
            <div className="flex gap-1.5">
              {(["epic", "minimal", "typewriter"] as const).map((s) => (
                <Chip key={s} active={studio.titleCard!.style === s} onClick={() => setStudio({ titleCard: { ...studio.titleCard!, style: s } })}>
                  {s}
                </Chip>
              ))}
            </div>
          </div>
        )}
        <div className="mt-2">
          <Toggle label="Kinetic word-pop captions" value={studio.kineticCaptions} onChange={(v) => setStudio({ kineticCaptions: v })} />
        </div>
        <label className="mt-2 block text-xs text-neutral-400">
          End credits — one per line, &quot;role | name&quot;
          <textarea
            value={studio.credits}
            onChange={(e) => setStudio({ credits: e.target.value })}
            rows={2}
            placeholder={"shot by | you\nedited with | ViralEdit AI"}
            className="mt-1 w-full resize-none rounded-lg border border-card-border bg-black px-3 py-2 text-xs outline-none placeholder:text-neutral-700 focus:border-accent"
          />
        </label>
      </Section>

      {pro && (
        <div className="border-t border-card-border py-3">
          <p className="mb-2 text-[10px] uppercase tracking-wider text-neutral-600">Share this Studio setup</p>
          <button
            onClick={copyStudioCode}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-card-border py-2.5 text-xs text-neutral-300"
          >
            {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
            {copied ? "Copied!" : "Copy my Studio as a VES1 code"}
          </button>
          <div className="mt-2 flex gap-2">
            <input
              value={importCode}
              onChange={(e) => setImportCode(e.target.value)}
              placeholder="VES1.…"
              className="min-w-0 flex-1 rounded-lg border border-card-border bg-black px-3 py-2 font-mono text-xs outline-none placeholder:text-neutral-700 focus:border-accent"
            />
            <button
              onClick={importStudioCode}
              disabled={!importCode.trim()}
              className="rounded-full border border-card-border px-4 text-xs text-neutral-300 disabled:opacity-40"
            >
              Import
            </button>
          </div>
          {importNote && <p className="mt-1.5 text-[10px] text-accent">{importNote}</p>}
        </div>
      )}
    </section>
  );
}
