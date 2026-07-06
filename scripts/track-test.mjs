// Unit suite for the tracking + chroma cores (pure TS, no browser APIs).
// Run: npm run test:track  (node --experimental-strip-types under the hood)
import { strict as assert } from "node:assert";
import {
  isSkin,
  detectFaceInFrame,
  motionCentroid,
  smoothTrack,
  reduceKeyframes,
  piecewiseExpr,
  trackCropFilter,
  mapToCenterCrop,
  pathCenter,
  facePunchFilter,
} from "../src/lib/track-core.ts";
import {
  hexToRgb,
  rgbToHex,
  hexToFFmpeg,
  detectKeyColor,
  chromaKeyFilter,
  chromaComplex,
  DEFAULT_CHROMA,
} from "../src/lib/chroma.ts";

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n    ${e.message}`);
  }
}

// --- helpers ---------------------------------------------------------------

// synthetic RGBA frame: solid bg + optional discs/rects
function frame(w, h, bg, shapes = []) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = bg[0];
    d[i * 4 + 1] = bg[1];
    d[i * 4 + 2] = bg[2];
    d[i * 4 + 3] = 255;
  }
  for (const s of shapes) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const inside =
          s.type === "disc"
            ? (x - s.x) ** 2 + (y - s.y) ** 2 <= s.r ** 2
            : x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h;
        if (inside) {
          const p = (y * w + x) * 4;
          d[p] = s.color[0];
          d[p + 1] = s.color[1];
          d[p + 2] = s.color[2];
        }
      }
    }
  }
  return d;
}

const SKIN = [214, 160, 122]; // warm mid skin tone
const GREEN = [40, 230, 60];

// Evaluate one of our generated FFmpeg expressions numerically.
// Only the constructs we emit: if(), lt(), min(), max(), t, iw, ih, ow.
function evalExpr(expr, vars) {
  const js = expr
    .replaceAll("if(", "IF(")
    .replaceAll("lt(", "LT(")
    .replaceAll("min(", "Math.min(")
    .replaceAll("max(", "Math.max(");
  const fn = new Function(
    "IF", "LT", "t", "iw", "ih", "ow",
    `return (${js});`
  );
  return fn(
    (c, a, b) => (c ? a : b),
    (a, b) => (a < b ? 1 : 0),
    vars.t ?? 0,
    vars.iw ?? 1920,
    vars.ih ?? 1080,
    vars.ow ?? 607
  );
}

// --- track-core ------------------------------------------------------------

console.log("\ntrack-core:");

test("isSkin accepts skin tones, rejects green/white/black", () => {
  assert.ok(isSkin(...SKIN));
  assert.ok(isSkin(180, 120, 90));
  assert.ok(!isSkin(...GREEN));
  assert.ok(!isSkin(255, 255, 255));
  assert.ok(!isSkin(10, 10, 10));
  assert.ok(!isSkin(60, 120, 200)); // blue
});

test("detectFaceInFrame finds a skin disc where it is", () => {
  const W = 64, H = 64;
  const d = frame(W, H, [30, 60, 120], [{ type: "disc", x: 45, y: 19, r: 8, color: SKIN }]);
  const f = detectFaceInFrame(d, W, H);
  assert.ok(f, "no face found");
  assert.ok(Math.abs(f.cx - 45 / W) < 0.05, `cx ${f.cx}`);
  assert.ok(Math.abs(f.cy - 19 / H) < 0.05, `cy ${f.cy}`);
  assert.ok(f.conf > 0);
});

test("detectFaceInFrame returns null on empty and on thin-strip frames", () => {
  const W = 64, H = 64;
  assert.equal(detectFaceInFrame(frame(W, H, [30, 60, 120]), W, H), null);
  // 2px-tall full-width skin strip: wood/sand false-positive shape
  const strip = frame(W, H, [30, 60, 120], [{ type: "rect", x: 0, y: 30, w: W, h: 2, color: SKIN }]);
  assert.equal(detectFaceInFrame(strip, W, H), null);
});

test("detectFaceInFrame picks the LARGEST of two blobs", () => {
  const W = 64, H = 64;
  const d = frame(W, H, [30, 60, 120], [
    { type: "disc", x: 12, y: 12, r: 4, color: SKIN },
    { type: "disc", x: 48, y: 48, r: 9, color: SKIN },
  ]);
  const f = detectFaceInFrame(d, W, H);
  assert.ok(f);
  assert.ok(f.cx > 0.6 && f.cy > 0.6, `picked wrong blob: ${f.cx},${f.cy}`);
});

test("motionCentroid localizes movement", () => {
  const W = 64, H = 64;
  const a = frame(W, H, [20, 20, 20]);
  const b = frame(W, H, [20, 20, 20], [{ type: "rect", x: 44, y: 10, w: 10, h: 10, color: [250, 250, 250] }]);
  const m = motionCentroid(a, b, W, H);
  assert.ok(m.cx > 0.6, `cx ${m.cx}`);
  assert.ok(m.cy < 0.4, `cy ${m.cy}`);
  assert.ok(m.energy > 0);
});

test("smoothTrack bridges gaps and stays near the true path", () => {
  // subject moves linearly 0.2 → 0.8 over 4s, one sample per 0.25s,
  // 30% of samples lost, ±0.03 noise
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const t = i * 0.25;
    const truth = 0.2 + (0.6 * t) / 4;
    const lost = i % 3 === 2;
    pts.push({
      t,
      cx: lost ? 0 : truth + (i % 2 ? 0.03 : -0.03),
      cy: 0.4,
      size: 0.2,
      conf: lost ? 0 : 0.8,
    });
  }
  const path = smoothTrack(pts, "face", 4, 16 / 9);
  assert.ok(path, "path is null");
  assert.equal(path.times.length, 17);
  for (let i = 2; i < 15; i++) {
    const truth = 0.2 + (0.6 * path.times[i]) / 4;
    assert.ok(Math.abs(path.cx[i] - truth) < 0.08, `t=${path.times[i]}: ${path.cx[i]} vs ${truth}`);
  }
  assert.ok(path.quality > 0.6);
});

test("smoothTrack returns null when detections are too sparse", () => {
  const pts = Array.from({ length: 12 }, (_, i) => ({ t: i * 0.25, cx: 0, cy: 0, size: 0, conf: 0 }));
  pts[0] = { t: 0, cx: 0.5, cy: 0.5, size: 0.2, conf: 0.9 };
  assert.equal(smoothTrack(pts, "face", 3, 16 / 9), null);
});

test("reduceKeyframes: linear collapses to 2, corner is kept", () => {
  const t = [0, 1, 2, 3, 4];
  const linear = reduceKeyframes(t, [0, 0.25, 0.5, 0.75, 1.0]);
  assert.equal(linear.times.length, 2);
  const step = reduceKeyframes(t, [0.2, 0.2, 0.2, 0.8, 0.8]);
  assert.ok(step.times.length >= 3, `kept ${step.times.length}`);
  assert.ok(step.times.includes(2) || step.times.includes(3), "corner dropped");
});

test("piecewiseExpr evaluates to correct linear interpolation", () => {
  const expr = piecewiseExpr([0, 2, 4], [0.2, 0.8, 0.4], 0, 1);
  assert.ok(Math.abs(evalExpr(expr, { t: 0 }) - 0.2) < 1e-3);
  assert.ok(Math.abs(evalExpr(expr, { t: 1 }) - 0.5) < 1e-3);
  assert.ok(Math.abs(evalExpr(expr, { t: 2 }) - 0.8) < 1e-3);
  assert.ok(Math.abs(evalExpr(expr, { t: 3 }) - 0.6) < 1e-3);
  assert.ok(Math.abs(evalExpr(expr, { t: 99 }) - 0.4) < 1e-3); // hold last
});

test("piecewiseExpr remaps t by segment offset and speed", () => {
  // source keyframes at 2s..4s; segment starts at src 2s, speed 2x
  const expr = piecewiseExpr([2, 4], [0.0, 1.0], 2, 2);
  assert.ok(Math.abs(evalExpr(expr, { t: 0 }) - 0.0) < 1e-3); // src 2s
  assert.ok(Math.abs(evalExpr(expr, { t: 0.5 }) - 0.5) < 1e-3); // src 3s
  assert.ok(Math.abs(evalExpr(expr, { t: 1 }) - 1.0) < 1e-3); // src 4s
});

test("trackCropFilter emits a clamped 9:16 follow crop", () => {
  const path = {
    mode: "face", duration: 4, aspect: 16 / 9, quality: 1,
    times: [0, 1, 2, 3, 4],
    cx: [0.3, 0.4, 0.5, 0.6, 0.7],
    cy: [0.4, 0.4, 0.4, 0.4, 0.4],
    size: [0.2, 0.2, 0.2, 0.2, 0.2],
  };
  const f = trackCropFilter(path, { start: 0, end: 4, speed: 1 });
  assert.ok(f.startsWith("crop=w='min(iw,ih*9/16)':h=ih:x="), f);
  // numeric: at t=2 face at 0.5 → x centers the 607px window in 1920
  const xExpr = f.match(/x='([^']+)'/)[1];
  const x = evalExpr(xExpr, { t: 2, iw: 1920, ih: 1080, ow: 607 });
  assert.ok(Math.abs(x - (0.5 * 1920 - 303.5)) < 20, `x=${x}`);
  // clamp: subject far right never pushes crop out of bounds
  const xEnd = evalExpr(xExpr, { t: 99, iw: 1920, ih: 1080, ow: 607 });
  assert.ok(xEnd >= 0 && xEnd <= 1920 - 607, `xEnd=${xEnd}`);
});

test("trackCropFilter returns empty string when path misses the window", () => {
  const path = {
    mode: "face", duration: 1, aspect: 16 / 9, quality: 1,
    times: [0, 0.5, 1], cx: [0.5, 0.5, 0.5], cy: [0.5, 0.5, 0.5], size: [0.2, 0.2, 0.2],
  };
  assert.equal(trackCropFilter(path, { start: 8, end: 10, speed: 1 }), "");
});

test("mapToCenterCrop: portrait identity, landscape squeeze + clamp", () => {
  assert.equal(mapToCenterCrop(0.3, 9 / 16), 0.3);
  assert.equal(mapToCenterCrop(0.5, 16 / 9), 0.5);
  assert.equal(mapToCenterCrop(0.05, 16 / 9), 0); // outside visible band
  assert.ok(mapToCenterCrop(0.6, 16 / 9) > 0.6); // off-center amplified
});

test("pathCenter takes the median inside the window", () => {
  const path = {
    mode: "face", duration: 5, aspect: 1, quality: 1,
    times: [0, 1, 2, 3, 4],
    cx: [0.1, 0.5, 0.52, 0.48, 0.9],
    cy: [0.3, 0.3, 0.3, 0.3, 0.3],
    size: [0.2, 0.2, 0.2, 0.2, 0.2],
  };
  const c = pathCenter(path, 1, 3);
  assert.ok(Math.abs(c.cx - 0.5) < 0.03, `cx ${c.cx}`);
});

test("facePunchFilter targets the subject and clamps zoom window", () => {
  const p = facePunchFilter({ cx: 0.7, cy: 0.35 }, 2, 1.25);
  assert.ok(p.needsOverscan);
  assert.ok(p.post.includes("zoompan"));
  assert.ok(p.post.includes("0.700*iw"));
  assert.ok(p.post.includes("min(1+"));
  assert.ok(p.post.includes("max(0,min(iw-iw/zoom"));
});

// --- chroma ----------------------------------------------------------------

console.log("\nchroma:");

test("hex conversions round-trip", () => {
  assert.deepEqual(hexToRgb("#00ff00"), { r: 0, g: 255, b: 0 });
  assert.deepEqual(hexToRgb("1e90ff"), { r: 30, g: 144, b: 255 });
  assert.equal(hexToRgb("nope"), null);
  assert.equal(rgbToHex(0, 255, 0), "#00ff00");
  assert.equal(hexToFFmpeg("#1e90ff"), "0x1e90ff");
  assert.equal(hexToFFmpeg("garbage"), "0x00ff00");
});

test("detectKeyColor finds a green screen behind a subject", () => {
  const W = 96, H = 96;
  const d = frame(W, H, GREEN, [{ type: "disc", x: 48, y: 55, r: 22, color: SKIN }]);
  const k = detectKeyColor(d, W, H);
  assert.ok(k, "no key found");
  const rgb = hexToRgb(k.color);
  assert.ok(rgb.g > rgb.r * 1.3 && rgb.g > rgb.b * 1.3, `not green: ${k.color}`);
  assert.ok(k.coverage > 0.9);
});

test("detectKeyColor finds blue screens too", () => {
  const W = 96, H = 96;
  const d = frame(W, H, [30, 70, 220], [{ type: "disc", x: 48, y: 55, r: 20, color: SKIN }]);
  const k = detectKeyColor(d, W, H);
  assert.ok(k);
  const rgb = hexToRgb(k.color);
  assert.ok(rgb.b > rgb.r && rgb.b > rgb.g, `not blue: ${k.color}`);
});

test("detectKeyColor rejects normal footage", () => {
  const W = 96, H = 96;
  // busy frame: gray bg, some sky, some skin — nothing key-like enough
  const d = frame(W, H, [120, 118, 110], [
    { type: "rect", x: 0, y: 0, w: W, h: 20, color: [140, 170, 200] },
    { type: "disc", x: 48, y: 60, r: 18, color: SKIN },
  ]);
  assert.equal(detectKeyColor(d, W, H), null);
});

test("chromaKeyFilter clamps and formats", () => {
  const f = chromaKeyFilter({ color: "#00ff00", similarity: 0.18, blend: 0.06, bg: "studio" });
  assert.equal(f, "chromakey=0x00ff00:0.180:0.060");
  const clamped = chromaKeyFilter({ color: "#00ff00", similarity: 9, blend: -1, bg: "studio" });
  assert.equal(clamped, "chromakey=0x00ff00:0.500:0.000");
});

test("chromaComplex: color background structure", () => {
  const fc = chromaComplex(
    { color: "#00ff00", ...DEFAULT_CHROMA },
    "trim=start=0:end=2,setpts=PTS-STARTPTS,scale=720:1280,fps=30",
    "format=yuv420p",
    2
  );
  assert.ok(fc.startsWith("color=c=0x101014:s=720x1280:r=30:d=2.00[bg];"), fc);
  assert.ok(fc.includes("[0:v]trim=start=0"));
  assert.ok(fc.includes("chromakey=0x00ff00"));
  assert.ok(fc.includes("[bg][fg]overlay=0:0:shortest=1,format=yuv420p[v]"));
});

test("chromaComplex: blur background splits the clip", () => {
  const fc = chromaComplex(
    { color: "#00ff00", similarity: 0.18, blend: 0.06, bg: "blur" },
    "scale=720:1280,fps=30",
    "",
    3
  );
  assert.ok(fc.includes("split[cbg][cfg]"));
  assert.ok(fc.includes("boxblur"));
  assert.ok(fc.includes("[bg][fg]overlay=0:0:shortest=1[v]"));
});

test("chromaComplex: custom hex background", () => {
  const fc = chromaComplex(
    { color: "#00ff00", similarity: 0.18, blend: 0.06, bg: "#ff8800" },
    "scale=720:1280", "", 1
  );
  assert.ok(fc.startsWith("color=c=0xff8800"), fc);
});

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
