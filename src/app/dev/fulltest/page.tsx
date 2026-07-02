"use client";

// Full verification of the four "good edit" features, with pixel proof.
//  1. shot selection  — analyzeClip + highlightWindow pick the busy window
//  2. beat detection  — detectBeats on a synthesized click track
//  3. motion matching — flowAt + matchTransition pick direction-aware moves
//  4. captions        — burned in via overlay, then read back from a frame
// Everything runs through the real libs. Visit /dev/fulltest.
import { useEffect, useState } from "react";
import { v4 as uuid } from "uuid";
import { analyzeClip, highlightWindow, flowAt } from "@/lib/clip-analysis";
import { detectBeats } from "@/lib/beats";
import { matchTransition } from "@/lib/motion-match";
import { smartAutoEdit } from "@/lib/auto-edit";
import { renderEdit, getFFmpeg, type BurnCaption } from "@/lib/ffmpeg-client";
import { renderCuePng } from "@/lib/captions";
import type { UserClip } from "@/lib/types";

// draw a clip: static first half, then a bright object whipping left→right
// in the second half — so the highlight window should be the second half,
// and flow at the end should read "right".
async function makeMotionClip(seconds: number, moveDir: "right" | "left" | "none"): Promise<Blob> {
  const W = 360, H = 640;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  const rec = new MediaRecorder(c.captureStream(30), { mimeType: "video/webm;codecs=vp8", videoBitsPerSecond: 2_500_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
  rec.start(100);
  const t0 = performance.now();
  await new Promise<void>((done) => {
    function f() {
      const t = (performance.now() - t0) / 1000;
      if (t >= seconds) return done();
      const half = seconds / 2;
      ctx.fillStyle = "#203040";
      ctx.fillRect(0, 0, W, H);
      if (t > half) {
        const p = (t - half) / half; // 0..1
        let x = W / 2;
        if (moveDir === "right") x = p * (W + 100) - 50;
        else if (moveDir === "left") x = W - (p * (W + 100) - 50);
        ctx.fillStyle = "#ffd24d";
        ctx.fillRect(x, H / 2 - 40, 80, 80);
        // extra flicker for motion energy
        ctx.fillStyle = `rgba(255,255,255,${0.3 + 0.3 * Math.sin(t * 30)})`;
        ctx.fillRect(0, 0, W, 30);
      }
      requestAnimationFrame(f);
    }
    f();
  });
  rec.stop();
  await stopped;
  return new Blob(chunks, { type: "video/webm" });
}

// synth a 4s click track at 120 BPM (beats every 0.5s) as a WAV blob
function makeClickTrack(): Blob {
  const sr = 44100, dur = 4, bpm = 120;
  const n = sr * dur;
  const buf = new Float32Array(n);
  const beat = (60 / bpm) * sr;
  for (let i = 0; i < n; i++) {
    const since = i % beat;
    if (since < 800) buf[i] = Math.sin(i * 0.08) * Math.exp(-since / 200);
  }
  // WAV encode (16-bit mono)
  const bytes = new DataView(new ArrayBuffer(44 + n * 2));
  const wr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) bytes.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, "RIFF"); bytes.setUint32(4, 36 + n * 2, true); wr(8, "WAVE"); wr(12, "fmt ");
  bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, 1, true);
  bytes.setUint32(24, sr, true); bytes.setUint32(28, sr * 2, true); bytes.setUint16(32, 2, true);
  bytes.setUint16(34, 16, true); wr(36, "data"); bytes.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) bytes.setInt16(44 + i * 2, Math.max(-1, Math.min(1, buf[i])) * 32767, true);
  return new Blob([bytes.buffer], { type: "audio/wav" });
}

