import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
