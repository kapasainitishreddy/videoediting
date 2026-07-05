"use client";

// Verification for the cinematic feature drop. Each engine is exercised
// through the REAL render path with a concrete pass/fail check:
//  1. looks     — genre look + letterbox: top rows must be black
//  2. motion    — ken-burns render succeeds at 720x1280
//  3. overlay   — embers blend=screen: output frame must gain bright pixels
//  4. score     — composeScore returns decodable audio of right length
//  5. sfx+mix   — mixTimeline WAV has audible energy at transition times
//  6. captions  — kinetic word cue PNGs generate with correct windows
//  7. intel     — virality/pace/coldopen/codes round-trip
//  8. web sfx   — bundled /sfx file loads, bogus URL → synth, blob plays in mix
import { useEffect, useState } from "react";
import { v4 as uuid } from "uuid";
import { renderEdit, getFFmpeg } from "@/lib/ffmpeg-client";
import { generateOverlayClip } from "@/lib/overlays";
import { composeScore, mixTimeline } from "@/lib/audio-cinema";
import { kineticWordCues } from "@/lib/titles";
import { viralityScore, paceAnalysis, coldOpenCheck, blueprintToCode, blueprintFromCode } from "@/lib/intelligence";
import { analyzeClip } from "@/lib/clip-analysis";
import { cinematicify } from "@/lib/cinematic";
import type { TimelineSegment, EditPlan, EditBlueprint } from "@/lib/types";

async function makeClip(color: string, seconds: number): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = 360;
  c.height = 640;
  const ctx = c.getContext("2d")!;
  const rec = new MediaRecorder(c.captureStream(24), { mimeType: "video/webm;codecs=vp8" });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
  rec.start(100);
  const t0 = performance.now();
  await new Promise<void>((done) => {
    function f() {
      const t = (performance.now() - t0) / 1000;
      if (t >= seconds) return done();
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 360, 640);
      ctx.fillStyle = "#fff";
      ctx.fillRect((t * 150) % 360, 300, 50, 50);
      requestAnimationFrame(f);
    }
    f();
  });
  rec.stop();
  await stopped;
  return new Blob(chunks, { type: "video/webm" });
}

async function framePixels(mp4: Blob, at: number): Promise<{ data: Uint8ClampedArray; w: number; h: number }> {
  const ff = await getFFmpeg();
  const { fetchFile } = await import("@ffmpeg/util");
  await ff.writeFile("chk.mp4", await fetchFile(mp4));
  await ff.exec(["-i", "chk.mp4", "-ss", String(at), "-frames:v", "1", "-y", "chk.png"]);
  const png = (await ff.readFile("chk.png")) as Uint8Array;
  await ff.deleteFile("chk.mp4").catch(() => {});
  await ff.deleteFile("chk.png").catch(() => {});
  const url = URL.createObjectURL(new Blob([png.slice().buffer], { type: "image/png" }));
  const img = new Image();
  await new Promise((r) => {
    img.onload = r;
    img.src = url;
  });
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);
  return { data: ctx.getImageData(0, 0, img.width, img.height).data, w: img.width, h: img.height };
}

