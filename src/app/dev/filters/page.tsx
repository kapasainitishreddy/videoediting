"use client";

// Dev probe: which cinematic filters exist in the bundled WASM core?
// Everything the looks/motion engines use must pass here first.
import { useEffect, useState } from "react";
import { getFFmpeg } from "@/lib/ffmpeg-client";

const CANDIDATES: Record<string, string> = {
  vignette: "vignette=PI/5",
  noise: "noise=alls=12:allf=t",
  curves: "curves=preset=increase_contrast",
  colorbalance: "colorbalance=rm=0.1",
  colorchannelmixer: "colorchannelmixer=rr=0.9:gg=1.0:bb=1.1",
  colortemperature: "colortemperature=temperature=4500",
  hqdn3d: "hqdn3d=4:3:6:4",
  unsharp: "unsharp=5:5:0.8",
  gblur: "gblur=sigma=8",
  boxblur: "boxblur=4:1",
  deshake: "deshake",
  zoompan: "zoompan=z='1.1':d=25:s=240x426",
  chromashift: "chromashift=cbh=4:crh=-4",
  rgbashift: "rgbashift=rh=3:bh=-3",
  lenscorrection: "lenscorrection=k1=-0.2:k2=-0.02",
  pad: "pad=240:520:0:47:black",
  drawbox: "drawbox=x=0:y=0:w=240:h=40:color=black:t=fill",
  tblend: "tblend=all_mode=average",
  minterpolate: "minterpolate=fps=30",
  rotate: "rotate=0.05",
  hue: "hue=h=20:s=1.2",
  eq: "eq=contrast=1.2",
  crop_expr: "crop=200:380:'10+5*sin(t)':'10'",
  scale: "scale=240:426",
  fade: "fade=in:0:10",
  vibrance: "vibrance=intensity=0.3",
  chromahold: "chromahold=color=green",
  selectivecolor: "selectivecolor=reds=0.1 0 0 0",
  exposure: "exposure=exposure=0.4",
  lut3d_missing_ok: "eq=gamma=1.0",
};

const BLENDS: Record<string, string> = {
  blend_screen: "blend=all_mode=screen",
  blend_overlay: "blend=all_mode=overlay",
  blend_softlight: "blend=all_mode=softlight",
  blend_lighten: "blend=all_mode=lighten",
};

export default function FiltersProbe() {
  const [out, setOut] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("running…");

  useEffect(() => {
    (async () => {
      const ff = await getFFmpeg();
      const r: Record<string, string> = {};
      await ff.exec(["-f", "lavfi", "-i", "testsrc2=size=240x426:rate=15:duration=0.6", "-pix_fmt", "yuv420p", "-y", "in.mp4"]);
      await ff.exec(["-f", "lavfi", "-i", "testsrc=size=240x426:rate=15:duration=0.6", "-pix_fmt", "yuv420p", "-y", "in2.mp4"]);

      for (const [name, vf] of Object.entries(CANDIDATES)) {
        try {
          const code = await ff.exec(["-i", "in.mp4", "-vf", vf, "-frames:v", "5", "-y", "o.mp4"]);
          let size = 0;
          if (code === 0) {
            const d = (await ff.readFile("o.mp4")) as Uint8Array;
            size = d.byteLength;
            await ff.deleteFile("o.mp4");
          }
          r[name] = code === 0 && size > 300 ? "ok" : `fail(${code})`;
        } catch {
          r[name] = "throw";
        }
        setOut({ ...r });
      }
      for (const [name, fc] of Object.entries(BLENDS)) {
        try {
          const code = await ff.exec([
            "-i", "in.mp4", "-i", "in2.mp4",
            "-filter_complex", `[0:v][1:v]${fc}[v]`,
            "-map", "[v]", "-frames:v", "5", "-y", "o.mp4",
          ]);
          let size = 0;
          if (code === 0) {
            const d = (await ff.readFile("o.mp4")) as Uint8Array;
            size = d.byteLength;
            await ff.deleteFile("o.mp4");
          }
          r[name] = code === 0 && size > 300 ? "ok" : `fail(${code})`;
        } catch {
          r[name] = "throw";
        }
        setOut({ ...r });
      }
      setStatus("done");
      (window as unknown as { filterResults: Record<string, string> }).filterResults = r;
    })().catch((e) => setStatus("fatal: " + e));
  }, []);

  return (
    <main className="p-6 font-mono text-xs">
      <h1 className="mb-3 text-sm font-bold">filter probe — {status}</h1>
      {Object.entries(out).map(([k, v]) => (
        <div key={k}>
          {k}: <span className={v === "ok" ? "text-green-500" : "text-red-500"}>{v}</span>
        </div>
      ))}
    </main>
  );
}
