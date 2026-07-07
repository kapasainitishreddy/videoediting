"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Camera, Check, Clapperboard, Copy, Download, FileText, ListOrdered, Pencil, RotateCcw, Share2, Volume2 } from "lucide-react";
import { useProject } from "@/store/project";
import { getRenderedVideo } from "@/lib/storage";
import { cropAspect, bestFrame, type ExportAspect } from "@/lib/export-kit";
import { chapterMarkers } from "@/lib/retention";
import { socialCaption } from "@/lib/creator-kit";
import { reportError } from "@/lib/report-error";
import { pickThumbCandidates, type FrameStats, type ThumbScore } from "@/lib/thumb-score";
import { detectFaceInFrame } from "@/lib/track-core";
import { attributionText, licenseAudit } from "@/lib/media-trust";
import { showNotes } from "@/lib/creator-growth";
import { canSpeak, speakLines, stopSpeaking } from "@/lib/share-a11y";

export default function ExportPage() {
  const router = useRouter();
  const { renderedUrl, setRenderedUrl, plan, clips, blueprint, assets } = useProject();
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [toolError, setToolError] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<(ThumbScore & { dataUrl: string })[]>([]);
  const [speaking, setSpeaking] = useState(false);
  // Only tracks the genuinely async branch (the IndexedDB lookup after a
  // reload). When renderedUrl is already set, "ready" is derived directly
  // from props during render below — no effect/state needed for that case.
  const [recovery, setRecovery] = useState<"checking" | "missing" | null>(renderedUrl ? null : "checking");

  useEffect(() => {
    if (renderedUrl) return; // nothing to recover — derived state below handles it
    // The store's renderedUrl (a blob: URL) always dies on reload — that's
    // expected, not an error. Before giving up, check IndexedDB for the
    // actual render bytes the editor saved and rebuild a fresh URL.
    let cancelled = false;
    (async () => {
      const blob = await getRenderedVideo();
      if (cancelled) return;
      if (blob) setRenderedUrl(URL.createObjectURL(blob));
      else setRecovery("missing");
    })();
    return () => {
      cancelled = true;
    };
  }, [renderedUrl, setRenderedUrl]);

  const status: "checking" | "missing" | "ready" = renderedUrl ? "ready" : (recovery ?? "checking");

  if (status === "checking") {
    return (
      <main className="flex flex-1 flex-col items-center justify-center px-8">
        <div className="pulse-soft text-sm text-neutral-500">Looking for your render…</div>
      </main>
    );
  }

  if (status === "missing") {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
        <AlertTriangle className="text-accent" size={32} />
        <div>
          <h1 className="text-lg font-bold">No render to show</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Nothing has been rendered in this session yet — or your browser cleared its storage.
          </p>
        </div>
        <button
          onClick={() => router.push("/editor")}
          className="btn-primary flex items-center gap-2 px-6 py-3"
        >
          <Pencil size={16} /> Go build an edit
        </button>
      </main>
    );
  }

  async function handleShare() {
    try {
      const blob = await fetch(renderedUrl!).then((r) => r.blob());
      const file = new File([blob], "viraledit.mp4", { type: "video/mp4" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "My ViralEdit AI edit" });
        setShared(true);
      } else {
        handleDownload();
      }
    } catch {
      // user cancelled share
    }
  }

  function handleDownload() {
    const a = document.createElement("a");
    a.href = renderedUrl!;
    a.download = "viraledit.mp4";
    a.click();
  }

  function downloadBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // One render, three aspect ratios: derive 1:1 / 16:9 center crops of the
  // 9:16 master in a single FFmpeg pass each.
  async function handleAspect(aspect: ExportAspect) {
    setToolError(null);
    setBusy(`Exporting ${aspect}…`);
    try {
      const master = await fetch(renderedUrl!).then((r) => r.blob());
      const out = await cropAspect(master, aspect);
      downloadBlob(out, `viraledit-${aspect.replace(":", "x")}.mp4`);
    } catch (e) {
      reportError(e, { where: "export.cropAspect", aspect });
      setToolError(`Couldn't export the ${aspect} version — try again.`);
    } finally {
      setBusy(null);
    }
  }

  // Scan the render for the sharpest, best-exposed frame → thumbnail JPEG.
  async function handleThumbnail() {
    setToolError(null);
    setBusy("Scanning for the best thumbnail frame…");
    try {
      const master = await fetch(renderedUrl!).then((r) => r.blob());
      const { jpeg, at } = await bestFrame(master);
      downloadBlob(jpeg, `viraledit-thumbnail-${at}s.jpg`);
    } catch (e) {
      reportError(e, { where: "export.bestFrame" });
      setToolError("Couldn't scan for a thumbnail — try again.");
    } finally {
      setBusy(null);
    }
  }

  async function copyText(label: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }

  // Thumbnail A/B/C: sample frames, score each on the factors thumbnail
  // research rewards (face, contrast, sharpness, exposure, thirds), offer
  // the top 3 with reasons — an honest heuristic, not a magic CTR oracle.
  async function handleThumbCandidates() {
    setToolError(null);
    setBusy("Scoring thumbnail candidates…");
    try {
      const blob = await fetch(renderedUrl!).then((r) => r.blob());
      const url = URL.createObjectURL(blob);
      const v = document.createElement("video");
      v.preload = "auto";
      v.muted = true;
      v.src = url;
      await new Promise<void>((res, rej) => {
        v.onloadeddata = () => res();
        v.onerror = () => rej(new Error("load failed"));
      });
      const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 10;
      const S = 96;
      const H = Math.round((S * v.videoHeight) / Math.max(1, v.videoWidth)) || 170;
      const small = document.createElement("canvas");
      small.width = S;
      small.height = H;
      const sctx = small.getContext("2d", { willReadFrequently: true })!;
      const seek = (t: number) =>
        new Promise<void>((res) => {
          v.onseeked = () => res();
          v.currentTime = t;
        });

      const stats: FrameStats[] = [];
      for (let i = 1; i <= 14; i++) {
        const t = (dur * i) / 15;
        await seek(t);
        sctx.drawImage(v, 0, 0, S, H);
        const d = sctx.getImageData(0, 0, S, H).data;
        let sum = 0, sat = 0;
        const luma = new Float32Array(S * H);
        for (let p = 0, px = 0; p < d.length; p += 4, px++) {
          const y = (0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]) / 255;
          luma[px] = y;
          sum += y;
          sat += (Math.max(d[p], d[p + 1], d[p + 2]) - Math.min(d[p], d[p + 1], d[p + 2])) / 255;
        }
        const mean = sum / luma.length;
        let varSum = 0, edge = 0;
        for (let yy = 0; yy < H - 1; yy++) {
          for (let xx = 0; xx < S - 1; xx++) {
            const px = yy * S + xx;
            varSum += (luma[px] - mean) ** 2;
            edge += Math.abs(luma[px + 1] - luma[px]) + Math.abs(luma[px + S] - luma[px]);
          }
        }
        const face = detectFaceInFrame(d, S, H);
        const thirds = [
          [1 / 3, 1 / 3], [2 / 3, 1 / 3], [1 / 3, 2 / 3], [2 / 3, 2 / 3],
        ];
        const off = face ? Math.min(...thirds.map(([tx, ty]) => Math.hypot(face.cx - tx, face.cy - ty))) : 1;
        stats.push({
          t: Number(t.toFixed(2)),
          brightness: mean,
          contrast: Math.sqrt(varSum / luma.length),
          saturation: sat / luma.length,
          sharpness: edge / ((S - 1) * (H - 1) * 2),
          faceSize: face?.size ?? 0,
          faceOffCenter: off,
        });
      }

      const picks = pickThumbCandidates(stats, 3);
      const big = document.createElement("canvas");
      big.width = v.videoWidth;
      big.height = v.videoHeight;
      const bctx = big.getContext("2d")!;
      const out: (ThumbScore & { dataUrl: string })[] = [];
      for (const p of picks) {
        await seek(p.t);
        bctx.drawImage(v, 0, 0);
        out.push({ ...p, dataUrl: big.toDataURL("image/jpeg", 0.85) });
      }
      URL.revokeObjectURL(url);
      setThumbs(out);
    } catch (e) {
      reportError(e, { where: "export.thumbCandidates" });
      setToolError("Couldn't score thumbnails — try again.");
    } finally {
      setBusy(null);
    }
  }

  const post = socialCaption(blueprint?.niche?.id ?? "general", {
    pacing: blueprint?.style.pacing,
    bpm: blueprint?.beats?.bpm ?? null,
  });

  return (
    <main className="flex flex-1 flex-col px-6 pb-10 pt-12">
      <header className="mb-6 text-center">
        <p className="text-xs font-bold uppercase tracking-widest text-accent">Done</p>
        <h1 className="mt-1 text-2xl font-extrabold">Your edit is ready 🔥</h1>
        <p className="mt-1 text-sm text-neutral-400">720×1280 · 9:16 · MP4 — sized for Reels, TikTok & Shorts</p>
      </header>

      <div className="mx-auto w-[70%]">
        <video
          src={renderedUrl!}
          controls
          playsInline
          loop
          className="w-full rounded-2xl border border-card-border bg-black"
        />
      </div>

      <div className="mt-8 flex flex-col gap-3">
        <button onClick={handleShare} disabled={!!busy} className="btn-primary flex items-center justify-center gap-2 py-4 text-lg">
          <Share2 size={18} /> Share to socials
        </button>
        <button
          onClick={handleDownload}
          disabled={!!busy}
          className="flex items-center justify-center gap-2 rounded-full border border-card-border py-4 font-semibold"
        >
          <Download size={18} /> Save to device
        </button>

        {/* More formats: one master render → other aspects + thumbnail */}
        <div className="card mt-2 p-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-neutral-400">
            <Clapperboard size={12} /> More formats from this render
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => handleAspect("1:1")}
              disabled={!!busy}
              className="flex-1 rounded-full border border-card-border py-2.5 text-xs text-neutral-300 active:border-accent"
            >
              Square 1:1
            </button>
            <button
              onClick={() => handleAspect("16:9")}
              disabled={!!busy}
              className="flex-1 rounded-full border border-card-border py-2.5 text-xs text-neutral-300 active:border-accent"
            >
              Wide 16:9
            </button>
            <button
              onClick={handleThumbnail}
              disabled={!!busy}
              className="flex flex-1 items-center justify-center gap-1 rounded-full border border-card-border py-2.5 text-xs text-neutral-300 active:border-accent"
            >
              <Camera size={12} /> Thumbnail
            </button>
          </div>

          {/* Live crop preview: how the same render reads in each aspect */}
          <p className="mb-2 mt-4 text-[10px] uppercase tracking-wider text-neutral-600">Crop preview</p>
          <div className="flex items-end justify-center gap-3">
            {[
              { label: "9:16", w: 72, h: 128 },
              { label: "1:1", w: 100, h: 100 },
              { label: "16:9", w: 142, h: 80 },
            ].map((a) => (
              <figure key={a.label} className="text-center">
                <div style={{ width: a.w, height: a.h }} className="overflow-hidden rounded-lg border border-card-border bg-black">
                  <video src={renderedUrl!} muted loop autoPlay playsInline className="h-full w-full object-cover" />
                </div>
                <figcaption className="mt-1 text-[10px] text-neutral-500">{a.label}</figcaption>
              </figure>
            ))}
          </div>
        </div>

        {/* Thumbnail A/B: three scored candidates with the WHY */}
        <div className="card p-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-neutral-400">
            <Camera size={12} /> Thumbnail A/B — scored candidates
          </p>
          <button
            onClick={handleThumbCandidates}
            disabled={!!busy}
            className="rounded-full border border-card-border px-4 py-2 text-xs text-neutral-300"
          >
            {thumbs.length ? "Rescan" : "Score 3 candidates"}
          </button>
          {thumbs.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {thumbs.map((t, i) => (
                <div key={i} className="text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={t.dataUrl} alt={`Thumbnail candidate ${"ABC"[i]}, appeal score ${t.score}`} className="w-full rounded-lg" />
                  <p className="mt-1 text-xs font-bold text-accent">{"ABC"[i]} · {t.score}</p>
                  <p className="text-[10px] leading-3 text-neutral-500">{t.reasons[0] ?? ""}</p>
                  <button
                    onClick={() => {
                      const a = document.createElement("a");
                      a.href = t.dataUrl;
                      a.download = `thumb-${"abc"[i]}-${t.t}s.jpg`;
                      a.click();
                    }}
                    className="mt-1 text-[10px] text-neutral-400 underline"
                  >
                    download
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-[10px] text-neutral-600">
            Heuristic appeal score (faces, contrast, sharpness, exposure, thirds) — a guide, not an oracle.
          </p>
        </div>

        {/* Post kit: caption + hashtags from the detected niche, chapters */}
        <div className="card p-4">
          <p className="mb-2 text-xs font-semibold text-neutral-400">Post kit</p>
          <p className="rounded-lg bg-black px-3 py-2 text-xs leading-5 text-neutral-300">{post.caption}</p>
          <p className="mt-1.5 text-[11px] text-accent">{post.hashtags.map((t) => `#${t}`).join(" ")}</p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => copyText("post", post.full)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-card-border py-2.5 text-xs text-neutral-300"
            >
              {copied === "post" ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
              {copied === "post" ? "Copied!" : "Copy caption + tags"}
            </button>
            {plan && clips.length > 0 && (
              <button
                onClick={() => copyText("chapters", chapterMarkers(plan, clips))}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-card-border py-2.5 text-xs text-neutral-300"
              >
                {copied === "chapters" ? <Check size={12} className="text-green-400" /> : <ListOrdered size={12} />}
                {copied === "chapters" ? "Copied!" : "Copy chapters"}
              </button>
            )}
          </div>
          {blueprint?.niche && (
            <p className="mt-2 text-[10px] text-neutral-600">
              Written for your detected {blueprint.niche.label} niche.
            </p>
          )}
          <div className="mt-2 flex gap-2">
            {canSpeak() && (
              <button
                onClick={() => {
                  if (speaking) {
                    stopSpeaking();
                    setSpeaking(false);
                  } else {
                    setSpeaking(true);
                    speakLines([post.caption, post.hashtags.map((t) => `#${t}`).join(" ")], { onDone: () => setSpeaking(false) });
                  }
                }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-card-border py-2.5 text-xs text-neutral-300"
              >
                <Volume2 size={12} /> {speaking ? "Stop reading" : "Read it aloud"}
              </button>
            )}
            {plan && (
              <button
                onClick={() => {
                  const md = showNotes({
                    title: blueprint?.sourceName ? `Inspired by ${blueprint.sourceName}` : undefined,
                    blueprint,
                    plan,
                    clips,
                    chapters: clips.length > 0 ? chapterMarkers(plan, clips) : undefined,
                    hashtags: post.hashtags,
                    attribution: assets.length > 0 ? attributionText(assets) : undefined,
                  });
                  downloadBlob(new Blob([md], { type: "text/markdown" }), "show-notes.md");
                }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-card-border py-2.5 text-xs text-neutral-300"
              >
                <FileText size={12} /> Show notes (.md)
              </button>
            )}
          </div>
        </div>

        {/* Licenses & attribution — only when third-party assets are in play */}
        {assets.length > 0 && (
          <div className="card p-4">
            <p className="mb-2 text-xs font-semibold text-neutral-400">Licenses & attribution ({assets.length})</p>
            {(() => {
              const audit = licenseAudit(assets);
              return !audit.ok ? (
                <ul className="mb-2 space-y-1">
                  {audit.warnings.map((w, i) => (
                    <li key={i} className="text-[11px] leading-4 text-yellow-400">⚠ {w}</li>
                  ))}
                </ul>
              ) : null;
            })()}
            <pre className="overflow-x-auto rounded-lg bg-black px-3 py-2 text-[10px] leading-4 text-neutral-400">{attributionText(assets)}</pre>
            <button
              onClick={() => copyText("attribution", attributionText(assets))}
              className="mt-2 flex items-center justify-center gap-1.5 rounded-full border border-card-border px-4 py-2 text-xs text-neutral-300"
            >
              {copied === "attribution" ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
              {copied === "attribution" ? "Copied!" : "Copy attribution"}
            </button>
          </div>
        )}

        <button
          onClick={() => router.push("/marketing")}
          className="mt-2 flex items-center justify-center gap-2 rounded-full border border-accent/40 bg-accent/10 py-3 text-sm font-semibold text-accent"
        >
          📣 Marketing HQ — calendar, A/B tests, sponsor pitch, media kit
        </button>

        <div className="mt-2 flex gap-3">
          <button
            onClick={() => router.push("/editor")}
            className="flex flex-1 items-center justify-center gap-2 rounded-full border border-card-border py-3 text-sm text-neutral-300"
          >
            <Pencil size={14} /> Keep editing
          </button>
          <button
            onClick={() => router.push("/home")}
            className="flex flex-1 items-center justify-center gap-2 rounded-full border border-card-border py-3 text-sm text-neutral-300"
          >
            <RotateCcw size={14} /> New project
          </button>
        </div>
      </div>

      {busy && (
        <div className="pulse-soft mt-4 rounded-xl bg-accent/10 px-4 py-3 text-center text-sm font-medium text-accent">{busy}</div>
      )}
      {toolError && (
        <div className="mt-4 rounded-xl bg-red-500/10 px-4 py-3 text-center text-sm text-red-400">{toolError}</div>
      )}
      {shared && <p className="mt-4 text-center text-sm text-accent">Shared! 🎉</p>}
    </main>
  );
}
