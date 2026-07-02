// Copies the FFmpeg WASM core into public/ so it is served same-origin
// (required for SharedArrayBuffer under COOP/COEP headers).
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const dest = path.join(root, "public", "ffmpeg");
fs.mkdirSync(dest, { recursive: true });

// the WASM core
const coreSrc = path.join(root, "node_modules", "@ffmpeg", "core", "dist", "esm");
for (const f of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
  fs.copyFileSync(path.join(coreSrc, f), path.join(dest, f));
}

// the @ffmpeg/ffmpeg ESM library, served unbundled so its worker's dynamic
// import() is not rewritten by the bundler (which breaks loading)
const libSrc = path.join(root, "node_modules", "@ffmpeg", "ffmpeg", "dist", "esm");
const libDest = path.join(dest, "lib");
fs.mkdirSync(libDest, { recursive: true });
for (const f of fs.readdirSync(libSrc).filter((f) => f.endsWith(".js"))) {
  fs.copyFileSync(path.join(libSrc, f), path.join(libDest, f));
}
console.log("ffmpeg core + lib copied to public/ffmpeg");
