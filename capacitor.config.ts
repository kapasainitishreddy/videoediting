import type { CapacitorConfig } from "@capacitor/cli";

// Bundled Android app: the ENTIRE web app (static export in out/, including
// the FFmpeg + MediaPipe WASM engines) ships inside the APK and is served
// from the app's own assets — no server, no hosting, works offline. The
// only things missing vs. the hosted version are the optional /api cloud
// features (they degrade to clear "unavailable" messages by design).
const config: CapacitorConfig = {
  appId: "app.viraledit.android",
  appName: "ViralEdit AI",
  webDir: "out",
  android: {
    backgroundColor: "#0d0d0d",
  },
};

export default config;