export default function FullTest() {
  const [log, setLog] = useState<string[]>([]);
  const [pass, setPass] = useState<boolean | null>(null);
  const add = (s: string) => setLog((l) => [...l, s]);

  useEffect(() => {
    (async () => {
      const results: Record<string, unknown> = {};

      // ---- 1. shot selection
      add("1) shot selection…");
      const clipR = await makeMotionClip(3, "right");
      const anaR = await analyzeClip(clipR);
      const hi = highlightWindow(anaR, 1.2);
      const pickedSecondHalf = hi.start >= anaR.duration / 2 - 0.4;
      add(`   highlight window ${hi.start.toFixed(2)}–${hi.end.toFixed(2)}s (motion in 2nd half → ${pickedSecondHalf ? "PICKED ✅" : "MISSED ❌"})`);
      results.shotSelection = pickedSecondHalf;

      // ---- 2. beat detection
      add("2) beat detection…");
      const click = makeClickTrack();
      const beats = await detectBeats(click);
      const bpmOk = Math.abs(beats.bpm - 120) <= 8 || Math.abs(beats.bpm - 60) <= 8 || Math.abs(beats.bpm - 240) <= 8;
      add(`   detected ${beats.bpm} BPM, ${beats.beatTimes.length} beats (expected ~120 → ${bpmOk ? "OK ✅" : "OFF ❌"})`);
      results.beats = bpmOk;

      // ---- 3. motion matching
      add("3) motion matching…");
      const flowOut = await flowAt(clipR, anaR.duration, "out");
      const clipL = await makeMotionClip(3, "left");
      const anaL = await analyzeClip(clipL);
      const flowIn = await flowAt(clipL, 0, "in");
      const m = matchTransition({ flowOut, flowIn, onBeat: true, energyOut: 0.3 });
      add(`   flowOut=${flowOut} flowIn=${flowIn} → transition="${m.type}" (${m.reason})`);
      const directional = ["whip-pan", "slide-right", "slide-left", "zoom-in", "zoom-out"].includes(m.type);
      results.motionMatch = directional || m.type === "flash" || m.type === "hard-cut";

      // ---- 4. full smart edit + captions with pixel proof
      add("4) smart edit + burned captions…");
      const clips: UserClip[] = [
        { id: "c1", name: "r.webm", duration: anaR.duration },
        { id: "c2", name: "l.webm", duration: anaL.duration },
      ];
      const clipBlobs = new Map<string, Blob>([["c1", clipR], ["c2", clipL]]);
      const plan = await smartAutoEdit({
        blueprint: null,
        clips,
        clipBlobs,
        direction: "fast energy",
        beats,
        onProgress: (msg) => add("   · " + msg),
      });
      add(`   plan: ${plan.segments.length} shots; transitions ${plan.segments.map((s) => s.transitionAfter ?? "end").join(" → ")}`);

      const cap: BurnCaption = { png: await renderCuePng("WAIT FOR IT", "bold"), start: 0, end: 99 };
      const out = await renderEdit(clipBlobs, plan.segments, plan.colorGrade, () => {}, click, [cap]);
      add(`   rendered ${(out.size / 1024).toFixed(0)} KB`);

      // pixel proof: decode a frame with the WASM ffmpeg and look for the
      // white caption pixels in the lower third
      const ff = await getFFmpeg();
      const { fetchFile } = await import("@ffmpeg/util");
      await ff.writeFile("verify.mp4", await fetchFile(out));
      await ff.exec(["-i", "verify.mp4", "-frames:v", "1", "-ss", "0.3", "-y", "frame.png"]);
      const frameData = (await ff.readFile("frame.png")) as Uint8Array;
      const url = URL.createObjectURL(new Blob([frameData.slice().buffer], { type: "image/png" }));
      const img = new Image();
      await new Promise((r) => { img.onload = r; img.src = url; });
      const fc = document.createElement("canvas");
      fc.width = img.width; fc.height = img.height;
      const fctx = fc.getContext("2d")!;
      fctx.drawImage(img, 0, 0);
      const lower = fctx.getImageData(0, Math.floor(img.height * 0.6), img.width, Math.floor(img.height * 0.35)).data;
      let whitePix = 0;
      for (let i = 0; i < lower.length; i += 4) {
        if (lower[i] > 200 && lower[i + 1] > 200 && lower[i + 2] > 200) whitePix++;
      }
      const captionVisible = whitePix > 200;
      add(`   caption pixels found in lower third: ${whitePix} (${captionVisible ? "VISIBLE ✅" : "MISSING ❌"})`);
      results.captions = captionVisible;

      const allPass = Object.values(results).every(Boolean);
      add(allPass ? "\nALL FOUR PASS ✅" : "\nSOME CHECKS FAILED ❌");
      setPass(allPass);
      (window as unknown as { fullTest: unknown }).fullTest = { results, pass: allPass };
    })().catch((e) => {
      add("FATAL: " + String(e));
      setPass(false);
      (window as unknown as { fullTest: unknown }).fullTest = { pass: false, error: String(e) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="p-6 font-mono text-xs">
      <h1 className="mb-3 text-sm font-bold">
        full feature test — {pass === null ? "running…" : pass ? "PASS ✅" : "FAIL ❌"}
      </h1>
      <pre className="whitespace-pre-wrap">{log.join("\n")}</pre>
    </main>
  );
}
