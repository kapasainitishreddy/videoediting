import type { MetadataRoute } from "next";

// Required for the static export (bundled Android APK build) — the manifest
// is a metadata route, and `output: "export"` only includes routes that
// declare themselves static. No effect on the normal server build.
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ViralEdit AI",
    short_name: "ViralEdit",
    description: "Reverse-engineer any viral edit. AI extracts transitions, beat sync, and style — then edits your clips to match.",
    start_url: "/",
    display: "standalone",
    background_color: "#0d0d0d",
    theme_color: "#0d0d0d",
    orientation: "portrait",
    categories: ["photo", "video", "entertainment"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
