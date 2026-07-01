// Copies the FFmpeg WASM core into public/ so it is served same-origin
// (required for SharedArrayBuffer under COOP/COEP headers).
const fs = require("fs");
const path = require("path");
const src = path.join(__dirname, "..", "node_modules", "@ffmpeg", "core", "dist", "esm");
const dest = path.join(__dirname, "..", "public", "ffmpeg");
fs.mkdirSync(dest, { recursive: true });
for (const f of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
  fs.copyFileSync(path.join(src, f), path.join(dest, f));
}
console.log("ffmpeg core copied to public/ffmpeg");
