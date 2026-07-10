// End-to-end proof of conversational editing: build a plan, then drive it
// entirely through the chat panel — a style turn, a length turn, and finally
// "render it" — and validate the MP4 that comes out. Run: node scripts/chat-e2e.mjs [port]
import { chromium } from "playwright";

const PORT = process.argv[2] ?? "3997";
const BASE = `http://localhost:${PORT}`;

const MAKE_VIDEO = `async (seconds) => {
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
  await new Promise((done) => {
    function frame() {
      const t = (performance.now() - t0) / 1000;
      if (t >= seconds) { done(); return; }
      ctx.fillStyle = "#" + (0x224466 + Math.floor(t * 40) * 0x101010).toString(16).slice(0, 6);
      ctx.fillRect(0, 0, 360, 640);
      ctx.fillStyle = "#fff";
      ctx.fillRect((t * 200) % 360, 200 + (t * 80) % 200, 60, 60);
      requestAnimationFrame(frame);
    }
    frame();
  });
  rec.stop();
  await stopped;
  const buf = await new Blob(chunks, { type: "video/webm" }).arrayBuffer();
  return Array.from(new Uint8Array(buf));
}`;

async function setFileOnInput(page, selector, bytes, name) {
  await page.evaluate(({ selector, bytes, name }) => {
    const input = document.querySelector(selector);
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], name, { type: "video/webm" }));
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, { selector, bytes, name });
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("[pageerror]", String(e).slice(0, 200)));
const fail = async (m) => { console.error("FAIL:", m); process.exitCode = 1; await browser.close(); };
const gen = (s) => page.evaluate(new Function("return " + MAKE_VIDEO)(), s);

console.log("1) reel → analyze → editor…");
await page.goto(`${BASE}/home`);
await setFileOnInput(page, "input[type=file]", await gen(4), "ref.webm");
await page.waitForURL("**/analyze**", { timeout: 20000 });
await page.waitForSelector("text=Edit blueprint", { timeout: 120000 });
await page.click("text=Recreate with my clips");
await page.waitForURL("**/editor**");

console.log("2) two clips + auto-edit…");
await setFileOnInput(page, "input[type=file][multiple]", await gen(3), "a.webm");
await page.waitForSelector("img[alt='a.webm']", { timeout: 30000 });
await setFileOnInput(page, "input[type=file][multiple]", await gen(3), "b.webm");
await page.waitForSelector("img[alt='b.webm']", { timeout: 30000 });
await page.click("text=Auto-edit my clips");
await page.waitForSelector("text=Timeline", { timeout: 60000 });

console.log("3) open chat edit, drive it turn by turn…");
await page.click("text=Chat edit — steer it one step at a time");
const chatInput = page.locator('input[aria-label="Type an editing instruction"]');
const send = async (text) => {
  await chatInput.fill(text);
  await page.click('button[aria-label="Send instruction"]');
};
await send("make it cinematic and moody");
await page.waitForSelector("text=/Done —/", { timeout: 10000 });
console.log("   ✓ style turn applied");
await send("make it 15 seconds");
await page.waitForSelector("text=/15s version/", { timeout: 10000 });
console.log("   ✓ length turn applied");

console.log("4) 'render it' via chat → export…");
await send("render it");
await page.waitForURL("**/export**", { timeout: 600000 });
const bytes = await page.evaluate(async () => {
  const v = document.querySelector("video");
  if (!v?.src) return null;
  return Array.from(new Uint8Array(await (await fetch(v.src)).arrayBuffer()));
});
if (!bytes || bytes.length < 20000) {
  await fail(`rendered blob too small: ${bytes?.length ?? 0}`);
} else {
  const buf = Buffer.from(bytes);
  const ok = buf.subarray(4, 8).toString("latin1") === "ftyp" && buf.includes(Buffer.from("moov")) && buf.includes(Buffer.from("avc1"));
  if (!ok) await fail("rendered file failed MP4 structure checks");
  else {
    console.log(`\nPASS ✅  chat-driven edit rendered a valid MP4 (${(buf.length / 1024).toFixed(0)}KB)`);
    await browser.close();
  }
}
