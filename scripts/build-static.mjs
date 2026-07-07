// Static build for the BUNDLED Android APK (and any static host).
// Run: node scripts/build-static.mjs   →   out/
//
// Next.js static export can't include API route handlers, so this script
// moves src/app/api aside for the duration of the build and always restores
// it (even on failure). The app is local-first: every /api call already
// degrades to a clear "needs a server / needs a key" message, so the
// exported app loses only the optional cloud features (AI direction
// refinement, Whisper, TTS, stock search, reel download) — all editing,
// rendering, tracking, and marketing tools work fully offline.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(root, "src", "app", "api");
const apiAside = path.join(root, ".api-excluded-from-static-export");

if (fs.existsSync(apiAside)) {
  // a previous run died mid-build — restore before doing anything else
  if (fs.existsSync(apiDir)) fs.rmSync(apiAside, { recursive: true });
  else fs.renameSync(apiAside, apiDir);
}

fs.renameSync(apiDir, apiAside);
try {
  execSync("npx next build", {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, STATIC_EXPORT: "1" },
  });
} finally {
  fs.renameSync(apiAside, apiDir);
}

const out = path.join(root, "out");
if (!fs.existsSync(path.join(out, "index.html"))) {
  console.error("static export missing out/index.html");
  process.exit(1);
}
console.log(`\nStatic export OK → ${out}`);
