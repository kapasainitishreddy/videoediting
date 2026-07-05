// The prompt compiler: turn ONE plain-English direction into the WHOLE
// edit — transitions, sound design, color, motion, atmosphere, score.
//
// This is the deterministic quality floor. A beginner types "make it
// cinematic and moody with punchy transitions and sound effects" and this
// module — with NO AI key required — resolves that into a concrete
// StudioConfig patch (grade, letterbox, grain, score mood, SFX on…) plus a
// set of plan operations (which transitions to use, how tight to cut, speed).
// When a key IS present, /api/ai "compile-direction" refines the same shape
// on top (see normalizeCompileDirection in ai-schema.ts) — so the result is
// consistent whether or not a model was in the loop.
//
// Pure and framework-free: no "use client", no DOM, no network — importable
// from a Node test and from the server route alike. It only imports data
// tables and types, never anything that touches `window`.
import type { TransitionType } from "./types";
import { TRANSITIONS, COLOR_GRADES } from "./transitions";
import { FILM_STOCKS, GENRE_LOOKS, type LookConfig } from "./looks-data";

// These mirror the enums declared in the client modules. We re-declare the
// string unions here (rather than importing from "use client" files) so this
// module stays server/Node importable. The compiler output is validated
// against the real tables above, and the wiring layer assigns into the real
// StudioConfig — a mismatch would be a compile error there, not a silent bug.
export type ScoreMood = "epic" | "chill" | "dark" | "uplift";
export type OverlayType = "rain" | "embers" | "dust" | "fog" | "light-leak" | "lens-flare";
export type MotionEffect = "none" | "ken-burns-in" | "ken-burns-out" | "shake" | "stabilize" | "drift";
export type CaptionStyleId = "bold" | "highlight" | "subtitle" | "hook";

const VALID_TRANSITIONS = new Set<string>(TRANSITIONS.map((t) => t.type));
const VALID_GRADES = new Set<string>([
  ...Object.keys(COLOR_GRADES),
  ...Object.keys(FILM_STOCKS),
  ...Object.keys(GENRE_LOOKS),
]);
const VALID_MOODS = new Set<string>(["epic", "chill", "dark", "uplift"]);
const VALID_OVERLAYS = new Set<string>(["rain", "embers", "dust", "fog", "light-leak", "lens-flare"]);
const VALID_MOTIONS = new Set<string>(["none", "ken-burns-in", "ken-burns-out", "shake", "stabilize", "drift"]);

// What the compiler produces. The wiring layer merges `studio.look` onto the
// current look, applies the other studio fields directly, and walks `plan`
// over the EditPlan's segments.
export interface CompiledDirection {
  studio: {
    look: Partial<LookConfig>;
    motionDefault?: MotionEffect;
    autoKenBurns?: boolean;
    autoReframe?: boolean;
    overlay?: OverlayType | null;
    overlayOpacity?: number;
    scoreMood?: ScoreMood | null;
    autoSfx?: boolean;
    kineticCaptions?: boolean;
  };
  plan: {
    // COLOR_GRADES key for the legacy/AI plan path. When the look uses a
    // genre/stock grade (not a COLOR_GRADES key) this is "none" so grading
    // isn't applied twice — look.grade is the single source of truth.
    colorGrade?: string;
    // Cycle these transitions across the cuts, in order (overrides the
    // motion-matched picks). Empty/undefined = leave motion-match alone.
    transitionCycle?: TransitionType[];
    // Or remap specific transition types the motion-matcher chose.
    transitionMap?: Partial<Record<TransitionType, TransitionType>>;
    // Multiply every segment's speed (slow-mo <1, fast >1).
    speedScale?: number;
    // Shorten each shot to this fraction of its length (0..1), for punchier
    // pacing. Clamped so a shot never drops below ~0.35s at wiring time.
    tightenTo?: number;
    captionStyle?: CaptionStyleId;
  };
  notes: string[]; // human-readable, for the plan explanation
  summary: string; // one-line headline of what the direction became
}

