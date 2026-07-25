// Unit suite for the competitor-parity feature libs (pure TS, no browser).
// Run: node --experimental-strip-types scripts/features-test.mjs
import { strict as assert } from "node:assert";
import { toTimecode, edlFromPlan, fcpxmlFromPlan, projectToFile, projectFromFile } from "../src/lib/edl.ts";
import { parseCube, generateCube, applyLut, gradeToCube, GRADE_TRANSFORMS } from "../src/lib/lut.ts";
import {
  subtractRanges, tightenSilences, insertCutaways, activeSpeakerCut, longformClips,
} from "../src/lib/plan-surgery.ts";
import { hookLines, showNotes } from "../src/lib/creator-growth.ts";
import { scoreFrame, pickThumbCandidates } from "../src/lib/thumb-score.ts";
import { readAudioTags, assessCopyrightRisk, attributionText, licenseAudit } from "../src/lib/media-trust.ts";
import { estimateLufs, platformGain, PLATFORM_TARGETS } from "../src/lib/platform-audio.ts";
import { foleyCues } from "../src/lib/foley.ts";
import {
  frameSignature, averageSignatures, signatureSimilarity, findSimilar, matchesAttribute, searchByAttributes,
} from "../src/lib/similarity.ts";
import { parseWhisperWords, fillerRanges, wordCutRanges, transcriptLines } from "../src/lib/transcript-edit.ts";
import { chromaComplex, chromaImageBgComplex, DEFAULT_CHROMA } from "../src/lib/chroma.ts";
import {
  slopCheck, optimizeTitle, contentCalendar, utmLink, abExperimentPlan, sponsorPitch, mediaKit, repurposePlan,
} from "../src/lib/marketing.ts";
import {
  beautyFilter, blurFillComplex, portraitBlurComplex, freezeFrameChain,
  privacyBlurComplex, splitStackComplex, pipComplex,
} from "../src/lib/compose.ts";
import { energyEnvelope, crossCorrelate, alignByAudio, detectRepeatTakes } from "../src/lib/sync.ts";
import { shotQuality, reshootScore } from "../src/lib/reshoot.ts";
import { frameSignature as fsig } from "../src/lib/similarity.ts";
import { interpretTurn } from "../src/lib/chat-edit.ts";
import { interpretMotionGfx } from "../src/lib/motion-gfx.ts";
import { interpretVibe } from "../src/lib/vibe-music.ts";
import { tierCheckout, PRICING_TIERS } from "../src/lib/credits.ts";
import {
  makeComment, addComment, editComment, setResolved, deleteComment, mergeComments, reviewSummary, timecode, formatComment,
} from "../src/lib/review.ts";
import {
  makeItem, addItem, removeItem, renameItem, itemsOfKind, searchItems, libraryStats, exportLibrary, importLibrary, mergeLibrary,
} from "../src/lib/library.ts";
import {
  seedPlanFromClips, appendClipToPlan, removeSegment, reorderSegments, trimSegment, splitSegment, MIN_SEGMENT,
  totalTimelineDuration, timeAtPlayhead,
} from "../src/lib/manual-timeline.ts";

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

// --- fixtures --------------------------------------------------------------

const CLIPS = [
  { id: "a", name: "talk.mp4", duration: 20 },
  { id: "b", name: "broll.mp4", duration: 8 },
];
const PLAN = {
  segments: [
    { id: "s1", clipId: "a", start: 1, end: 6, transitionAfter: "fade", speed: 1 },
    { id: "s2", clipId: "b", start: 0.5, end: 3.5, transitionAfter: "hard-cut", speed: 2 },
    { id: "s3", clipId: "a", start: 8, end: 11, transitionAfter: null, speed: 1 },
  ],
  colorGrade: "warm",
  aiDirection: "punchy",
  explanation: "test plan",
};

// solid RGBA frame builder
function solid(w, h, [r, g, b]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
  }
  return d;
}

