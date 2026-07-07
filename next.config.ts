import type { NextConfig } from "next";

// STATIC_EXPORT=1 (scripts/build-static.mjs) produces a fully static build
// in out/ for the BUNDLED Android APK — the whole app ships inside the APK
// with no server at all. API routes are moved aside by that script (static
// export can't include them); every /api-dependent feature already reports
// "unavailable" gracefully because the app is local-first by design. The
// COOP/COEP headers aren't expressible in an export, and aren't needed:
// @ffmpeg/core is the single-threaded build, which never touches
// SharedArrayBuffer.
const staticExport = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = staticExport
  ? {
      output: "export",
      images: { unoptimized: true },
    }
  : {
      // Standalone output for the Docker image (Dockerfile copies
      // .next/standalone) — produces a minimal self-contained server bundle
      // instead of requiring the full node_modules tree at runtime.
      output: "standalone",
      async headers() {
        return [
          {
            source: "/(.*)",
            headers: [
              { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
              { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
            ],
          },
        ];
      },
    };

export default nextConfig;