// Internal mutable draft the rules write into.
interface Draft {
  look: Partial<LookConfig>;
  motionDefault?: MotionEffect;
  autoKenBurns?: boolean;
  autoReframe?: boolean;
  overlay?: OverlayType | null;
  overlayOpacity?: number;
  scoreMood?: ScoreMood | null;
  autoSfx?: boolean;
  kineticCaptions?: boolean;
  colorGrade?: string;
  transitionCycle?: TransitionType[];
  transitionMap?: Partial<Record<TransitionType, TransitionType>>;
  speedScale?: number;
  tightenTo?: number;
  captionStyle?: CaptionStyleId;
  notes: string[];
}

// Set the grade coherently across both paths: `look.grade` is the source of
// truth for the cinematic renderer; `colorGrade` mirrors it only when it's a
// real COLOR_GRADES key, else "none" so grading never stacks.
function setGrade(d: Draft, grade: string) {
  if (!VALID_GRADES.has(grade)) return;
  d.look.grade = grade;
  d.colorGrade = COLOR_GRADES[grade] ? grade : "none";
}

// A rule fires when its pattern hits the direction. Rules are additive and
// ordered general→specific, so a later, more specific rule wins for any field
// it sets (e.g. "noir" overriding a generic "cinematic" grade).
interface Rule {
  match: RegExp;
  apply: (d: Draft) => void;
  note: string;
}

