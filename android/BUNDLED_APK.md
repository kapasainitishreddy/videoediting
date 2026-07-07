# ViralEdit AI — self-contained Android app (Capacitor)

This Android project bundles the ENTIRE web app inside the APK: the static
export of the Next.js app plus the FFmpeg WASM core (~31MB) and the
MediaPipe vision runtime (~33MB) are packaged as app assets and served
locally by Capacitor's WebView. **No server. No hosting. No internet
needed** for editing, rendering, face tracking, green screen, captions,
score, or the marketing tools — everything runs on the phone, same as the
web version runs in a browser.

(This replaced the earlier Trusted-Web-Activity wrapper that pointed at a
hosted URL — see git history at commit 32da289 if you ever want that
variant back.)

## Getting the APK

GitHub Actions → **Build Android APK** → open the latest green run →
download the `viraledit-apk` artifact. Unzip → `app-debug.apk` → copy to
the phone → tap to install (allow "install unknown apps" when prompted —
standard for sideloading). Expect ~70MB: the video engine ships inside.

The workflow rebuilds automatically on every push that touches the app,
and can be run manually from the Actions tab (workflow_dispatch).

## How the pieces fit

- `scripts/build-static.mjs` — builds the web app with `STATIC_EXPORT=1`
  (Next.js `output: "export"` → `out/`), temporarily setting aside
  `src/app/api` (route handlers can't be statically exported).
- `capacitor.config.ts` — `webDir: "out"`; `npx cap sync android` copies
  the export into `android/app/src/main/assets/public` (gitignored — CI
  regenerates it every build).
- `android/debug.keystore` — committed on purpose (password `android`,
  the standard debug convention) so every CI build signs identically;
  Android refuses to update an installed app when signatures differ.
  Debug keys are never valid for the Play Store — a release needs its own
  secret keystore and an `assembleRelease`/`bundleRelease` lane.

## What's intentionally NOT in the bundle

The optional cloud features live in `/api` routes, which a static bundle
cannot contain. In the APK they show their built-in "unavailable" message
instead of working:

- AI direction refinement / niche vision / caption translation (LLM keys)
- Whisper transcription (edit-by-text, auto-captions)
- MiniMax B-roll generation and TTS voiceover
- CC stock-music search (Openverse proxy)
- Paste-a-link reel download (yt-dlp — needs the Docker deployment anyway)

Everything else — which is 136 of the app's working features — is fully
functional offline. If you later host the app (the Dockerfile or Netlify
workflow), those cloud features light up in the web version; the APK stays
offline-first by design.

## Updating the app

Push changes → CI builds a new APK → install it over the old one (same
debug signature, so it updates in place; user data lives in the WebView's
IndexedDB and survives updates, but NOT uninstalls).
