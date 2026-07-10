// Regenerates every app icon (PWA manifest, Android legacy + adaptive
// launcher icons, favicon.ico, Apple touch icon) from the single canvas
// design in gen-icons.html. Run from the repo root: node scripts/icon-gen/generate.mjs
// Edit the glyph/gradient in gen-icons.html, then re-run — nothing else to touch.
import { chromium } from "playwright";
import path from "path";
import fs from "fs";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
await page.goto("file://" + path.resolve("scripts/icon-gen/gen-icons.html"));

async function render(fn, size) {
  const b64 = await page.evaluate(({ fn, size }) => {
    const c = document.createElement("canvas");
    window.render[fn](c, size);
    return c.toDataURL("image/png").split(",")[1];
  }, { fn, size });
  return Buffer.from(b64, "base64");
}
function write(p, buf) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buf);
}

// PWA manifest icons
write("public/icons/icon-192.png", await render("drawMaskable", 192));
write("public/icons/icon-512.png", await render("drawMaskable", 512));

// Android legacy launcher icons (flat, full-bleed — masked by the OS pre-26)
const legacyDensities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [d, px] of Object.entries(legacyDensities)) {
  const full = await render("drawFullIcon", px);
  write(`android/app/src/main/res/mipmap-${d}/ic_launcher.png`, full);
  write(`android/app/src/main/res/mipmap-${d}/ic_launcher_round.png`, full);
}

// Android adaptive-icon foreground (transparent bg, glyph only, safe-zone
// sized) — the foreground layer canvas is conventionally rendered bigger
// than the legacy icon (108dp vs 72dp) so it can be masked/parallaxed
// without clipping the glyph.
const fgDensities = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
for (const [d, px] of Object.entries(fgDensities)) {
  write(`android/app/src/main/res/mipmap-${d}/ic_launcher_foreground.png`, await render("drawForeground", px));
}

// Favicon: modern browsers accept a plain PNG named favicon.ico just fine
// (magic-byte sniffing, not extension), but for a real multi-res ICO we
// hand-wrap two PNG frames (32/16) in a minimal ICO container.
function buildIco(frames) {
  // frames: [{ size, png: Buffer }], PNG-compressed ICO entries (valid since Vista)
  const count = frames.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);
  let offset = 6 + count * 16;
  const dirEntries = [];
  const imageDatas = [];
  for (const f of frames) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(f.size >= 256 ? 0 : f.size, 0); // width (0 = 256)
    entry.writeUInt8(f.size >= 256 ? 0 : f.size, 1); // height
    entry.writeUInt8(0, 2); // color palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(f.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += f.png.length;
    dirEntries.push(entry);
    imageDatas.push(f.png);
  }
  return Buffer.concat([header, ...dirEntries, ...imageDatas]);
}
const ico32 = await render("drawFullIcon", 32);
const ico16 = await render("drawFullIcon", 16);
write("src/app/favicon.ico", buildIco([{ size: 32, png: ico32 }, { size: 16, png: ico16 }]));

// Apple touch icon (no transparency, no rounding — iOS applies its own mask)
write("public/icons/apple-touch-icon.png", await render("drawFullIcon", 180));

await browser.close();
console.log("icons written");
