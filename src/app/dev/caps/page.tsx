"use client";

// Dev probe: which caption-burn strategy does the bundled WASM core support?
//  A) drawtext (needs libfreetype — often absent in ffmpeg.wasm builds)
//  B) overlay of a canvas-rendered PNG, time-gated with enable=between()
// Whichever passes decides how we burn captions. Visit /dev/caps.
import { useEffect, useState } from "react";
import { getFFmpeg } from "@/lib/ffmpeg-client";
import { fetchFile } from "@ffmpeg/util";

export default function CapsProbe() {
  const [out, setOut] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const ff = await getFFmpeg();
      const r: Record<string, string> = {};

      // base clip
      const base = await ff.exec([
        "-f", "lavfi", "-i", "color=teal:size=240x426:rate=15:duration=1",
        "-pix_fmt", "yuv420p", "-y", "base.mp4",
      ]);
      r.base = base === 0 ? "ok" : `fail(${base})`;

      // A) drawtext
      try {
        const code = await ff.exec([
          "-i", "base.mp4",
          "-vf", "drawtext=text='HELLO':fontcolor=white:fontsize=40:x=20:y=20",
          "-y", "dt.mp4",
        ]);
        let size = 0;
        if (code === 0) { const d = (await ff.readFile("dt.mp4")) as Uint8Array; size = d.byteLength; }
        r.drawtext = code === 0 && size > 500 ? "ok" : `fail(code=${code},size=${size})`;
      } catch (e) { r.drawtext = "throw:" + String(e).slice(0, 50); }

      // B) overlay of a PNG made in canvas, time-gated
      try {
        const c = document.createElement("canvas");
        c.width = 240; c.height = 120;
        const ctx = c.getContext("2d")!;
        ctx.font = "700 40px sans-serif";
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 6;
        ctx.strokeText("HELLO", 20, 70);
        ctx.fillText("HELLO", 20, 70);
        const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), "image/png"));
        await ff.writeFile("cap.png", await fetchFile(blob));
        const code = await ff.exec([
          "-i", "base.mp4", "-i", "cap.png",
          "-filter_complex", "[0:v][1:v]overlay=x=0:y=H-h-10:enable='between(t,0.2,0.8)'[v]",
          "-map", "[v]", "-y", "ov.mp4",
        ]);
        let size = 0;
        if (code === 0) { const d = (await ff.readFile("ov.mp4")) as Uint8Array; size = d.byteLength; }
        r.overlayPng = code === 0 && size > 500 ? "ok" : `fail(code=${code},size=${size})`;
      } catch (e) { r.overlayPng = "throw:" + String(e).slice(0, 50); }

      setOut(r);
      (window as unknown as { capsResult: Record<string, string> }).capsResult = r;
    })().catch((e) => setOut({ fatal: String(e) }));
  }, []);

  return (
    <main className="p-6 font-mono text-sm">
      <h1 className="mb-3 font-bold">caption-burn probe</h1>
      {Object.entries(out).map(([k, v]) => (
        <div key={k}>
          {k}: <span className={v === "ok" ? "text-green-500" : "text-red-500"}>{v}</span>
        </div>
      ))}
    </main>
  );
}
