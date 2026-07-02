// End-to-end proof: synthesize a viral-style reel with known hard cuts,
// push it through the real UI (analyze → auto-edit → render → export),
// and verify a playable MP4 comes out. Run: node e2e-test.mjs [port]
import { chromium } from "playwright";

const PORT = process.argv[2] ?? "3997";
const BASE = `http://localhost:${PORT}`;

// Generates a video in-page: canvas + MediaRecorder. scenes = array of
// {color, seconds, motion} — each scene change is a hard cut the analyzer
// should detect.
const MAKE_VIDEO = `async (scenes) => {
  const c = document.createElement("canvas");
  c.width = 360; c.height = 640;
  const ctx = c.getContext("2d");
  const stream = c.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8", videoBitsPerSecond: 1_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const stopped = new Promise((res) => (rec.onstop = res));
  rec.start(100);
  const t0 = performance.now();
  let total = 0;
  for (const s of scenes) total += s.seconds;
  await new Promise((done) => {
    function frame() {
      const t = (performance.now() - t0) / 1000;
      if (t >= total) { done(); return; }
      let acc = 0, scene = scenes[0], local = t;
      for (const s of scenes) {
        if (t < acc + s.seconds) { scene = s; local = t - acc; break; }
        acc += s.seconds;
      }
      ctx.fillStyle = scene.color;
      ctx.fillRect(0, 0, 360, 640);
      // moving box so every frame differs a bit (like real footage)
      ctx.fillStyle = "#ffffff";
      const x = scene.motion === "fast" ? (local * 700) % 360 : (local * 120) % 360;
      ctx.fillRect(x, 200 + (local * 60) % 240, 60, 60);
      requestAnimationFrame(frame);
    }
    frame();
  });
  rec.stop();
  await stopped;
  const blob = new Blob(chunks, { type: "video/webm" });
  const buf = await blob.arrayBuffer();
  return Array.from(new Uint8Array(buf));
}`;

async function setFileOnInput(page, selector, bytes, name, mime) {
  await page.evaluate(
    ({ selector, bytes, name, mime }) => {
      const input = document.querySelector(selector);
      const file = new File([new Uint8Array(bytes)], name, { type: mime });
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { selector, bytes, name, mime }
  );
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("[pageerror]", String(e).slice(0, 200)));

const fail = (msg) => {
  console.error("FAIL:", msg);
  process.exitCode = 1;
  return browser.close();
};

// ---- 1. Home: upload a synthetic "viral reel" (7 scenes = 6 hard cuts)
console.log("1) uploading synthetic reel…");
await page.goto(`${BASE}/home`);
const reelScenes = [
  { color: "#e74c3c", seconds: 1.0, motion: "slow" },
  { color: "#2c3e50", seconds: 0.8, motion: "fast" },
  { color: "#f1c40f", seconds: 0.9, motion: "slow" },
  { color: "#8e44ad", seconds: 0.8, motion: "fast" },
  { color: "#16a085", seconds: 1.0, motion: "slow" },
  { color: "#ecf0f1", seconds: 0.7, motion: "fast" },
  { color: "#d35400", seconds: 1.0, motion: "slow" },
];
const reelBytes = await page.evaluate(new Function("return " + MAKE_VIDEO)(), reelScenes);
console.log(`   reel: ${(reelBytes.length / 1024).toFixed(0)} KB webm`);
await setFileOnInput(page, 'input[type=file]', reelBytes, "viral-test.webm", "video/webm");

// ---- 2. Analyze
console.log("2) waiting for analysis…");
await page.waitForURL("**/analyze**", { timeout: 20000 });
await page.waitForSelector("text=Edit blueprint", { timeout: 120000 });
const cutCount = await page.locator("text=/\\d+ transitions/").first().textContent();
console.log(`   blueprint: ${cutCount?.trim()}`);
const nCuts = parseInt(cutCount?.match(/(\d+) transitions/)?.[1] ?? "0");
if (nCuts < 3) await fail(`expected >=3 detected transitions, got ${nCuts}`);

// ---- 3. Editor: add two user clips
console.log("3) adding user clips…");
await page.click("text=Recreate with my clips");
await page.waitForURL("**/editor**");
const clipA = await page.evaluate(new Function("return " + MAKE_VIDEO)(), [
  { color: "#3498db", seconds: 3.0, motion: "fast" },
]);
const clipB = await page.evaluate(new Function("return " + MAKE_VIDEO)(), [
  { color: "#e67e22", seconds: 3.0, motion: "slow" },
]);
await setFileOnInput(page, 'input[type=file][multiple]', clipA, "clip-a.webm", "video/webm");
await page.waitForSelector("img[alt='clip-a.webm']", { timeout: 30000 });
await setFileOnInput(page, 'input[type=file][multiple]', clipB, "clip-b.webm", "video/webm");
await page.waitForSelector("img[alt='clip-b.webm']", { timeout: 30000 });
console.log("   2 clips added with thumbnails");

// ---- 4. AI direction + auto-edit
console.log("4) auto-editing…");
await page.fill("textarea", "make it smooth and cinematic");
await page.click("text=Auto-edit my clips");
await page.waitForSelector("text=Timeline", { timeout: 30000 });
const explanation = await page.locator("p.text-xs.leading-5").first().textContent();
console.log(`   plan: ${explanation?.slice(0, 140)}`);

// ---- 5. Render. NOTE: headless Chromium has no H.264 decoder, so we
// validate the produced MP4's bytes/structure rather than <video> playback.
console.log("5) rendering (FFmpeg WASM)…");
await page.click("text=Render my edit");
await page.waitForURL("**/export**", { timeout: 300000 });
const bytes = await page.evaluate(async () => {
  const v = document.querySelector("video");
  if (!v?.src) return null;
  const blob = await fetch(v.src).then((r) => r.blob());
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
});
if (!bytes || bytes.length < 20000) {
  await fail(`rendered blob too small: ${bytes?.length ?? 0} bytes`);
} else {
  const buf = Buffer.from(bytes);
  const isMp4 = buf.subarray(4, 8).toString("latin1") === "ftyp";
  const hasMoov = buf.includes(Buffer.from("moov"));
  const hasAvc1 = buf.includes(Buffer.from("avc1"));
  // mvhd duration: find box, read timescale+duration (version 0 layout)
  let duration = 0;
  const mvhd = buf.indexOf(Buffer.from("mvhd"));
  if (mvhd > 0) {
    const ts = buf.readUInt32BE(mvhd + 16);
    duration = buf.readUInt32BE(mvhd + 20) / ts;
  }
  console.log(`   mp4=${isMp4} moov=${hasMoov} h264=${hasAvc1} duration=${duration.toFixed(2)}s size=${(buf.length / 1024).toFixed(0)}KB`);
  if (!isMp4 || !hasMoov || !hasAvc1 || duration < 2) {
    await fail("rendered file failed MP4 structure checks");
  } else {
    const fs = await import("fs");
    fs.writeFileSync("e2e-output.mp4", buf);
    console.log(`\nPASS ✅  ${duration.toFixed(1)}s H.264 MP4 rendered from ${nCuts}-cut blueprint → e2e-output.mp4`);
    await browser.close();
  }
}