const RULES: Rule[] = [
  // ---- Mood & genre grade -------------------------------------------------
  {
    match: /cinematic|movie|film look|filmic|hollywood/i,
    apply: (d) => {
      setGrade(d, "blockbuster");
      d.look.letterbox = true;
      d.look.grain = Math.max(d.look.grain ?? 0, 0.2);
      d.look.halation = true;
      d.look.vignette = Math.max(d.look.vignette ?? 0, 0.35);
      if (d.scoreMood === undefined) d.scoreMood = "epic";
    },
    note: "cinematic look: blockbuster grade, cinema bars, soft halation",
  },
  {
    match: /moody|noir|neo-?noir|film noir/i,
    apply: (d) => {
      setGrade(d, "neo-noir");
      d.look.vignette = Math.max(d.look.vignette ?? 0, 0.6);
      d.look.grain = Math.max(d.look.grain ?? 0, 0.25);
      d.scoreMood = "dark";
    },
    note: "neo-noir mood: crushed blacks, heavy vignette, dark score",
  },
  {
    match: /warm|golden|sunset|sunrise|travel|summer/i,
    apply: (d) => {
      setGrade(d, "kodak-warm");
      d.look.goldenHour = true;
      d.transitionMap = { ...d.transitionMap, flash: "light-leak" };
      if (d.scoreMood === undefined) d.scoreMood = "uplift";
    },
    note: "warm golden-hour grade with light-leak accents",
  },
  {
    match: /vintage|retro|old ?school|8 ?mm|16 ?mm|super ?8|nostalg/i,
    apply: (d) => {
      setGrade(d, "vintage-16mm");
      d.look.grain = Math.max(d.look.grain ?? 0, 0.4);
      d.look.vignette = Math.max(d.look.vignette ?? 0, 0.3);
    },
    note: "vintage 16mm stock with heavier grain",
  },
  {
    // Note: "punchy" is deliberately NOT here — it usually describes pacing
    // ("punchy cuts/transitions"), not color, and would wrongly override a
    // stated mood grade. Energy is handled by the pacing rules below.
    match: /vibrant|pop|bright|colou?rful|bold colou?r/i,
    apply: (d) => {
      setGrade(d, "high-contrast");
      d.look.sharpen = true;
    },
    note: "punchy high-contrast grade with a touch of sharpening",
  },
  {
    match: /horror|scary|creepy|nightmare|eerie/i,
    apply: (d) => {
      setGrade(d, "horror");
      d.look.vignette = Math.max(d.look.vignette ?? 0, 0.8);
      d.look.grain = Math.max(d.look.grain ?? 0, 0.4);
      d.scoreMood = "dark";
      d.overlay = "fog";
    },
    note: "horror look: desaturated, deep vignette, fog, dark score",
  },
  {
    match: /dreamy|ethereal|soft|hazy|dream/i,
    apply: (d) => {
      d.look.haze = true;
      d.look.halation = true;
      d.look.grade = d.look.grade ?? "none";
      if (d.scoreMood === undefined) d.scoreMood = "chill";
    },
    note: "dreamy haze with gentle bloom",
  },
  {
    match: /clean|minimal|modern|crisp/i,
    apply: (d) => {
      setGrade(d, "none");
      d.look.grain = 0;
      d.look.sharpen = true;
    },
    note: "clean modern look: no grain, subtle sharpening",
  },
  {
    match: /teal|orange|teal.?orange/i,
    apply: (d) => setGrade(d, "cinematic"),
    note: "teal-and-orange blockbuster grade",
  },
  {
    match: /black.?and.?white|b&w|b ?and ?w|monochrome|grayscale|greyscale/i,
    apply: (d) => setGrade(d, "noir-bw"),
    note: "black & white",
  },
  {
    match: /cool|cold|blue|icy/i,
    apply: (d) => setGrade(d, "cool"),
    note: "cool blue grade",
  },
  {
    match: /night|dark scene|midnight/i,
    apply: (d) => {
      d.look.dayForNight = true;
      d.look.vignette = Math.max(d.look.vignette ?? 0, 0.4);
    },
    note: "day-for-night: blue-shifted, dropped exposure",
  },
  {
    match: /documentary|doc\b|realistic|natural/i,
    apply: (d) => setGrade(d, "documentary"),
    note: "documentary-natural grade",
  },
  {
    match: /indie|a24|arthouse|art.?house/i,
    apply: (d) => {
      setGrade(d, "a24-indie");
      d.look.grain = Math.max(d.look.grain ?? 0, 0.35);
    },
    note: "A24 indie look",
  },
  {
    match: /anamorphic|widescreen|cinemascope/i,
    apply: (d) => {
      d.look.anamorphic = true;
      d.look.letterbox = true;
    },
    note: "anamorphic widescreen with lens character",
  },
  {
    match: /letterbox|cinema bars|film bars|2\.?39|21:9/i,
    apply: (d) => { d.look.letterbox = true; },
    note: "cinema letterbox bars",
  },
  {
    match: /grain|grainy|film grain/i,
    apply: (d) => { d.look.grain = Math.max(d.look.grain ?? 0, 0.35); },
    note: "film grain",
  },

  // ---- Energy & pacing ----------------------------------------------------
  {
    match: /fast|hype|energetic|energy|hard|aggressive|intense|snappy/i,
    apply: (d) => {
      d.tightenTo = Math.min(d.tightenTo ?? 1, 0.7);
      d.autoSfx = true;
      if (!d.transitionCycle) d.transitionCycle = ["whip-pan", "zoom-in", "hard-cut"];
      if (d.scoreMood === undefined) d.scoreMood = "epic";
    },
    note: "high energy: tighter cuts, whip/zoom transitions, SFX on",
  },
  {
    match: /slow|calm|chill|aesthetic|relax|lofi|lo-fi|mellow|gentle/i,
    apply: (d) => {
      d.speedScale = Math.min(d.speedScale ?? 1, 0.9);
      d.transitionMap = { ...d.transitionMap, "whip-pan": "fade", flash: "fade" };
      d.autoKenBurns = true;
      // "chill/calm" is a stated mood, so it overrides any mood a look rule
      // set as a default (e.g. travel → uplift).
      d.scoreMood = "chill";
    },
    note: "calm pacing: gentle slow-mo, dissolves, slow Ken Burns push",
  },
  {
    match: /dramatic|epic|grand|powerful|cinematic trailer|trailer/i,
    apply: (d) => {
      d.look.letterbox = true;
      d.scoreMood = "epic";
      d.autoSfx = true;
    },
    note: "epic drama: letterbox, swelling score, impact hits",
  },
  {
    match: /happy|fun|upbeat|joyful|bright mood|feel.?good/i,
    apply: (d) => { d.scoreMood = "uplift"; },
    note: "upbeat, uplifting score",
  },

  // ---- Transitions --------------------------------------------------------
  {
    match: /whip|whip.?pan|swipe/i,
    apply: (d) => { d.transitionCycle = ["whip-pan"]; },
    note: "whip-pan transitions",
  },
  {
    match: /zoom/i,
    apply: (d) => {
      d.transitionCycle = ["zoom-in", "zoom-out"];
      d.autoSfx = true;
    },
    note: "zoom-punch transitions with impact SFX",
  },
  {
    match: /glitch|digital|vhs|distort/i,
    apply: (d) => {
      d.transitionCycle = ["glitch"];
      d.autoSfx = true;
    },
    note: "glitch transitions with glitch SFX",
  },
  {
    match: /smooth|seamless|invisible|flow/i,
    apply: (d) => {
      d.transitionMap = { ...d.transitionMap, "hard-cut": "blur" };
    },
    note: "smoothed cuts: hard cuts become blur dissolves",
  },
  {
    match: /flash|strobe/i,
    apply: (d) => {
      d.transitionCycle = ["flash", "hard-cut"];
      d.autoSfx = true;
    },
    note: "flash cuts on the hits",
  },
  {
    match: /slide|push/i,
    apply: (d) => { d.transitionCycle = ["slide-left", "slide-right"]; },
    note: "alternating slide transitions",
  },
  {
    match: /spin|rotate|roll/i,
    apply: (d) => { d.transitionCycle = ["spin"]; },
    note: "spin transitions",
  },
  {
    match: /fade|dissolve|cross ?fade/i,
    apply: (d) => { d.transitionCycle = ["fade"]; },
    note: "soft cross-fades",
  },

  // ---- Audio --------------------------------------------------------------
  {
    match: /sound ?effect|sfx|whoosh|swoosh|impact|boom|riser/i,
    apply: (d) => { d.autoSfx = true; },
    note: "transition sound effects on",
  },
  {
    match: /music|score|soundtrack|beat drop|beats?\b|background music/i,
    apply: (d) => { if (d.scoreMood === undefined) d.scoreMood = "epic"; },
    note: "original score composed to the cut",
  },
  { match: /\bepic score|orchestral|heroic\b/i, apply: (d) => { d.scoreMood = "epic"; }, note: "epic score" },
  { match: /\bdark (music|score|vibe|tone)|ominous|tense\b/i, apply: (d) => { d.scoreMood = "dark"; }, note: "dark score" },

  // ---- Motion -------------------------------------------------------------
  {
    match: /ken ?burns|dolly|slow (push|zoom)|drift/i,
    apply: (d) => { d.autoKenBurns = true; },
    note: "Ken Burns push on static shots",
  },
  {
    match: /shake|handheld|hand.?held|shaky|documentary feel/i,
    apply: (d) => { d.motionDefault = "shake"; },
    note: "handheld shake",
  },
  {
    match: /stabil|smooth motion|steady/i,
    apply: (d) => { d.motionDefault = "stabilize"; },
    note: "stabilized footage",
  },
  {
    match: /reframe|vertical|9:16|portrait|crop to/i,
    apply: (d) => { d.autoReframe = true; },
    note: "subject-aware 9:16 reframe",
  },

  // ---- Atmosphere overlays ------------------------------------------------
  { match: /\brain|rainy|storm/i, apply: (d) => { d.overlay = "rain"; }, note: "rain overlay" },
  { match: /ember|spark|fire|burning/i, apply: (d) => { d.overlay = "embers"; }, note: "drifting embers" },
  { match: /dust|particle|floaty|mote/i, apply: (d) => { d.overlay = "dust"; }, note: "dust motes" },
  { match: /fog|mist|smoke/i, apply: (d) => { d.overlay = "fog"; }, note: "volumetric fog" },
  { match: /light ?leak/i, apply: (d) => { d.overlay = "light-leak"; }, note: "light leaks" },
  { match: /lens ?flare|anamorphic flare/i, apply: (d) => { d.overlay = "lens-flare"; }, note: "lens flare" },

  // ---- Captions -----------------------------------------------------------
  {
    match: /caption|subtitle|text|word.?by.?word|kinetic|karaoke/i,
    apply: (d) => {
      d.kineticCaptions = true;
    },
    note: "kinetic word-by-word captions",
  },
];

