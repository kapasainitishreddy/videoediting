// End-to-end proof of the AI subject tools: synthesize a clip with a moving
// skin-tone "face" and a green-screen clip, push them through the real UI —
// Face lock, Green screen auto-key, Studio "Auto punch-in on faces" — then
// auto-edit + render and verify a playable H.264 MP4 comes out.
// Run: node scripts/track-e2e.mjs [port]
import { chromium } from "playwright";

const PORT = process.argv[2] ?? "3997";
const BASE = `http://localhost:${PORT}`;

// In-page canvas + MediaRecorder generator. kind:
//   "scenes" — {color,seconds,motion}[] hard-cut reel (same as e2e-test.mjs)
//   "face"   — dark background, skin-tone ellipse drifting left→right
//              (rgb(224,172,135) passes track-core's isSkin rules, so the
//              heuristic tier locks on even if MediaPipe rejects synthetic
//              footage — the product's own fallback ladder)
//   "green"  — solid #00ff00 backdrop, dark figure moving in the middle
//              (border ring stays pure green for detectKeyColor)
const MAKE_VIDEO = `async ({ kind, scenes, seconds }) => {
  const c = document.createElement("canvas");
  c.width = 360; c.height = 640;
  const ctx = c.getContext("2d");
  const stream = c.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8", videoBitsPerSecond: 1_500_000 });
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const stopped = new Promise((res) => (rec.onstop = res));
  rec.start(100);
  const t0 = performance.now();
  let total = seconds ?? 0;
  if (kind === "scenes") { total = 0; for (const s of scenes) total += s.seconds; }
  await new Promise((done) => {
    function frame() {
      const t = (performance.now() - t0) / 1000;
      if (t >= total) { done(); return; }
      if (kind === "scenes") {
        let acc = 0, scene = scenes[0], local = t;
        for (const s of scenes) {
          if (t < acc + s.seconds) { scene = s; local = t - acc; break; }
          acc += s.seconds;
        }
        ctx.fillStyle = scene.color;
        ctx.fillRect(0, 0, 360, 640);
        ctx.fillStyle = "#ffffff";
        const x = scene.motion === "fast" ? (local * 700) % 360 : (local * 120) % 360;
        ctx.fillRect(x, 200 + (local * 60) % 240, 60, 60);
      } else if (kind === "face") {
        ctx.fillStyle = "#12213a";
        ctx.fillRect(0, 0, 360, 640);
        // torso so the frame isn't just a floating head
        const fx = 120 + (t / total) * 120; // face drifts 120→240
        ctx.fillStyle = "#3a4a5a";
        ctx.fillRect(fx - 70, 330, 140, 310);
        ctx.fillStyle = "rgb(224,172,135)";
        ctx.beginPath();
        ctx.ellipse(fx, 250 + Math.sin(t * 3) * 8, 55, 70, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#1c1c1c"; // eyes — keeps the blob from being a perfect oval
        ctx.fillRect(fx - 28, 228, 16, 10);
        ctx.fillRect(fx + 12, 228, 16, 10);
      } else {
        ctx.fillStyle = "#00ff00";
        ctx.fillRect(0, 0, 360, 640);
        const gx = 130 + Math.sin(t * 2) * 40; // stays well inside the border
        ctx.fillStyle = "#333344";
        ctx.fillRect(gx, 220, 100, 260);
        ctx.beginPath();
        ctx.arc(gx + 50, 180, 45, 0, Math.PI * 2);
        ctx.fill();
      }
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

const fail = async (msg) => {
  console.error("FAIL:", msg);
  const err = await page.locator(".text-red-400, [role=alert]").allTextContents().catch(() => []);
  if (err.length) console.error("  page error text:", err.join(" | ").slice(0, 300));
  process.exitCode = 1;
  return browser.close();
};

// ---- 1. Home: minimal reel so we get a blueprint into the editor
console.log("1) uploading a small reel for the blueprint…");
await page.goto(`${BASE}/home`);
const gen = (arg) => page.evaluate(new Function("return " + MAKE_VIDEO)(), arg);
const reelBytes = await gen({
  kind: "scenes",
  scenes: [
    { color: "#e74c3c", seconds: 1.5, motion: "slow" },
    { color: "#2c3e50", seconds: 1.5, motion: "fast" },
    { color: "#f1c40f", seconds: 1.5, motion: "slow" },
  ],
});
await setFileOnInput(page, "input[type=file]", reelBytes, "ref-reel.webm", "video/webm");
await page.waitForURL("**/analyze**", { timeout: 20000 });
await page.waitForSelector("text=Edit blueprint", { timeout: 120000 });

// ---- 2. Editor with a face clip + a green-screen clip
console.log("2) adding face + green-screen clips…");
await page.click("text=Recreate with my clips");
await page.waitForURL("**/editor**");
const faceClip = await gen({ kind: "face", seconds: 3 });
const greenClip = await gen({ kind: "green", seconds: 3 });
console.log(`   face clip ${(faceClip.length / 1024).toFixed(0)}KB, green clip ${(greenClip.length / 1024).toFixed(0)}KB`);
await setFileOnInput(page, "input[type=file][multiple]", faceClip, "face-clip.webm", "video/webm");
await page.waitForSelector("img[alt='face-clip.webm']", { timeout: 30000 });
await setFileOnInput(page, "input[type=file][multiple]", greenClip, "green-clip.webm", "video/webm");
await page.waitForSelector("img[alt='green-clip.webm']", { timeout: 30000 });

// ---- 3. Face lock via the AI tools card
console.log("3) Face lock on the face clip…");
await page.click('[aria-label="AI tools for face-clip.webm"]');
await page.waitForSelector("text=AI tools — face-clip.webm", { timeout: 10000 });
await page.click('button:has-text("Face lock")');
// success = the chip flips to the active (accent) style; failure surfaces an error instead
const faceLocked = await page
  .waitForSelector('button.bg-accent:has-text("Face lock")', { timeout: 120000 })
  .then(() => true)
  .catch(() => false);
if (!faceLocked) {
  await fail("Face lock did not activate — tracker found no face in the synthetic clip");
} else {
  console.log("   face lock active ✓");

  // ---- 4. Green screen auto-key on the green clip
  console.log("4) Green screen on the green clip…");
  await page.click('[aria-label="AI tools for green-clip.webm"]');
  await page.waitForSelector("text=AI tools — green-clip.webm", { timeout: 10000 });
  await page.click('button:has-text("Green screen")');
  const keyed = await page
    .waitForSelector("text=/Keyed #[0-9a-f]{6}/", { timeout: 60000 })
    .then((h) => h.textContent())
    .catch(() => null);
  const keyHex = keyed?.match(/#([0-9a-f]{6})/)?.[1];
  if (!keyHex) {
    await fail("Green screen did not key — no backdrop detected on the synthetic green clip");
  } else {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(keyHex.slice(i, i + 2), 16));
    console.log(`   keyed #${keyHex} (r=${r} g=${g} b=${b})`);
    if (!(g > r && g > b && g > 120)) {
      await fail(`detected key #${keyHex} is not green`);
    } else {
      // swap the backdrop — exercises the persisted chroma.bg path
      await page.click('button:has-text("Deep blue")');
      await page.waitForSelector('button.bg-accent:has-text("Deep blue")', { timeout: 10000 });
      console.log("   backdrop → deep blue ✓");

      // ---- 5. Studio: enable the CapCut-style auto face punch-in
      console.log("5) enabling auto punch-in on faces…");
      await page.click("text=Camera Motion");
      await page.click("text=Auto punch-in on faces");
      await page.waitForSelector("text=Finds the face in each shot", { timeout: 10000 });

      // ---- 6. Auto-edit
      console.log("6) auto-editing…");
      await page.fill("textarea", "energetic and punchy");
      await page.click("text=Auto-edit my clips");
      await page.waitForSelector("text=Timeline", { timeout: 60000 });

      // ---- 7. Render (face-lock crop + chroma composite + punch zoompan all
      // hit the WASM core). Headless Chromium can't decode H.264, so validate
      // the MP4's byte structure instead of playback.
      console.log("7) rendering (FFmpeg WASM — track crop + chroma + punch-ins)…");
      await page.click("text=Render my edit");
      await page.waitForURL("**/export**", { timeout: 600000 });
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
          fs.writeFileSync("track-e2e-output.mp4", buf);
          console.log(`\nPASS ✅  face lock + green key (#${keyHex}) + auto punch-in rendered ${duration.toFixed(1)}s MP4 → track-e2e-output.mp4`);
          await browser.close();
        }
      }
    }
  }
}
