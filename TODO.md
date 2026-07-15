# TODO

Source of truth is `src/lib/features-manifest.ts`. Current status counts:
**157 working · 15 key (add an API key) · 7 coming-soon · 1 roadmap** (180 total).
That's **95.6% working today or with a key**. The core pipeline
(analyze → auto-edit → render → export), AND the manual timeline (add clip →
reorder/trim/split/delete by hand → render, no AI step required), are both
verified end-to-end by `npm run test:e2e` (each produces a real H.264 MP4).

What's left genuinely needs infrastructure or a model the on-device stack
can't provide — nothing here is merely "unbuilt".

## Coming soon — needs a realtime backend / accounts

- [ ] Live shared cursors (Figma-style co-editing) — realtime sync backend.
- [ ] Team workspace with roles + cloud-synced library — accounts + storage;
      the on-device shared library ships today.
- [ ] Realtime review threads (live comments + @mentions) — async review
      notes ship today; live threads need the collab backend.
- [ ] Community template marketplace — your own template library ships today;
      community sharing needs a backend.
- [ ] Server-side credit enforcement — real enforcement needs accounts; paid
      credits are still checked client-side (the one real security gap).

## Coming soon — pipeline work, no new model needed

- [ ] Side-by-side diff vs. reference — synced dual-player UI (deferred to
      avoid shipping a flaky reference-retrieval path).
- [ ] AI dubbing (translated voiceover, re-timed) — translation + TTS ship
      today; the re-timing/mux pipeline is the remaining piece.

## Roadmap — needs a model beyond on-device WASM

- [ ] Animated rack-focus pull — static portrait DoF ships today; an animated
      pull needs a depth model over time.

## Key-gated cloud (works when the operator adds a key)

`/api/image-edit` (defaults to fal.ai, override with `AI_IMAGE_ENDPOINT`) powers
AI Frame Studio: sky replacement, relighting, object removal, eye-contact,
outpainting — applied to a still frame (cover / title bg / B-roll plate).
Set `FAL_KEY` (or `AI_IMAGE_KEY`) in `.env.local`. Video/voice AI (B-roll,
voiceover, transcription) use `MINIMAX_API_KEY` / `OPENAI_API_KEY`. Checkout
uses `STRIPE_SECRET_KEY`. Without a key each feature reports "needs a key" —
never a broken button.

## Shipped this round (on-device, no key)

- Manual timeline (Editor → Edit tab) — add a clip to the cut with a tap,
  drag to reorder (framer-motion `Reorder`), drag either edge to trim,
  split at the scrubbed playhead, delete a shot, and set per-segment
  speed/transition/look — all writing the same `EditPlan.segments` the AI
  auto-edit pass produces, so the two are freely interchangeable: auto-edit
  then hand-tweak, or build the whole cut by hand and skip AI entirely. A
  segment-accurate `PreviewPlayer` (trims/order only — filters/transitions
  still need a render) sits above it. `src/lib/timeline-edit.ts`.
- CapCut-style tab bar (Edit / Text / Effects / AI / More) replacing the old
  single long AI-gated scroll — every panel (Studio, captions, overlays+,
  Pro Tools) is reachable with or without a plan.
- Contextual "what should I do next" tips (AI tab) — reads clip/trim/music/
  caption/grade state and suggests 2-4 concrete next actions with a one-tap
  button; deterministic, no network call. `src/lib/assistant-tips.ts`.
- Motion-blur speed ramps (Studio → Camera Motion) — tblend on re-timed shots.
- Ambience beds by scene type (Studio → Score & Sound) — rain / forest / room
  / city / ocean / cinematic drone, synthesized on-device.
- Live camera overlay (`/film`) — getUserMedia + rule-of-thirds + safe-zone
  guides; records straight onto the timeline.
- Progressive skill levels (Editor → More tab) — Beginner keeps it simple;
  Pro reveals the Pro Tools drawer. No longer gates manual editing itself.
- Post to TikTok/YouTube/IG via the native share sheet (Export → Share).

## Notes for whoever picks this up

- Pure-lib pattern: logic in `src/lib/*.ts` with no `"use client"`/DOM imports
  so it's unit-testable via `npx tsx scripts/features-test.mjs` (120 tests).
- Keep any realtime/cloud layer OPTIONAL and key/config-gated so the offline
  APK/PWA never hard-depends on a server.
- Full regression: `npx tsx scripts/features-test.mjs && npx eslint src
  scripts --max-warnings=0 && npm run build && npm run test:e2e`.