// Compile a direction string into a full pipeline configuration. Always
// returns a valid object — an empty/unmatched direction yields an empty patch
// (no changes), so the app behaves exactly as before when there's nothing to
// act on.
export function compileDirection(direction: string): CompiledDirection {
  const text = (direction ?? "").trim();
  const draft: Draft = { look: {}, notes: [] };

  for (const rule of RULES) {
    if (rule.match.test(text)) {
      rule.apply(draft);
      draft.notes.push(rule.note);
    }
  }

  // Validate/clean the transition cycle & map against real transition types.
  const cycle = draft.transitionCycle?.filter((t) => VALID_TRANSITIONS.has(t));
  const map = draft.transitionMap
    ? Object.fromEntries(
        Object.entries(draft.transitionMap).filter(
          ([from, to]) => VALID_TRANSITIONS.has(from) && VALID_TRANSITIONS.has(String(to))
        )
      )
    : undefined;

  const summary = draft.notes.length
    ? draft.notes.slice(0, 3).join("; ")
    : "No specific direction — keeping the motion-matched auto-edit.";

  return {
    studio: {
      look: draft.look,
      motionDefault: draft.motionDefault,
      autoKenBurns: draft.autoKenBurns,
      autoReframe: draft.autoReframe,
      overlay: draft.overlay,
      overlayOpacity: draft.overlayOpacity,
      scoreMood: draft.scoreMood ?? undefined,
      autoSfx: draft.autoSfx,
      kineticCaptions: draft.kineticCaptions,
    },
    plan: {
      colorGrade: draft.colorGrade,
      transitionCycle: cycle && cycle.length ? cycle : undefined,
      transitionMap: map && Object.keys(map).length ? (map as Partial<Record<TransitionType, TransitionType>>) : undefined,
      speedScale: draft.speedScale,
      tightenTo: draft.tightenTo,
      captionStyle: draft.captionStyle,
    },
    notes: draft.notes,
    summary,
  };
}

