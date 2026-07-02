"use client";

// Dev diagnostic: verifies every transition in the library actually renders
// with the bundled FFmpeg WASM core, using the app's own wrapper.
// Visit /dev/xfade — results land in the table and on window.testResults.
import { useEffect, useState } from "react";
import { getFFmpeg } from "@/lib/ffmpeg-client";
import { TRANSITIONS } from "@/lib/transitions";

declare global {
  interface Window {
    testResults: Record<string, string> | null;
  }
}

export default function XfadeTestPage() {
  const [results, setResults] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("loading ffmpeg…");

  useEffect(() => {
    window.testResults = null;
    (async () => {
      const ff = await getFFmpeg();
      setStatus("generating test clips…");
      let rc = await ff.exec(["-f", "lavfi", "-i", "color=red:size=180x320:rate=15:duration=1", "-pix_fmt", "yuv420p", "a.mp4"]);
      rc += await ff.exec(["-f", "lavfi", "-i", "color=blue:size=180x320:rate=15:duration=1", "-pix_fmt", "yuv420p", "b.mp4"]);
      if (rc !== 0) {
        window.testResults = { setup: "failed" };
        setStatus("setup failed");
        return;
      }
      const names = Array.from(
        new Set(TRANSITIONS.map((t) => t.xfade).filter((x): x is string => !!x))
      );
      const out: Record<string, string> = {};
      for (const n of names) {
        setStatus(`testing ${n}…`);
        try {
          const code = await ff.exec([
            "-i", "a.mp4", "-i", "b.mp4",
            "-filter_complex", `[0:v][1:v]xfade=transition=${n}:duration=0.4:offset=0.5,format=yuv420p[v]`,
            "-map", "[v]", "-y", "out.mp4",
          ]);
          let size = 0;
          if (code === 0) {
            const d = (await ff.readFile("out.mp4")) as Uint8Array;
            size = d.byteLength;
            await ff.deleteFile("out.mp4");
          }
          out[n] = code === 0 && size > 500 ? "ok" : `fail(code=${code},size=${size})`;
        } catch (e) {
          out[n] = `throw:${String(e).slice(0, 60)}`;
        }
        setResults({ ...out });
      }
      window.testResults = out;
      setStatus("done");
    })().catch((e) => {
      window.testResults = { fatal: String(e) };
      setStatus(`fatal: ${e}`);
    });
  }, []);

  return (
    <main className="p-6 font-mono text-sm">
      <h1 className="mb-4 font-bold">xfade support test — {status}</h1>
      <table>
        <tbody>
          {Object.entries(results).map(([k, v]) => (
            <tr key={k}>
              <td className="pr-6">{k}</td>
              <td className={v === "ok" ? "text-green-500" : "text-red-500"}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