export default function CineTest() {
  const [log, setLog] = useState<string[]>([]);
  const [pass, setPass] = useState<boolean | null>(null);
  const add = (s: string) => setLog((l) => [...l, s]);

  useEffect(() => {
    (async () => {
      const results: Record<string, boolean> = {};
      const clipA = await makeClip("#7a2020", 2.5);
      const clipB = await makeClip("#204a7a", 2.5);
      const clips = new Map([["a", clipA], ["b", clipB]]);
      const seg = (id: string, clipId: string, tr: TimelineSegment["transitionAfter"]): TimelineSegment => ({
        id, clipId, start: 0.2, end: 1.6, transitionAfter: tr, speed: 1,
      });

      // 1. looks: cinematic-ify (blockbuster + letterbox + grain + vignette)
      add("1) cinematic look render…");
      const look = cinematicify();
      const outLook = await renderEdit(clips, [seg(uuid(), "a", "fade"), seg(uuid(), "b", null)], {
        look, onProgress: () => {},
      });
      const f1 = await framePixels(outLook, 0.5);
      let topBlack = 0;
      for (let y = 0; y < 100; y++) {
        for (let x = 0; x < f1.w; x += 8) {
          const p = (y * f1.w + x) * 4;
          if (f1.data[p] < 16 && f1.data[p + 1] < 16 && f1.data[p + 2] < 16) topBlack++;
        }
      }
      const letterboxOk = topBlack > (100 * (f1.w / 8)) * 0.9;
      add(`   letterbox top rows black: ${letterboxOk ? "YES ✅" : "NO ❌"} (${topBlack})`);
      results.looks = letterboxOk && outLook.size > 20000;

      // 2. motion: ken burns render
      add("2) ken burns motion render…");
      const outKb = await renderEdit(clips, [seg(uuid(), "a", null)], {
        look: { ...look, letterbox: false }, motionDefault: "ken-burns-in", onProgress: () => {},
      });
      const f2 = await framePixels(outKb, 0.5);
      results.motion = f2.w === 720 && f2.h === 1280 && outKb.size > 10000;
      add(`   ${f2.w}x${f2.h}, ${(outKb.size / 1024).toFixed(0)}KB → ${results.motion ? "OK ✅" : "FAIL ❌"}`);

      // 3. overlay: embers via blend=screen must brighten pixels
      add("3) atmosphere overlay…");
      const plainOut = await renderEdit(clips, [seg(uuid(), "a", null)], { colorGrade: "none", onProgress: () => {} });
      const embers = await generateOverlayClip("embers", 2.5);
      const overlayOut = await renderEdit(clips, [seg(uuid(), "a", null)], {
        colorGrade: "none", overlay: { blob: embers, opacity: 0.9 }, onProgress: () => {},
      });
      const fp = await framePixels(plainOut, 0.7);
      const fo = await framePixels(overlayOut, 0.7);
      const bright = (f: { data: Uint8ClampedArray }) => {
        let n = 0;
        for (let i = 0; i < f.data.length; i += 4) {
          if (f.data[i] > 140 && f.data[i + 1] > 70 && f.data[i + 2] < 160) n++;
        }
        return n;
      };
      const gained = bright(fo) - bright(fp);
      results.overlay = gained > 50;
      add(`   bright ember pixels gained: ${gained} → ${results.overlay ? "OK ✅" : "FAIL ❌"}`);

      // 4. score synthesis
      add("4) score composition…");
      const score = await composeScore({ bpm: 120, seconds: 4, mood: "epic" });
      const AC = window.AudioContext;
      const ac = new AC();
      const sbuf = await ac.decodeAudioData(await score.arrayBuffer());
      results.score = Math.abs(sbuf.duration - 4) < 0.2 && sbuf.getChannelData(0).some((v) => Math.abs(v) > 0.05);
      add(`   ${sbuf.duration.toFixed(2)}s, audible=${results.score} → ${results.score ? "OK ✅" : "FAIL ❌"}`);

      // 5. sfx mix: whoosh at 1.0s should show an energy bump there
      add("5) sfx timeline mix…");
      const mixed = await mixTimeline({ seconds: 3, music: null, sfxAt: [{ time: 1.0, type: "impact" }] });
      const mbuf = await ac.decodeAudioData(await mixed.arrayBuffer());
      const d = mbuf.getChannelData(0);
      const energyAt = (t: number) => {
        let e = 0;
        const i0 = Math.floor(t * mbuf.sampleRate);
        for (let i = i0; i < i0 + 4410; i++) e += Math.abs(d[i] || 0);
        return e / 4410;
      };
      const atSfx = energyAt(1.02);
      const before = energyAt(0.4);
      results.sfx = atSfx > before * 3 && atSfx > 0.01;
      add(`   energy@1.0s=${atSfx.toFixed(4)} vs 0.4s=${before.toFixed(4)} → ${results.sfx ? "OK ✅" : "FAIL ❌"}`);
      ac.close();

      // 6. kinetic cues
      add("6) kinetic typography…");
      const cues = await kineticWordCues("WAIT FOR IT", 0, 3);
      results.kinetic = cues.length === 3 && Math.abs(cues[2].end - 3) < 0.05 && cues.every((c) => c.png.size > 500);
      add(`   ${cues.length} word cues, windows ok → ${results.kinetic ? "OK ✅" : "FAIL ❌"}`);

      // 7. intelligence round-trip
      add("7) intelligence suite…");
      const bp: EditBlueprint = {
        id: "t", sourceName: "test", duration: 10,
        transitions: [1, 2, 3, 4.5, 6, 8].map((t, i) => ({ id: `x${i}`, time: t, type: "hard-cut", confidence: 1, durationFrames: 2, description: "" })),
        beats: { bpm: 120, beatTimes: [], energy: "high" },
        style: { colorGrade: "warm", pacing: "fast", avgShotLength: 1.4, aspectRatio: "9:16", notes: [] },
        guide: [], createdAt: 0,
      };
      const plan: EditPlan = {
        segments: [seg("s1", "a", "whip-pan"), seg("s2", "b", "flash"), seg("s3", "a", null)],
        colorGrade: "warm", aiDirection: "", explanation: "",
      };
      const v = viralityScore(plan, bp);
      const p = paceAnalysis(bp);
      const ana = await analyzeClip(clipA, { samplesPerSecond: 4, maxSamples: 20 });
      const co = coldOpenCheck(ana);
      const code = blueprintToCode(bp);
      const back = blueprintFromCode(code);
      results.intel =
        v.score > 0 && v.score <= 100 && p.acts.length === 3 && typeof co.pass === "boolean" &&
        !!back && back.transitions.length === 6 && back.beats?.bpm === 120;
      add(`   virality=${v.score}, acts=${p.acts.length}, code roundtrip=${!!back} → ${results.intel ? "OK ✅" : "FAIL ❌"}`);

      // 8. web sfx loader: real bundled file loads + bogus URL falls back to
      //    synth + mixTimeline actually PLAYS the fetched blob at the cue.
      add("8) web sfx loader + blob mix…");
      const { resolveSfxBlob } = await import("@/lib/sfx-web");
      const real = await resolveSfxBlob("whoosh", ["/sfx/whoosh.wav"]);
      const fell = await resolveSfxBlob("whoosh", ["/sfx/__does_not_exist__.wav"]);
      const ac2 = new window.AudioContext();
      const realBuf = await ac2.decodeAudioData(await real.blob.arrayBuffer());
      const realOk =
        real.source === "/sfx/whoosh.wav" && realBuf.duration > 0.3 &&
        realBuf.getChannelData(0).some((v) => Math.abs(v) > 0.05);
      const fellOk = fell.source === "synth" && fell.blob.size > 256;
      add(`   real file: source=${real.source} dur=${realBuf.duration.toFixed(2)}s audible=${realOk ? "YES ✅" : "NO ❌"}`);
      add(`   bogus URL: source=${fell.source} size=${fell.blob.size} → ${fellOk ? "synth fallback ✅" : "❌"}`);
      const mixedBlob = await mixTimeline({ seconds: 3, music: null, sfxAt: [{ time: 1.0, type: "whoosh", blob: real.blob }] });
      const mb = await ac2.decodeAudioData(await mixedBlob.arrayBuffer());
      const dd = mb.getChannelData(0);
      const eAt = (t: number) => {
        let e = 0;
        const i0 = Math.floor(t * mb.sampleRate);
        for (let i = i0; i < i0 + 4410; i++) e += Math.abs(dd[i] || 0);
        return e / 4410;
      };
      const blobEnergy = eAt(1.1);
      const quiet = eAt(0.4);
      const mixOk = blobEnergy > quiet * 2 && blobEnergy > 0.004;
      add(`   blob mix energy@1.0s=${blobEnergy.toFixed(4)} vs 0.4s=${quiet.toFixed(4)} → ${mixOk ? "OK ✅" : "FAIL ❌"}`);
      ac2.close();
      results.websfx = realOk && fellOk && mixOk;

      const all = Object.values(results).every(Boolean);
      add(all ? "\nALL CINEMATIC CHECKS PASS ✅" : "\nSOME FAILED ❌ " + JSON.stringify(results));
      setPass(all);
      (window as unknown as { cineTest: unknown }).cineTest = { results, pass: all };
    })().catch((e) => {
      add("FATAL: " + String(e).slice(0, 300));
      setPass(false);
      (window as unknown as { cineTest: unknown }).cineTest = { pass: false, error: String(e) };
    });
  }, []);

  return (
    <main className="p-6 font-mono text-xs">
      <h1 className="mb-3 text-sm font-bold">
        cinematic test — {pass === null ? "running…" : pass ? "PASS ✅" : "FAIL ❌"}
      </h1>
      <pre className="whitespace-pre-wrap">{log.join("\n")}</pre>
    </main>
  );
}
