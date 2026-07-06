"use client";

// Dev probe: the AI subject tools' render constructs, run against the REAL
// bundled WASM core with the REAL filter strings the libs emit —
//   1. chromakey (bare -vf)
//   2. chromaComplex color-bg form (color source + overlay + [v] map)
//   3. chromaComplex blur-bg form (split + boxblur + overlay)
//   4. trackCropFilter's animated crop (nested-if piecewise expression)
//   5. facePunchFilter's zoompan (face-targeted x/y expressions)
// plus a PIXEL check that keying really removes green: a green frame with a
// red center box keyed over blue must come out blue in the corner and red in
// the middle.
import { useEffect, useState } from "react";
import { getFFmpeg } from "@/lib/ffmpeg-client";
import { chromaComplex, DEFAULT_CHROMA } from "@/lib/chroma";
import { trackCropFilter, facePunchFilter, type TrackPath } from "@/lib/track-core";

// A plausible smoothed face path: drifts left→right over 2s in a 16:9 frame
const PATH: TrackPath = {
  mode: "face",
  duration: 2,
  aspect: 16 / 9,
  times: [0, 0.5, 1.0, 1.5, 2.0],
  cx: [0.3, 0.38, 0.5, 0.62, 0.7],
  cy: [0.4, 0.4, 0.42, 0.44, 0.44],
  size: [0.3, 0.3, 0.3, 0.3, 0.3],
  quality: 0.9,
};

export default function SubjectProbe() {
  const [out, setOut] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("running…");

  useEffect(() => {
    (async () => {
      const ff = await getFFmpeg();
      const r: Record<string, string> = {};
      const report = (k: string, v: string) => {
        r[k] = v;
        setOut({ ...r });
      };

      // sources: a landscape test clip, and a green screen with a red box
      await ff.exec(["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=15:duration=2", "-pix_fmt", "yuv420p", "-y", "land.mp4"]);
      await ff.exec([
        "-f", "lavfi", "-i", "color=c=0x00ff00:size=320x568:rate=15:duration=1",
        "-vf", "drawbox=x=110:y=234:w=100:h=100:color=red:t=fill",
        "-pix_fmt", "yuv420p", "-y", "green.mp4",
      ]);

      const run = async (name: string, args: string[], minSize = 300) => {
        try {
          const code = await ff.exec(args);
          let size = 0;
          if (code === 0) {
            const d = (await ff.readFile("o.mp4")) as Uint8Array;
            size = d.byteLength;
            await ff.deleteFile("o.mp4");
          }
          report(name, code === 0 && size > minSize ? "ok" : `fail(${code},${size}b)`);
        } catch (e) {
          report(name, "throw:" + String(e).slice(0, 60));
        }
      };

      // 1. bare chromakey
      await run("chromakey", ["-i", "green.mp4", "-vf", "chromakey=0x00ff00:0.18:0.06", "-frames:v", "5", "-y", "o.mp4"]);

      // 2. chromaComplex — color background (the exact renderEdit branch)
      const core = "trim=start=0:end=1,setpts=PTS-STARTPTS,scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=30";
      const post = "eq=contrast=1.05,format=yuv420p";
      const fcColor = chromaComplex({ ...DEFAULT_CHROMA, color: "#00ff00", bg: "studio" }, core, post, 1);
      await run("chroma_color_bg", ["-i", "green.mp4", "-filter_complex", fcColor, "-map", "[v]", "-frames:v", "5", "-y", "o.mp4"]);

      // 3. chromaComplex — blur (bokeh) background
      const fcBlur = chromaComplex({ ...DEFAULT_CHROMA, color: "#00ff00", bg: "blur" }, core, post, 1);
      await run("chroma_blur_bg", ["-i", "green.mp4", "-filter_complex", fcBlur, "-map", "[v]", "-frames:v", "5", "-y", "o.mp4"]);

      // 4. animated follow crop from a real path (piecewise t-expression)
      const crop = trackCropFilter(PATH, { start: 0.2, end: 1.8, speed: 1 });
      if (!crop) {
        report("track_crop", "fail(empty filter)");
      } else {
        await run("track_crop", [
          "-i", "land.mp4",
          "-vf", `trim=start=0.2:end=1.8,setpts=PTS-STARTPTS,${crop},scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280`,
          "-frames:v", "8", "-y", "o.mp4",
        ]);
      }

      // 5. face punch-in zoompan (pre chain scales; post zooms toward the face)
      const punch = facePunchFilter({ cx: 0.62, cy: 0.4 }, 1.6);
      await run("face_punch", [
        "-i", "land.mp4",
        "-vf", `${punch.pre},${punch.post}`,
        "-frames:v", "8", "-y", "o.mp4",
      ]);

      // 6. PIXEL check: key green over blue, dump 1 frame as PNG, verify the
      // corner turned blue (green gone) and the red box survived.
      try {
        const fc = chromaComplex({ ...DEFAULT_CHROMA, color: "#00ff00", bg: "#0000ff" }, "scale=320:568", "format=yuv420p", 1);
        const code = await ff.exec(["-i", "green.mp4", "-filter_complex", fc, "-map", "[v]", "-frames:v", "1", "-y", "frame.png"]);
        if (code !== 0) throw new Error("exec " + code);
        const png = (await ff.readFile("frame.png")) as Uint8Array;
        await ff.deleteFile("frame.png");
        const buf = new ArrayBuffer(png.byteLength);
        new Uint8Array(buf).set(png);
        const bmp = await createImageBitmap(new Blob([buf], { type: "image/png" }));
        const c = document.createElement("canvas");
        c.width = bmp.width;
        c.height = bmp.height;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(bmp, 0, 0);
        const corner = ctx.getImageData(4, 4, 1, 1).data; // was green → must be blue
        const center = ctx.getImageData(160, 284, 1, 1).data; // red box → must stay red
        const cornerBlue = corner[2] > 150 && corner[1] < 90 && corner[0] < 90;
        const centerRed = center[0] > 150 && center[1] < 90 && center[2] < 90;
        report(
          "chroma_pixels",
          cornerBlue && centerRed
            ? "ok"
            : `fail(corner=${[...corner.slice(0, 3)]} center=${[...center.slice(0, 3)]})`
        );
      } catch (e) {
        report("chroma_pixels", "throw:" + String(e).slice(0, 60));
      }

      setStatus("done");
      (window as unknown as { subjectResults: Record<string, string> }).subjectResults = r;
    })().catch((e) => setStatus("fatal: " + e));
  }, []);

  return (
    <main className="p-6 font-mono text-xs">
      <h1 className="mb-3 text-sm font-bold">AI subject tools probe — {status}</h1>
      {Object.entries(out).map(([k, v]) => (
        <div key={k}>
          {k}: <span className={v === "ok" ? "text-green-500" : "text-red-500"}>{v}</span>
        </div>
      ))}
    </main>
  );
}
