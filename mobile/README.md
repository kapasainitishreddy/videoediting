# ViralEdit AI — Mobile (Capacitor)

Native Android shell for the ViralEdit AI Next.js app. The WebView loads the
app from `server.url` in `capacitor.config.json`; the bundled `www/` page is
only an offline fallback.

The app needs the Next.js server because it uses API routes (`/api/ai`,
`/api/download`, `/api/generate`, `/api/transcribe`) and the COOP/COEP headers
required for FFmpeg WebAssembly (`SharedArrayBuffer`) — both are served by
Next, so a static export is not possible.

## Development (Android emulator)

The committed config points at `http://10.0.2.2:3000` — the Android emulator's
alias for your machine's localhost.

```bash
# from the repo root: start the web app
npm run dev

# in another terminal
cd mobile
npm install
npx cap sync android
npx cap open android   # then Run ▶ in Android Studio
```

For a physical device on the same Wi-Fi, replace `10.0.2.2` with your
machine's LAN IP.

## Production

Point `server.url` at your deployed HTTPS instance and drop `cleartext`:

```json
"server": { "url": "https://your-deployment.example.com" }
```

Then build:

```bash
npm run android:release   # AAB for Play Store
npm run android:debug     # debug APK
```
