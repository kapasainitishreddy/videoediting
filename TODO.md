# TODO

Everything currently requested has shipped and is on
`claude/ai-video-editing-app-vrohjm`. This file tracks what's genuinely left —
pulled from `src/lib/features-manifest.ts` (`status: "roadmap"`), which is the
source of truth. Update the manifest and this file together.

## Priority: security

- [ ] **Server-side credit enforcement** — paid-tier AI credits are currently
      only checked client-side (wallet.ts, IndexedDB). A user who edits the
      client state can spend past their balance. Mirror the spend check at
      the `/api/*` boundary before any paid AI call runs.
      _(`src/lib/credits.ts`, `src/app/api/generate`, `src/app/api/checkout`)_

## Needs a backend / accounts (deliberately absent from the local-first core)

- [ ] Team workspace with roles + shared library — needs accounts + cloud
      storage; the portable project file (`edl.ts`) is the handoff today.
- [ ] Live shared cursors (Figma-style co-editing) — needs a realtime sync
      backend + accounts.
- [ ] Collaborative review with comments — needs a realtime backend; project
      files + share codes cover async handoff today.
- [ ] Template marketplace — needs a community backend (storage, moderation,
      discovery).
- [ ] Direct in-app upload to TikTok/YouTube — needs platform OAuth apps; the
      OS share sheet covers mobile posting today.

## Needs a generative/ML model beyond what runs in-browser

- [ ] Sky replacement — needs a segmentation model.
- [ ] AI relighting — needs a relighting model.
- [ ] Freeform object removal (inpainting) — corner delogo works today;
      arbitrary objects need an inpainting model.
- [ ] Eye-contact correction — needs a gaze-redirection model.
- [ ] Content-aware letterbox fill (true outpainting) — blur-fill ships
      today; painting *new* pixels needs a generative model.
- [ ] Focus pull simulation (animated rack focus) — static portrait DoF
      ships today; an animated pull needs a depth model over time.
- [ ] Ambience beds by scene type — needs scene classification + a sound
      bank; procedural score/SFX cover the rest of the audio suite today.

## UI / pipeline work, no new model needed

- [ ] Side-by-side diff view vs. a reference video — needs a synced
      dual-player UI.
- [ ] Progressive skill levels (beginner → pro gating) — UI gating planned,
      not yet built.
- [ ] Live camera overlay while filming — needs a `getUserMedia` recording UI.
- [ ] AI dubbing (translated voiceover, re-timed) — translation and TTS both
      exist independently; the re-timing/mux pipeline that ties them
      together for dubbing is not built.
- [ ] Motion-blur speed ramps (`minterpolate`) — the FFmpeg core supports
      it, but it's too slow in single-threaded WASM today; revisit if a
      multi-threaded core (SharedArrayBuffer/COOP-COEP) becomes viable.

## Notes for whoever picks this up

- Pure-lib pattern: business logic lives in `src/lib/*.ts` with no
  `"use client"`/DOM imports so it's unit-testable via
  `npx tsx scripts/features-test.mjs`. New logic should follow this.
- Manifest (`src/lib/features-manifest.ts`) statuses: `working` / `key`
  (needs an operator-provided API key) / `roadmap`. Keep it honest — don't
  mark something `working` until it's wired into the UI and tested.
- Full regression: `npx tsx scripts/features-test.mjs && npx eslint src
  scripts --max-warnings=0 && npm run build`.
