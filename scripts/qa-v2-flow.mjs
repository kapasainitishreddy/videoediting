// v2 feature-drop live QA: preset chips → studio patch, Overlays+ burn-ins in
// a real render, director's notes report, export post-kit + palette.
import { chromium } from "playwright";

const BASE = "http://localhost:4003";
const OUT = "/tmp/claude-0/-home-user-videoediting/784d39ef-7160-585b-ba90-b17779e7b3c0/scratchpad/shots";

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
      ctx.fillStyle = "#ffffff";
      ctx.fillRect((local * 300) % 360, 200 + (local * 60) % 240, 60, 60);
      requestAnimationFrame(frame);
    }
    frame();
  });
  rec.stop();
  await stopped;
  const blob = new Blob(chunks, { type: "video/webm" });
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}`;

async function setFileOnInput(page, selector, bytes, name, mime) {
  await page.evaluate(({ selector, bytes, name, mime }) => {
    const input = document.querySelector(selector);
    const file = new File([new Uint8Array(bytes)], name, { type: mime });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, { selector, bytes, name, mime });
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error") errors.push("[console] " + m.text().slice(0, 200)); });
let failed = false;
const fail = (m) => { console.error("FAIL:", m); failed = true; };

await page.goto(`${BASE}/home`, { waitUntil: "networkidle" });
await page.click("text=Skip analysis");
await page.waitForURL("**/editor**");

// upload 2 clips
const b1 = await page.evaluate(new Function("return " + MAKE_VIDEO)(), [{ color: "#7a2020", seconds: 2.5 }]);
const b2 = await page.evaluate(new Function("return " + MAKE_VIDEO)(), [{ color: "#204a7a", seconds: 2.5 }]);
await setFileOnInput(page, "input[type=file][multiple]", b1, "clip1.webm", "video/webm");
await page.waitForSelector("img[alt='clip1.webm']", { timeout: 30000 });
await setFileOnInput(page, "input[type=file][multiple]", b2, "clip2.webm", "video/webm");
await page.waitForSelector("img[alt='clip2.webm']", { timeout: 30000 });
console.log("clips: 2 uploaded");

// 1. Gaming preset chip → direction filled + studio patched (glitch/dark/sfx)
await page.click("text=🎮 Gaming");
const directionVal = await page.locator("textarea").first().inputValue();
console.log("preset direction:", directionVal.slice(0, 60));
if (!/glitch/.test(directionVal)) fail("gaming preset did not fill the direction");
const studioAfterPreset = await page.evaluate(() => {
  const raw = sessionStorage.getItem("viraledit-session");
  return raw ? JSON.parse(raw).state.studio : null;
});
console.log("studio after preset: grade=", studioAfterPreset?.look?.grade, "sfx=", studioAfterPreset?.autoSfx, "mood=", studioAfterPreset?.scoreMood);
if (studioAfterPreset?.autoSfx !== true) fail("preset did not enable SFX");

// 2. Auto-edit
await page.click("text=Auto-edit my clips");
await page.waitForSelector("text=Timeline", { timeout: 30000 });
console.log("timeline: visible");

// 3. Insights v2 blocks present
for (const label of ["Retention risk map", "Try a different hook", "Loopability", "Cut to length"]) {
  const n = await page.locator(`text=${label}`).count();
  console.log(`insights "${label}":`, n > 0 ? "present" : "MISSING");
  if (n === 0) fail(`insights block missing: ${label}`);
}

// 4. Overlays+: location card + progress bar + countdown
await page.fill('input[placeholder*="Location card"]', "Test Beach, QA Island");
await page.click("text=3·2·1 intro");
await page.click("text=Progress bar");
await page.screenshot({ path: `${OUT}/15-editor-v2.png`, fullPage: true });

// 5. Render
await page.click("text=Render my edit");
await page.waitForURL("**/export", { timeout: 240000 });
await page.waitForTimeout(1200);
console.log("render: reached export");

// 6. Export post-kit present
for (const label of ["More formats from this render", "Post kit", "Copy caption + tags", "Copy chapters"]) {
  const n = await page.locator(`text=${label}`).count();
  console.log(`export "${label}":`, n > 0 ? "present" : "MISSING");
  if (n === 0) fail(`export block missing: ${label}`);
}
await page.screenshot({ path: `${OUT}/16-export-v2.png`, fullPage: true });

// 7. Validate the output bytes (headless Chromium has no H.264 decoder, so a
// canvas frame-grab is impossible here — same constraint the main e2e works
// around; the PNG-overlay burn path is pixel-proven in /dev/fulltest).
const bytes = await page.evaluate(async () => {
  const v = document.querySelector("video");
  if (!v?.src) return null;
  const blob = await fetch(v.src).then((r) => r.blob());
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
});
if (!bytes || bytes.length < 20000) {
  fail(`rendered blob too small: ${bytes?.length ?? 0}`);
} else {
  const buf = Buffer.from(bytes);
  const isMp4 = buf.subarray(4, 8).toString("latin1") === "ftyp";
  const hasMoov = buf.includes(Buffer.from("moov"));
  const hasAvc1 = buf.includes(Buffer.from("avc1"));
  const hasAudio = buf.includes(Buffer.from("mp4a")); // room-tone/SFX made it in
  console.log(`render bytes: mp4=${isMp4} moov=${hasMoov} h264=${hasAvc1} audio=${hasAudio} size=${(buf.length / 1024).toFixed(0)}KB`);
  if (!isMp4 || !hasMoov || !hasAvc1) fail("output failed MP4 structure checks");
  if (!hasAudio) fail("output has no audio track (SFX/ambience missing)");
}

console.log("\nerrors during flow:", errors.length ? errors : "(none)");
await browser.close();
console.log(failed ? "\nV2 FLOW FAILED ❌" : "\nV2 FLOW PASSED ✅");
process.exit(failed ? 1 : 0);
