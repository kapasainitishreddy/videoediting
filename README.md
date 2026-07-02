# ViralEdit AI 🎬

**Reverse-engineer any viral edit.** Paste a reel link or upload a video — AI maps every cut, transition, and beat, then edits *your* clips to match. Built as a mobile-first PWA: install it to your home screen like a native app.

## Features

- 🔗 **Paste any link** — Instagram Reels, TikTok, YouTube Shorts, X, Facebook (via `yt-dlp`)
- ✂️ **Automatic transition extraction** — every upload is scanned frame-by-frame; hard cuts, whip pans, flash cuts, and fades are detected and timestamped
- 🥁 **Beat & pacing analysis** — estimates BPM from cut rhythm, classifies energy and average shot length
- 📋 **Step-by-step recreation guide** — beginner-friendly instructions for reshooting and recreating the edit
- 🪄 **AI direction** — type "make it cinematic" or "fast cuts, high energy" and the auto-editor restructures your timeline
- 🎞️ **12 real transitions** — whip pan, zoom punch, flash, glitch, spin, blur dissolve, light leak… all rendered with FFmpeg xfade
- 🎨 **7 color grades** — cinematic teal-orange, warm golden, vintage film, noir B&W…
- 📱 **9:16 export** — 720×1280 MP4 sized for Reels/TikTok/Shorts, with native share sheet
- 🔒 **Local-first** — all footage and edits live in your browser's IndexedDB; videos are processed on-device with FFmpeg WebAssembly and never uploaded

## Quick start

```bash
npm install          # also copies the FFmpeg WASM core into public/
pip install yt-dlp   # needed for the paste-a-link feature
npm run dev
```

Open http://localhost:3000 — on a phone, use "Add to Home Screen" to install as an app.

## Optional: AI enrichment (any provider, same result)

The app is fully functional offline — cut detection, beat estimation, auto-editing, and rendering all run locally with zero API keys.

Add **any one** of these to `.env.local` (see `.env.local.example`) to upgrade transition labeling and prompt-directed editing:

```bash
MINIMAX_API_KEY=your_key_here
# or
ANTHROPIC_API_KEY=your_key_here
# or
OPENAI_API_KEY=your_key_here
```

**Why the result is the same no matter which key you use:** `/api/ai` sends every provider the identical system prompt, and every reply — regardless of which LLM answered — is forced through the same validator (`src/lib/ai-schema.ts`) before it reaches the app. Transition types are clamped to the app's real enum, color grades to the app's real presets, and edit-plan segments can only reference clip IDs that actually exist on your timeline. A provider can never hand back something the app doesn't understand. Wording in descriptions will vary slightly between models (that's unavoidable with LLMs), but structure, valid values, and app behavior are guaranteed identical.

## How it works

| Stage | Where | How |
|---|---|---|
| Link download | Server (`/api/download`) | `yt-dlp`, file streamed to browser and deleted from server |
| Cut detection | Browser | Canvas frame-differencing at ~5-10 samples/sec |
| Transition classification | Browser (+ AI if a key is set) | Delta/brightness heuristics → typed transitions, normalized identically across providers |
| Beat estimate | Browser | Inter-cut interval clustering → BPM |
| Auto-edit | Browser (+ AI if a key is set) | Maps your clips onto the reference cut pattern; plain-English rules adjust transitions/grade/speed |
| Render | Browser | FFmpeg WASM: trim → normalize 720×1280 → xfade chain → MP4 |

## Cinematic Studio

The editor now includes a full cinematic engine — all on-device:

- **Looks**: 5 genre looks (Neo-Noir, A24 Indie, Blockbuster, Documentary, Horror), 5 film stocks (Kodak Warm, Fuji Cool, Vintage 16mm, Bleach Bypass, Silver Noir), day-for-night, golden hour, haze, halation, anamorphic, grain, vignette, chromatic aberration, letterbox — plus one-tap **Cinematic-ify**
- **Auto color matching**: per-clip white-balance and exposure normalization so shots don't jump at cuts
- **Camera motion**: Ken Burns push/pull (zoompan), handheld shake, drift, deshake stabilization, subject-aware 9:16 auto-reframe
- **Score & sound**: an original score synthesized on-device (epic/chill/dark/uplift, matched to your BPM), auto whoosh/impact/glitch/riser SFX on transitions, S-curve music ducking under speech
- **Atmosphere**: rain, embers, dust motes, fog, light leaks, lens flare — procedural particle overlays composited in RGB screen-blend
- **Titles**: cinematic title cards (3 styles), kinetic word-pop captions, lower thirds, end credits
- **Intelligence**: virality score with breakdown, three-act pacing analysis, cold-open detector, trend fingerprints + taste profile, blueprint share codes (`VE1.…`), edit variations (Punchy/Dreamy/Raw), platform format migration, match-cut detection, composition scoring

See `/features` in the app for the full honest manifest (what works on-device, what needs a key, what's roadmap). Verification suites live at `/dev/cinetest`, `/dev/fulltest`, `/dev/filters`, `/dev/xfade`, `/dev/caps`.

## Stack

Next.js 16 · React · Tailwind v4 · FFmpeg WebAssembly · Zustand · IndexedDB (idb) · yt-dlp · MiniMax / Anthropic / OpenAI (optional, interchangeable)
