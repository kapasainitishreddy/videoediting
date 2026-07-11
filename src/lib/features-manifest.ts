// The honest feature manifest: every feature from the 20-uniqueness and
// 50-cinematic lists, with its real status in the codebase. Rendered at
// /features. "working" = implemented and verified locally; "key" = wired,
// needs an API key; "roadmap" = not built (requires models/services beyond
// this stack) — listed so the app never pretends.

export type FeatureStatus = "working" | "key" | "coming-soon" | "roadmap";

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
  { group: "Viral Intelligence", name: "Side-by-side diff vs reference", status: "coming-soon", where: "synced dual-player UI in progress" },
  { group: "Viral Intelligence", name: "Community template marketplace", status: "coming-soon", where: "your own template library ships today; community sharing needs a backend" },

  // ---------- Direction & coaching ----------
  { group: "Direction & Coaching", name: "Plain-English AI direction", status: "working", where: "Editor → Direct the AI" },
  { group: "Direction & Coaching", name: "One-prompt full edit (transitions + SFX + look + score)", status: "working", where: "Editor → Direct the AI — prompt-compiler drives the Studio" },
  { group: "Direction & Coaching", name: "Conversational editing — steer the edit one instruction at a time", status: "working", where: "Editor → Chat edit (below Render)" },
  { group: "Direction & Coaching", name: "Describe a motion graphic → animated overlay (title / lower third / counter / countdown / location / caption)", status: "working", where: "Editor → Generate → motion graphic input (on-device, no key)" },
  { group: "Direction & Coaching", name: "Voice-directed editing", status: "working", where: "Editor → mic button (Chrome/Safari)" },
  { group: "Direction & Coaching", name: "Step-by-step recreation guide", status: "working", where: "Analyze → How to recreate it" },
  { group: "Direction & Coaching", name: "Shot list generator", status: "working", where: "Analyze → Shot list" },
  { group: "Direction & Coaching", name: "Explain-this-edit narration", status: "key", where: "richer with MINIMAX/ANTHROPIC/OPENAI key" },
  { group: "Direction & Coaching", name: "Progressive skill levels (Beginner / Pro)", status: "working", where: "Editor → Editing mode toggle (Pro reveals Pro Tools)" },
  { group: "Direction & Coaching", name: "Live camera overlay while filming", status: "working", where: "Home → Film a clip — rule-of-thirds + safe-zone guides, records to your timeline" },
  { group: "Direction & Coaching", name: "Reshoot comparison score", status: "working", where: "Editor → Pro Tools → Reshoot Compare" },
  { group: "Direction & Coaching", name: "Undo history for edits", status: "working", where: "Editor → undo (up to 20 steps)" },
  { group: "Direction & Coaching", name: "Portable project export/import (.viraledit.json)", status: "working", where: "Editor → Pro Tools → Handoff" },

  // ---------- Color & grading ----------
  { group: "Color & Grading", name: "7 color grades", status: "working", where: "Studio → Look & Grade" },
  { group: "Color & Grading", name: "5 film stock emulations", status: "working", where: "Studio → Film stocks" },
  { group: "Color & Grading", name: "5 genre looks (Neo-Noir, A24, Blockbuster…)", status: "working", where: "Studio → Genre looks" },
  { group: "Color & Grading", name: "Scene-adaptive auto color/exposure matching", status: "working", where: "Studio → Auto color/exposure match" },
  { group: "Color & Grading", name: "Reference-match grading from an image", status: "working", where: "cinematic.gradeFromImage — surfacing UI soon" },
  { group: "Color & Grading", name: "Day-for-night simulation", status: "working", where: "Studio → Day-for-night" },
  { group: "Color & Grading", name: "Golden hour simulation", status: "working", where: "Studio → Golden hour warmth" },
  { group: "Color & Grading", name: "Auto white-balance correction", status: "working", where: "part of auto color match" },
  { group: "Color & Grading", name: "Import a .cube LUT onto a clip (lut3d)", status: "working", where: "Editor → Pro Tools → Handoff" },
  { group: "Color & Grading", name: "Section looks — per-shot grade override", status: "working", where: "Timeline → Shot looks row" },

  // ---------- Camera & motion ----------
  { group: "Camera & Motion", name: "Ken Burns / virtual dolly", status: "working", where: "Studio → Camera Motion → Push/Pull" },
  { group: "Camera & Motion", name: "Auto Ken Burns on static shots", status: "working", where: "Studio → auto toggle" },
  { group: "Camera & Motion", name: "Stabilization (deshake)", status: "working", where: "Studio → Stabilize" },
  { group: "Camera & Motion", name: "Procedural handheld shake", status: "working", where: "Studio → Handheld" },
  { group: "Camera & Motion", name: "Drift (operator breathing)", status: "working", where: "Studio → Drift" },
  { group: "Camera & Motion", name: "Speed ramps (two-stage)", status: "working", where: "motion.splitForRamp — surfacing UI soon" },
  { group: "Camera & Motion", name: "Subject-aware 9:16 auto-reframe", status: "working", where: "Studio → Subject-aware reframe" },
  { group: "Camera & Motion", name: "Match-cut detector", status: "working", where: "motion.matchCutPairs — surfacing UI soon" },
  { group: "Camera & Motion", name: "Motion-blur speed ramps", status: "working", where: "Studio → Camera Motion → Motion-blur speed ramps (frame-blend on re-timed shots)" },

  // ---------- AI subject tools (on-device ML — MediaPipe) ----------
  { group: "AI Subject Tools", name: "Face lock — crop follows the face (MediaPipe, on-device)", status: "working", where: "Clip card → face icon → Face lock" },
  { group: "AI Subject Tools", name: "Action lock — crop follows the motion", status: "working", where: "Clip card → face icon → Action lock" },
  { group: "AI Subject Tools", name: "Auto punch-in on faces (CapCut-style auto zoom)", status: "working", where: "Studio → Camera Motion → Auto punch-in on faces" },
  { group: "AI Subject Tools", name: "AI background removal (selfie segmentation)", status: "working", where: "Clip card → face icon → Remove background" },
  { group: "AI Subject Tools", name: "Green screen / chroma key with auto color detect", status: "working", where: "Clip card → face icon → Green screen" },
  { group: "AI Subject Tools", name: "Multi-face picker — choose WHO the lock follows", status: "working", where: "Face lock on a clip with several faces" },
  { group: "AI Subject Tools", name: "Virtual set backgrounds (5 procedural plates)", status: "working", where: "Green screen → backdrop chips" },
  { group: "AI Subject Tools", name: "Watermark / logo removal (corner delogo)", status: "working", where: "Clip card → face icon → Remove a corner watermark" },

  // ---------- Composition ----------
  { group: "Composition", name: "Composition score + tips", status: "working", where: "motion.compositionScore — surfacing UI soon" },
  { group: "Composition", name: "Cinema letterbox bars", status: "working", where: "Studio → letterbox toggle" },
  { group: "Composition", name: "Rule-of-thirds guidance", status: "working", where: "part of composition score tips" },
  { group: "Composition", name: "Blur-fill background (fills bars with a defocused copy)", status: "working", where: "Clip card → face icon → Effects → Blur-fill vertical" },
  { group: "Composition", name: "Content-aware outpainting (fill a 9:16 frame)", status: "key", where: "Editor → Pro Tools → AI Frame Studio → Outpaint (FAL_KEY); blur-fill ships on-device today" },
  { group: "Composition", name: "Depth-of-field simulation (portrait blur)", status: "working", where: "Clip card → face icon → Effects → Portrait blur" },

  // ---------- Lens & optics ----------
  { group: "Lens & Optics", name: "Anamorphic lens simulation", status: "working", where: "Studio → Anamorphic" },
  { group: "Lens & Optics", name: "Chromatic aberration", status: "working", where: "Studio → toggle" },
  { group: "Lens & Optics", name: "Vignette", status: "working", where: "Studio → toggle" },
  { group: "Lens & Optics", name: "Film grain", status: "working", where: "Studio → toggle" },
  { group: "Lens & Optics", name: "Halation bloom", status: "working", where: "Studio → toggle" },
  { group: "Lens & Optics", name: "Lens distortion correct/add", status: "working", where: "lenscorrection in anamorphic chain" },
  { group: "Lens & Optics", name: "Focus pull simulation (animated rack focus)", status: "roadmap", where: "static portrait DoF ships today; an animated rack-focus PULL needs a depth model" },

  // ---------- Atmosphere ----------
  { group: "Atmosphere", name: "Rain overlay", status: "working", where: "Studio → Atmosphere" },
  { group: "Atmosphere", name: "Embers overlay", status: "working", where: "Studio → Atmosphere" },
  { group: "Atmosphere", name: "Dust motes + light beam", status: "working", where: "Studio → Atmosphere" },
  { group: "Atmosphere", name: "Volumetric fog drift", status: "working", where: "Studio → Atmosphere" },
  { group: "Atmosphere", name: "Light leaks", status: "working", where: "Studio → Atmosphere (plus transition)" },
  { group: "Atmosphere", name: "Tracked-feel lens flare with ghosts", status: "working", where: "Studio → Atmosphere" },
  { group: "Atmosphere", name: "Atmospheric haze grade", status: "working", where: "Studio → haze toggle" },
  { group: "Atmosphere", name: "Sky replacement (on a frame)", status: "key", where: "Editor → Pro Tools → AI Frame Studio → Sky replace (FAL_KEY)" },
  { group: "Atmosphere", name: "AI relighting (on a frame)", status: "key", where: "Editor → Pro Tools → AI Frame Studio → Relight (FAL_KEY)" },

  // ---------- Sound & score ----------
  { group: "Sound & Score", name: "Original score composition (BPM + mood matched)", status: "working", where: "Studio → Score & Sound — synthesized on-device" },
  { group: "Sound & Score", name: "Auto sound FX on transitions (whoosh/impact/glitch/riser)", status: "working", where: "Studio → auto SFX toggle" },
  { group: "Sound & Score", name: "Web sound-effect library with offline fallback", status: "working", where: "sfx-web.ts → /sfx/*.wav, synth if a fetch fails" },
  { group: "Sound & Score", name: "Real beat detection from your music", status: "working", where: "Editor → add music, then Auto-edit" },
  { group: "Sound & Score", name: "S-curve music ducking under speech", status: "working", where: "audio-cinema.mixTimeline — voiceover UI soon" },
  { group: "Sound & Score", name: "Speech-range detection", status: "working", where: "audio-cinema.speechRanges" },
  { group: "Sound & Score", name: "Beat-locked music swap", status: "working", where: "swap music → Auto-edit re-snaps cuts" },
  { group: "Sound & Score", name: "Ambience beds by scene type (rain / forest / room / city / ocean / drone)", status: "working", where: "Studio → Score & Sound → Ambience bed (synthesized on-device)" },
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
  { group: "Business & Access", name: "Payment checkout (Stripe) — buy AI credits, verified on return", status: "working", where: "Pricing → Get a plan (activates when STRIPE_SECRET_KEY is set)" },
  { group: "Business & Access", name: "Server-side credit enforcement", status: "coming-soon", where: "mirror spend at the /api boundary for paid tiers — in progress" },

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
  { group: "Smart Cutting", name: "Repeat-take detector", status: "working", where: "Editor → Pro Tools → Repeat-Take Detector" },
  { group: "Smart Cutting", name: "Multi-cam sync via audio waveforms", status: "working", where: "Editor → Pro Tools → Multi-Cam Audio Sync" },
  { group: "Smart Cutting", name: "Text-based editing / filler-word remover", status: "key", where: "Editor → Pro Tools → Edit by Text (OPENAI_API_KEY)" },
  { group: "Smart Cutting", name: "Jump-cut tightener (removes dead air)", status: "working", where: "Editor → Pro Tools → Cut Cleanup" },
  { group: "Smart Cutting", name: "Auto B-roll cutaways at speech gaps", status: "working", where: "Editor → Pro Tools → Cut Cleanup" },
  { group: "Smart Cutting", name: "Multi-cam active-speaker cut (energy diarization)", status: "working", where: "Editor → Pro Tools → Cut Cleanup" },
  { group: "Smart Cutting", name: "Long recording → ranked short-clip candidates", status: "working", where: "Editor → Pro Tools → Long Recording" },
  { group: "Smart Cutting", name: "Quick draft preview (360p, skips slow filters)", status: "working", where: "Editor → below Render" },

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
  { group: "Overlays+", name: "Freeze-frame call-out (hold + annotate with captions)", status: "working", where: "Clip card → face icon → Effects → Freeze-frame" },

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
  { group: "Branding & Distribution", name: "Multi-language caption pack", status: "key", where: "Editor → Pro Tools → Caption Translations (any AI key)" },
  { group: "Branding & Distribution", name: "EDL export (CMX3600) for Premiere/Resolve", status: "working", where: "Editor → Pro Tools → Handoff" },
  { group: "Branding & Distribution", name: "FCPXML export (Final Cut / Resolve)", status: "working", where: "Editor → Pro Tools → Handoff" },
  { group: "Branding & Distribution", name: "Export the current grade as a .cube LUT", status: "working", where: "Editor → Pro Tools → Handoff" },
  { group: "Branding & Distribution", name: "Thumbnail A/B — 3 scored candidates with reasons", status: "working", where: "Export → Thumbnail A/B" },
  { group: "Branding & Distribution", name: "Multi-aspect crop preview grid", status: "working", where: "Export → More formats → Crop preview" },
  { group: "Branding & Distribution", name: "Show notes / blog post from the edit", status: "working", where: "Export → Post kit → Show notes" },
  { group: "Branding & Distribution", name: "Read post copy aloud (accessibility review)", status: "working", where: "Export → Post kit → Read it aloud" },

  // ---------- Rights & trust ----------
  { group: "Rights & Trust", name: "Music copyright check before export (tag scan, honest about not fingerprinting)", status: "working", where: "Editor → Pro Tools → Audio & Rights" },
  { group: "Rights & Trust", name: "License & attribution tracker with auto-credits", status: "working", where: "Editor → Pro Tools · Export → Licenses" },
  { group: "Rights & Trust", name: "CC stock music search (Openverse, keyless)", status: "working", where: "Editor → Pro Tools → Audio & Rights" },

  // ---------- Pro audio ----------
  { group: "Pro Audio", name: "Studio sound — one-tap voice cleanup (gate + EQ + compression)", status: "working", where: "Editor → Pro Tools → Audio & Rights" },
  { group: "Pro Audio", name: "Platform loudness targets (TikTok/YT/podcast LUFS)", status: "working", where: "Editor → Pro Tools → Audio & Rights" },
  { group: "Pro Audio", name: "AI voiceover narration (text → speech)", status: "key", where: "Editor → Pro Tools → AI Voiceover (MINIMAX_API_KEY)" },
  { group: "Pro Audio", name: "Procedural foley cues from motion energy", status: "working", where: "foley.foleyCues — surfacing UI soon" },
  { group: "Pro Audio", name: "Describe a vibe → original royalty-free soundtrack, length-matched", status: "working", where: "Editor → Generate → soundtrack input (on-device composer, no key)" },

  // ---------- Creator growth ----------
  { group: "Creator Growth", name: "Hook writer — niche-tuned opening lines with the why", status: "working", where: "Editor → Pro Tools → Hook Writer" },
  { group: "Creator Growth", name: "Visual similar-shot search across your library", status: "working", where: "Editor → Pro Tools → Find Similar Shots" },

  // ---------- Marketing HQ (creator GTM, adapted from open-source ai-marketing-skills) ----------
  { group: "Marketing HQ", name: "Caption slop check / humanizer (AI-writing detector)", status: "working", where: "/marketing → Slop Check" },
  { group: "Marketing HQ", name: "Title & hook optimizer with rewrites", status: "working", where: "/marketing → Title Optimizer" },
  { group: "Marketing HQ", name: "2-week content calendar generator", status: "working", where: "/marketing → Content Calendar" },
  { group: "Marketing HQ", name: "UTM link builder (know which video sent the click)", status: "working", where: "/marketing → UTM Links" },
  { group: "Marketing HQ", name: "A/B experiment planner with honest sample sizes", status: "working", where: "/marketing → A/B Planner" },
  { group: "Marketing HQ", name: "Sponsor pitch writer + follow-up cadence", status: "working", where: "/marketing → Sponsor Pitch" },
  { group: "Marketing HQ", name: "Media kit builder (.md download)", status: "working", where: "/marketing → Media Kit" },
  { group: "Marketing HQ", name: "Repurposing map — one edit → every platform, wired to app features", status: "working", where: "/marketing → Repurposing Map" },

  // ---------- Honest roadmap (needs models/backends this stack doesn't have) ----------
  { group: "AI Subject Tools", name: "Privacy blur — a blurred box follows the face", status: "working", where: "Clip card → face icon → Effects → Blur the face" },
  { group: "AI Subject Tools", name: "Split-screen (2-up) + picture-in-picture layouts", status: "working", where: "Editor → Pro Tools → Split Screen & PiP" },
  { group: "AI Subject Tools", name: "Beauty skin-smoothing", status: "working", where: "Studio → Look & Grade → Beauty skin-smoothing" },
  // ---------- Collaboration & team (local-first today, realtime coming soon) ----------
  { group: "Collaboration & Team", name: "Async review notes — timestamped comments on the timeline", status: "working", where: "Editor → Collaborate → add a note; travels inside the project file" },
  { group: "Collaboration & Team", name: "Shared asset library (brand kits, LUTs, looks, caption styles, your templates)", status: "working", where: "Editor → Collaborate → Library; export/import the whole kit" },
  { group: "Collaboration & Team", name: "Portable project handoff (.viraledit.json round-trips the full edit)", status: "working", where: "Export → Save project · Home → Import project" },
  { group: "Collaboration & Team", name: "Live shared cursors (Figma-style co-editing)", status: "coming-soon", where: "needs a realtime sync backend + accounts — on the way" },
  { group: "Collaboration & Team", name: "Team workspace with roles + cloud-synced library", status: "coming-soon", where: "the on-device shared library ships today; cloud sync + roles are coming" },
  { group: "Collaboration & Team", name: "Realtime review threads (live comments + @mentions)", status: "coming-soon", where: "async notes ship today; live threads need the collab backend" },
  { group: "Collaboration & Team", name: "Post to TikTok / YouTube / IG (native share sheet)", status: "working", where: "Export → Share — hands the .mp4 to the OS share sheet (navigator.share)" },
  { group: "Collaboration & Team", name: "AI dubbing (translated voiceover, re-timed)", status: "coming-soon", where: "translation + TTS exist; the re-timing/mux pipeline is in progress" },

  // ---------- AI Frame Studio (key-gated cloud edits on a still frame) ----------
  { group: "AI Frame Studio", name: "AI Frame Studio — cloud generative edits on a cover / plate", status: "key", where: "Editor → Pro Tools → AI Frame Studio (FAL_KEY)" },
  { group: "AI Frame Studio", name: "Eye-contact correction (on a frame)", status: "key", where: "Editor → Pro Tools → AI Frame Studio → Eye contact (FAL_KEY)" },
  { group: "AI Frame Studio", name: "Object removal / inpainting (on a frame)", status: "key", where: "Editor → Pro Tools → AI Frame Studio → Remove object (FAL_KEY); corner delogo runs on-device" },
];

export const featureCounts = () => {
  const working = FEATURES.filter((f) => f.status === "working").length;
  const key = FEATURES.filter((f) => f.status === "key").length;
  const comingSoon = FEATURES.filter((f) => f.status === "coming-soon").length;
  const roadmap = FEATURES.filter((f) => f.status === "roadmap").length;
  return { working, key, comingSoon, roadmap, total: FEATURES.length };
};
