// Niche / category extraction for an uploaded reel.
//
// Pure and framework-free (no "use client", no DOM, no network) so it runs in
// a Node test and inside the server route alike. The browser does the frame
// grabbing and hands the results here; this module owns the taxonomy, the
// deterministic local classifier, and the validator that clamps any AI answer
// back onto the taxonomy.
//
// Two paths, same output shape:
//   • classifyNicheLocal(): title keywords + edit-style heuristics. Always
//     available, no key required — the quality floor.
//   • /api/ai "classify-niche" (see ai-schema/ai-providers): optional vision
//     refinement from a few frames, normalized by normalizeNiche() here.

export type NicheId =
  | "travel"
  | "fitness"
  | "food"
  | "fashion"
  | "beauty"
  | "gaming"
  | "comedy"
  | "music"
  | "dance"
  | "tech"
  | "education"
  | "pets"
  | "sports"
  | "finance"
  | "lifestyle"
  | "general";

export interface NicheResult {
  id: NicheId;
  label: string;
  confidence: number; // 0..1
  source: "title" | "style" | "ai" | "fallback";
}

interface NicheDef {
  id: NicheId;
  label: string;
  emoji: string;
  keywords: string[]; // matched as word-ish substrings against title/caption text
}

// The fixed taxonomy. "general" is the catch-all and has no keywords — it's
// only ever returned as a fallback, never matched.
export const NICHES: NicheDef[] = [
  { id: "travel", label: "Travel", emoji: "✈️", keywords: ["travel", "trip", "wanderlust", "explore", "adventure", "vacation", "destination", "backpack", "roadtrip", "road trip", "journey", "beach", "mountain", "hike", "hiking", "flight", "passport", "tourist", "nomad", "getaway", "sightseeing"] },
  { id: "fitness", label: "Fitness", emoji: "💪", keywords: ["fitness", "workout", "gym", "exercise", "training", "muscle", "gains", "cardio", "hiit", "bodybuilding", "fitfam", "reps", "lifting", "crossfit", "abs", "physique", "shredded", "transformation"] },
  { id: "food", label: "Food", emoji: "🍜", keywords: ["food", "recipe", "cooking", "cook", "baking", "meal", "kitchen", "foodie", "delicious", "tasty", "restaurant", "chef", "dish", "snack", "dessert", "breakfast", "dinner", "mukbang", "eats"] },
  { id: "fashion", label: "Fashion", emoji: "👗", keywords: ["fashion", "outfit", "ootd", "lookbook", "wardrobe", "thrift", "haul", "streetwear", "runway", "designer", "clothing", "style inspo", "fit check"] },
  { id: "beauty", label: "Beauty", emoji: "💄", keywords: ["makeup", "beauty", "skincare", "cosmetics", "glam", "lipstick", "foundation", "grwm", "hairstyle", "nails", "glowup", "glow up", "mascara", "contour"] },
  { id: "gaming", label: "Gaming", emoji: "🎮", keywords: ["gaming", "gamer", "gameplay", "stream", "twitch", "fortnite", "minecraft", "warzone", "speedrun", "console", "esports", "valorant", "roblox", "clutch", "noscope"] },
  { id: "comedy", label: "Comedy", emoji: "😂", keywords: ["comedy", "funny", "meme", "prank", "skit", "joke", "humor", "humour", "parody", "sketch", "bloopers", "relatable"] },
  { id: "music", label: "Music", emoji: "🎵", keywords: ["music", "song", "cover", "remix", "producer", "singing", "guitar", "piano", "lyrics", "musician", "band", "vocals", "acoustic", "freestyle"] },
  { id: "dance", label: "Dance", emoji: "🕺", keywords: ["dance", "dancing", "choreography", "choreo", "routine", "dancer", "ballet", "hiphop dance", "twerk"] },
  { id: "tech", label: "Tech", emoji: "📱", keywords: ["tech", "technology", "gadget", "unboxing", "iphone", "android", "app review", "coding", "pc build", "software", "gadgets", "review of", "setup tour"] },
  { id: "education", label: "Education", emoji: "📚", keywords: ["education", "learn", "tutorial", "how to", "howto", "explained", "tips", "facts", "study", "science", "history", "lesson", "did you know", "life hack", "lifehack"] },
  { id: "pets", label: "Pets", emoji: "🐶", keywords: ["pet", "dog", "cat", "puppy", "kitten", "doggo", "adopt", "rescue", "paws", "kitty", "golden retriever"] },
  { id: "sports", label: "Sports", emoji: "⚽", keywords: ["sports", "football", "basketball", "soccer", "nba", "nfl", "athlete", "highlights", "goal", "dunk", "touchdown", "cricket", "tennis", "skateboard", "surfing"] },
  { id: "finance", label: "Finance", emoji: "📈", keywords: ["finance", "money", "invest", "investing", "stocks", "crypto", "bitcoin", "business", "entrepreneur", "wealth", "budget", "trading", "passive income", "side hustle"] },
  { id: "lifestyle", label: "Lifestyle", emoji: "🌿", keywords: ["vlog", "lifestyle", "daily routine", "morning routine", "day in the life", "self care", "selfcare", "productivity", "aesthetic", "motivation", "grwm"] },
];

