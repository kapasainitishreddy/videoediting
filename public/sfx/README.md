# Transition sound effects

These files are the app's built-in transition SFX library — whooshes,
impacts, glitches and risers placed automatically on cuts when **Auto SFX** is
on (or when a prompt asks for sound effects).

Most (`whoosh.wav`, `impact.wav`, `glitch.wav`, `riser.wav`) are generated, not
third-party recordings, so there's no licensing to worry about — regenerate
them any time with:

```
node scripts/generate-sfx.js
```

The generator is deterministic (seeded), so re-running produces byte-identical
files and won't create noisy diffs.

## Real recordings (impact-kenney.ogg, glitch-kenney.ogg)

`impact-kenney.ogg` (from Kenney's "Impact Sounds" pack) and
`glitch-kenney.ogg` (from Kenney's "Sci-fi Sounds" pack) are real CC0
recordings by [Kenney](https://kenney.nl) — public domain, attribution
appreciated but not required. `src/lib/sfx-web.ts` tries these before the
synthesized `.wav` for their type, so a missing/corrupt file just falls back,
same as the remote/synth path already did. Do NOT run `generate-sfx.js` over
these two — it only touches the four `.wav` files.

## Using a richer / external library

The loader (`src/lib/sfx-web.ts`) tries sources in order and always falls back
to on-the-fly Web-Audio synthesis, so nothing here is load-bearing. To pull
higher-fidelity effects from a CDN, add URLs to `SFX_REMOTE` in that file:

```ts
export const SFX_REMOTE: Partial<Record<SfxType, string[]>> = {
  whoosh: ["https://your-cdn.example/whoosh.mp3"],
  impact: ["https://your-cdn.example/impact.mp3"],
};
```

Remote URLs are tried first, then these bundled files, then synthesis. Use a
host that sends permissive CORS headers (`Access-Control-Allow-Origin`) or the
browser will block the fetch and the loader will fall back.
