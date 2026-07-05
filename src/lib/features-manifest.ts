// The honest feature manifest: every feature from the 20-uniqueness and
// 50-cinematic lists, with its real status in the codebase. Rendered at
// /features. "working" = implemented and verified locally; "key" = wired,
// needs an API key; "roadmap" = not built (requires models/services beyond
// this stack) — listed so the app never pretends.

export type FeatureStatus = "working" | "key" | "roadmap";

export interface Feature {
  name: string;
  status: FeatureStatus;
  where: string; // what to tap / which module
  group: string;
}

export const FEATURES: Feature[] = [
  // ---------- Viral intelligence (uniqueness list) ----------
  { group: "Viral Intelligence", name: "Trend fingerprinting + taste profile", status: "working", where: "Analyze → Save style · Home shows your profile" },
  { group: "Viral Intelligence", name: "Virality score with breakdown", status: "working", where: "Editor → below timeline" },
  { group: "Viral Intelligence", name: "Reverse-engineer any reel (cut map, BPM, style)", status: "working", where: "Home → paste link / upload" },
  { group: "Viral Intelligence", name: "Niche / category extraction (title + edit-style, vision-refined)", status: "working", where: "Analyze → niche card" },
  { group: "Viral Intelligence", name: "Format migration (TikTok / Reels / Shorts)", status: "working", where: "Analyze → Adapt for another platform" },
  { group: "Viral Intelligence", name: "Style blending (pacing from A, look from B)", status: "working", where: "intelligence.blendStyles — surfacing UI soon" },
  { group: "Viral Intelligence", name: "Blueprint share codes (recipe only, no video)", status: "working", where: "Editor → Insights → Copy code · Home → Import" },
  { group: "Viral Intelligence", name: "Preloaded viral templates", status: "working", where: "Home → Start from a viral template" },
  { group: "Viral Intelligence", name: "Batch edit variations (Punchy / Dreamy / Raw)", status: "working", where: "Editor → Insights → Try a different take" },
  { group: "Viral Intelligence", name: "Side-by-side diff vs reference", status: "roadmap", where: "needs synced dual-player UI" },
  { group: "Viral Intelligence", name: "Template marketplace", status: "roadmap", where: "needs a community backend" },

  // ---------- Direction & coaching ----------
  { group: "Direction & Coaching", name: "Plain-English AI direction", status: "working", where: "Editor → Direct the AI" },
  { group: "Direction & Coaching", name: "One-prompt full edit (transitions + SFX + look + score)", status: "working", where: "Editor → Direct the AI — prompt-compiler drives the Studio" },
  { group: "Direction & Coaching", name: "Voice-directed editing", status: "working", where: "Editor → mic button (Chrome/Safari)" },
  { group: "Direction & Coaching", name: "Step-by-step recreation guide", status: "working", where: "Analyze → How to recreate it" },
  { group: "Direction & Coaching", name: "Shot list generator", status: "working", where: "Analyze → Shot list" },
  { group: "Direction & Coaching", name: "Explain-this-edit narration", status: "key", where: "richer with MINIMAX/ANTHROPIC/OPENAI key" },
  { group: "Direction & Coaching", name: "Progressive skill levels", status: "roadmap", where: "UI gating planned" },
  { group: "Direction & Coaching", name: "Live camera overlay while filming", status: "roadmap", where: "needs getUserMedia recording UI" },
  { group: "Direction & Coaching", name: "Reshoot comparison score", status: "roadmap", where: "builds on clip-analysis" },
  { group: "Direction & Coaching", name: "Undo history for edits", status: "working", where: "Editor → undo (up to 20 steps)" },
  { group: "Direction & Coaching", name: "Portable project export", status: "roadmap", where: "blueprint codes cover the recipe today" },

  // ---------- Color & grading ----------
  { group: "Color & Grading", name: "7 color grades", status: "working", where: "Studio → Look & Grade" },
  { group: "Color & Grading", name: "5 film stock emulations", status: "working", where: "Studio → Film stocks" },
  { group: "Color & Grading", name: "5 genre looks (Neo-Noir, A24, Blockbuster…)", status: "working", where: "Studio → Genre looks" },
  { group: "Color & Grading", name: "Scene-adaptive auto color/exposure matching", status: "working", where: "Studio → Auto color/exposure match" },
  { group: "Color & Grading", name: "Reference-match grading from an image", status: "working", where: "cinematic.gradeFromImage — surfacing UI soon" },
  { group: "Color & Grading", name: "Day-for-night simulation", status: "working", where: "Studio → Day-for-night" },
  { group: "Color & Grading", name: "Golden hour simulation", status: "working", where: "Studio → Golden hour warmth" },
  { group: "Color & Grading", name: "Auto white-balance correction", status: "working", where: "part of auto color match" },

  // ---------- Camera & motion ----------
  { group: "Camera & Motion", name: "Ken Burns / virtual dolly", status: "working", where: "Studio → Camera Motion → Push/Pull" },
  { group: "Camera & Motion", name: "Auto Ken Burns on static shots", status: "working", where: "Studio → auto toggle" },
  { group: "Camera & Motion", name: "Stabilization (deshake)", status: "working", where: "Studio → Stabilize" },
  { group: "Camera & Motion", name: "Procedural handheld shake", status: "working", where: "Studio → Handheld" },
  { group: "Camera & Motion", name: "Drift (operator breathing)", status: "working", where: "Studio → Drift" },
  { group: "Camera & Motion", name: "Speed ramps (two-stage)", status: "working", where: "motion.splitForRamp — surfacing UI soon" },
  { group: "Camera & Motion", name: "Subject-aware 9:16 auto-reframe", status: "working", where: "Studio → Subject-aware reframe" },
  { group: "Camera & Motion", name: "Match-cut detector", status: "working", where: "motion.matchCutPairs — surfacing UI soon" },
  { group: "Camera & Motion", name: "Motion-blur speed ramps (minterpolate)", status: "roadmap", where: "core supports it; too slow in WASM today" },

  // ---------- Composition ----------
  { group: "Composition", name: "Composition score + tips", status: "working", where: "motion.compositionScore — surfacing UI soon" },
  { group: "Composition", name: "Cinema letterbox bars", status: "working", where: "Studio → letterbox toggle" },
  { group: "Composition", name: "Rule-of-thirds guidance", status: "working", where: "part of composition score tips" },
  { group: "Composition", name: "Content-aware letterbox fill (outpainting)", status: "roadmap", where: "needs a generative model" },
  { group: "Composition", name: "Depth-of-field simulation", status: "roadmap", where: "needs depth estimation model" },

  // ---------- Lens & optics ----------
  { group: "Lens & Optics", name: "Anamorphic lens simulation", status: "working", where: "Studio → Anamorphic" },
  { group: "Lens & Optics", name: "Chromatic aberration", status: "working", where: "Studio → toggle" },
  { group: "Lens & Optics", name: "Vignette", status: "working", where: "Studio → toggle" },
  { group: "Lens & Optics", name: "Film grain", status: "working", where: "Studio → toggle" },
  { group: "Lens & Optics", name: "Halation bloom", status: "working", where: "Studio → toggle" },
  { group: "Lens & Optics", name: "Lens distortion correct/add", status: "working", where: "lenscorrection in anamorphic chain" },
  { group: "Lens & Optics", name: "Focus pull simulation", status: "roadmap", where: "needs depth model" },

  // ---------- Atmosphere ----------
  { group: "Atmosphere", name: "Rain overlay", status: "working", where: "Studio → Atmosphere" },
  { group: "Atmosphere", name: "Embers overlay", status: "working", where: "Studio → Atmosphere" },
  { group: "Atmosphere", name: "Dust motes + light beam", status: "working", where: "Studio → Atmosphere" },
  { group: "Atmosphere", name: "Volumetric fog drift", status: "working", where: "Studio → Atmosphere" },
  { group: "Atmosphere", name: "Light leaks", status: "working", where: "Studio → Atmosphere (plus transition)" },
  { group: "Atmosphere", name: "Tracked-feel lens flare with ghosts", status: "working", where: "Studio → Atmosphere" },
  { group: "Atmosphere", name: "Atmospheric haze grade", status: "working", where: "Studio → haze toggle" },
  { group: "Atmosphere", name: "Sky replacement", status: "roadmap", where: "needs segmentation model" },
  { group: "Atmosphere", name: "AI relighting", status: "roadmap", where: "needs a relighting model" },

  // ---------- Sound & score ----------
  { group: "Sound & Score", name: "Original score composition (BPM + mood matched)", status: "working", where: "Studio → Score & Sound — synthesized on-device" },
  { group: "Sound & Score", name: "Auto sound FX on transitions (whoosh/impact/glitch/riser)", status: "working", where: "Studio → auto SFX toggle" },
  { group: "Sound & Score", name: "Web sound-effect library with offline fallback", status: "working", where: "sfx-web.ts → /sfx/*.wav, synth if a fetch fails" },
  { group: "Sound & Score", name: "Real beat detection from your music", status: "working", where: "Editor → add music, then Auto-edit" },
  { group: "Sound & Score", name: "S-curve music ducking under speech", status: "working", where: "audio-cinema.mixTimeline — voiceover UI soon" },
  { group: "Sound & Score", name: "Speech-range detection", status: "working", where: "audio-cinema.speechRanges" },
  { group: "Sound & Score", name: "Beat-locked music swap", status: "working", where: "swap music → Auto-edit re-snaps cuts" },
  { group: "Sound & Score", name: "Ambience beds by scene type", status: "roadmap", where: "needs scene classification + sound bank" },
  { group: "Sound & Score", name: "Cloud AI score (MiniMax music)", status: "key", where: "MINIMAX_API_KEY" },

  // ---------- Titles & text ----------
  { group: "Titles & Text", name: "4 viral caption styles, beat-timed", status: "working", where: "Editor → Captions" },
  { group: "Titles & Text", name: "Kinetic word-pop typography", status: "working", where: "Studio → kinetic captions toggle" },
  { group: "Titles & Text", name: "Cinematic title cards (3 styles)", status: "working", where: "Studio → Titles & Credits" },
  { group: "Titles & Text", name: "Lower thirds", status: "working", where: "titles.renderLowerThird — surfacing UI soon" },
  { group: "Titles & Text", name: "End credits", status: "working", where: "Studio → credits box" },
  { group: "Titles & Text", name: "Auto-transcribed captions (Whisper)", status: "key", where: "OPENAI_API_KEY" },

  // ---------- Story intelligence ----------
  { group: "Story Intelligence", name: "Three-act pacing analysis", status: "working", where: "Analyze → Pacing structure" },
  { group: "Story Intelligence", name: "Emotional arc data", status: "working", where: "intelligence.emotionalArc" },
  { group: "Story Intelligence", name: "Cold-open detector", status: "working", where: "intelligence.coldOpenCheck" },
  { group: "Story Intelligence", name: "B-roll gap detection", status: "working", where: "intelligence.brollGaps" },
  { group: "Story Intelligence", name: "AI storyboard generation", status: "key", where: "any LLM key via /api/ai" },

  // ---------- AI generation ----------
  { group: "AI Generation", name: "AI B-roll generation (text → clip)", status: "key", where: "MINIMAX_API_KEY via /api/generate" },
  { group: "AI Generation", name: "Smarter transition labels / edit refinement", status: "key", where: "any of the three provider keys" },

  // ---------- Business & access ----------
  { group: "Business & Access", name: "Unlimited free on-device editing & export", status: "working", where: "no account, no watermark — renders in your browser" },
  { group: "Business & Access", name: "Credits + pricing page (4 tiers)", status: "working", where: "/pricing — balance chip on Home & Editor" },
  { group: "Business & Access", name: "Fair AI billing (charge only if the AI ran, auto-refund)", status: "working", where: "wallet.withCredit — spend + refund-if-unavailable" },
  { group: "Business & Access", name: "Bring-your-own AI key (meter off)", status: "working", where: "Studio tier — any provider key in .env.local" },
  { group: "Business & Access", name: "Payment checkout", status: "roadmap", where: "startCheckout() stub — wire Stripe/Lemon/Paddle" },
  { group: "Business & Access", name: "Server-side credit enforcement", status: "roadmap", where: "mirror spend at /api boundary for paid tiers" },

  // ---------- Retention & hooks (v2 drop) ----------
  { group: "Retention & Hooks", name: "Retention risk heatmap on the timeline", status: "working", where: "Editor → Insights" },
  { group: "Retention & Hooks", name: "Dead-intro detector with exact trim suggestion", status: "working", where: "Editor → Insights (under the heatmap)" },
  { group: "Retention & Hooks", name: "Hook A/B variants (tight / swapped / ending-first teaser)", status: "working", where: "Editor → Insights → Try a different hook" },
  { group: "Retention & Hooks", name: "Callback ending (hook returns at the end)", status: "working", where: "Editor → Insights → loopability" },
  { group: "Retention & Hooks", name: "Loopability score + tips", status: "working", where: "Editor → Insights" },
  { group: "Retention & Hooks", name: "Cut-to-length variants (15s / 30s / 60s)", status: "working", where: "Editor → Insights → Cut to length" },

  // ---------- Smart cutting (v2 drop) ----------
  { group: "Smart Cutting", name: "Highlight-reel distiller for long clips", status: "working", where: "Editor → ⚡ Distill on any clip over 25s" },
  { group: "Smart Cutting", name: "Auto black-bar strip (baked-in letterbox/pillarbox)", status: "working", where: "automatic at clip upload" },
  { group: "Smart Cutting", name: "Repeat-take detector", status: "roadmap", where: "needs pairwise clip similarity pass" },
  { group: "Smart Cutting", name: "Multi-cam sync via audio waveforms", status: "roadmap", where: "needs cross-correlation aligner" },
  { group: "Smart Cutting", name: "Text-based editing / filler-word remover", status: "key", where: "needs Whisper word timestamps (OPENAI_API_KEY) — planned" },

  // ---------- One-tap pipelines (v2 drop) ----------
  { group: "One-Tap Pipelines", name: "6 genre presets (Wedding, Travel, Fitness, Food, Gaming, Film Story)", status: "working", where: "Editor → preset chips above the prompt" },
  { group: "One-Tap Pipelines", name: "Studio share codes (VES1 — trade full setups)", status: "working", where: "Studio → Pro → Share this Studio setup" },
  { group: "One-Tap Pipelines", name: "Command palette — every tool searchable", status: "working", where: "⌘K / Ctrl-K or the floating search button" },
  { group: "One-Tap Pipelines", name: "Simple / Pro studio tiers", status: "working", where: "Studio header toggle" },

  // ---------- Overlays+ (v2 drop) ----------
  { group: "Overlays+", name: "Animated counter (Day 1 → Day 7, $0 → $1,000)", status: "working", where: "Editor → Overlays+" },
  { group: "Overlays+", name: "3-2-1 countdown intro", status: "working", where: "Editor → Overlays+" },
  { group: "Overlays+", name: "Location card (📍 place)", status: "working", where: "Editor → Overlays+" },
  { group: "Overlays+", name: "Progress bar along the bottom", status: "working", where: "Editor → Overlays+" },
  { group: "Overlays+", name: "Emoji reactions on excitement peaks", status: "working", where: "Editor → Overlays+" },
  { group: "Overlays+", name: "Watermark / logo overlay", status: "working", where: "Editor → Overlays+ → Add watermark logo" },
  { group: "Overlays+", name: "Smart caption emphasis (key word pops bigger)", status: "working", where: "automatic in kinetic captions" },
  { group: "Overlays+", name: "Freeze-frame call-out with annotation", status: "roadmap", where: "needs frame-hold render path" },

  // ---------- Audio polish (v2 drop) ----------
  { group: "Audio Polish", name: "Music loudness auto-match", status: "working", where: "automatic when you add a track" },
  { group: "Audio Polish", name: "Room-tone ambience on silent edits", status: "working", where: "automatic when the edit has no audio" },
  { group: "Audio Polish", name: "Watch-muted mode (kinetic captions auto-enable)", status: "working", where: "automatic: captions + no audio" },
  { group: "Audio Polish", name: "Voice-clarity EQ (rumble cut + presence lift)", status: "working", where: "audio-polish.polishVoice — voiceover UI soon" },
  { group: "Audio Polish", name: "Silence / dead-air detection", status: "working", where: "audio-polish.silenceRanges — voiceover UI soon" },
  { group: "Audio Polish", name: "Score mood auto-suggest from footage", status: "working", where: "audio-polish.suggestMood — surfacing UI soon" },

  // ---------- Branding & distribution (v2 drop) ----------
  { group: "Branding & Distribution", name: "Brand palette match (footage nudged toward your hex colors)", status: "working", where: "Studio → Pro → Brand colors" },
  { group: "Branding & Distribution", name: "Multi-aspect export (1:1 square, 16:9 wide)", status: "working", where: "Export → More formats" },
  { group: "Branding & Distribution", name: "Best-frame thumbnail picker", status: "working", where: "Export → More formats → Thumbnail" },
  { group: "Branding & Distribution", name: "Caption + hashtag writer from your niche", status: "working", where: "Export → Post kit" },
  { group: "Branding & Distribution", name: "Chapter markers export", status: "working", where: "Export → Post kit → Copy chapters" },
  { group: "Branding & Distribution", name: "Multi-language caption pack", status: "key", where: "needs a translation-capable key — planned" },

  // ---------- Honest roadmap (needs models/backends this stack doesn't have) ----------
  { group: "Needs ML Models", name: "Privacy blur (faces / plates)", status: "roadmap", where: "needs a face-detection model" },
  { group: "Needs ML Models", name: "Chroma key (green screen)", status: "roadmap", where: "chromakey filter unverified in the WASM core" },
  { group: "Needs ML Models", name: "Split-screen / PiP reaction layouts", status: "roadmap", where: "needs hstack/vstack probe + layout UI" },
  { group: "Needs ML Models", name: "Beauty smoothing / eye-contact correction", status: "roadmap", where: "needs face models" },
  { group: "Needs ML Models", name: "Collaborative review with comments", status: "roadmap", where: "needs a sharing backend" },
];

export const featureCounts = () => {
  const working = FEATURES.filter((f) => f.status === "working").length;
  const key = FEATURES.filter((f) => f.status === "key").length;
  const roadmap = FEATURES.filter((f) => f.status === "roadmap").length;
  return { working, key, roadmap, total: FEATURES.length };
};
