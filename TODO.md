# TODO

Source of truth is `src/lib/features-manifest.ts`. Statuses:
`working` (152) · `key` (9, needs your API key) · `coming-soon` (11) ·
`roadmap` (7). Update the manifest and this file together.

The collaboration bucket is now **local-first working**: async review notes
that travel inside the project file, a reusable shared asset library, and
portable-project handoff all ship today. What remains needs either a realtime
backend + accounts, or a generative ML model the on-device stack can't run.

## Priority: security

- [ ] **Server-side credit enforcement** (`coming-soon`) — paid-tier AI credits
      are still only checked client-side (wallet.ts). Mirror the spend check at
      the `/api/*` boundary before any paid AI call runs.

## Coming soon — needs a realtime backend / accounts

- [ ] Live shared cursors (Figma-style co-editing) — realtime sync backend.
- [ ] Team workspace with roles + cloud-synced library — the on-device shared
      library ships today; cloud sync + roles are the cloud layer.
- [ ] Realtime review threads (live comments + @mentions) — async notes ship
      today; live threads need the collab backend.
- [ ] Community template marketplace — your own template library ships today;
      community sharing needs a backend.
- [ ] Direct in-app upload to TikTok/YouTube — platform OAuth apps.

## Coming soon — UI / pipeline work, no new model needed

- [ ] Side-by-side diff view vs. a reference video — synced dual-player UI.
- [ ] Progressive skill levels (beginner → pro gating).
- [ ] Live camera overlay while filming — `getUserMedia` recording UI.
- [ ] AI dubbing (translated voiceover, re-timed) — translation + TTS exist;
      the re-timing/mux pipeline is the remaining piece.
- [ ] Ambience beds by scene type — scene classification + procedural bank.

## Roadmap — needs a generative/ML model beyond on-device WASM

- [ ] Sky replacement (segmentation model)
- [ ] AI relighting (relighting model)
- [ ] Freeform object removal / inpainting (corner delogo works today)
- [ ] Eye-contact correction (gaze-redirection model)
- [ ] Content-aware letterbox fill / true outpainting (blur-fill ships today)
- [ ] Animated focus pull / rack focus (static portrait DoF ships today)
- [ ] Motion-blur speed ramps (`minterpolate`) — too slow in single-threaded
      WASM; revisit with a multi-threaded core.

## Notes for whoever picks this up

- Pure-lib pattern: logic lives in `src/lib/*.ts` with no `"use client"`/DOM
  imports so it's unit-testable via `npx tsx scripts/features-test.mjs`
  (104 tests). New collab logic (`review.ts`, `library.ts`) follows this.
- Collaboration is local-first by design: notes ride inside the
  `.viraledit.json` project file (`edl.projectToFile`); the shared library
  lives in IndexedDB (`storage.ts`, DB v3) and exports as
  `.viraledit-library.json`. Keep the realtime layer optional so the offline
  APK/PWA never hard-depends on a server.
- Full regression: `npx tsx scripts/features-test.mjs && npx eslint src
  scripts --max-warnings=0 && npm run build`.
