"use client";

// Dev utility: pulls /review.mp4 from public/, extracts frames at fixed
// timestamps with the WASM ffmpeg, exposes them as base64 on window.
import { useEffect, useState } from "react";
import { getFFmpeg } from "@/lib/ffmpeg-client";

export default function FrameDump() {
  const [status, setStatus] = useState("running…");
  useEffect(() => {
    (async () => {
      const ff = await getFFmpeg();
      const res = await fetch("/review.mp4");
      const buf = new Uint8Array(await res.arrayBuffer());
      await ff.writeFile("r.mp4", buf);
      const out: Record<string, string> = {};
      for (const t of [1.0, 3.5, 7.0, 10.5, 13.0]) {
        const code = await ff.exec(["-i", "r.mp4", "-ss", String(t), "-frames:v", "1", "-update", "1", "-y", "f.png"]);
        if (code === 0) {
          try {
            const d = (await ff.readFile("f.png")) as Uint8Array;
            let bin = "";
            for (let i = 0; i < d.length; i++) bin += String.fromCharCode(d[i]);
            out["t" + t] = btoa(bin);
            await ff.deleteFile("f.png");
          } catch { /* missing frame */ }
        }
      }
      (window as unknown as { dumpResult: Record<string, string> }).dumpResult = out;
      setStatus("done: " + Object.keys(out).join(","));
    })().catch((e) => setStatus("fatal " + e));
  }, []);
  return <pre className="p-6 text-xs">{status}</pre>;
}