// minimal ID3v2.3 buffer with given text frames
function id3(frames) {
  const chunks = [];
  for (const [id, text] of frames) {
    const body = [0, ...[...text].map((c) => c.charCodeAt(0))];
    chunks.push([...[...id].map((c) => c.charCodeAt(0)), (body.length >> 24) & 255, (body.length >> 16) & 255, (body.length >> 8) & 255, body.length & 255, 0, 0, ...body]);
  }
  const payload = chunks.flat();
  const size = payload.length;
  return new Uint8Array([
    0x49, 0x44, 0x33, 3, 0, 0,
    (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f,
    ...payload,
  ]);
}

// --- EDL / FCPXML / project file ------------------------------------------------

console.log("\nedl.ts");
test("toTimecode formats frames at 30fps", () => {
  assert.equal(toTimecode(0), "00:00:00:00");
  assert.equal(toTimecode(1.5), "00:00:01:15");
  assert.equal(toTimecode(3661.0333, 30), "01:01:01:01");
});
// the app passes transitionByType-based durations; tests inject their own
const DISSOLVE = (t) => (t === "fade" ? 0.45 : 0);
test("EDL has one event per segment with FROM CLIP NAME", () => {
  const edl = edlFromPlan(PLAN, CLIPS, { dissolve: DISSOLVE });
  assert.match(edl, /TITLE:/);
  assert.match(edl, /FCM: NON-DROP FRAME/);
  assert.equal((edl.match(/^\d{3} {2}AX/gm) ?? []).length, 3);
  assert.match(edl, /FROM CLIP NAME: talk\.mp4/);
  assert.match(edl, /FROM CLIP NAME: broll\.mp4/);
});
test("EDL: fade-in becomes a D event, speed emits M2", () => {
  const edl = edlFromPlan(PLAN, CLIPS, { dissolve: DISSOLVE });
  assert.match(edl, /002 {2}AX {7}V {5}D/); // s1's fade leads into event 2
  assert.match(edl, /M2 {3}AX/); // s2 runs at 2x
});
test("FCPXML: one asset per used clip, timeMap on retimed segment", () => {
  const xml = fcpxmlFromPlan(PLAN, CLIPS);
  assert.match(xml, /<fcpxml version="1.9">/);
  assert.equal((xml.match(/<asset /g) ?? []).length, 2);
  assert.equal((xml.match(/<asset-clip /g) ?? []).length, 3);
  assert.match(xml, /<timeMap>/);
});
test("project file round-trips and validates", () => {
  const text = projectToFile({ blueprint: null, plan: PLAN, studio: { look: {} }, clips: CLIPS, exportedAt: 123 });
  const res = projectFromFile(text);
  assert.equal(res.ok, true);
  assert.equal(res.project.plan.segments.length, 3);
  assert.equal(res.project.clips[0].name, "talk.mp4");
  assert.equal(projectFromFile("{}").ok, false);
  assert.equal(projectFromFile("not json").ok, false);
});

// --- LUT ---------------------------------------------------------------------------

console.log("\nlut.ts");
test("generateCube → parseCube round-trip", () => {
  const text = generateCube("Test", (r, g, b) => [r, g, b], 5);
  const res = parseCube(text);
  assert.equal(res.ok, true);
  assert.equal(res.lut.size, 5);
  assert.equal(res.lut.title, "Test");
});
test("identity LUT leaves colors unchanged", () => {
  const res = parseCube(generateCube("I", (r, g, b) => [r, g, b], 9));
  const [r, g, b] = applyLut(res.lut, 0.3, 0.6, 0.9);
  assert.ok(Math.abs(r - 0.3) < 0.01 && Math.abs(g - 0.6) < 0.01 && Math.abs(b - 0.9) < 0.01);
});
test("warm grade lifts red, drops blue", () => {
  const res = parseCube(gradeToCube("warm").text);
  assert.equal(res.ok, true);
  const [r, , b] = applyLut(res.lut, 0.5, 0.5, 0.5);
  assert.ok(r > 0.5, `red ${r} should rise`);
  assert.ok(b < 0.5, `blue ${b} should drop`);
});
test("parseCube rejects malformed input", () => {
  assert.equal(parseCube("hello").ok, false);
  assert.equal(parseCube("LUT_3D_SIZE 4\n0 0 0").ok, false); // wrong count
  assert.equal(parseCube("LUT_1D_SIZE 4").ok, false);
});
test("unknown grade bakes an identity LUT (never fails)", () => {
  const res = parseCube(gradeToCube("nonexistent").text);
  assert.equal(res.ok, true);
  const [r] = applyLut(res.lut, 0.42, 0.42, 0.42);
  assert.ok(Math.abs(r - 0.42) < 0.01);
});
test("every signature grade transform stays in gamut", () => {
  for (const [k, t] of Object.entries(GRADE_TRANSFORMS)) {
    for (const v of [0, 0.5, 1]) {
      const out = t.fn(v, v, v);
      assert.ok(out.every((c) => c >= 0 && c <= 1), `${k} out of gamut at ${v}`);
    }
  }
});

// --- plan surgery ---------------------------------------------------------------------

console.log("\nplan-surgery.ts");
test("subtractRanges splits and drops slivers", () => {
  const out = subtractRanges({ start: 0, end: 10 }, [{ start: 2, end: 3 }, { start: 9.9, end: 10 }]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { start: 0, end: 2 });
  assert.deepEqual(out[1], { start: 3, end: 9.9 });
});
test("tightenSilences jump-cuts dead air, keeps final transition", () => {
  const silences = new Map([["a", [{ start: 2.5, end: 4.5 }]]]);
  const res = tightenSilences(PLAN, silences);
  assert.ok(res.removedSeconds > 1.4, `removed ${res.removedSeconds}`);
  const pieces = res.plan.segments.filter((s) => s.id.startsWith("s1"));
  assert.equal(pieces.length, 2);
  assert.equal(pieces[0].transitionAfter, "hard-cut");
  assert.equal(pieces[1].transitionAfter, "fade");
  assert.equal(res.plan.segments[res.plan.segments.length - 1].transitionAfter, null);
});
test("tightenSilences leaves untouched clips alone", () => {
  const res = tightenSilences(PLAN, new Map());
  assert.equal(res.removedSeconds, 0);
  assert.equal(res.plan.segments.length, 3);
});
test("insertCutaways preserves duration and uses B-roll once", () => {
  const before = PLAN.segments.reduce((s, x) => s + (x.end - x.start) / x.speed, 0);
  const res = insertCutaways(
    PLAN,
    [{ clipId: "a", at: 3 }, { clipId: "a", at: 9.5 }],
    [{ clipId: "b", start: 4, end: 7 }],
    { len: 1 }
  );
  assert.equal(res.inserted, 1);
  const after = res.plan.segments.reduce((s, x) => s + (x.end - x.start) / x.speed, 0);
  assert.ok(Math.abs(before - after) < 0.05, `duration drifted ${before} → ${after}`);
  const broll = res.plan.segments.find((s) => s.id.endsWith("_broll"));
  assert.equal(broll.clipId, "b");
});
test("activeSpeakerCut follows the louder camera with hysteresis", () => {
  const times = Array.from({ length: 40 }, (_, i) => i * 0.5);
  const camA = times.map((t) => (t < 10 ? 0.2 : 0.01));
  const camB = times.map((t) => (t < 10 ? 0.01 : 0.2));
  const res = activeSpeakerCut([
    { clipId: "camA", times, rms: camA },
    { clipId: "camB", times, rms: camB },
  ]);
  assert.equal(res.segments.length, 2);
  assert.equal(res.segments[0].clipId, "camA");
  assert.equal(res.segments[1].clipId, "camB");
  assert.ok(Math.abs(res.segments[0].end - 10) < 1.5, `switch at ${res.segments[0].end}`);
});
test("activeSpeakerCut refuses single-camera input", () => {
  const res = activeSpeakerCut([{ clipId: "x", times: [0, 1], rms: [0.1, 0.1] }]);
  assert.equal(res.segments.length, 0);
});
test("longformClips returns ranked non-overlapping windows", () => {
  const n = 240; // 240 samples over 120s
  const times = Array.from({ length: n }, (_, i) => i * 0.5);
  const motion = times.map((t) => (t > 30 && t < 52 ? 0.3 : t > 80 && t < 102 ? 0.18 : 0.02));
  const brightness = times.map(() => 0.5);
  const out = longformClips({ duration: 120, times, motion, brightness }, { clipLen: 20, count: 3 });
  assert.ok(out.length >= 2);
  assert.equal(out[0].score, 100);
  assert.ok(out[0].start > 25 && out[0].start < 40, `best window at ${out[0].start}`);
  for (let i = 1; i < out.length; i++) assert.ok(out[i].score <= out[i - 1].score);
});

// --- creator growth --------------------------------------------------------------------

console.log("\ncreator-growth.ts");
test("hookLines: one line per pattern, topic substituted", () => {
  const hooks = hookLines("fitness", undefined, 3);
  assert.equal(hooks.length, 5);
  assert.ok(hooks.some((h) => h.line.includes("training")));
  assert.ok(new Set(hooks.map((h) => h.pattern)).size === 5);
});
test("hookLines deterministic per seed, changes across seeds", () => {
  const a = hookLines("travel", undefined, 1).map((h) => h.line).join("|");
  const b = hookLines("travel", undefined, 1).map((h) => h.line).join("|");
  assert.equal(a, b);
});
test("showNotes assembles chapters, tags and attribution", () => {
  const md = showNotes({
    plan: PLAN,
    clips: CLIPS,
    chapters: "0:00 intro\n0:05 payoff",
    hashtags: ["fyp", "#edit"],
    attribution: "• Song by X (CC BY 4.0)",
  });
  assert.match(md, /## Chapters/);
  assert.match(md, /#fyp #edit/);
  assert.match(md, /CC BY 4\.0/);
  assert.match(md, /on-device/);
});

// --- thumbnails --------------------------------------------------------------------------

console.log("\nthumb-score.ts");
test("a lit face frame outscores a dark empty frame", () => {
  const face = scoreFrame({ t: 1, brightness: 0.5, contrast: 0.2, saturation: 0.2, sharpness: 0.12, faceSize: 0.25, faceOffCenter: 0.1 });
  const dark = scoreFrame({ t: 2, brightness: 0.05, contrast: 0.05, saturation: 0.03, sharpness: 0.02, faceSize: 0, faceOffCenter: 1 });
  assert.ok(face.score > dark.score + 30, `${face.score} vs ${dark.score}`);
  assert.ok(face.reasons.some((r) => r.includes("face")));
});
test("pickThumbCandidates enforces time spacing", () => {
  const stats = [1, 1.2, 1.4, 5, 9].map((t) => ({ t, brightness: 0.5, contrast: 0.2, saturation: 0.2, sharpness: 0.12, faceSize: 0.2, faceOffCenter: 0.1 }));
  const picks = pickThumbCandidates(stats, 3, 1.0);
  assert.equal(picks.length, 3);
  const ts = picks.map((p) => p.t).sort((a, b) => a - b);
  for (let i = 1; i < ts.length; i++) assert.ok(ts[i] - ts[i - 1] >= 1.0);
});

// --- media trust -----------------------------------------------------------------------------

console.log("\nmedia-trust.ts");
test("ID3v2 TCOP tag → high risk", () => {
  const bytes = id3([["TIT2", "Hit Song"], ["TPE1", "Big Artist"], ["TCOP", "2024 Label Inc"]]);
  const tags = readAudioTags(bytes);
  assert.equal(tags.title, "Hit Song");
  assert.equal(tags.copyright, "2024 Label Inc");
  assert.equal(assessCopyrightRisk(tags).level, "high");
});
test("artist+title without rights tags → caution", () => {
  const risk = assessCopyrightRisk(readAudioTags(id3([["TIT2", "Song"], ["TPE1", "Artist"]])));
  assert.equal(risk.level, "caution");
});
test("untagged audio → unknown, still warns about fingerprinting", () => {
  const risk = assessCopyrightRisk(readAudioTags(new Uint8Array(300)));
  assert.equal(risk.level, "unknown");
  assert.match(risk.detail, /fingerprint/i);
});
test("ID3v1 tail parses as fallback", () => {
  const buf = new Uint8Array(300);
  const tag = "TAG" + "Old Title".padEnd(30, "\0") + "Old Artist".padEnd(30, "\0");
  for (let i = 0; i < tag.length; i++) buf[buf.length - 128 + i] = tag.charCodeAt(i);
  const tags = readAudioTags(buf);
  assert.equal(tags.title, "Old Title");
  assert.equal(tags.artist, "Old Artist");
});
test("attribution: CC-BY assets demand credits", () => {
  const text = attributionText([
    { id: "1", name: "Track", kind: "music", source: "openverse", license: "CC BY 4.0", author: "Ann" },
  ]);
  assert.match(text, /REQUIRE attribution/);
  assert.match(text, /Track by Ann/);
});
test("licenseAudit flags missing license and author", () => {
  const audit = licenseAudit([
    { id: "1", name: "Mystery", kind: "music", source: "?", license: "unknown" },
    { id: "2", name: "CCThing", kind: "image", source: "web", license: "CC BY 4.0" },
  ]);
  assert.equal(audit.ok, false);
  assert.equal(audit.warnings.length, 2);
});

// --- platform audio -----------------------------------------------------------------------------

console.log("\nplatform-audio.ts");
test("estimateLufs tracks 20log10(rms)", () => {
  assert.ok(Math.abs(estimateLufs(0.1) - -20.7) < 0.2);
  assert.equal(estimateLufs(0), -70);
});
test("quiet track gets boosted toward -14 LUFS", () => {
  const g = platformGain({ rms: 0.02, peak: 0.05 }, "tiktok"); // ample peak headroom
  assert.ok(g.gainDb > 15, `gain ${g.gainDb}`);
  assert.ok(!g.limited);
});
test("peak ceiling caps the boost", () => {
  const g = platformGain({ rms: 0.02, peak: 0.9 }, "tiktok");
  assert.ok(g.limited);
  assert.ok(g.gainDb < 1.2, `gain ${g.gainDb} should be peak-capped`);
});
test("all platform targets are sane", () => {
  for (const p of PLATFORM_TARGETS) assert.ok(p.lufs <= -10 && p.lufs >= -30 && p.peak <= 0);
});

// --- foley ----------------------------------------------------------------------------------------

console.log("\nfoley.ts");
test("sharp spike → impact, respects spacing", () => {
  const times = Array.from({ length: 30 }, (_, i) => i * 0.2);
  const motion = times.map((t) => (Math.abs(t - 2) < 0.11 ? 0.5 : 0.02));
  const cues = foleyCues(motion, times);
  assert.ok(cues.some((c) => c.kind === "impact" && Math.abs(c.t - 2) < 0.3));
});
test("late build → riser", () => {
  const times = Array.from({ length: 30 }, (_, i) => i * 0.2);
  const motion = times.map((t) => (t < 4 ? 0.02 : 0.25));
  const cues = foleyCues(motion, times);
  assert.ok(cues.some((c) => c.kind === "riser"));
});
test("static footage produces no cues", () => {
  const times = Array.from({ length: 20 }, (_, i) => i * 0.2);
  assert.equal(foleyCues(times.map(() => 0.01), times).length, 0);
});

// --- similarity --------------------------------------------------------------------------------------

console.log("\nsimilarity.ts");
test("identical frames → similarity ≈ 1; opposite → lower", () => {
  const red = { clipId: "r", ...frameSignature(solid(24, 24, [200, 30, 30]), 24, 24), avgMotion: 0.05 };
  const red2 = { clipId: "r2", ...frameSignature(solid(24, 24, [200, 30, 30]), 24, 24), avgMotion: 0.05 };
  const blue = { clipId: "b", ...frameSignature(solid(24, 24, [20, 30, 220]), 24, 24), avgMotion: 0.05 };
  assert.ok(signatureSimilarity(red, red2) > 0.99);
  assert.ok(signatureSimilarity(red, blue) < signatureSimilarity(red, red2));
  const ranked = findSimilar(red, [red, red2, blue]);
  assert.equal(ranked[0].clipId, "r2");
});
test("attribute filters classify bright/dark/colorful", () => {
  const bright = { clipId: "w", ...frameSignature(solid(16, 16, [230, 230, 230]), 16, 16), avgMotion: 0.01 };
  const dark = { clipId: "d", ...frameSignature(solid(16, 16, [15, 15, 20]), 16, 16), avgMotion: 0.2 };
  assert.ok(matchesAttribute(bright, "bright"));
  assert.ok(!matchesAttribute(bright, "dark"));
  assert.ok(matchesAttribute(dark, "dark"));
  assert.ok(matchesAttribute(dark, "high-action"));
  assert.deepEqual(searchByAttributes([bright, dark], ["dark", "high-action"]), ["d"]);
});
test("averageSignatures blends frames", () => {
  const avg = averageSignatures([frameSignature(solid(8, 8, [0, 0, 0]), 8, 8), frameSignature(solid(8, 8, [255, 255, 255]), 8, 8)]);
  assert.ok(Math.abs(avg.layout[0] - 0.5) < 0.01);
});

// --- transcript edit -------------------------------------------------------------------------------------

console.log("\ntranscript-edit.ts");
const WORDS = [
  { word: "So", start: 0.0, end: 0.2 },
  { word: "um", start: 0.5, end: 0.7 },
  { word: "this", start: 0.8, end: 1.0 },
  { word: "is", start: 1.05, end: 1.15 },
  { word: "you", start: 1.5, end: 1.6 },
  { word: "know", start: 1.62, end: 1.8 },
  { word: "great", start: 2.4, end: 2.8 },
];
test("parseWhisperWords handles top-level and segment shapes", () => {
  assert.equal(parseWhisperWords({ words: WORDS }).length, 7);
  assert.equal(parseWhisperWords({ segments: [{ words: WORDS.slice(0, 3) }, { words: WORDS.slice(3) }] }).length, 7);
  assert.equal(parseWhisperWords({}).length, 0);
});
test("fillerRanges catches um + you know, spares real words", () => {
  const f = fillerRanges(parseWhisperWords({ words: WORDS }));
  assert.equal(f.length, 2);
  assert.equal(f[0].text.toLowerCase(), "um");
  assert.equal(f[1].text, "you know");
});
test("isolated 'like' counts, mid-sentence 'like' doesn't", () => {
  const iso = parseWhisperWords({ words: [
    { word: "I", start: 0, end: 0.1 },
    { word: "like", start: 0.6, end: 0.8 }, // pauses both sides
    { word: "trains", start: 1.4, end: 1.7 },
  ] });
  assert.equal(fillerRanges(iso).length, 1);
  const mid = parseWhisperWords({ words: [
    { word: "I", start: 0, end: 0.1 },
    { word: "like", start: 0.12, end: 0.3 },
    { word: "trains", start: 0.32, end: 0.6 },
  ] });
  assert.equal(fillerRanges(mid).length, 0);
});
test("wordCutRanges merges neighbors and pads", () => {
  const cuts = wordCutRanges([WORDS[4], WORDS[5], WORDS[1]].map((w) => ({ w: w.word, start: w.start, end: w.end })));
  assert.equal(cuts.length, 2);
  assert.ok(cuts[0].start < 0.5 && cuts[0].end > 0.7);
  assert.ok(cuts[1].start < 1.5 && cuts[1].end > 1.8);
});
test("transcriptLines breaks on pauses", () => {
  const lines = transcriptLines(parseWhisperWords({ words: WORDS }), 9);
  assert.ok(lines.length >= 2, `got ${lines.length} lines`);
});

// --- chroma additions ---------------------------------------------------------------------------------------

console.log("\nchroma.ts (new)");
test("chromaComplex honors a custom output size", () => {
  const fc = chromaComplex({ ...DEFAULT_CHROMA, color: "#00ff00", bg: "studio" }, "scale=360:640", "", 1, { w: 360, h: 640 });
  assert.match(fc, /s=360x640/);
});
test("chromaImageBgComplex scales the [1:v] plate to cover", () => {
  const fc = chromaImageBgComplex({ ...DEFAULT_CHROMA, color: "#00ff00", bg: "vset:studio-glow" }, "scale=720:1280", "format=yuv420p", { w: 720, h: 1280 });
  assert.match(fc, /\[1:v\]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280/);
  assert.match(fc, /\[bg\]\[fg\]overlay/);
});

// --- marketing ------------------------------------------------------------------------------------------

console.log("\nmarketing.ts");
test("slopCheck flags AI-isms, passes human writing", () => {
  const slop = slopCheck("In today's fast-paced world, this game-changer will unlock your potential. Let's dive into it — seamless!");
  assert.ok(slop.score < 58, `score ${slop.score}`);
  assert.ok(slop.flags.length >= 4);
  const human = slopCheck("I burned the first three pancakes so you don't have to. Here's the pan temperature that finally worked.");
  assert.ok(human.score >= 86, `score ${human.score}`);
  assert.equal(human.flags.length, 0);
});
test("slopCheck catches hashtag stuffing", () => {
  const r = slopCheck("nice video #a #b #c #d #e #f #g #h #i #j");
  assert.ok(r.flags.some((f) => f.why.includes("hashtag")));
});
test("optimizeTitle rewards number+curiosity, gives 3 rewrites", () => {
  const good = optimizeTitle("Why 3 of my edits failed (the mistake nobody mentions)");
  const bad = optimizeTitle("MY VLOG!!!");
  assert.ok(good.score > bad.score + 20, `${good.score} vs ${bad.score}`);
  assert.equal(good.rewrites.length, 3);
  assert.ok(bad.tips.length >= 2);
});
test("contentCalendar: right shape, rotating formats, deterministic per seed", () => {
  const cal = contentCalendar("street food", { weeks: 2, perWeek: 4, seed: 5 });
  assert.equal(cal.length, 2);
  assert.equal(cal[0].length, 4);
  assert.ok(cal[0][0].angle.includes("street food"));
  assert.ok(new Set(cal[0].map((s) => s.format)).size === 4, "formats rotate within a week");
  const again = contentCalendar("street food", { weeks: 2, perWeek: 4, seed: 5 });
  assert.deepEqual(cal, again);
});
test("utmLink builds tagged URLs and validates input", () => {
  const r = utmLink("myshop.com/products?ref=x", { source: "TikTok", campaign: "Launch Week" });
  assert.equal(r.ok, true);
  assert.match(r.url, /^https:\/\/myshop\.com\/products\?/);
  assert.match(r.url, /utm_source=tiktok/);
  assert.match(r.url, /utm_campaign=launch_week/);
  assert.match(r.url, /ref=x/); // existing params survive
  assert.equal(utmLink("not a url at all", { source: "x" }).ok, false);
  assert.equal(utmLink("https://ok.com", { source: "  " }).ok, false);
});
test("abExperimentPlan sizes honestly and needs 2+ variants", () => {
  const p = abExperimentPlan({ what: "thumbnail", variants: ["A", "B"], dailyViews: 1000 });
  assert.ok(p);
  assert.match(p.metric, /click-through/);
  assert.ok(p.durationDays >= 3 && p.durationDays <= 30);
  assert.equal(abExperimentPlan({ what: "hook", variants: ["only one"] }), null);
});
test("sponsorPitch merges fields into subjects, email and cadence", () => {
  const p = sponsorPitch({ creator: "Nia", niche: "fitness", followers: "42k", brand: "HydroCo" });
  assert.equal(p.subjects.length, 3);
  assert.ok(p.subjects.some((s) => s.includes("HydroCo")));
  assert.match(p.email, /Nia/);
  assert.match(p.email, /42k followers/);
  assert.equal(p.followUps.length, 2);
  assert.ok(p.followUps[1].day > p.followUps[0].day);
});
test("mediaKit renders the platform table and sections", () => {
  const md = mediaKit({
    creator: "Nia",
    niche: "fitness",
    platforms: [{ name: "TikTok", handle: "@nia", followers: "42k", avgViews: "120k" }, { name: "", handle: "", followers: "" }],
    contact: "nia@example.com",
    pastBrands: "HydroCo, GymKit",
  });
  assert.match(md, /# Nia — Media Kit/);
  assert.match(md, /\| TikTok \| @nia \| 42k \| 120k \|/);
  assert.ok(!md.includes("|  |"), "empty platform rows dropped");
  assert.match(md, /Past collaborations/);
});
test("repurposePlan adds the clips-channel row only for long videos", () => {
  const short = repurposePlan(45);
  const long = repurposePlan(900);
  assert.ok(!short.some((r) => r.platform === "Clips channel"));
  assert.ok(long.some((r) => r.platform === "Clips channel"));
  assert.ok(short.every((r) => r.produceWith.length > 0));
});

// --- compose (filter builders) -----------------------------------------------------------------------

console.log("\ncompose.ts");
const PATH2 = { mode: "face", duration: 2, aspect: 9 / 16, times: [0, 1, 2], cx: [0.3, 0.5, 0.7], cy: [0.4, 0.4, 0.4], size: [0.3, 0.3, 0.3], quality: 0.9 };
test("beautyFilter emits smartblur scaled by strength", () => {
  assert.match(beautyFilter(0.5), /^smartblur=lr=/);
  assert.notEqual(beautyFilter(0.2), beautyFilter(0.9)); // strength changes the params
});
test("blurFillComplex has bg blur + centered overlay + [v] out", () => {
  const fc = blurFillComplex("fps=30", "format=yuv420p", { w: 720, h: 1280 });
  assert.match(fc, /gblur=sigma=/);
  assert.match(fc, /overlay=\(W-w\)\/2:\(H-h\)\/2/);
  assert.ok(fc.trim().endsWith("[v]"));
});
test("portraitBlurComplex builds a radial alpha mask over the subject", () => {
  const fc = portraitBlurComplex(0.6, 0.4, "fps=30", "format=yuv420p", { w: 720, h: 1280 });
  assert.match(fc, /geq=/);
  assert.match(fc, /overlay=0:0/);
  assert.ok(fc.includes("[v]"));
});
test("freezeFrameChain concats before/frozen/after", () => {
  const { complex } = freezeFrameChain(1.5, 1.2);
  assert.match(complex, /tpad=stop_mode=clone:stop_duration=1.20/);
  assert.match(complex, /concat=n=3:v=1:a=0\[v\]/);
});
test("privacyBlurComplex animates a blurred box, empty when no keyframes", () => {
  const fc = privacyBlurComplex(PATH2, { start: 0, end: 2, speed: 1 }, { w: 720, h: 1280 });
  assert.match(fc, /gblur=sigma=/);
  assert.match(fc, /overlay=x='/);
  const empty = privacyBlurComplex(PATH2, { start: 50, end: 60, speed: 1 }, { w: 720, h: 1280 });
  assert.equal(empty, "");
});
test("splitStackComplex uses vstack/hstack by direction", () => {
  assert.match(splitStackComplex("v", { w: 720, h: 1280 }), /vstack=inputs=2/);
  assert.match(splitStackComplex("h", { w: 720, h: 1280 }), /hstack=inputs=2/);
});
test("pipComplex overlays the inset in the chosen corner", () => {
  assert.match(pipComplex("br", 0.32, { w: 720, h: 1280 }), /overlay=W-w-24:H-h-24/);
  assert.match(pipComplex("tl", 0.32, { w: 720, h: 1280 }), /overlay=24:24/);
});

// --- sync (multi-cam + repeat-take) ------------------------------------------------------------------

console.log("\nsync.ts");
test("energyEnvelope normalizes to a 0..1 shape", () => {
  const sr = 1000;
  const data = new Float32Array(sr);
  for (let i = 0; i < sr; i++) data[i] = i > 400 && i < 500 ? 0.8 : 0.01; // a burst
  const env = energyEnvelope(data, sr, 100);
  assert.equal(env.length, 100);
  assert.ok(Math.max(...env) <= 1.0001 && Math.max(...env) > 0.99);
});
test("crossCorrelate recovers a known lag", () => {
  const a = Array.from({ length: 100 }, (_, i) => (i > 40 && i < 50 ? 1 : 0.02));
  const b = Array.from({ length: 100 }, (_, i) => (i > 55 && i < 65 ? 1 : 0.02)); // b is +15 later
  const { lag, score } = crossCorrelate(a, b, 40);
  assert.ok(Math.abs(lag - 15) <= 1, `lag ${lag}`);
  assert.ok(score > 0.5);
});
test("alignByAudio returns head-trim offsets, reference at 0", () => {
  const mk = (delaySamples) => {
    const d = new Float32Array(3000);
    for (let i = 0; i < 3000; i++) d[i] = i > 1000 + delaySamples && i < 1100 + delaySamples ? 0.9 : 0.01;
    return d;
  };
  const out = alignByAudio([
    { clipId: "cam1", data: mk(0), sampleRate: 1000 },
    { clipId: "cam2", data: mk(500), sampleRate: 1000 }, // cam2 recorded the burst 0.5s later
  ], { hz: 100, maxLagSec: 5 });
  assert.equal(out.length, 2);
  assert.ok(out.every((o) => o.offsetSec >= 0));
  assert.ok(out.some((o) => o.aligned));
});
function solidSig(id, rgb) {
  return { clipId: id, ...fsig(solid(16, 16, rgb), 16, 16), avgMotion: 0.05 };
}
test("detectRepeatTakes groups near-identical clips", () => {
  const groups = detectRepeatTakes([
    solidSig("a1", [200, 30, 30]),
    solidSig("a2", [200, 30, 30]), // dup of a1
    solidSig("b1", [30, 30, 200]),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].keep, "a1");
  assert.deepEqual(groups[0].duplicates, ["a2"]);
});

// --- reshoot ---------------------------------------------------------------------------------------------

console.log("\nreshoot.ts");
test("shotQuality rewards steady, well-exposed, even footage", () => {
  const steady = shotQuality({ motion: [0.05, 0.05, 0.05, 0.05], brightness: [0.5, 0.5, 0.5, 0.5] });
  // jittery: high motion variance, dark + flickering exposure
  const jittery = shotQuality({ motion: [0.02, 0.5, 0.02, 0.6], brightness: [0.08, 0.28, 0.05, 0.22] });
  assert.ok(steady.steadiness > jittery.steadiness);
  assert.ok(steady.exposure > jittery.exposure);
  assert.ok(steady.consistency > jittery.consistency);
});
test("reshootScore picks the better take with a verdict", () => {
  const bad = { motion: [0.02, 0.5, 0.02, 0.6], brightness: [0.05, 0.95, 0.1, 0.9] };
  const good = { motion: [0.06, 0.06, 0.06, 0.06], brightness: [0.5, 0.5, 0.5, 0.5] };
  const r = reshootScore(bad, good);
  assert.ok(r.scoreCurr > r.scorePrev);
  assert.match(r.verdict, /reshoot is better/i);
  assert.equal(r.deltas.length, 4);
});

// --- chat-edit (conversational turn interpreter) ---------------------------------------------------

console.log("\nchat-edit.ts");
test("structural commands classify to the right op", () => {
  assert.equal(interpretTurn("cut the silences").op.kind, "tighten");
  assert.equal(interpretTurn("remove the dead air").op.kind, "tighten");
  assert.equal(interpretTurn("add some b-roll cutaways").op.kind, "cutaways");
  assert.equal(interpretTurn("cut to whoever's talking").op.kind, "speakerCut");
  assert.equal(interpretTurn("loop the ending").op.kind, "callback");
  assert.equal(interpretTurn("undo that").op.kind, "undo");
  assert.equal(interpretTurn("start over").op.kind, "reset");
  assert.equal(interpretTurn("render it").op.kind, "render");
});
test("length parses digits and words", () => {
  const a = interpretTurn("make it 30 seconds");
  assert.equal(a.op.kind, "length");
  assert.equal(a.op.seconds, 30);
  assert.equal(interpretTurn("cut it to 15s").op.seconds, 15);
  assert.equal(interpretTurn("make it a minute").op.seconds, 60);
});
test("hook variants distinguish tight / swap / teaser", () => {
  assert.equal(interpretTurn("tighten the intro").op.variant, "tight");
  assert.equal(interpretTurn("swap the opening shot").op.variant, "swapped");
  assert.equal(interpretTurn("tease the ending first").op.variant, "teaser");
});
test("pacing tightens without a look change", () => {
  const p = interpretTurn("make the cuts snappier");
  assert.equal(p.op.kind, "pace");
  assert.ok(p.op.tightenTo < 1);
});
test("style turns fall through to the compiler", () => {
  const s = interpretTurn("make it cinematic and moody");
  assert.equal(s.op.kind, "style");
  assert.ok(s.op.compiled.notes.length > 0);
});
test("render is not triggered by 'make it <style>'", () => {
  // "make it moody" must be a style op, not a render — the render regex must
  // not swallow the common "make it ___" phrasing
  assert.equal(interpretTurn("make it moody").op.kind, "style");
});
test("unrecognized input returns suggestions, no op", () => {
  const u = interpretTurn("asdfghjkl");
  assert.equal(u.op, null);
  assert.ok(Array.isArray(u.suggestions) && u.suggestions.length >= 3);
});
test("empty input is handled gracefully", () => {
  assert.equal(interpretTurn("").op, null);
  assert.equal(interpretTurn("   ").op, null);
});

// --- motion-gfx (text → animated overlay primitive) ------------------------------------------------

console.log("\nmotion-gfx.ts");
test("countdown intro needs no text payload", () => {
  assert.equal(interpretMotionGfx("add a countdown").kind, "countdown");
  assert.equal(interpretMotionGfx("3 2 1 intro").kind, "countdown");
  assert.equal(interpretMotionGfx("three two one").kind, "countdown");
});
test("counter parses a numeric range and prefix", () => {
  const a = interpretMotionGfx("counter from 0 to 1000");
  assert.equal(a.kind, "counter");
  assert.equal(a.from, "0");
  assert.equal(a.to, "1000");
  const b = interpretMotionGfx("count from $0 to $10000");
  assert.equal(b.kind, "counter");
  assert.equal(b.text, "$");
  assert.equal(b.to, "10000");
  const c = interpretMotionGfx("Day 1 to 7 counter");
  assert.equal(c.text, "Day ");
});
test("commas are stripped from counter numbers", () => {
  const a = interpretMotionGfx("count from 1,000 to 1,000,000");
  assert.equal(a.from, "1000");
  assert.equal(a.to, "1000000");
});
test("title / lower third / location / caption classify with text", () => {
  assert.equal(interpretMotionGfx('title that says "WELCOME"').kind, "title");
  assert.equal(interpretMotionGfx('title that says "WELCOME"').text, "WELCOME");
  const lt = interpretMotionGfx("lower third for Jane Doe, Designer");
  assert.equal(lt.kind, "lowerThird");
  assert.equal(lt.text, "Jane Doe");
  assert.equal(lt.subtext, "Designer");
  assert.equal(interpretMotionGfx("location card Paris").kind, "location");
  assert.equal(interpretMotionGfx("location card Paris").text, "Paris");
  const cap = interpretMotionGfx('caption that says hello there');
  assert.equal(cap.kind, "caption");
  assert.equal(cap.text, "hello there");
});
test("title style is inferred", () => {
  assert.equal(interpretMotionGfx('epic title that says "GO"').style, "epic");
  assert.equal(interpretMotionGfx('typewriter title that says "GO"').style, "typewriter");
  assert.equal(interpretMotionGfx('title that says "GO"').style, "minimal");
});
test("unrecognized description returns null", () => {
  assert.equal(interpretMotionGfx(""), null);
  assert.equal(interpretMotionGfx("make it better"), null);
});

// --- vibe-music (text → score params) --------------------------------------------------------------

console.log("\nvibe-music.ts");
test("mood keywords map to the right score mood", () => {
  assert.equal(interpretVibe("epic cinematic trailer").mood, "epic");
  assert.equal(interpretVibe("chill lo-fi study").mood, "chill");
  assert.equal(interpretVibe("dark ominous tension").mood, "dark");
  assert.equal(interpretVibe("upbeat happy pop").mood, "uplift");
});
test("unknown vibe defaults to uplift", () => {
  assert.equal(interpretVibe("something").mood, "uplift");
});
test("explicit bpm wins and is clamped", () => {
  assert.equal(interpretVibe("chill 128 bpm").bpm, 128);
  assert.equal(interpretVibe("chill 500 bpm").bpm, 160);
  assert.equal(interpretVibe("chill 10 bpm").bpm, 60);
});
test("tempo adjectives nudge the base tempo", () => {
  assert.ok(interpretVibe("slow chill").bpm < interpretVibe("chill").bpm);
  assert.ok(interpretVibe("fast chill").bpm > interpretVibe("chill").bpm);
});
test("label summarizes mood and tempo", () => {
  assert.match(interpretVibe("chill").label, /BPM/);
});

// --- credits checkout math -------------------------------------------------------------------------

console.log("\ncredits.ts (checkout)");
test("free and byo-key tiers are not checkoutable", () => {
  const free = PRICING_TIERS.find((t) => t.id === "free");
  assert.equal(tierCheckout(free), null);
  const byo = PRICING_TIERS.find((t) => t.byoKey);
  assert.equal(tierCheckout(byo), null);
});
test("paid tiers price in whole cents matching the tier credits", () => {
  for (const t of PRICING_TIERS) {
    const c = tierCheckout(t);
    if (c === null) continue;
    assert.ok(Number.isInteger(c.amountCents) && c.amountCents > 0);
    assert.equal(c.credits, t.credits);
    // "$9" → 900 cents
    assert.equal(c.amountCents, Math.round(parseFloat(t.price.replace(/[^0-9.]/g, "")) * 100));
  }
});

// --- review (async timeline notes) -----------------------------------------------------------------

console.log("\nreview.ts");
const mk = (time, body, id, createdAt, author = "Alex") => makeComment({ time, author, body }, { id, createdAt });
test("makeComment normalizes time and author", () => {
  const c = makeComment({ time: -5, author: "  ", body: " hi " }, { id: "a", createdAt: 1 });
  assert.equal(c.time, 0);
  assert.equal(c.author, "Anonymous");
  assert.equal(c.body, "hi");
  assert.equal(c.resolved, false);
});
test("addComment keeps timeline order", () => {
  let list = [];
  list = addComment(list, mk(10, "late", "b", 2));
  list = addComment(list, mk(2, "early", "a", 1));
  assert.deepEqual(list.map((c) => c.id), ["a", "b"]);
});
test("same-time notes order by createdAt", () => {
  let list = [];
  list = addComment(list, mk(5, "second", "b", 20));
  list = addComment(list, mk(5, "first", "a", 10));
  assert.deepEqual(list.map((c) => c.id), ["a", "b"]);
});
test("edit / resolve / delete", () => {
  let list = [mk(1, "x", "a", 1)];
  list = editComment(list, "a", "y");
  assert.equal(list[0].body, "y");
  list = setResolved(list, "a", true);
  assert.equal(list[0].resolved, true);
  list = deleteComment(list, "a");
  assert.equal(list.length, 0);
});
test("mergeComments dedupes by id, newest write wins", () => {
  const mine = [mk(1, "mine", "a", 1)];
  const theirs = [mk(1, "edited", "a", 5), mk(3, "new", "b", 2)];
  const merged = mergeComments(mine, theirs);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((c) => c.id === "a").body, "edited");
});
test("summary counts open/resolved and authors", () => {
  const list = [mk(1, "a", "a", 1, "Sam"), setResolved([mk(2, "b", "b", 2, "Kai")], "b", true)[0]];
  const s = reviewSummary(list);
  assert.equal(s.total, 2);
  assert.equal(s.open, 1);
  assert.equal(s.resolved, 1);
  assert.deepEqual(s.authors, ["Kai", "Sam"]);
});
test("timecode + formatComment", () => {
  assert.equal(timecode(65), "1:05");
  assert.equal(timecode(4), "0:04");
  assert.match(formatComment(mk(65, "tighten", "a", 1)), /1:05 · Alex: tighten/);
});

// --- library (shared asset library) ----------------------------------------------------------------

console.log("\nlibrary.ts");
const li = (kind, name, id, createdAt, data = {}) => makeItem({ kind, name, data }, { id, createdAt });
test("makeItem falls back to a kind label when unnamed", () => {
  const it = makeItem({ kind: "look", name: "  ", data: { grade: "warm" } }, { id: "a", createdAt: 1 });
  assert.equal(it.name, "Looks & grades");
});
test("addItem newest-first, replaces same id", () => {
  let list = [];
  list = addItem(list, li("look", "old", "a", 1));
  list = addItem(list, li("brand", "new", "b", 2));
  assert.deepEqual(list.map((x) => x.id), ["b", "a"]);
  list = addItem(list, li("look", "renamed", "a", 9));
  assert.equal(list.find((x) => x.id === "a").name, "renamed");
  assert.equal(list.length, 2);
});
test("remove / rename / itemsOfKind", () => {
  let list = [li("look", "L1", "a", 1), li("brand", "B1", "b", 2), li("look", "L2", "c", 3)];
  assert.equal(itemsOfKind(list, "look").length, 2);
  list = renameItem(list, "a", "L1b");
  assert.equal(list.find((x) => x.id === "a").name, "L1b");
  list = removeItem(list, "b");
  assert.equal(list.length, 2);
});
test("searchItems matches name, tag and kind label", () => {
  const tagged = makeItem({ kind: "lut", name: "Teal", data: {}, tags: ["cinematic"] }, { id: "a", createdAt: 1 });
  const list = [tagged, li("brand", "Acme", "b", 2)];
  assert.equal(searchItems(list, "teal").length, 1);
  assert.equal(searchItems(list, "cinematic").length, 1);
  assert.equal(searchItems(list, "LUT").length, 1);
  assert.equal(searchItems(list, "").length, 2);
});
test("libraryStats counts by kind", () => {
  const list = [li("look", "a", "1", 1), li("look", "b", "2", 2), li("brand", "c", "3", 3)];
  const s = libraryStats(list);
  assert.equal(s.total, 3);
  assert.equal(s.byKind.look, 2);
  assert.equal(s.byKind.brand, 1);
});
test("export → import round-trips valid items", () => {
  const list = [li("look", "Warm", "a", 1, { grade: "warm" })];
  const text = exportLibrary(list, 123);
  const res = importLibrary(text);
  assert.ok(res.ok);
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].name, "Warm");
});
test("import rejects non-library JSON and drops malformed items", () => {
  assert.equal(importLibrary("nope").ok, false);
  assert.equal(importLibrary(JSON.stringify({ magic: "x" })).ok, false);
  const dirty = JSON.stringify({ magic: "viraledit-library", version: 1, exportedAt: 0, items: [{ id: "a", name: "n", kind: "bogus" }, li("look", "ok", "b", 1)] });
  const res = importLibrary(dirty);
  assert.ok(res.ok);
  assert.equal(res.items.length, 1);
});
test("mergeLibrary dedupes by id keeping newer", () => {
  const a = [li("look", "old", "x", 1)];
  const b = [li("look", "new", "x", 5), li("brand", "y", "y", 2)];
  const merged = mergeLibrary(a, b);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((x) => x.id === "x").name, "new");
});

// --- manual-timeline.ts -----------------------------------------------------

const MT_CLIPS = [
  { id: "a", name: "talk.mp4", duration: 20 },
  { id: "b", name: "broll.mp4", duration: 8 },
];

test("seedPlanFromClips: one full-duration segment per clip, hard cuts, last transition null", () => {
  const plan = seedPlanFromClips(MT_CLIPS);
  assert.equal(plan.segments.length, 2);
  assert.deepEqual(plan.segments.map((s) => [s.clipId, s.start, s.end]), [["a", 0, 20], ["b", 0, 8]]);
  assert.equal(plan.segments[0].transitionAfter, "hard-cut");
  assert.equal(plan.segments[1].transitionAfter, null);
});

test("appendClipToPlan adds a segment and fixes up the old last segment's transition", () => {
  const plan = seedPlanFromClips([MT_CLIPS[0]]);
  const next = appendClipToPlan(plan, MT_CLIPS[1]);
  assert.equal(next.segments.length, 2);
  assert.equal(next.segments[0].transitionAfter, "hard-cut");
  assert.equal(next.segments[1].transitionAfter, null);
});

test("removeSegment drops the segment and keeps the last-transition-null invariant", () => {
  const plan = seedPlanFromClips(MT_CLIPS);
  const next = removeSegment(plan, plan.segments[0].id);
  assert.equal(next.segments.length, 1);
  assert.equal(next.segments[0].clipId, "b");
  assert.equal(next.segments[0].transitionAfter, null);
});

test("reorderSegments moves a segment and re-nulls the new last transition", () => {
  const plan = seedPlanFromClips(MT_CLIPS);
  const next = reorderSegments(plan, 0, 1);
  assert.deepEqual(next.segments.map((s) => s.clipId), ["b", "a"]);
  assert.equal(next.segments[0].transitionAfter, "hard-cut");
  assert.equal(next.segments[1].transitionAfter, null);
});

test("reorderSegments is a no-op for an out-of-range fromIndex", () => {
  const plan = seedPlanFromClips(MT_CLIPS);
  const next = reorderSegments(plan, 5, 0);
  assert.deepEqual(next, plan);
});

test("trimSegment clamps the start handle to [0, end - MIN_SEGMENT]", () => {
  const plan = seedPlanFromClips(MT_CLIPS);
  const seg = plan.segments[0]; // clip "a", 0..20
  const dragged = trimSegment(plan, seg.id, MT_CLIPS[0], "start", -5);
  assert.equal(dragged.segments[0].start, 0);
  const overshot = trimSegment(plan, seg.id, MT_CLIPS[0], "start", 25);
  assert.equal(overshot.segments[0].start, 20 - MIN_SEGMENT);
});

test("trimSegment clamps the end handle to [start + MIN_SEGMENT, clip.duration]", () => {
  const plan = seedPlanFromClips(MT_CLIPS);
  const seg = plan.segments[0];
  const overshot = trimSegment(plan, seg.id, MT_CLIPS[0], "end", 999);
  assert.equal(overshot.segments[0].end, 20);
  const undershot = trimSegment(plan, seg.id, MT_CLIPS[0], "end", -1);
  assert.equal(undershot.segments[0].end, MIN_SEGMENT);
});

test("splitSegment cuts one segment into two adjoining segments with a hard cut between", () => {
  const plan = seedPlanFromClips([MT_CLIPS[0]]);
  const seg = plan.segments[0]; // 0..20
  const next = splitSegment(plan, seg.id, 8);
  assert.equal(next.segments.length, 2);
  assert.equal(next.segments[0].end, 8);
  assert.equal(next.segments[1].start, 8);
  assert.equal(next.segments[0].transitionAfter, "hard-cut");
  assert.equal(next.segments[1].transitionAfter, null);
});

test("splitSegment refuses a cut too close to either edge", () => {
  const plan = seedPlanFromClips([MT_CLIPS[0]]);
  const seg = plan.segments[0]; // 0..20
  const tooEarly = splitSegment(plan, seg.id, 0.05);
  assert.equal(tooEarly.segments.length, 1);
  const tooLate = splitSegment(plan, seg.id, 19.99);
  assert.equal(tooLate.segments.length, 1);
});

test("totalTimelineDuration sums trimmed segment lengths", () => {
  const plan = seedPlanFromClips(MT_CLIPS); // 20 + 8
  assert.equal(totalTimelineDuration(plan.segments), 28);
});

test("timeAtPlayhead resolves the right segment and local clip time", () => {
  const plan = seedPlanFromClips(MT_CLIPS); // seg0: clip a 0..20, seg1: clip b 0..8
  const early = timeAtPlayhead(plan.segments, 5);
  assert.equal(early.segment.clipId, "a");
  assert.equal(early.localTime, 5);
  const late = timeAtPlayhead(plan.segments, 23);
  assert.equal(late.segment.clipId, "b");
  assert.equal(late.localTime, 3); // 23 - 20
});

test("timeAtPlayhead clamps past the end to the last segment's end", () => {
  const plan = seedPlanFromClips(MT_CLIPS);
  const past = timeAtPlayhead(plan.segments, 999);
  assert.equal(past.segment.clipId, "b");
  assert.equal(past.localTime, 8);
});

test("timeAtPlayhead returns null for an empty timeline", () => {
  assert.equal(timeAtPlayhead([], 0), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
