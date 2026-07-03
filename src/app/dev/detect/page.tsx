"use client";

// Ground-truth accuracy test for detection v2.
// We render an edit with KNOWN transitions at KNOWN times using the app's
// own renderer, then require the detector to recover them. Scores:
//   recall   — % of true cuts found within ±0.25s
//   posErr   — mean |detected - true| for matched cuts
//   typeAcc  — % of matched cuts with the right transition type
//   falsePos — detections with no true cut nearby
import { useEffect, useState } from "react";
import { v4 as uuid } from "uuid";
import { renderEdit, getFFmpeg } from "@/lib/ffmpeg-client";
import { detectTransitionsV2 } from "@/lib/detect";
import { transitionByType } from "@/lib/transitions";
import type { TimelineSegment, TransitionType } from "@/lib/types";

// Textured, structured scenes — SAD flow and block analysis need real
// visual structure, like actual footage has.
async function makeTexturedClip(seed: number, seconds: number): Promise<Blob> {
  const W = 360, H = 640;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const hue = (seed * 67) % 360;
  const rec = new MediaRecorder(c.captureStream(30), { mimeType: "video/webm;codecs=vp8", videoBitsPerSecond: 4_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
  rec.start(100);
  const t0 = performance.now();
  await new Promise<void>((done) => {
    function f() {
      const t = (performance.now() - t0) / 1000;
      if (t >= seconds) return done();
      // background gradient distinct per scene
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, `hsl(${hue},45%,28%)`);
      g.addColorStop(1, `hsl(${(hue + 60) % 360},40%,14%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      // textured grid of blobs (structure for block/flow analysis)
      for (let i = 0; i < 40; i++) {
        const px = ((i * 97 + seed * 31) % W) + Math.sin(t * 1.2 + i) * 6;
        const py = ((i * 173 + seed * 57) % H) + Math.cos(t * 0.9 + i) * 5;
        ctx.fillStyle = `hsla(${(hue + (i % 5) * 14) % 360},65%,${30 + (i % 4) * 12}%,0.85)`;
        ctx.beginPath();
        ctx.arc(px, py, 10 + (i % 5) * 6, 0, Math.PI * 2);
        ctx.fill();
      }
      // a moving subject
      ctx.fillStyle = "#f0ede2";
      const sx = W / 2 + Math.sin(t * 0.8 + seed) * 70;
      const sy = H / 2 + Math.cos(t * 0.6 + seed) * 90;
      ctx.beginPath();
      ctx.arc(sx, sy, 34, 0, Math.PI * 2);
      ctx.fill();
      requestAnimationFrame(f);
    }
    f();
  });
  rec.stop();
  await stopped;
  return new Blob(chunks, { type: "video/webm" });
}

export default function DetectTest() {
  const [log, setLog] = useState<string[]>([]);
  const [pass, setPass] = useState<boolean | null>(null);
  const add = (s: string) => setLog((l) => [...l, s]);

  useEffect(() => {
    (async () => {
      // ---- build the known edit
      add("building ground-truth edit…");
      const plan: { len: number; tr: TransitionType | null }[] = [
        { len: 1.8, tr: "hard-cut" },
        { len: 1.7, tr: "fade" },
        { len: 1.9, tr: "whip-pan" },
        { len: 1.6, tr: "flash" },
        { len: 1.8, tr: "zoom-in" },
        { len: 1.7, tr: "hard-cut" },
        { len: 1.8, tr: null },
      ];
      const clips = new Map<string, Blob>();
      const segments: TimelineSegment[] = [];
      for (let i = 0; i < plan.length; i++) {
        const blob = await makeTexturedClip(i + 1, plan[i].len + 0.5);
        const id = `c${i}`;
        clips.set(id, blob);
        segments.push({ id: uuid(), clipId: id, start: 0.1, end: 0.1 + plan[i].len, transitionAfter: plan[i].tr, speed: 1 });
        add(`  clip ${i + 1}/${plan.length} filmed`);
      }

      // expected cut midpoints in the OUTPUT timeline
      const expected: { time: number; type: TransitionType }[] = [];
      let cum = 0;
      let overlap = 0;
      for (let i = 0; i < plan.length - 1; i++) {
        cum += plan[i].len;
        const r = transitionByType(plan[i].tr ?? "hard-cut");
        const d = plan[i].tr && r.xfade ? r.defaultDuration : 0;
        expected.push({ time: cum - overlap - d / 2, type: plan[i].tr! });
        overlap += d;
      }

      add("rendering with the app's own renderer…");
      const out = await renderEdit(clips, segments, { colorGrade: "none", onProgress: () => {} });
      add(`rendered ${(out.size / 1024).toFixed(0)} KB; expected cuts: ${expected.map((e) => `${e.type}@${e.time.toFixed(2)}`).join(", ")}`);

      // Headless Chromium can't decode H.264 — transcode to VP8 so the
      // detector's <video> sampler works IN THIS TEST. Real browsers decode
      // the mp4 directly; pixels are the same content either way.
      add("transcoding for the test browser (vp8)…");
      const ff = await getFFmpeg();
      const { fetchFile } = await import("@ffmpeg/util");
      await ff.writeFile("gt.mp4", await fetchFile(out));
      const tcode = await ff.exec(["-i", "gt.mp4", "-c:v", "libvpx", "-b:v", "3M", "-auto-alt-ref", "0", "-y", "gt.webm"]);
      if (tcode !== 0) throw new Error("vp8 transcode failed");
      const webm = new Blob([((await ff.readFile("gt.webm")) as Uint8Array).slice().buffer], { type: "video/webm" });
      await ff.deleteFile("gt.mp4").catch(() => {});
      await ff.deleteFile("gt.webm").catch(() => {});

      // ---- run the detector
      add("running detection v2…");
      const det = await detectTransitionsV2(webm, (pct, msg) => {
        if (pct % 25 === 0) add(`  ${msg}`);
      });
      add(`detected: ${det.transitions.map((t) => `${t.type}@${t.time}`).join(", ") || "(none)"}`);

      // ---- score
      const TOL = 0.3;
      let matched = 0;
      let typeOk = 0;
      let posErrSum = 0;
      const usedDet = new Set<number>();
      for (const exp of expected) {
        let best = -1;
        let bestD = TOL;
        det.transitions.forEach((d, i) => {
          if (usedDet.has(i)) return;
          const dd = Math.abs(d.time - exp.time);
          if (dd < bestD) {
            bestD = dd;
            best = i;
          }
        });
        if (best >= 0) {
          usedDet.add(best);
          matched++;
          posErrSum += bestD;
          if (det.transitions[best].type === exp.type) typeOk++;
          else add(`  type miss @${exp.time.toFixed(2)}: expected ${exp.type}, got ${det.transitions[best].type}`);
        } else {
          add(`  MISSED cut @${exp.time.toFixed(2)} (${exp.type})`);
        }
      }
      const falsePos = det.transitions.length - usedDet.size;
      const recall = matched / expected.length;
      const typeAcc = matched ? typeOk / matched : 0;
      const posErr = matched ? posErrSum / matched : 99;

      add("");
      add(`recall:   ${(recall * 100).toFixed(0)}% (${matched}/${expected.length})`);
      add(`typeAcc:  ${(typeAcc * 100).toFixed(0)}% (${typeOk}/${matched})`);
      add(`posErr:   ${(posErr * 1000).toFixed(0)}ms`);
      add(`falsePos: ${falsePos}`);

      const ok = recall >= 0.85 && typeAcc >= 0.65 && posErr < 0.2 && falsePos <= 2;
      add(ok ? "\nGROUND-TRUTH PASS ✅" : "\nFAIL ❌");
      setPass(ok);
      (window as unknown as { detectResult: unknown }).detectResult = { recall, typeAcc, posErr, falsePos, pass: ok };
    })().catch((e) => {
      add("FATAL: " + String(e).slice(0, 300));
      setPass(false);
      (window as unknown as { detectResult: unknown }).detectResult = { pass: false, error: String(e) };
    });
  }, []);

  return (
    <main className="p-6 font-mono text-xs">
      <h1 className="mb-3 text-sm font-bold">
        detection ground truth — {pass === null ? "running…" : pass ? "PASS ✅" : "FAIL ❌"}
      </h1>
      <pre className="whitespace-pre-wrap">{log.join("\n")}</pre>
    </main>
  );
}
