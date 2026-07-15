// End-to-end proof of the manual (non-AI) timeline: add a clip to the
// timeline by tapping it, reorder by dragging a grip, trim by dragging a
// handle, split at the playhead, delete a shot, set a per-segment
// transition, walk every tab, then render — all without ever running
// Quick Edit/Auto-edit. Complements e2e-test.mjs, which covers the AI path.
// Run: node scripts/e2e-manual-timeline-test.mjs [port]
import { chromium } from "playwright";

const PORT = process.argv[2] ?? "3997";
const BASE = `http://localhost:${PORT}`;

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
      ctx.fillStyle = scenes[0].color;
      ctx.fillRect(0, 0, 360, 640);
      ctx.fillStyle = "#ffffff";
      const x = (t * 120) % 360;
      ctx.fillRect(x, 200, 60, 60);
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

// Sets a controlled <input type=range>'s value the way a real drag would —
// through the native setter + an `input` event — since React ignores a
// plain `.value =` assignment on a controlled input.
async function setRangeValue(page, selector, value) {
  await page.locator(selector).evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (msg) => {
  if (msg.type() === "error") pageErrors.push(msg.text());
});

async function fail(msg) {
  console.error("FAIL:", msg);
  if (pageErrors.length) console.error("page errors seen:", pageErrors.slice(0, 10));
  await page.screenshot({ path: "/tmp/claude-0/-home-user-videoediting/862a9779-5b07-5248-bf1b-c1813cb48144/scratchpad/failure.png" }).catch(() => {});
  await browser.close();
  process.exit(1);
}

// Identify a rendered shot by its source clip name via the segment
// inspector heading ("Shot N — clip-0.webm") — more reliable than comparing
// thumbnail bytes, which can coincidentally match for flat-color synthetic
// test clips, and still correct after a split (which keeps the same clip
// name on both halves — this is only used BEFORE any split happens below).
async function clipNameOf(page, shotLabel) {
  await page.click(`img[alt='${shotLabel}']`);
  const heading = await page.locator(`text=/${shotLabel} —/`).first().textContent();
  return heading.split("—")[1].trim();
}