// Apply a compiled direction's PLAN operations to a list of segments in
// place-safe fashion (returns new segment objects). Transition cycle wins over
// the motion-matched picks; otherwise the map remaps them. Speed and tighten
// are clamped to keep every shot renderable (≥0.35s, speed 0.25–4).
export interface CompilableSegment {
  start: number;
  end: number;
  speed: number;
  transitionAfter: TransitionType | null;
}

export function applyPlanOps<T extends CompilableSegment>(
  segments: T[],
  plan: CompiledDirection["plan"]
): T[] {
  const n = segments.length;
  return segments.map((seg, i) => {
    const next = { ...seg };
    const isLast = i === n - 1;

    // Pacing: shorten the shot toward tightenTo, keeping ≥0.35s.
    if (plan.tightenTo && plan.tightenTo < 1) {
      const len = next.end - next.start;
      const tightened = Math.max(0.35, len * plan.tightenTo);
      next.end = Number((next.start + tightened).toFixed(2));
    }
    // Speed.
    if (plan.speedScale && plan.speedScale !== 1) {
      next.speed = Number(Math.max(0.25, Math.min(4, next.speed * plan.speedScale)).toFixed(3));
    }
    // Transitions.
    if (!isLast) {
      if (plan.transitionCycle && plan.transitionCycle.length) {
        next.transitionAfter = plan.transitionCycle[i % plan.transitionCycle.length];
      } else if (plan.transitionMap && next.transitionAfter && plan.transitionMap[next.transitionAfter]) {
        next.transitionAfter = plan.transitionMap[next.transitionAfter]!;
      }
    } else {
      next.transitionAfter = null;
    }
    return next;
  });
}

// Merge one compiled direction over another (patch wins where it sets a
// field). Used to lay an AI refinement on top of the deterministic local
// result: the local compile is always the floor, the model only adjusts.
export function mergeCompiled(base: CompiledDirection, patch: Partial<CompiledDirection>): CompiledDirection {
  return {
    studio: {
      ...base.studio,
      ...patch.studio,
      look: { ...base.studio.look, ...patch.studio?.look },
    },
    plan: { ...base.plan, ...patch.plan },
    notes: [...base.notes, ...(patch.notes ?? [])],
    summary: patch.summary || base.summary,
  };
}

// --- AI-refined path ---------------------------------------------------------
// The /api/ai "compile-direction" task asks the model to return a FLAT JSON
// object describing the same pipeline. We clamp every field to the app's real
// enums here, so no provider can ever push an invalid grade/overlay/transition
// into the render. Anything missing or invalid is simply dropped — the local
// compile still stands underneath (see mergeCompiled).
function clampNumber(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, n));
}

