"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Download, Pencil, RotateCcw, Share2 } from "lucide-react";
import { useProject } from "@/store/project";
import { getRenderedVideo } from "@/lib/storage";

export default function ExportPage() {
  const router = useRouter();
  const { renderedUrl, setRenderedUrl } = useProject();
  const [shared, setShared] = useState(false);
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
        <button onClick={handleShare} className="btn-primary flex items-center justify-center gap-2 py-4 text-lg">
          <Share2 size={18} /> Share to socials
        </button>
        <button
          onClick={handleDownload}
          className="flex items-center justify-center gap-2 rounded-full border border-card-border py-4 font-semibold"
        >
          <Download size={18} /> Save to device
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

      {shared && <p className="mt-4 text-center text-sm text-accent">Shared! 🎉</p>}
    </main>
  );
}
