"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Camera, Check, Clapperboard, Copy, Download, ListOrdered, Pencil, RotateCcw, Share2 } from "lucide-react";
import { useProject } from "@/store/project";
import { getRenderedVideo } from "@/lib/storage";
import { cropAspect, bestFrame, type ExportAspect } from "@/lib/export-kit";
import { chapterMarkers } from "@/lib/retention";
import { socialCaption } from "@/lib/creator-kit";
import { reportError } from "@/lib/report-error";

export default function ExportPage() {
  const router = useRouter();
  const { renderedUrl, setRenderedUrl, plan, clips, blueprint } = useProject();
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [toolError, setToolError] = useState<string | null>(null);
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
        </div>

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
