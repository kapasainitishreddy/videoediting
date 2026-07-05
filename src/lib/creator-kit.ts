// Creator kit — pure, Node-testable helpers that make a finished edit easier
// to reach and easier to post:
//
//  • GENRE_PRESETS    — one-tap pipeline bundles. Each preset is a curated
//                       prompt-compiler direction, so a preset and a typed
//                       prompt flow through the SAME engine — one source of
//                       truth, no drift between "preset behavior" and
//                       "prompt behavior".
//  • studioToCode / studioFromCode — share your whole Studio setup (grade,
//                       motion, atmosphere, score, SFX, captions) as a short
//                       "VES1." code. Decoding runs through the same
//                       normalizer as AI replies, so a tampered code can
//                       never inject invalid settings.
//  • brandFilterFromHex — nudge the grade toward your brand colors.
//  • socialCaption    — ready-to-post caption + hashtags from the detected
//                       niche and edit stats.
//  • pickEmphasisWord — which word in a caption line deserves the pop.
import {
  compileDirection,
  normalizeCompiledDirection,
  type CompiledDirection,
} from "./prompt-compiler";

// --- Genre presets ---------------------------------------------------------------
export interface GenrePreset {
  id: string;
  label: string;
  emoji: string;
  tagline: string;
  direction: string; // fed through compileDirection — same engine as typing it
}

export const GENRE_PRESETS: GenrePreset[] = [
  {
    id: "wedding",
    label: "Wedding",
    emoji: "💍",
    tagline: "Soft, warm, timeless",
    direction: "dreamy soft golden warm, gentle slow pacing, fade transitions, uplifting score, film grain",
  },
  {
    id: "travel",
    label: "Travel",
    emoji: "✈️",
    tagline: "Golden hour + light leaks",
    direction: "warm golden travel sunset, smooth transitions, uplifting music, ken burns",
  },
  {
    id: "fitness",
    label: "Fitness",
    emoji: "💪",
    tagline: "Hard cuts, heavy hits",
    direction: "fast aggressive high energy, punchy transitions with sound effects, epic score, vibrant",
  },
  {
    id: "food",
    label: "Food",
    emoji: "🍜",
    tagline: "Rich color, calm rhythm",
    direction: "warm vibrant colorful, calm pacing, smooth fade transitions, chill music, sharpen",
  },
  {
    id: "gaming",
    label: "Gaming",
    emoji: "🎮",
    tagline: "Glitch energy",
    direction: "fast glitch vhs edgy, sound effects, dark score, zoom transitions",
  },
  {
    id: "cinematic-story",
    label: "Film Story",
    emoji: "🎬",
    tagline: "Letterbox + epic score",
    direction: "cinematic movie look with letterbox, dramatic epic score, smooth transitions, anamorphic",
  },
];

export function compilePreset(preset: GenrePreset): CompiledDirection {
  return compileDirection(preset.direction);
}

// --- Studio share codes ("VES1.") ---------------------------------------------------
// The encoded shape is deliberately the FLAT shape the AI normalizer accepts,
// so studioFromCode gets validation for free — same trust boundary as a
// model reply. Anything unknown/invalid in a code is simply dropped.
export interface FlatStudio {
  grade?: string;
  letterbox?: boolean;
  grain?: number;
  vignette?: number;
  halation?: boolean;
  goldenHour?: boolean;
  dayForNight?: boolean;
  anamorphic?: boolean;
  haze?: boolean;
  sharpen?: boolean;
  scoreMood?: string | null;
  autoSfx?: boolean;
  autoKenBurns?: boolean;
  autoReframe?: boolean;
  kineticCaptions?: boolean;
  overlay?: string | null;
  overlayOpacity?: number;
  motion?: string;
}