const BY_ID = new Map<string, NicheDef>(NICHES.map((n) => [n.id, n]));

export function nicheLabel(id: string): string {
  return BY_ID.get(id)?.label ?? "General";
}
export function nicheEmoji(id: string): string {
  return BY_ID.get(id)?.emoji ?? "🎬";
}

export interface StyleHints {
  pacing?: "slow" | "medium" | "fast" | "frenetic";
  colorGrade?: string;
  avgShotLength?: number;
  transitionCount?: number;
}

// Broad style→niche nudges, used only when the title gives no signal. These
// are weak on purpose (an edit style suggests a vibe, not a topic).
const STYLE_BONUS: { when: (s: StyleHints) => boolean; add: Partial<Record<NicheId, number>> }[] = [
  { when: (s) => s.pacing === "fast" || s.pacing === "frenetic", add: { gaming: 0.6, fitness: 0.5, sports: 0.5, comedy: 0.4, dance: 0.4 } },
  { when: (s) => s.pacing === "slow", add: { travel: 0.6, lifestyle: 0.5, food: 0.3 } },
  { when: (s) => (s.colorGrade ?? "").includes("warm"), add: { travel: 0.4, lifestyle: 0.3, food: 0.3 } },
  { when: (s) => (s.colorGrade ?? "").includes("cool") || (s.colorGrade ?? "").includes("cinematic"), add: { tech: 0.3, gaming: 0.3 } },
];

// Deterministic local classifier. `text` is the title plus any caption/
// transcript text the caller can supply.
export function classifyNicheLocal(text: string, style?: StyleHints): NicheResult {
  const hay = ` ${(text ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ")} `;
  const scores = new Map<NicheId, number>();

  for (const n of NICHES) {
    let score = 0;
    for (const kw of n.keywords) {
      // word-boundary-ish match so "cat" doesn't hit "category"
      const needle = ` ${kw} `;
      if (hay.includes(needle)) score += kw.includes(" ") ? 2 : 1; // phrases weigh more
    }
    if (score > 0) scores.set(n.id, score);
  }

  const titleRanked = [...scores.entries()].sort((a, b) => b[1] - a[1]);

  if (titleRanked.length > 0) {
    const [topId, topScore] = titleRanked[0];
    const secondScore = titleRanked[1]?.[1] ?? 0;
    const margin = topScore - secondScore;
    const confidence = Math.max(0.45, Math.min(0.95, 0.45 + 0.12 * topScore + 0.12 * margin));
    return { id: topId, label: nicheLabel(topId), confidence: round2(confidence), source: "title" };
  }

  // No title signal → try style heuristics.
  if (style) {
    const styleScores = new Map<NicheId, number>();
    for (const rule of STYLE_BONUS) {
      if (rule.when(style)) {
        for (const [id, v] of Object.entries(rule.add)) {
          styleScores.set(id as NicheId, (styleScores.get(id as NicheId) ?? 0) + (v ?? 0));
        }
      }
    }
    const styleRanked = [...styleScores.entries()].sort((a, b) => b[1] - a[1]);
    if (styleRanked.length > 0 && styleRanked[0][1] > 0) {
      const [topId] = styleRanked[0];
      return { id: topId, label: nicheLabel(topId), confidence: 0.35, source: "style" };
    }
  }

  return { id: "general", label: "General", confidence: 0.2, source: "fallback" };
}

// Clamp an AI reply to the taxonomy. Accepts { niche, confidence } in any
// casing; unknown niches map to "general".
export function normalizeNiche(raw: unknown): NicheResult {
  const o = (raw ?? {}) as Record<string, unknown>;
  const rawId = typeof o.niche === "string" ? o.niche.toLowerCase().trim() : "";
  const id: NicheId = (BY_ID.has(rawId) ? rawId : "general") as NicheId;
  let confidence = typeof o.confidence === "number" ? o.confidence : Number(o.confidence);
  if (!Number.isFinite(confidence)) confidence = 0.6;
  confidence = Math.max(0, Math.min(1, confidence));
  return { id, label: nicheLabel(id), confidence: round2(confidence), source: "ai" };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// System prompt for the AI vision path. Lists the taxonomy so the model can
// only pick a valid id (and normalizeNiche enforces it regardless).
export const CLASSIFY_NICHE_PROMPT = `You are a social-media strategist. Classify this short-form vertical video into exactly ONE niche. You may be given its title, edit-style stats, and a few sample frames. Choose the single best fit from this list ONLY: ${NICHES.map((n) => n.id).join(", ")}. If nothing fits, use "general". Respond with ONLY a JSON object, no prose or markdown fences: {"niche": string, "confidence": number between 0 and 1}.`;