export function normalizeCompiledDirection(raw: unknown): Partial<CompiledDirection> {
  const o = (raw ?? {}) as Record<string, unknown>;
  const look: Partial<LookConfig> = {};
  const studio: CompiledDirection["studio"] = { look };
  const plan: CompiledDirection["plan"] = {};

  // Grade → look.grade (+ mirror colorGrade only for real COLOR_GRADES keys).
  if (typeof o.grade === "string") {
    const g = o.grade.toLowerCase().trim();
    if (VALID_GRADES.has(g)) {
      look.grade = g;
      plan.colorGrade = COLOR_GRADES[g] ? g : "none";
    }
  }
  if (typeof o.letterbox === "boolean") look.letterbox = o.letterbox;
  if (typeof o.halation === "boolean") look.halation = o.halation;
  if (typeof o.goldenHour === "boolean") look.goldenHour = o.goldenHour;
  if (typeof o.dayForNight === "boolean") look.dayForNight = o.dayForNight;
  if (typeof o.anamorphic === "boolean") look.anamorphic = o.anamorphic;
  if (typeof o.haze === "boolean") look.haze = o.haze;
  if (typeof o.sharpen === "boolean") look.sharpen = o.sharpen;
  const grain = clampNumber(o.grain, 0, 1);
  if (grain !== undefined) look.grain = grain;
  const vignette = clampNumber(o.vignette, 0, 1);
  if (vignette !== undefined) look.vignette = vignette;

  // Top-level studio fields.
  if (typeof o.scoreMood === "string" && VALID_MOODS.has(o.scoreMood)) studio.scoreMood = o.scoreMood as ScoreMood;
  if (typeof o.autoSfx === "boolean") studio.autoSfx = o.autoSfx;
  if (typeof o.autoKenBurns === "boolean") studio.autoKenBurns = o.autoKenBurns;
  if (typeof o.autoReframe === "boolean") studio.autoReframe = o.autoReframe;
  if (typeof o.kineticCaptions === "boolean") studio.kineticCaptions = o.kineticCaptions;
  if (o.overlay === null) studio.overlay = null;
  else if (typeof o.overlay === "string" && VALID_OVERLAYS.has(o.overlay)) studio.overlay = o.overlay as OverlayType;
  if (typeof o.motion === "string" && VALID_MOTIONS.has(o.motion)) studio.motionDefault = o.motion as MotionEffect;
  const overlayOpacity = clampNumber(o.overlayOpacity, 0.05, 1);
  if (overlayOpacity !== undefined) studio.overlayOpacity = overlayOpacity;

  // Plan ops.
  if (Array.isArray(o.transitionCycle)) {
    const cycle = o.transitionCycle
      .map((t) => (typeof t === "string" ? t.toLowerCase().trim().replace(/\s+/g, "-") : ""))
      .filter((t) => VALID_TRANSITIONS.has(t)) as TransitionType[];
    if (cycle.length) plan.transitionCycle = cycle.slice(0, 12);
  }
  const speedScale = clampNumber(o.speedScale, 0.25, 4);
  if (speedScale !== undefined) plan.speedScale = speedScale;
  const tightenTo = clampNumber(o.tightenTo, 0.3, 1);
  if (tightenTo !== undefined) plan.tightenTo = tightenTo;

  const result: Partial<CompiledDirection> = { studio, plan };
  if (typeof o.summary === "string" && o.summary.trim()) result.summary = o.summary.slice(0, 200);
  return result;
}

// System prompt for the AI-refined compile path. Kept here (next to the
// enums it must respect) so the route stays a thin dispatcher.
export const COMPILE_DIRECTION_PROMPT = `You are a master video editor translating a creator's plain-English direction into concrete edit settings for a 9:16 short-form video. Return ONLY a flat JSON object, no prose or markdown fences, with any of these OPTIONAL keys (omit any you're unsure about):
{"grade": one of [${[...VALID_GRADES].join(", ")}], "letterbox": boolean, "grain": 0..1, "vignette": 0..1, "halation": boolean, "goldenHour": boolean, "dayForNight": boolean, "anamorphic": boolean, "haze": boolean, "sharpen": boolean, "scoreMood": one of [epic, chill, dark, uplift], "autoSfx": boolean, "autoKenBurns": boolean, "autoReframe": boolean, "kineticCaptions": boolean, "overlay": one of [rain, embers, dust, fog, light-leak, lens-flare] or null, "motion": one of [none, ken-burns-in, ken-burns-out, shake, stabilize, drift], "transitionCycle": array of [${[...VALID_TRANSITIONS].join(", ")}], "speedScale": 0.25..4, "tightenTo": 0.3..1, "summary": short sentence}. Choose tasteful, restrained settings that a professional editor would — do not enable everything at once.`;
