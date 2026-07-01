"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Pencil, RotateCcw, Share2 } from "lucide-react";
import { useProject } from "@/store/project";

export default function ExportPage() {
  const router = useRouter();
  const { renderedUrl } = useProject();
  const [shared, setShared] = useState(false);

  useEffect(() => {
    if (!renderedUrl) router.replace("/editor");
  }, [renderedUrl, router]);

  if (!renderedUrl) return null;

  async function handleShare() {
    try {
      const blob = await fetch(renderedUrl!).then((r) => r.blob());
      const file = new File([blob], "viraledit.mp4", { type: "video/mp4" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "My ViralEdit" });
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
          src={renderedUrl}
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
