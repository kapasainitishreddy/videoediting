"use client";

// Command palette — type what you want instead of hunting menus. ⌘K/Ctrl-K
// (or the floating button) opens a search over EVERY pipeline control: genre
// presets, looks, film stocks, grades, motion, atmosphere, score moods,
// toggles, and navigation. Entries are generated from the same data tables
// the Studio renders from, so nothing can drift out of sync.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { useProject, DEFAULT_STUDIO, type StudioConfig } from "@/store/project";
import { COLOR_GRADES } from "@/lib/transitions";
import { FILM_STOCKS, GENRE_LOOKS, cinematicify } from "@/lib/cinematic";
import { OVERLAY_LABELS, type OverlayType } from "@/lib/overlays";
import { GENRE_PRESETS, compilePreset } from "@/lib/creator-kit";
import { applyPlanOps } from "@/lib/prompt-compiler";
import type { ScoreMood } from "@/lib/audio-cinema";
import type { MotionEffect } from "@/lib/motion";

interface Entry {
  id: string;
  label: string;
  group: string;
  keywords: string;
  run: () => string; // returns a confirmation toast message
}

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // open/close always flow through these so the query resets in the event
  // handler itself (not in an effect — avoids a cascading render).
  const openPalette = () => {
    setQuery("");
    setOpen(true);
  };
  const closePalette = () => {
    setQuery("");
    setOpen(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => {
          if (!o) setQuery("");
          return !o;
        });
      }
      if (e.key === "Escape") closePalette();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
     
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const entries = useMemo<Entry[]>(() => {
    const setStudio = (patch: Partial<StudioConfig>) => useProject.getState().setStudio(patch);
    const setLook = (patch: Partial<StudioConfig["look"]>) => {
      const cur = useProject.getState().studio.look;
      setStudio({ look: { ...cur, ...patch } });
    };
    const out: Entry[] = [];

    // one-tap genre presets (same compiler as typing the prompt)
    for (const p of GENRE_PRESETS) {
      out.push({
        id: `preset-${p.id}`,
        label: `${p.emoji} ${p.label} preset`,
        group: "Presets",
        keywords: `${p.tagline} ${p.direction}`,
        run: () => {
          const c = compilePreset(p);
          const state = useProject.getState();
          setStudio({
            ...(c.studio.scoreMood !== undefined ? { scoreMood: c.studio.scoreMood } : {}),
            ...(c.studio.autoSfx !== undefined ? { autoSfx: c.studio.autoSfx } : {}),
            ...(c.studio.autoKenBurns !== undefined ? { autoKenBurns: c.studio.autoKenBurns } : {}),
            ...(c.studio.overlay !== undefined ? { overlay: c.studio.overlay } : {}),
            ...(c.studio.kineticCaptions !== undefined ? { kineticCaptions: c.studio.kineticCaptions } : {}),
            ...(c.studio.motionDefault !== undefined ? { motionDefault: c.studio.motionDefault } : {}),
            look: { ...state.studio.look, ...c.studio.look },
          });
          if (state.plan && (c.plan.transitionCycle || c.plan.transitionMap)) {
            state.setPlan({
              ...state.plan,
              colorGrade: c.plan.colorGrade ?? state.plan.colorGrade,
              segments: applyPlanOps(state.plan.segments, c.plan),
            });
          }
          return `${p.label} preset applied — ${p.tagline.toLowerCase()}`;
        },
      });
    }

    for (const [k, g] of Object.entries(GENRE_LOOKS)) {
      out.push({
        id: `genre-${k}`, label: `Look: ${g.label}`, group: "Looks", keywords: `genre grade color ${k}`,
        run: () => { setLook({ grade: k, ...g.pairs }); return `${g.label} look on`; },
      });
    }
    for (const [k, s] of Object.entries(FILM_STOCKS)) {
      out.push({
        id: `stock-${k}`, label: `Film stock: ${s.label}`, group: "Looks", keywords: `stock grade color film ${k}`,
        run: () => { setLook({ grade: k }); return `${s.label} stock on`; },
      });
    }
    for (const [k, g] of Object.entries(COLOR_GRADES)) {
      out.push({
        id: `grade-${k}`, label: `Grade: ${g.label}`, group: "Looks", keywords: `color grade simple ${k}`,
        run: () => { setLook({ grade: k }); return `${g.label} grade on`; },
      });
    }

    const lookToggles: { key: keyof StudioConfig["look"]; label: string; kw: string; on: Partial<StudioConfig["look"]> }[] = [
      { key: "letterbox", label: "Cinema letterbox bars", kw: "black bars widescreen", on: { letterbox: true } },
      { key: "grain", label: "Film grain", kw: "texture noise", on: { grain: 0.3 } },
      { key: "vignette", label: "Vignette", kw: "dark edges", on: { vignette: 0.45 } },
      { key: "halation", label: "Halation bloom", kw: "glow highlights soft", on: { halation: true } },
      { key: "anamorphic", label: "Anamorphic lens", kw: "flare squeeze widescreen", on: { anamorphic: true } },
      { key: "goldenHour", label: "Golden hour warmth", kw: "sunset warm", on: { goldenHour: true } },
      { key: "dayForNight", label: "Day-for-night", kw: "dark moon night", on: { dayForNight: true } },
      { key: "haze", label: "Atmospheric haze", kw: "dreamy fog soft", on: { haze: true } },
      { key: "sharpen", label: "Sharpen", kw: "crisp detail", on: { sharpen: true } },
      { key: "denoise", label: "Denoise footage", kw: "clean noise", on: { denoise: true } },
      { key: "autoNormalize", label: "Auto color/exposure match", kw: "white balance consistent", on: { autoNormalize: true } },
    ];
    for (const t of lookToggles) {
      out.push({
        id: `look-${String(t.key)}`, label: t.label, group: "Look toggles", keywords: t.kw,
        run: () => {
          const cur = useProject.getState().studio.look;
          const isOn = typeof cur[t.key] === "number" ? (cur[t.key] as number) > 0 : !!cur[t.key];
          if (isOn) {
            const off: Partial<StudioConfig["look"]> = {};
            (off as Record<string, unknown>)[t.key as string] = typeof cur[t.key] === "number" ? 0 : false;
            setLook(off);
            return `${t.label} off`;
          }
          setLook(t.on);
          return `${t.label} on`;
        },
      });
    }

    const motions: { id: MotionEffect; label: string }[] = [
      { id: "none", label: "Motion: none" },
      { id: "ken-burns-in", label: "Motion: push in (Ken Burns)" },
      { id: "ken-burns-out", label: "Motion: pull out" },
      { id: "drift", label: "Motion: drift" },
      { id: "shake", label: "Motion: handheld shake" },
      { id: "stabilize", label: "Motion: stabilize" },
    ];
    for (const m of motions) {
      out.push({
        id: `motion-${m.id}`, label: m.label, group: "Motion", keywords: "camera movement dolly",
        run: () => { setStudio({ motionDefault: m.id }); return `${m.label} set`; },
      });
    }
    out.push({
      id: "auto-kenburns", label: "Auto Ken Burns on static shots", group: "Motion", keywords: "dolly zoom automatic",
      run: () => {
        const v = !useProject.getState().studio.autoKenBurns;
        setStudio({ autoKenBurns: v });
        return `Auto Ken Burns ${v ? "on" : "off"}`;
      },
    });
    out.push({
      id: "auto-reframe", label: "Subject-aware 9:16 reframe", group: "Motion", keywords: "crop vertical portrait",
      run: () => {
        const v = !useProject.getState().studio.autoReframe;
        setStudio({ autoReframe: v });
        return `Auto reframe ${v ? "on" : "off"}`;
      },
    });

    out.push({
      id: "overlay-none", label: "Atmosphere: none", group: "Atmosphere", keywords: "clear overlay off",
      run: () => { setStudio({ overlay: null }); return "Atmosphere off"; },
    });
    for (const k of Object.keys(OVERLAY_LABELS) as OverlayType[]) {
      out.push({
        id: `overlay-${k}`, label: `Atmosphere: ${OVERLAY_LABELS[k].emoji} ${OVERLAY_LABELS[k].label}`,
        group: "Atmosphere", keywords: OVERLAY_LABELS[k].hint,
        run: () => { setStudio({ overlay: k }); return `${OVERLAY_LABELS[k].label} overlay on`; },
      });
    }

    const moods: (ScoreMood | null)[] = [null, "epic", "chill", "dark", "uplift"];
    for (const m of moods) {
      out.push({
        id: `mood-${m ?? "off"}`, label: m ? `Score: ${m}` : "Score: off", group: "Sound", keywords: "music soundtrack compose",
        run: () => { setStudio({ scoreMood: m }); return m ? `${m} score on` : "Score off"; },
      });
    }
    out.push({
      id: "auto-sfx", label: "Auto sound FX on transitions", group: "Sound", keywords: "whoosh impact sfx",
      run: () => {
        const v = !useProject.getState().studio.autoSfx;
        setStudio({ autoSfx: v });
        return `Transition SFX ${v ? "on" : "off"}`;
      },
    });
    out.push({
      id: "kinetic", label: "Kinetic word-pop captions", group: "Text", keywords: "captions subtitles words",
      run: () => {
        const v = !useProject.getState().studio.kineticCaptions;
        setStudio({ kineticCaptions: v });
        return `Kinetic captions ${v ? "on" : "off"}`;
      },
    });

    out.push({
      id: "cinematicify", label: "✨ Cinematic-ify (one tap)", group: "Actions", keywords: "instant movie look everything",
      run: () => { setStudio({ look: cinematicify() }); return "Cinematic-ified"; },
    });
    out.push({
      id: "reset-studio", label: "Reset the whole Studio", group: "Actions", keywords: "clear default start over",
      run: () => { setStudio({ ...DEFAULT_STUDIO }); return "Studio reset to defaults"; },
    });

    const navs: [string, string, string][] = [
      ["/home", "Go to Home", "start reel link upload"],
      ["/editor", "Go to Editor", "clips timeline edit"],
      ["/export", "Go to Export", "download share render"],
      ["/features", "Everything this app can do", "feature list manifest help"],
    ];
    for (const [path, label, kw] of navs) {
      out.push({ id: `nav-${path}`, label, group: "Navigate", keywords: kw, run: () => { router.push(path); return label; } });
    }
    return out;
  }, [router]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries.slice(0, 12);
    return entries
      .filter((e) => `${e.label} ${e.group} ${e.keywords}`.toLowerCase().includes(q))
      .slice(0, 14);
  }, [entries, query]);

  function runEntry(e: Entry) {
    const msg = e.run();
    setOpen(false);
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }

  return (
    <>
      {/* floating trigger — thumb-reachable on mobile, ⌘K on desktop */}
      <button
        onClick={openPalette}
        aria-label="Search all tools"
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-card-border bg-card shadow-lg active:border-accent"
      >
        <Search size={18} className="text-accent" />
      </button>

      {toast && (
        <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white shadow-lg">
          {toast}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/75 px-4 pt-[12vh]" onClick={closePalette}>
          <div
            className="w-full max-w-md overflow-hidden rounded-2xl border border-card-border bg-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-card-border px-4 py-3">
              <Search size={16} className="shrink-0 text-accent" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && results[0]) runEntry(results[0]);
                }}
                placeholder="Search any tool — grain, noir, slow motion, rain…"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-600"
              />
              <button onClick={closePalette} aria-label="Close search">
                <X size={16} className="text-neutral-500" />
              </button>
            </div>
            <div className="max-h-[50vh] overflow-y-auto py-2">
              {results.length === 0 && (
                <p className="px-4 py-6 text-center text-xs text-neutral-500">
                  No tool matches “{query}” — try “grade”, “motion”, or “preset”.
                </p>
              )}
              {results.map((e) => (
                <button
                  key={e.id}
                  onClick={() => runEntry(e)}
                  className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm text-neutral-200 hover:bg-black/40 active:bg-black/40"
                >
                  <span>{e.label}</span>
                  <span className="ml-3 shrink-0 text-[10px] uppercase tracking-wider text-neutral-600">{e.group}</span>
                </button>
              ))}
            </div>
            <p className="border-t border-card-border px-4 py-2 text-[10px] text-neutral-600">
              ⌘K / Ctrl-K opens this anywhere · Enter runs the top match
            </p>
          </div>
        </div>
      )}
    </>
  );
}
