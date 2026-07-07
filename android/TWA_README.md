# ViralEdit AI — Android app (Trusted Web Activity)

This is a **thin native wrapper**, not a rewrite. It launches the real web
app (the same Next.js + FFmpeg WASM app you use in a desktop browser) inside
a full-screen Chrome Custom Tab with no URL bar — that's a Trusted Web
Activity (TWA), the same technique behind most "PWA on the Play Store" apps.
Nothing about the editor's logic is duplicated here.

## Getting the APK

Push to `claude/ai-video-editing-app-vrohjm` (or run it manually): GitHub
Actions → **Build Android APK** → open the finished run → download the
`viraledit-debug-apk` artifact from the **Artifacts** section. Unzip it,
transfer `app-debug.apk` to an Android phone, and install it (you'll need to
allow "install unknown apps" for whatever app you used to transfer it —
Android's standard sideloading prompt).

This build environment has no Android SDK and its network policy blocks
`dl.google.com`, so the APK cannot be built locally in this session —
GitHub's hosted runners have the SDK preinstalled and full internet access,
which is why the build happens there instead.

## What it points at

`app/src/main/res/values/strings.xml` has two lines:

```xml
<string name="twa_url">https://viraledit-ai.netlify.app/home</string>
<string name="twa_host">viraledit-ai.netlify.app</string>
```

Change both if you deploy the web app somewhere else, then re-run the
workflow. The `.github/workflows/deploy-netlify.yml` workflow deploys the
web app to that same Netlify project automatically once you add two repo
secrets (see that workflow's header comment) — `NETLIFY_AUTH_TOKEN` and
`NETLIFY_SITE_ID`.

## Digital Asset Links (removing the URL bar)

Chrome only hides the address bar once it can verify THIS APK is authorized
by the domain it's opening. That's `public/.well-known/assetlinks.json` in
the web app repo — it's already filled in with the fingerprint of the debug
keystore committed at `android/debug.keystore`, so once the site is deployed
at the URL above, the two should match automatically. If Chrome still shows
a URL bar: confirm `https://<your-domain>/.well-known/assetlinks.json` is
reachable and returns that exact JSON — some static hosts strip
dot-prefixed paths, in which case add an explicit rewrite/redirect for it.

Until asset links verify, the app still opens and works fully — it just
shows a thin browser toolbar at the top instead of looking fully native.

## debug.keystore — do not treat this like a real signing key

`android/debug.keystore` is committed on purpose (password `android`, alias
`androiddebugkey`) so its fingerprint — and therefore the asset-links
match — stays identical across every CI run. This is completely normal for
Android **debug** builds and is what most Android tooling defaults to
anyway (a machine-random `~/.android/debug.keystore`); the only difference
here is it's fixed so CI can rebuild deterministically.

**This is not a Play Store key.** Google Play requires app-signing keys you
generate yourself and keep secret, and rejects submissions signed with a
debug key. If you want a Play Store release: generate a real keystore
(`keytool -genkeypair -v -keystore release.keystore ...`), keep it OUT of
git, add its passwords as GitHub secrets, add a `release` signing config
that reads from those secrets, and build `assembleRelease` / `bundleRelease`
(for an `.aab`) instead of `assembleDebug`.

## Known trade-offs of the TWA approach

- **Not on the Play Store yet** — this produces a sideloadable APK. Play
  Store listing is a separate, mostly non-technical step (developer account,
  store listing, content rating) once you have a release-signed `.aab`.
- **Needs the site live** — this shell has no offline app logic of its own;
  if `viraledit-ai.netlify.app` is down, the app can't open (though the web
  app's own service worker still caches the FFmpeg engine for offline
  editing once a session has loaded it once).
- **`/api/download` (paste-a-link import) doesn't work on Netlify** — that
  route shells out to the `yt-dlp` binary, which serverless functions can't
  run (see the repo's `Dockerfile` comment). Uploading your own clips works
  everywhere.
