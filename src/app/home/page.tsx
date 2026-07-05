"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Upload, Clapperboard, ChevronRight, Flame, Heart, Import, ListChecks } from "lucide-react";
import { v4 as uuid } from "uuid";
import { saveVideo, listBlueprints, listFingerprints, saveBlueprint } from "@/lib/storage";
import { tasteProfile, blueprintFromCode, type Fingerprint } from "@/lib/intelligence";
import { VIRAL_TEMPLATES } from "@/lib/templates";
import { probeDuration } from "@/lib/ffmpeg-client";
import { checkReferenceLimits } from "@/lib/limits";
import { useProject } from "@/store/project";
import CommandPalette from "@/components/CommandPalette";
import type { EditBlueprint } from "@/lib/types";

export default function Home() {
  const router = useRouter();
  const { setBlueprint } = useProject();
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<EditBlueprint[]>([]);
  const [prints, setPrints] = useState<Fingerprint[]>([]);
  const [importCode, setImportCode] = useState("");

  useEffect(() => {
    listBlueprints().then((b) => setRecent(b.slice(0, 5))).catch(() => {});
    listFingerprints().then(setPrints).catch(() => {});
  }, []);

  async function handleImportCode() {
    const bp = blueprintFromCode(importCode.trim());
    if (!bp) {
      setError("That code doesn't look like a valid VE1 blueprint code");
      return;
    }
    await saveBlueprint(bp);
    router.push(`/analyze?blueprint=${bp.id}`);
  }

  async function handleLink() {
    if (!url.trim()) return;
    setBusy("Downloading reel…");
    setError(null);
    try {
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: "Download failed" }));
        throw new Error(j.error ?? "Download failed");
      }
      const blob = await res.blob();
      const title = decodeURIComponent(res.headers.get("X-Video-Title") ?? "reel");

      setBusy("Checking length…");
      const duration = await probeDuration(blob);
      const check = checkReferenceLimits(duration);
      if (!check.ok) {
        setError(check.reason!);
        setBusy(null);
        return;
      }

      const id = uuid();
      await saveVideo(id, blob, title);
      router.push(`/analyze?video=${id}&name=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
      setBusy(null);
    }
  }

  async function handleFile(f: File) {
    setBusy("Checking length…");
    setError(null);
    try {
      const duration = await probeDuration(f);
      const check = checkReferenceLimits(duration);
      if (!check.ok) {
        setError(check.reason!);
        setBusy(null);
        return;
      }
      setBusy("Saving video…");
      const id = uuid();
      await saveVideo(id, f, f.name);
      router.push(`/analyze?video=${id}&name=${encodeURIComponent(f.name)}`);
    } catch {
      setError("Couldn't read that video file.");
      setBusy(null);
    }
  }

  return (
    <main className="flex flex-1 flex-col px-6 pb-10 pt-14">
      <header className="mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight">
          Drop a viral reel<span className="text-accent">.</span>
        </h1>
        <p className="mt-2 text-neutral-400">
          Paste a link or upload a video — AI maps every cut and transition.
        </p>
      </header>

      {/* Paste link */}
      <div className="card p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-neutral-300">
          <Link2 size={16} className="text-accent" /> Paste a link
        </div>
        <div className="mt-3 flex gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLink()}
            placeholder="instagram.com/reels/…"
            inputMode="url"
            className="min-w-0 flex-1 rounded-xl border border-card-border bg-black px-4 py-3 text-sm outline-none placeholder:text-neutral-600 focus:border-accent"
          />
          <button
            onClick={handleLink}
            disabled={!!busy || !url.trim()}
            className="btn-primary px-5 text-sm"
          >
            Go
          </button>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Instagram · TikTok · YouTube · X · Facebook
        </p>
        <p className="mt-2 text-[10px] leading-4 text-neutral-600">
          Only analyze content you have the rights to use — this downloads the
          video temporarily on our server to detect its edit, then deletes it
          immediately.
        </p>
      </div>

      <div className="my-4 flex items-center gap-3 text-xs text-neutral-600">
        <div className="h-px flex-1 bg-card-border" /> or <div className="h-px flex-1 bg-card-border" />
      </div>

      {/* Upload */}
      <button
        onClick={() => fileRef.current?.click()}
        disabled={!!busy}
        className="stripes flex h-40 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-neutral-700 active:border-accent"
      >
        <Upload className="text-accent" />
        <span className="font-semibold">Upload from your device</span>
        <span className="text-xs text-neutral-500">MP4 · MOV · WebM</span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />

      {busy && (
        <div className="pulse-soft mt-6 rounded-xl bg-accent/10 px-4 py-3 text-center text-sm font-medium text-accent">
          {busy}
        </div>
      )}
      {error && (
        <div className="mt-6 rounded-xl bg-red-500/10 px-4 py-3 text-center text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Viral templates */}
      <section className="mt-10">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-neutral-500">
          <Flame size={14} className="text-accent" /> Start from a viral template
        </h2>
        <div className="-mx-6 flex gap-3 overflow-x-auto px-6 pb-2">
          {VIRAL_TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              onClick={() => {
                setBlueprint(tpl);
                router.push("/editor");
              }}
              className="card flex w-40 shrink-0 flex-col items-start p-4 text-left active:border-accent"
            >
              <span className="text-3xl">{tpl.emoji}</span>
              <span className="mt-2 text-sm font-bold">{tpl.sourceName}</span>
              <span className="mt-1 text-xs leading-4 text-neutral-500">{tpl.tagline}</span>
              <span className="mt-2 font-mono text-[10px] text-accent">
                {tpl.beats?.bpm} BPM · {tpl.transitions.length} cuts
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Recent blueprints */}
      {recent.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-neutral-500">
            <Clapperboard size={14} /> Recent breakdowns
          </h2>
          <div className="flex flex-col gap-2">
            {recent.map((bp) => (
              <button
                key={bp.id}
                onClick={() => router.push(`/analyze?blueprint=${bp.id}`)}
                className="card flex items-center justify-between px-4 py-3 text-left"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{bp.sourceName}</div>
                  <div className="text-xs text-neutral-500">
                    {bp.transitions.length} transitions · {bp.beats ? `${bp.beats.bpm} BPM · ` : ""}
                    {bp.style.pacing} pacing
                  </div>
                </div>
                <ChevronRight size={16} className="shrink-0 text-neutral-600" />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Taste profile (#1 uniqueness) */}
      {prints.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-neutral-500">
            <Heart size={14} className="text-accent" /> Your taste profile
          </h2>
          <div className="card p-4">
            {tasteProfile(prints).map((n, i) => (
              <p key={i} className="py-0.5 text-xs leading-5 text-neutral-300">{n}</p>
            ))}
            <p className="mt-1 text-[10px] text-neutral-500">Built from {prints.length} saved reel{prints.length > 1 ? "s" : ""} — save more styles from the analysis screen.</p>
          </div>
        </section>
      )}

      {/* Import a shared blueprint code (#18 uniqueness) */}
      <section className="mt-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-neutral-500">
          <Import size={14} /> Import a blueprint code
        </h2>
        <div className="flex gap-2">
          <input
            value={importCode}
            onChange={(e) => setImportCode(e.target.value)}
            placeholder="VE1.…"
            className="min-w-0 flex-1 rounded-xl border border-card-border bg-black px-4 py-3 font-mono text-xs outline-none placeholder:text-neutral-600 focus:border-accent"
          />
          <button onClick={handleImportCode} disabled={!importCode.trim()} className="btn-primary px-5 text-sm">
            Load
          </button>
        </div>
        <p className="mt-1 text-[10px] text-neutral-500">A friend&apos;s cut recipe — timings and transitions only, no video.</p>
      </section>

      <div className="mt-4">
        <button
          onClick={() => router.push("/features")}
          className="flex w-full items-center justify-center gap-2 rounded-full border border-card-border py-3 text-xs text-neutral-400"
        >
          <ListChecks size={13} /> Everything this app can do
        </button>
      </div>

      <div className="mt-auto pt-10">
        <button
          onClick={() => router.push("/editor")}
          className="w-full rounded-full border border-card-border py-4 text-sm font-semibold text-neutral-300"
        >
          Skip analysis → edit my clips directly
        </button>
      </div>

      {/* ⌘K — every tool, searchable */}
      <CommandPalette />
    </main>
  );
}