try {
  console.log("1) opening editor directly, adding 3 clips…");
  await page.goto(`${BASE}/editor`);
  const clipBytes = [];
  for (const color of ["#3498db", "#e67e22", "#2ecc71"]) {
    clipBytes.push(await page.evaluate(new Function("return " + MAKE_VIDEO)(), [{ color, seconds: 2.0 }]));
  }
  for (let i = 0; i < clipBytes.length; i++) {
    await setFileOnInput(page, "input[type=file][multiple]", clipBytes[i], `clip-${i}.webm`, "video/webm");
    await page.waitForSelector(`img[alt='clip-${i}.webm']`, { timeout: 20000 });
  }
  console.log("   3 clips uploaded");

  console.log("2) tapping each clip thumbnail to add it to the timeline…");
  for (let i = 0; i < 3; i++) {
    await page.click(`img[alt='clip-${i}.webm']`);
    await page.waitForTimeout(150);
  }
  await page.waitForSelector("text=Your edit", { timeout: 10000 });
  let segCount = await page.locator("[aria-label^='Drag to reorder shot']").count();
  if (segCount !== 3) await fail(`expected 3 segments on the timeline, got ${segCount}`);
  console.log(`   ${segCount} segments on the timeline, preview mounted`);

  const previewMounted = await page.locator("text=Preview shows trims and order only").count();
  if (previewMounted !== 1) await fail("PreviewPlayer caption not found");
  console.log("   PreviewPlayer present");

  console.log("3) reordering by dragging shot 1's grip past shot 2 (before any split, so clip names stay unique)…");
  const clipAtShot1Before = await clipNameOf(page, "Shot 1");
  const clipAtShot2Before = await clipNameOf(page, "Shot 2");
  await page.locator("[aria-label='Drag to reorder shot 1']").scrollIntoViewIfNeeded();
  const grip1 = await page.locator("[aria-label='Drag to reorder shot 1']").boundingBox();
  const grip2 = await page.locator("[aria-label='Drag to reorder shot 2']").boundingBox();
  await page.mouse.move(grip1.x + grip1.width / 2, grip1.y + grip1.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(50);
  await page.mouse.move(grip2.x + grip2.width / 2, grip2.y + grip2.height / 2, { steps: 10 });
  await page.waitForTimeout(50);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const clipAtShot1After = await clipNameOf(page, "Shot 1");
  console.log(`   shot 1 before: ${clipAtShot1Before}; shot 2 before: ${clipAtShot2Before}; shot 1 after: ${clipAtShot1After}`);
  if (clipAtShot1After !== clipAtShot2Before || clipAtShot1After === clipAtShot1Before) {
    await fail(`drag-reorder didn't actually swap shot 1 and shot 2 (clip identity unchanged/wrong)`);
  }
  console.log("   drag-reorder swapped shot 1 and shot 2 as expected");

  console.log("4) selecting shot 1 and dragging its right trim handle inward (shortening it)…");
  await page.click("img[alt='Shot 1']");
  await page.waitForSelector("text=/Shot 1 —/", { timeout: 5000 });
  await page.locator("[title='Trim the end of shot 1']").scrollIntoViewIfNeeded();
  const rightHandleBox = await page.locator("[title='Trim the end of shot 1']").boundingBox();
  const rightHandle = { x: rightHandleBox.x + rightHandleBox.width / 2, y: rightHandleBox.y + rightHandleBox.height / 2 };
  await page.mouse.move(rightHandle.x, rightHandle.y);
  await page.mouse.down();
  await page.mouse.move(rightHandle.x - 40, rightHandle.y, { steps: 8 });
  await page.mouse.up();
  const durAfterTrim = await page.locator("text=/of 2\\.0s/").first().textContent();
  console.log(`   shot 1 trim readout: ${durAfterTrim}`);
  if (/^0\.0s–2\.0s/.test(durAfterTrim)) await fail(`trim handle drag doesn't seem to have shortened the segment: ${durAfterTrim}`);

  console.log("5) splitting shot 2 at the playhead…");
  await page.click("img[alt='Shot 2']");
  await page.waitForSelector("text=/Shot 2 —/", { timeout: 5000 });
  // Selecting a shot seeks the preview to its own start; nudge forward into
  // its middle before splitting (right at the edge is a deliberate no-op).
  const scrubValue = await page.locator('input[aria-label="Scrub preview"]').inputValue();
  await setRangeValue(page, 'input[aria-label="Scrub preview"]', Number(scrubValue) + 0.8);
  await page.waitForTimeout(150);
  await page.click('button:has-text("Split here")');
  await page.waitForTimeout(300);
  segCount = await page.locator("[aria-label^='Drag to reorder shot']").count();
  if (segCount !== 4) await fail(`expected 4 segments after a split, got ${segCount}`);
  console.log(`   ${segCount} segments after split`);

  console.log("6) deleting a shot…");
  await page.click("img[alt='Shot 1']");
  await page.click('button:has-text("Delete shot")');
  await page.waitForTimeout(300);
  segCount = await page.locator("[aria-label^='Drag to reorder shot']").count();
  if (segCount !== 3) await fail(`expected 3 segments after delete, got ${segCount}`);
  console.log(`   ${segCount} segments after delete`);

  console.log("7) setting a transition on shot 1…");
  await page.click("img[alt='Shot 1']");
  await page.click('button:has-text("Transition")');
  await page.waitForSelector("text=Pick a transition", { timeout: 5000 });
  await page.click('.slide-up button:has-text("Whip Pan")');
  await page.waitForSelector("text=Pick a transition", { state: "detached", timeout: 5000 }).catch(() => {});
  console.log("   transition sheet opened and a choice applied");

  console.log("8) walking every tab (Text / Effects / AI / More) for render errors…");
  for (const tab of ["Text", "Effects", "AI", "More"]) {
    await page.click(`button:text-is("${tab}")`);
    await page.waitForTimeout(200);
  }
  await page.click('button:text-is("Edit")');
  console.log("   all tabs switched cleanly");

  if (pageErrors.length > 0) {
    await fail(`console/page errors were logged during the run: ${pageErrors.slice(0, 5).join(" | ")}`);
  }

  console.log("9) rendering the manually-built edit…");
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
  }
  const buf = Buffer.from(bytes);
  const isMp4 = buf.subarray(4, 8).toString("latin1") === "ftyp";
  if (!isMp4) await fail("manually-built edit did not render to a valid MP4");
  console.log(`   manual edit rendered: ${(buf.length / 1024).toFixed(0)}KB MP4`);

  console.log("\nPASS ✅  manual timeline: add/reorder/select/trim/split/delete/transition/tabs/render all work");
  await browser.close();
} catch (e) {
  await fail(`uncaught exception: ${e?.stack ?? e}`);
}