export function studioToCode(flat: FlatStudio): string {
  const json = JSON.stringify(flat);
  return "VES1." + btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function studioFromCode(code: string): Partial<CompiledDirection> | null {
  try {
    if (!code.startsWith("VES1.")) return null;
    const b64 = code.slice(5).replace(/-/g, "+").replace(/_/g, "/");
    const raw = JSON.parse(decodeURIComponent(escape(atob(b64))));
    return normalizeCompiledDirection(raw); // clamps every field to real enums
  } catch {
    return null;
  }
}

// --- Brand palette match ---------------------------------------------------------------
// Parse the user's brand hex colors, measure their average warmth/saturation,
// and produce a gentle corrective filter that nudges footage toward that
// palette. Deliberately subtle — brand ALIGNMENT, not a color replacement.
export function brandFilterFromHex(hexes: string[]): { filter: string; summary: string } | null {
  const rgbs = hexes
    .map((h) => h.trim().replace(/^#/, ""))
    .filter((h) => /^[0-9a-f]{6}$/i.test(h))
    .map((h) => ({
      r: parseInt(h.slice(0, 2), 16) / 255,
      g: parseInt(h.slice(2, 4), 16) / 255,
      b: parseInt(h.slice(4, 6), 16) / 255,
    }));
  if (rgbs.length === 0) return null;

  const avg = rgbs.reduce((a, c) => ({ r: a.r + c.r, g: a.g + c.g, b: a.b + c.b }), { r: 0, g: 0, b: 0 });
  avg.r /= rgbs.length;
  avg.g /= rgbs.length;
  avg.b /= rgbs.length;
  const gray = (avg.r + avg.g + avg.b) / 3;
  const warmth = avg.r - avg.b; // >0 warm brand, <0 cool brand
  const satAmt = (Math.abs(avg.r - gray) + Math.abs(avg.g - gray) + Math.abs(avg.b - gray)) * 2;

  const rm = Math.max(-0.12, Math.min(0.12, warmth * 0.35));
  const bm = -rm;
  const sat = Math.max(0.95, Math.min(1.15, 1 + satAmt * 0.3));
  const filter = `colorbalance=rm=${rm.toFixed(3)}:bm=${bm.toFixed(3)},eq=saturation=${sat.toFixed(2)}`;
  const summary = `${warmth > 0.03 ? "warm" : warmth < -0.03 ? "cool" : "neutral"} brand tint, ${sat > 1.05 ? "richer" : "matched"} color`;
  return { filter, summary };
}

// --- Post-ready caption + hashtags -----------------------------------------------------------
// Deterministic templates keyed by niche — works with zero API keys. The
// pacing tweak keeps it from feeling like one canned sentence.
const NICHE_CAPTIONS: Record<string, { captions: string[]; tags: string[] }> = {
  travel: {
    captions: ["Take this as your sign to book the trip ✈️", "POV: you finally said yes to the trip"],
    tags: ["travel", "wanderlust", "traveltok", "explore", "bucketlist"],
  },
  fitness: {
    captions: ["No excuses. Just reps. 💪", "The only bad workout is the one you skipped"],
    tags: ["fitness", "gymtok", "workout", "gymmotivation", "fitcheck"],
  },
  food: {
    captions: ["You need to try this at least once 🤤", "Saving this recipe? Thought so."],
    tags: ["foodtok", "recipe", "easyrecipes", "foodie", "cooking"],
  },
  fashion: { captions: ["Outfit? Understood the assignment.", "Fit check — rate it 1-10"], tags: ["fashion", "ootd", "styleinspo", "fitcheck", "outfitideas"] },
  beauty: { captions: ["Wait for the after ✨", "This routine changed everything"], tags: ["beauty", "grwm", "skincare", "makeuptutorial", "glowup"] },
  gaming: { captions: ["Clip of the week. No debate. 🎮", "He had 1HP. ONE."], tags: ["gaming", "gamingclips", "gamer", "clutch", "fyp"] },
  comedy: { captions: ["I can't be the only one 😭", "Tell me this isn't accurate"], tags: ["funny", "comedy", "relatable", "meme", "fyp"] },
  music: { captions: ["Sound on for this one 🎵", "This melody has been stuck in my head all week"], tags: ["music", "musician", "cover", "newmusic", "songwriter"] },
  dance: { captions: ["Took 47 takes. Worth it. 🕺", "Learn this one with me"], tags: ["dance", "dancechallenge", "choreography", "dancer", "fyp"] },
  tech: { captions: ["This changes everything. Here's why →", "You're using this wrong (probably)"], tags: ["tech", "techtok", "gadgets", "technology", "review"] },
  education: { captions: ["Today years old when I learned this 🤯", "Save this — you'll need it later"], tags: ["learnontiktok", "education", "didyouknow", "facts", "howto"] },
  pets: { captions: ["He knows exactly what he did 🐶", "POV: the best part of my day"], tags: ["pets", "dogsoftiktok", "catsoftiktok", "animals", "cute"] },
  sports: { captions: ["Watch this twice. You'll see it. ⚽", "Cold. Absolutely cold."], tags: ["sports", "highlights", "athlete", "sportstok", "goat"] },
  finance: { captions: ["The earlier you learn this, the better 📈", "Nobody teaches you this in school"], tags: ["finance", "money", "investing", "financialfreedom", "moneytok"] },
  lifestyle: { captions: ["Romanticize your routine ☀️", "A reset day, documented"], tags: ["lifestyle", "aesthetic", "dayinmylife", "selfcare", "routine"] },
  general: { captions: ["Wait for it…", "This took way too long to make 😅"], tags: ["fyp", "viral", "foryou", "trending", "creator"] },
};

export function socialCaption(
  nicheId: string,
  stats: { pacing?: string; bpm?: number | null } = {}
): { caption: string; hashtags: string[]; full: string } {
  const bank = NICHE_CAPTIONS[nicheId] ?? NICHE_CAPTIONS.general;
  // fast edits get the punchier first variant, calm ones the second
  const idx = stats.pacing === "fast" || stats.pacing === "frenetic" ? 0 : bank.captions.length - 1;
  const caption = bank.captions[idx];
  const hashtags = bank.tags.slice(0, 5);
  return { caption, hashtags, full: `${caption}\n\n${hashtags.map((t) => `#${t}`).join(" ")}` };
}

// --- Caption emphasis ------------------------------------------------------------------------
// Which single word in a caption line deserves visual emphasis: numbers win,
// then exclaim-y words, then the longest non-stopword. Returns the index into
// line.split(/\s+/) so renderers can style just that token.
const STOPWORDS = new Set(["the", "a", "an", "and", "or", "but", "to", "of", "in", "on", "at", "is", "it", "its", "this", "that", "was", "you", "your", "my", "for", "with", "i", "we", "me", "so", "be", "do", "did"]);

export function pickEmphasisWord(line: string): { index: number; word: string } | null {
  const words = line.trim().split(/\s+/);
  if (words.length < 2) return null; // one word is already all emphasis
  let best = -1;
  let bestScore = -1;
  words.forEach((w, i) => {
    const clean = w.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!clean || STOPWORDS.has(clean)) return;
    let score = clean.length;
    if (/\d/.test(clean)) score += 10; // numbers are almost always the point
    if (/[!?]/.test(w)) score += 4;
    if (w === w.toUpperCase() && /[A-Z]/.test(w)) score += 6; // already shouted
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best >= 0 ? { index: best, word: words[best] } : null;
}
