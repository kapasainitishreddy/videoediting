import { chromium } from "playwright";
import fs from "fs";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage();
await p.goto("http://localhost:3997/dev/filters"); // any page with ffmpeg access
await p.waitForFunction(() => window.filterResults, null, { timeout: 300000 });
const video = fs.readFileSync("/home/user/videoediting/golden-hour.mp4");
const frames = await p.evaluate(async (bytes) => {
  const { getFFmpeg } = await import("/_next/static/chunks/_23a2e01a._.js").catch(() => ({}));
  // fallback: use the page's ffmpeg via a fresh import is fragile — draw via <video> instead
  const blob = new Blob([new Uint8Array(bytes)], { type: "video/mp4" });
  const url = URL.createObjectURL(blob);
  const v = document.createElement("video");
  v.src = url; v.muted = true;
  await new Promise((r) => (v.onloadeddata = r));
  const out = {};
  const c = document.createElement("canvas");
  c.width = 360; c.height = 640;
  const ctx = c.getContext("2d");
  for (const t of [1.0, 3.5, 7.0, 10.5, 13.0]) {
    await new Promise((r) => { v.onseeked = r; v.currentTime = t; });
    ctx.drawImage(v, 0, 0, 360, 640);
    out["t" + t] = c.toDataURL("image/jpeg", 0.85).split(",")[1];
  }
  return out;
}, Array.from(video));
const dir = "/tmp/claude-0/-home-user-videoediting/784d39ef-7160-585b-ba90-b17779e7b3c0/scratchpad";
for (const [k, v] of Object.entries(frames)) fs.writeFileSync(`${dir}/gh_${k}.jpg`, Buffer.from(v, "base64"));
console.log("frames:", Object.keys(frames).join(", "));
await b.close();
