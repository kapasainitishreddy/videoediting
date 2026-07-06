// Probe runner for /dev/subject — verifies the AI subject tools' filter
// strings (chromakey, chromaComplex color+blur, animated track crop, face
// punch zoompan) against the real bundled WASM core, including a pixel-level
// check that keying actually removes the green.
// Run: node scripts/subject-check.mjs [port]
import { chromium } from "playwright";

const PORT = process.argv[2] ?? "3997";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
page.on("console", (m) => {
  if (m.type() === "error") console.error("[page]", m.text().slice(0, 160));
});
page.on("pageerror", (e) => console.error("[pageerror]", String(e).slice(0, 200)));

await page.goto(`http://localhost:${PORT}/dev/subject`);
const results = await page
  .waitForFunction(() => window.subjectResults, null, { timeout: 300000 })
  .then((h) => h.jsonValue());
await browser.close();

console.log(JSON.stringify(results, null, 2));
const expected = ["chromakey", "chroma_color_bg", "chroma_blur_bg", "track_crop", "face_punch", "chroma_pixels"];
const missing = expected.filter((k) => !(k in results));
const bad = Object.entries(results).filter(([, v]) => v !== "ok");
if (missing.length || bad.length) {
  console.error("FAIL:", [...missing.map((k) => `${k}=missing`), ...bad.map(([k, v]) => `${k}=${v}`)].join(" "));
  process.exit(1);
}
console.log(`PASS ✅  all ${expected.length} subject-tool probes ok`);
