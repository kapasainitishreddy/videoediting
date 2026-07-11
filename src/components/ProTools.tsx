"use client";

// Pro Tools — the power-user panel below the Studio. Each section is a
// competitor-parity-or-better feature, all opt-in, nothing auto-applies:
//   Cut cleanup    — tighten dead air (jump cuts), auto B-roll cutaways,
//                    multi-cam speaker cut
//   Long recording — Opus-Clip-style ranked short-clip candidates
//   Similar shots  — visual search across the clip library (on-device)
//   Audio & rights — music copyright check, studio-sound cleanup, platform
//                    loudness targets, CC stock music search (keyless)
//   Voiceover      — AI narration (MiniMax key) with automatic license entry
//   Hooks          — niche-tuned opening lines
//   Text edit      — Descript-style edit-by-transcript (Whisper key)
//   Handoff        — EDL / FCPXML / .cube LUT / portable project file
import { useEffect, useState } from "react";
import { v4 as uuid } from "uuid";
import {
  AudioLines, Copy, Download, FileText, Languages, Layers, Mic2, Scissors, SearchCheck,
  ShieldAlert, SlidersHorizontal, Sparkle, Upload, Users, Wand2, ChevronDown, Repeat, GitCompare,
  MessageSquare, Library, Check, Trash2, Plus,
} from "lucide-react";
import { useProject } from "@/store/project";
import { getVideo, saveClipMeta } from "@/lib/storage";
import type { EditPlan, UserClip } from "@/lib/types";
import { analyzeClip } from "@/lib/clip-analysis";
import { detectRepeatTakes, alignByAudio, type CamInput } from "@/lib/sync";
import { reshootScore, type ReshootResult } from "@/lib/reshoot";
import { splitScreenClip, pipClip } from "@/lib/ffmpeg-client";
import { silenceRanges, measureLoudness, normalizeAudioBlob } from "@/lib/audio-polish";
import {
  tightenSilences, insertCutaways, activeSpeakerCut, longformClips,
  type Range, type SpeakerTrack, type LongformCandidate,
} from "@/lib/plan-surgery";
import { hookLines, type HookLine } from "@/lib/creator-growth";
import { readAudioTags, assessCopyrightRisk, attributionText, type CopyrightRisk } from "@/lib/media-trust";
import { PLATFORM_TARGETS, platformGain } from "@/lib/platform-audio";
import { studioSound } from "@/lib/voice-clean";
import { frameSignature, averageSignatures, findSimilar, type ClipSignature } from "@/lib/similarity";
import { parseWhisperWords, fillerRanges, wordCutRanges, transcriptLines, type Word } from "@/lib/transcript-edit";
import { edlFromPlan, fcpxmlFromPlan, projectToFile, projectFromFile } from "@/lib/edl";
import { mergeComments, makeComment, addComment, setResolved, deleteComment, reviewSummary, timecode, formatComment, type ReviewComment } from "@/lib/review";
import {
  makeItem, addItem, removeItem, searchItems, exportLibrary, importLibrary, mergeLibrary,
  LIBRARY_KINDS, type LibraryItem, type LibraryKind,
} from "@/lib/library";
import { saveLibraryItem, listLibraryItems, deleteLibraryItem } from "@/lib/storage";
import { transitionByType } from "@/lib/transitions";
import { gradeToCube, parseCube } from "@/lib/lut";
import { applyCubeToClip, makeThumbnail } from "@/lib/ffmpeg-client";
import { saveVideo } from "@/lib/storage";

interface Props {
  music: { name: string; blob: Blob } | null;
  setMusic: (m: { name: string; blob: Blob } | null) => void;
  captionLines: string[];
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-card-border last:border-0">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between py-3 text-sm font-semibold">
        <span className="flex items-center gap-2">{icon} {title}</span>
        <ChevronDown size={14} className={`text-neutral-600 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="pb-4">{children}</div>}
    </div>
  );
}

const btn = "rounded-full border border-card-border px-3 py-1.5 text-xs text-neutral-300 disabled:opacity-40";
const btnAccent = "rounded-full bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent disabled:opacity-40";

function download(name: string, content: string | Blob, type = "text/plain") {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function decodeAudio(blob: Blob): Promise<{ data: Float32Array; sampleRate: number } | null> {
  try {
    const AC: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new AC();
    try {
      const buf = await ac.decodeAudioData(await blob.arrayBuffer());
      return { data: buf.getChannelData(0), sampleRate: buf.sampleRate };
    } finally {
      ac.close();
    }
  } catch {
    return null;
  }
}

// 3-frame visual signature + coarse motion stat for the similarity search
async function clipSignature(clip: UserClip, blob: Blob): Promise<ClipSignature | null> {
  try {
    const url = URL.createObjectURL(blob);
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    v.src = url;
    await new Promise<void>((res, rej) => {
      v.onloadeddata = () => res();
      v.onerror = () => rej(new Error("load"));
    });
    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : clip.duration;
    const S = 48;
    const c = document.createElement("canvas");
    c.width = S;
    c.height = S;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    const frames: Uint8ClampedArray[] = [];
    for (const f of [0.2, 0.5, 0.8]) {
      await new Promise<void>((res) => {
        v.onseeked = () => res();
        v.currentTime = Math.min(dur - 0.05, dur * f);
      });
      ctx.drawImage(v, 0, 0, S, S);
      frames.push(ctx.getImageData(0, 0, S, S).data.slice());
    }
    URL.revokeObjectURL(url);
    let motion = 0;
    for (let i = 0; i < frames[0].length; i += 4) {
      motion += Math.abs(frames[1][i] - frames[0][i]) + Math.abs(frames[2][i] - frames[1][i]);
    }
    motion /= (frames[0].length / 4) * 2 * 255;
    const sig = averageSignatures(frames.map((f) => frameSignature(f, S, S)));
    return { clipId: clip.id, ...sig, avgMotion: Number(motion.toFixed(4)) };
  } catch {
    return null;
  }
}

export default function ProTools({ music, setMusic, captionLines }: Props) {
  const { blueprint, clips, setClips, addClip, plan, setPlan, studio, setStudio, setBlueprint, assets, addAsset, comments, setComments } = useProject();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [risk, setRisk] = useState<CopyrightRisk | null>(null);
  const [platform, setPlatform] = useState("tiktok");
  const [stockQ, setStockQ] = useState("");
  const [stockResults, setStockResults] = useState<{ id: string; title: string; creator: string; license: string; licenseUrl: string; url: string; duration: number | null; source: string }[]>([]);
  const [hooks, setHooks] = useState<HookLine[]>([]);
  const [hookSeed, setHookSeed] = useState(1);
  const [longFor, setLongFor] = useState<string>("");
  const [candidates, setCandidates] = useState<LongformCandidate[]>([]);
  const [simFor, setSimFor] = useState<string>("");
  const [similar, setSimilar] = useState<{ clipId: string; similarity: number }[]>([]);
  const [ttsText, setTtsText] = useState("");
  const [txClip, setTxClip] = useState<string>("");
  const [words, setWords] = useState<Word[]>([]);
  const [killed, setKilled] = useState<Set<number>>(new Set());
  const [langs, setLangs] = useState("es, pt-BR, hi");
  const [lutClip, setLutClip] = useState("");
  // compositing
  const [ssA, setSsA] = useState("");
  const [ssB, setSsB] = useState("");
  const [ssDir, setSsDir] = useState<"v" | "h">("v");
  const [pipMain, setPipMain] = useState("");
  const [pipOver, setPipOver] = useState("");
  const [pipCorner, setPipCorner] = useState<"tl" | "tr" | "bl" | "br">("br");
  // repeat-take + multi-cam align + reshoot
  const [takes, setTakes] = useState<{ keep: string; duplicates: string[]; similarity: number }[] | null>(null);
  const [aligned, setAligned] = useState<{ clipId: string; offsetSec: number; score: number; aligned: boolean }[] | null>(null);
  const [reshootA, setReshootA] = useState("");
  const [reshootB, setReshootB] = useState("");
  const [reshoot, setReshoot] = useState<ReshootResult | null>(null);
  // collaborate: review notes + shared library
  const [noteAuthor, setNoteAuthor] = useState("");
  const [noteTime, setNoteTime] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [libSaveName, setLibSaveName] = useState("");
  const [libQuery, setLibQuery] = useState("");
  // AI Frame Studio (key-gated cloud image edits on a still frame)
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [frameOut, setFrameOut] = useState<string | null>(null);
  const [frameTask, setFrameTask] = useState<"sky" | "relight" | "inpaint" | "eyecontact" | "outpaint">("sky");
  useEffect(() => {
    listLibraryItems().then(setLibrary).catch(() => {});
  }, []);

  const say = (m: string) => {
    setNote(m);
    setError(null);
  };
  const fail = (m: string) => {
    setError(m);
    setNote(null);
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      fail(e instanceof Error ? e.message : `${label} failed`);
    } finally {
      setBusy(null);
    }
  };

  const needPlan = (): EditPlan | null => {
    if (!plan) fail("Auto-edit first — these tools operate on the timeline.");
    return plan;
  };

  // ---- collaborate: review notes ------------------------------------------------------------
  const addReviewNote = () => {
    const body = noteBody.trim();
    if (!body) return fail("Type the note first.");
    const time = Math.max(0, parseFloat(noteTime) || 0);
    const c = makeComment({ time, author: noteAuthor, body }, { id: uuid(), createdAt: Date.now() });
    setComments(addComment(comments, c));
    setNoteBody("");
    setNoteTime("");
    say(`Note added at ${timecode(time)} — it travels inside the exported project file.`);
  };
  const exportNotes = () => {
    if (comments.length === 0) return fail("No notes yet.");
    const text = comments.map((c) => formatComment(c)).join("\n");
    download("review-notes.txt", `Review notes\n\n${text}\n`);
    say("Review notes exported as text.");
  };

  // ---- collaborate: shared library ----------------------------------------------------------
  const saveToLibrary = async (kind: LibraryKind, name: string, data: unknown) => {
    const item = makeItem({ kind, name, data }, { id: uuid(), createdAt: Date.now() });
    await saveLibraryItem(item);
    setLibrary((prev) => addItem(prev, item));
    return item;
  };
  const saveLookToLibrary = () =>
    run("Saving look to library…", async () => {
      const name = libSaveName.trim() || `${studio.look.grade} look`;
      await saveToLibrary("look", name, studio.look);
      setLibSaveName("");
      say(`Saved “${name}” to your library — reuse it in any project.`);
    });
  const saveBrandToLibrary = () =>
    run("Saving brand kit…", async () => {
      if (!studio.brandHex.trim()) return fail("Set brand colors in Studio first.");
      await saveToLibrary("brand", libSaveName.trim() || "Brand kit", { brandHex: studio.brandHex });
      setLibSaveName("");
      say("Brand kit saved to your library.");
    });
  const applyLibraryItem = (item: LibraryItem) => {
    if (item.kind === "look") {
      setStudio({ look: item.data as typeof studio.look });
      say(`Applied “${item.name}”.`);
    } else if (item.kind === "brand") {
      const b = item.data as { brandHex?: string };
      if (b.brandHex) setStudio({ brandHex: b.brandHex });
      say(`Applied brand kit “${item.name}”.`);
    } else {
      fail("That item type is applied from its own panel.");
    }
  };
  const removeLibraryItem = (id: string) =>
    run("Removing…", async () => {
      await deleteLibraryItem(id);
      setLibrary((prev) => removeItem(prev, id));
    });
  const exportLibraryFile = () => {
    if (library.length === 0) return fail("Your library is empty.");
    download("kit.viraledit-library.json", exportLibrary(library, Date.now()), "application/json");
    say(`Exported ${library.length} item${library.length > 1 ? "s" : ""} — share the kit with your team.`);
  };
  const importLibraryFile = (file: File) =>
    run("Importing library…", async () => {
      const res = importLibrary(await file.text());
      if (!res.ok) throw new Error(res.error);
      const merged = mergeLibrary(library, res.items);
      for (const it of res.items) await saveLibraryItem(it).catch(() => {});
      setLibrary(merged);
      say(`Imported ${res.items.length} library item${res.items.length === 1 ? "" : "s"}.`);
    });

  // ---- AI Frame Studio: key-gated cloud image edits on a still frame --------------------------
  const loadFrame = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setFrameSrc(typeof reader.result === "string" ? reader.result : null);
      setFrameOut(null);
    };
    reader.readAsDataURL(file);
  };
  const FRAME_TASKS: { id: typeof frameTask; label: string }[] = [
    { id: "sky", label: "Sky replace" },
    { id: "relight", label: "Relight" },
    { id: "inpaint", label: "Remove object" },
    { id: "eyecontact", label: "Eye contact" },
    { id: "outpaint", label: "Outpaint 9:16" },
  ];
  const runFrameEdit = () =>
    run("AI is editing the frame…", async () => {
      if (!frameSrc) return fail("Pick a frame or cover image first.");
      const res = await fetch("/api/image-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: frameTask, imageB64: frameSrc }),
      });
      const data = await res.json();
      if (data.available === false) return fail(data.error ?? "Add FAL_KEY in .env.local to enable AI frame edits.");
      if (!data.imageUrl) return fail(data.error ?? "The edit failed — try another frame.");
      setFrameOut(data.imageUrl);
      say("Frame edited. Download it, or use it as a cover / title background / B-roll still.");
    });

  // ---- cut cleanup -----------------------------------------------------------

  const handleTighten = () =>
    run("Listening for dead air…", async () => {
      const p = needPlan();
      if (!p) return;
      const silences = new Map<string, Range[]>();
      let audible = 0;
      for (const id of new Set(p.segments.map((s) => s.clipId))) {
        const v = await getVideo(id);
        if (!v) continue;
        const audio = await decodeAudio(v.blob);
        if (!audio) continue;
        audible++;
        silences.set(id, silenceRanges(audio.data, audio.sampleRate));
      }
      if (audible === 0) {
        fail("None of the timeline clips have an audio track to listen to.");
        return;
      }
      const res = tightenSilences(p, silences);
      if (res.removedSeconds < 0.1) {
        say("No dead air worth cutting — the timeline is already tight.");
        return;
      }
      setPlan(res.plan);
      say(`Removed ${res.removedSeconds.toFixed(1)}s of dead air with ${res.cuts} jump cut${res.cuts === 1 ? "" : "s"}. Undo if it's too tight.`);
    });

  const handleCutaways = () =>
    run("Placing B-roll…", async () => {
      const p = needPlan();
      if (!p) return;
      const hostIds = new Set(p.segments.map((s) => s.clipId));
      const opportunities: { clipId: string; at: number }[] = [];
      for (const id of hostIds) {
        const v = await getVideo(id);
        if (!v) continue;
        const audio = await decodeAudio(v.blob);
        if (!audio) continue;
        for (const r of silenceRanges(audio.data, audio.sampleRate, { minLen: 0.4 })) {
          opportunities.push({ clipId: id, at: Number(((r.start + r.end) / 2).toFixed(2)) });
        }
      }
      const broll = clips
        .filter((c) => !hostIds.has(c.id) && c.duration > 1.6)
        .map((c) => ({ clipId: c.id, start: 0.3, end: Math.min(c.duration - 0.1, 3.5) }));
      if (broll.length === 0) {
        fail("No spare clips to cut away to — add B-roll footage that isn't already on the timeline.");
        return;
      }
      if (opportunities.length === 0) {
        fail("No natural speech gaps found in the timeline clips to hide a cutaway in.");
        return;
      }
      const res = insertCutaways(p, opportunities, broll);
      if (res.inserted === 0) {
        say("No gap was wide enough for a clean cutaway.");
        return;
      }
      setPlan(res.plan);
      say(`${res.inserted} B-roll cutaway${res.inserted > 1 ? "s" : ""} placed at speech gaps.`);
    });

  const handleSpeakerCut = () =>
    run("Reading who's talking…", async () => {
      if (clips.length < 2) {
        fail("Speaker cut needs at least two camera clips of the same conversation.");
        return;
      }
      const tracks: SpeakerTrack[] = [];
      let shortest = Infinity;
      for (const c of clips.slice(0, 4)) {
        const v = await getVideo(c.id);
        if (!v) continue;
        const audio = await decodeAudio(v.blob);
        if (!audio) continue;
        shortest = Math.min(shortest, audio.data.length / audio.sampleRate);
        tracks.push({ clipId: c.id, times: [], rms: [] });
        const hop = Math.floor(audio.sampleRate * 0.25);
        const t = tracks[tracks.length - 1];
        for (let i = 0; i + hop <= audio.data.length; i += hop) {
          let e = 0;
          for (let k = 0; k < hop; k++) e += audio.data[i + k] ** 2;
          t.times.push(Number((i / audio.sampleRate).toFixed(2)));
          t.rms.push(Math.sqrt(e / hop));
        }
      }
      if (tracks.length < 2) {
        fail("Fewer than two clips have readable audio — speaker cut listens to the mics.");
        return;
      }
      const n = Math.min(...tracks.map((t) => t.times.length));
      for (const t of tracks) {
        t.times = t.times.slice(0, n);
        t.rms = t.rms.slice(0, n);
      }
      const res = activeSpeakerCut(tracks);
      if (res.segments.length < 2) {
        fail("Couldn't find alternating speech — are these cameras rolling on the same conversation?");
        return;
      }
      setPlan({
        segments: res.segments,
        colorGrade: plan?.colorGrade ?? "none",
        aiDirection: plan?.aiDirection ?? "",
        explanation: res.explanation,
      });
      say(`${res.explanation} This replaced the timeline — undo brings the old cut back.`);
    });

  // ---- long-form → shorts ------------------------------------------------------

  const handleLongform = () =>
    run("Scanning the recording…", async () => {
      const clip = clips.find((c) => c.id === longFor);
      if (!clip) return;
      const v = await getVideo(clip.id);
      if (!v) throw new Error("Clip missing from storage");
      const analysis = await analyzeClip(v.blob, { samplesPerSecond: 2, maxSamples: 400 });
      setCandidates(longformClips(analysis, { clipLen: 22, count: 5 }));
    });

  const applyCandidate = (cand: LongformCandidate, clipId: string) => {
    const segs = [];
    let t = cand.start;
    let i = 0;
    while (t < cand.end - 0.3) {
      const end = Math.min(cand.end, t + 1.8);
      segs.push({ id: `lf_${i++}`, clipId, start: Number(t.toFixed(2)), end: Number(end.toFixed(2)), transitionAfter: end >= cand.end - 0.3 ? null : ("hard-cut" as const), speed: 1 });
      t = end;
    }
    setPlan({
      segments: segs,
      colorGrade: plan?.colorGrade ?? "none",
      aiDirection: plan?.aiDirection ?? "",
      explanation: `Short cut from the ${cand.start.toFixed(0)}s–${cand.end.toFixed(0)}s window of the recording (${cand.reason}).`,
    });
    say("Candidate loaded onto the timeline — render it, or undo to try another.");
  };

  // ---- similar shots ---------------------------------------------------------------

  const handleSimilar = () =>
    run("Comparing shots…", async () => {
      const target = clips.find((c) => c.id === simFor);
      if (!target) return;
      const sigs: ClipSignature[] = [];
      for (const c of clips) {
        const v = await getVideo(c.id);
        if (!v) continue;
        const s = await clipSignature(c, v.blob);
        if (s) sigs.push(s);
      }
      const q = sigs.find((s) => s.clipId === simFor);
      if (!q) throw new Error("Couldn't read the reference clip");
      setSimilar(findSimilar(q, sigs, 5));
    });

  // ---- compositing: split-screen + PiP ------------------------------------------------

  const addDerived = async (base: UserClip, blob: Blob, suffix: string) => {
    const id = uuid();
    const name = `${base.name.replace(/\.[a-z0-9]+$/i, "")} · ${suffix}`;
    let thumbnail: string | undefined;
    try {
      thumbnail = await makeThumbnail(blob);
    } catch {
      /* stripes placeholder */
    }
    await saveVideo(id, blob, name);
    const derived = { id, name, duration: base.duration, thumbnail };
    await saveClipMeta(derived).catch(() => {});
    addClip(derived);
  };

  const handleSplit = () =>
    run("Building the split screen…", async () => {
      const a = clips.find((c) => c.id === ssA);
      const b = clips.find((c) => c.id === ssB);
      if (!a || !b || a.id === b.id) {
        fail("Pick two different clips for the split screen.");
        return;
      }
      const [va, vb] = [await getVideo(a.id), await getVideo(b.id)];
      if (!va || !vb) throw new Error("A clip is missing from storage");
      await addDerived(a, await splitScreenClip(va.blob, vb.blob, ssDir), `split ${ssDir === "v" ? "top/bottom" : "side-by-side"}`);
      say("Split-screen clip added to your shelf.");
    });

  const handlePip = () =>
    run("Building the picture-in-picture…", async () => {
      const m = clips.find((c) => c.id === pipMain);
      const o = clips.find((c) => c.id === pipOver);
      if (!m || !o || m.id === o.id) {
        fail("Pick two different clips for PiP.");
        return;
      }
      const [vm, vo] = [await getVideo(m.id), await getVideo(o.id)];
      if (!vm || !vo) throw new Error("A clip is missing from storage");
      await addDerived(m, await pipClip(vm.blob, vo.blob, pipCorner), "PiP");
      say("Picture-in-picture clip added to your shelf.");
    });

  // ---- repeat-take detector + multi-cam align + reshoot compare -----------------------

  const handleRepeatTakes = () =>
    run("Comparing every clip…", async () => {
      const sigs: ClipSignature[] = [];
      for (const c of clips) {
        const v = await getVideo(c.id);
        if (!v) continue;
        const s = await clipSignature(c, v.blob);
        if (s) sigs.push(s);
      }
      const groups = detectRepeatTakes(sigs);
      setTakes(groups);
      if (groups.length === 0) say("No near-duplicate takes — every clip is distinct.");
    });

  const handleAlign = () =>
    run("Listening for a common moment…", async () => {
      const cams: CamInput[] = [];
      for (const c of clips.slice(0, 6)) {
        const v = await getVideo(c.id);
        if (!v) continue;
        const audio = await decodeAudio(v.blob);
        if (audio) cams.push({ clipId: c.id, data: audio.data, sampleRate: audio.sampleRate });
      }
      if (cams.length < 2) {
        fail("Multi-cam sync needs at least two clips with audio.");
        return;
      }
      setAligned(alignByAudio(cams));
    });

  const handleReshoot = () =>
    run("Scoring both takes…", async () => {
      const a = clips.find((c) => c.id === reshootA);
      const b = clips.find((c) => c.id === reshootB);
      if (!a || !b || a.id === b.id) {
        fail("Pick your previous take and the reshoot (two different clips).");
        return;
      }
      const [va, vb] = [await getVideo(a.id), await getVideo(b.id)];
      if (!va || !vb) throw new Error("A clip is missing from storage");
      const [aa, ab] = [
        await analyzeClip(va.blob, { samplesPerSecond: 4, maxSamples: 200 }),
        await analyzeClip(vb.blob, { samplesPerSecond: 4, maxSamples: 200 }),
      ];
      setReshoot(reshootScore({ motion: aa.motion, brightness: aa.brightness }, { motion: ab.motion, brightness: ab.brightness }));
    });

  // ---- audio & rights -----------------------------------------------------------------

  const handleCopyright = () =>
    run("Reading the track's tags…", async () => {
      if (!music) return;
      const bytes = new Uint8Array(await music.blob.arrayBuffer());
      setRisk(assessCopyrightRisk(readAudioTags(bytes)));
    });

  const handleStudioSound = () =>
    run("Cleaning the track…", async () => {
      if (!music) return;
      const { blob, report } = await studioSound(music.blob);
      setMusic({ name: music.name.replace(/\.[a-z0-9]+$/i, "") + " · studio.wav", blob });
      say(`Studio sound applied: noise floor ${report.noiseFloor}, ${report.gatedSeconds}s of room noise pulled down, ${report.gainDb > 0 ? "+" : ""}${report.gainDb} dB makeup gain.`);
    });

  const handleLoudness = () =>
    run("Measuring loudness…", async () => {
      if (!music) return;
      const audio = await decodeAudio(music.blob);
      if (!audio) throw new Error("Couldn't decode the track");
      const measured = measureLoudness(audio.data);
      const g = platformGain(measured, platform);
      if (Math.abs(g.gainDb) < 0.5) {
        say(g.message);
        return;
      }
      const { blob } = await normalizeAudioBlob(music.blob, measured.rms * g.gainLinear);
      setMusic({ name: music.name, blob });
      say(g.message + " Applied.");
    });

  const handleStockSearch = () =>
    run("Searching CC music…", async () => {
      const res = await fetch(`/api/stock?q=${encodeURIComponent(stockQ)}&kind=audio`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Stock search failed");
      setStockResults(data.results ?? []);
      if ((data.results ?? []).length === 0) say("No CC tracks matched — try a mood word like “upbeat” or “cinematic”.");
    });

  const pickStock = (r: (typeof stockResults)[0]) =>
    run("Fetching the track…", async () => {
      try {
        const res = await fetch(r.url);
        if (!res.ok) throw new Error(`fetch ${res.status}`);
        const blob = await res.blob();
        setMusic({ name: `${r.title}.mp3`, blob });
        addAsset({ id: r.id, name: r.title, kind: "music", source: r.source, license: r.license, author: r.creator, url: r.licenseUrl });
        say(`“${r.title}” added — its ${r.license} license was recorded in the attribution tracker.`);
      } catch {
        window.open(r.url, "_blank", "noopener");
        fail("That source blocks in-browser downloads — it opened in a new tab; download it there and add the file manually.");
      }
    });

  // ---- voiceover (key-gated) --------------------------------------------------------------

  const handleTts = () =>
    run("Generating the voiceover…", async () => {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "tts", text: ttsText }),
      });
      const data = await res.json();
      if (data.available === false) throw new Error(data.error ?? "Needs MINIMAX_API_KEY in .env.local");
      if (!data.audioB64) throw new Error(data.error ?? "No audio returned");
      const bytes = Uint8Array.from(atob(data.audioB64), (ch) => ch.charCodeAt(0));
      const blob = new Blob([bytes], { type: "audio/mpeg" });
      setMusic({ name: "AI voiceover.mp3", blob });
      addAsset({ id: uuid(), name: "AI voiceover", kind: "music", source: "MiniMax TTS", license: "AI-generated (yours)", author: "you" });
      say("Voiceover generated and set as the audio track. Run Studio sound on it for extra polish.");
    });

  // ---- hooks -----------------------------------------------------------------------------

  const handleHooks = () => {
    const next = hookSeed + 1;
    setHookSeed(next);
    setHooks(hookLines(blueprint?.niche?.id ?? "general", plan?.aiDirection || undefined, next));
  };

  // ---- edit by transcript (key-gated) --------------------------------------------------------

  const handleTranscribe = () =>
    run("Transcribing (Whisper)…", async () => {
      const clip = clips.find((c) => c.id === txClip);
      if (!clip) return;
      const v = await getVideo(clip.id);
      if (!v) throw new Error("Clip missing from storage");
      const form = new FormData();
      form.append("audio", v.blob, "clip.mp4");
      form.append("words", "1");
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = await res.json();
      if (data.available === false) throw new Error(data.error ?? "Needs OPENAI_API_KEY for word-level transcription");
      if (data.error) throw new Error(data.error);
      const ws = parseWhisperWords(data);
      if (ws.length === 0) throw new Error("No speech found in this clip");
      setWords(ws);
      setKilled(new Set());
    });

  const markFillers = () => {
    const ranges = fillerRanges(words);
    const next = new Set(killed);
    words.forEach((w, i) => {
      if (ranges.some((r) => w.start >= r.range.start - 1e-3 && w.end <= r.range.end + 1e-3)) next.add(i);
    });
    setKilled(next);
    say(`${next.size} filler word${next.size === 1 ? "" : "s"} marked — tap any word to toggle, then apply.`);
  };

  const applyWordCuts = () =>
    run("Cutting the words…", async () => {
      const p = needPlan();
      if (!p || killed.size === 0) return;
      const cuts = wordCutRanges([...killed].map((i) => words[i]));
      const res = tightenSilences(p, new Map([[txClip, cuts]]), { pad: 0 });
      setPlan(res.plan);
      setKilled(new Set());
      say(`${cuts.length} cut${cuts.length === 1 ? "" : "s"} applied from the transcript (${res.removedSeconds.toFixed(1)}s removed).`);
    });

  // ---- handoff ------------------------------------------------------------------------------

  const handleImportProject = (file: File) =>
    run("Reading project file…", async () => {
      const res = projectFromFile(await file.text());
      if (!res.ok) throw new Error(res.error);
      const pr = res.project;
      if (pr.blueprint) setBlueprint(pr.blueprint);
      if (pr.plan) setPlan(pr.plan);
      if (pr.studio && typeof pr.studio === "object") setStudio(pr.studio as Parameters<typeof setStudio>[0]);
      const existing = new Set(clips.map((c) => c.id));
      const merged = [...clips, ...pr.clips.filter((c) => !existing.has(c.id))];
      setClips(merged);
      for (const c of pr.clips) await saveClipMeta(c).catch(() => {});
      const incomingNotes = pr.comments ?? [];
      if (incomingNotes.length) setComments(mergeComments(comments, incomingNotes));
      const missing = pr.clips.filter((c) => !existing.has(c.id)).length;
      say(
        `Project restored: plan, studio and blueprint are back.` +
          (incomingNotes.length ? ` ${incomingNotes.length} review note${incomingNotes.length > 1 ? "s" : ""} imported.` : "") +
          (missing > 0 ? ` ${missing} clip${missing > 1 ? "s" : ""} need their media re-added (files stay on-device, so they don't travel in the file).` : "")
      );
    });

  // Apply an imported .cube LUT to a clip via the WASM lut3d filter — a new
  // graded copy is added so the original stays untouched.
  const handleLutImport = (file: File) =>
    run("Applying the LUT…", async () => {
      const clip = clips.find((c) => c.id === lutClip);
      if (!clip) throw new Error("Pick which clip the LUT should be applied to first.");
      const text = await file.text();
      const parsed = parseCube(text);
      if (!parsed.ok) throw new Error(parsed.error);
      const v = await getVideo(clip.id);
      if (!v) throw new Error("Clip missing from storage");
      const out = await applyCubeToClip(v.blob, text);
      if (!out) throw new Error("This FFmpeg build has no lut3d filter — the LUT couldn't be applied at render quality.");
      const id = uuid();
      const name = `${clip.name.replace(/\.[a-z0-9]+$/i, "")} · ${parsed.lut.title.slice(0, 18)}`;
      let thumbnail: string | undefined;
      try {
        thumbnail = await makeThumbnail(out);
      } catch {
        // stripes placeholder is fine
      }
      await saveVideo(id, out, name);
      const derived = { id, name, duration: clip.duration, thumbnail };
      await saveClipMeta(derived).catch(() => {});
      addClip(derived);
      say(`“${parsed.lut.title}” applied — the graded copy joined your clips.`);
    });

  // ---- translation (key-gated) ------------------------------------------------------------------

  const handleTranslate = () =>
    run("Translating captions…", async () => {
      const lines = captionLines.filter(Boolean);
      if (lines.length === 0) throw new Error("Write your captions first — there's nothing to translate yet.");
      const languages = langs.split(/[,\s]+/).filter(Boolean).slice(0, 6);
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: "translate-captions", payload: { lines, languages } }),
      });
      const data = await res.json();
      if (data.available === false) throw new Error(data.error ?? "Needs an AI key for translation");
      const translations: { lang: string; lines: string[] }[] = data.result?.translations ?? [];
      if (translations.length === 0) throw new Error("The model returned no translations");
      const pack = translations.map((t) => `== ${t.lang} ==\n${t.lines.join("\n")}`).join("\n\n");
      download("caption-pack.txt", `== original ==\n${lines.join("\n")}\n\n${pack}`);
      say(`Caption pack downloaded in ${translations.length} language${translations.length > 1 ? "s" : ""}.`);
    });

  const longClips = clips.filter((c) => c.duration > 45);

  return (
    <section className="card mt-5 px-4 py-1">
      <div className="flex items-center justify-between py-3">
        <span className="flex items-center gap-2 text-sm font-bold">
          <SlidersHorizontal size={15} className="text-accent" /> Pro Tools
        </span>
        {busy && <span className="text-[10px] text-accent">{busy}</span>}
      </div>
      {(note || error) && (
        <p className={`mb-2 rounded-lg px-3 py-2 text-xs leading-5 ${error ? "bg-red-500/10 text-red-400" : "bg-accent/10 text-accent"}`}>
          {error ?? note}
        </p>
      )}

      <Section icon={<Scissors size={14} className="text-accent" />} title="Cut Cleanup">
        <div className="flex flex-wrap gap-1.5">
          <button className={btnAccent} disabled={!!busy} onClick={handleTighten}>Tighten dead air</button>
          <button className={btn} disabled={!!busy} onClick={handleCutaways}>Auto B-roll cutaways</button>
          <button className={btn} disabled={!!busy} onClick={handleSpeakerCut}>
            <span className="flex items-center gap-1"><Users size={12} /> Speaker cut (multi-cam)</span>
          </button>
        </div>
        <p className="mt-2 text-[10px] leading-4 text-neutral-600">
          Tighten removes silent stretches as jump cuts. Cutaways hide B-roll at speech gaps. Speaker cut rebuilds the timeline
          from 2–4 cameras rolling on the same conversation, cutting to whoever talks. All undoable.
        </p>
      </Section>

      <Section icon={<Sparkle size={14} className="text-accent" />} title="Long Recording → Shorts">
        {longClips.length === 0 ? (
          <p className="text-xs text-neutral-500">Add a clip over 45s (a podcast, stream, or vlog take) and ranked short-clip candidates appear here.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <select value={longFor} onChange={(e) => setLongFor(e.target.value)} className="rounded-lg border border-card-border bg-black px-2 py-1.5 text-xs">
                <option value="">Pick a recording…</option>
                {longClips.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({Math.round(c.duration)}s)</option>
                ))}
              </select>
              <button className={btnAccent} disabled={!!busy || !longFor} onClick={handleLongform}>Find the best clips</button>
            </div>
            {candidates.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {candidates.map((cand, i) => (
                  <button
                    key={i}
                    onClick={() => applyCandidate(cand, longFor)}
                    className="block w-full rounded-lg border border-card-border px-3 py-2 text-left text-xs hover:border-accent"
                  >
                    <span className="font-semibold text-accent">{cand.score}</span>
                    <span className="ml-2 text-neutral-300">{cand.start.toFixed(0)}s–{cand.end.toFixed(0)}s</span>
                    <span className="ml-2 text-neutral-500">{cand.reason}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </Section>

      <Section icon={<SearchCheck size={14} className="text-accent" />} title="Find Similar Shots">
        <div className="flex flex-wrap items-center gap-1.5">
          <select value={simFor} onChange={(e) => setSimFor(e.target.value)} className="rounded-lg border border-card-border bg-black px-2 py-1.5 text-xs">
            <option value="">Like which clip…</option>
            {clips.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button className={btnAccent} disabled={!!busy || !simFor || clips.length < 2} onClick={handleSimilar}>Search my library</button>
        </div>
        {similar.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs">
            {similar.map((s) => (
              <li key={s.clipId} className="text-neutral-300">
                {Math.round(s.similarity * 100)}% — {clips.find((c) => c.id === s.clipId)?.name ?? s.clipId}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[10px] text-neutral-600">Color-layout + motion matching, on-device — no model download.</p>
      </Section>

      <Section icon={<Layers size={14} className="text-accent" />} title="Split Screen & PiP">
        <p className="mb-1.5 text-[10px] uppercase tracking-wider text-neutral-600">2-up split screen</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <select value={ssA} onChange={(e) => setSsA(e.target.value)} className="rounded-lg border border-card-border bg-black px-2 py-1.5 text-xs">
            <option value="">Clip A…</option>
            {clips.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={ssB} onChange={(e) => setSsB(e.target.value)} className="rounded-lg border border-card-border bg-black px-2 py-1.5 text-xs">
            <option value="">Clip B…</option>
            {clips.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={ssDir} onChange={(e) => setSsDir(e.target.value as "v" | "h")} className="rounded-lg border border-card-border bg-black px-2 py-1.5 text-xs">
            <option value="v">Top / bottom</option>
            <option value="h">Side by side</option>
          </select>
          <button className={btnAccent} disabled={!!busy || !ssA || !ssB} onClick={handleSplit}>Make split</button>
        </div>
        <p className="mb-1.5 mt-3 text-[10px] uppercase tracking-wider text-neutral-600">Picture-in-picture (reaction)</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <select value={pipMain} onChange={(e) => setPipMain(e.target.value)} className="rounded-lg border border-card-border bg-black px-2 py-1.5 text-xs">
            <option value="">Main…</option>
            {clips.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={pipOver} onChange={(e) => setPipOver(e.target.value)} className="rounded-lg border border-card-border bg-black px-2 py-1.5 text-xs">
            <option value="">Inset…</option>
            {clips.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={pipCorner} onChange={(e) => setPipCorner(e.target.value as typeof pipCorner)} className="rounded-lg border border-card-border bg-black px-2 py-1.5 text-xs">
            <option value="br">Bottom right</option>
            <option value="bl">Bottom left</option>
            <option value="tr">Top right</option>
            <option value="tl">Top left</option>
          </select>
          <button className={btnAccent} disabled={!!busy || !pipMain || !pipOver} onClick={handlePip}>Make PiP</button>
        </div>
        <p className="mt-2 text-[10px] text-neutral-600">Each makes a new clip on your shelf — the originals stay put.</p>
      </Section>

      <Section icon={<Repeat size={14} className="text-accent" />} title="Repeat-Take Detector">
        <button className={btnAccent} disabled={!!busy || clips.length < 2} onClick={handleRepeatTakes}>Find duplicate takes</button>
        {takes && takes.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {takes.map((g, i) => (
              <div key={i} className="rounded-lg border border-card-border px-3 py-2 text-xs">
                <p className="text-neutral-200">Keep <span className="text-accent">{clips.find((c) => c.id === g.keep)?.name ?? g.keep}</span></p>
                <p className="text-[11px] text-neutral-500">
                  {Math.round(g.similarity * 100)}% match to: {g.duplicates.map((d) => clips.find((c) => c.id === d)?.name ?? d).join(", ")}
                </p>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-[10px] text-neutral-600">Groups near-identical shots so you keep the best and drop the rest.</p>
      </Section>

      <Section icon={<Users size={14} className="text-accent" />} title="Multi-Cam Audio Sync">
        <button className={btnAccent} disabled={!!busy || clips.length < 2} onClick={handleAlign}>Align clips by sound</button>
        {aligned && (
          <div className="mt-2 space-y-1 text-xs">
            {aligned.map((a) => (
              <p key={a.clipId} className={a.aligned ? "text-neutral-300" : "text-yellow-400"}>
                {clips.find((c) => c.id === a.clipId)?.name ?? a.clipId}: {a.aligned ? `trim ${a.offsetSec}s off the head (match ${Math.round(a.score * 100)}%)` : "no common moment found"}
              </p>
            ))}
          </div>
        )}
        <p className="mt-2 text-[10px] text-neutral-600">Finds the offset that lines up cameras that recorded the same moment — feed the aligned clips to the speaker cut.</p>
      </Section>

      <Section icon={<GitCompare size={14} className="text-accent" />} title="Reshoot Compare">
        <div className="flex flex-wrap items-center gap-1.5">
          <select value={reshootA} onChange={(e) => setReshootA(e.target.value)} className="rounded-lg border border-card-border bg-black px-2 py-1.5 text-xs">
            <option value="">Previous take…</option>
            {clips.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={reshootB} onChange={(e) => setReshootB(e.target.value)} className="rounded-lg border border-card-border bg-black px-2 py-1.5 text-xs">
            <option value="">Reshoot…</option>
            {clips.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className={btnAccent} disabled={!!busy || !reshootA || !reshootB} onClick={handleReshoot}>Compare</button>
        </div>
        {reshoot && (
          <div className="mt-2 rounded-lg border border-card-border p-3 text-xs">
            <p className="text-sm font-bold">
              <span className="text-neutral-500">{reshoot.scorePrev}</span>
              <span className="mx-2 text-neutral-600">→</span>
              <span className={reshoot.scoreCurr >= reshoot.scorePrev ? "text-green-400" : "text-red-400"}>{reshoot.scoreCurr}</span>
            </p>
            <p className="mt-0.5 text-[11px] text-neutral-400">{reshoot.verdict}</p>
            <ul className="mt-1.5 space-y-0.5">
              {reshoot.deltas.map((d, i) => (
                <li key={i} className="text-[11px] text-neutral-500">{d.label}: {d.note}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-2 text-[10px] text-neutral-600">Scores steadiness, exposure, energy and even lighting so you keep the better take.</p>
      </Section>

      <Section icon={<AudioLines size={14} className="text-accent" />} title="Audio & Rights">
        {!music && <p className="mb-2 text-xs text-neutral-500">Add a music/voiceover track to unlock the cleanup + rights tools.</p>}
        <div className="flex flex-wrap gap-1.5">
          <button className={btn} disabled={!!busy || !music} onClick={handleCopyright}>
            <span className="flex items-center gap-1"><ShieldAlert size={12} /> Copyright check</span>
          </button>
          <button className={btn} disabled={!!busy || !music} onClick={handleStudioSound}>Studio sound</button>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="rounded-lg border border-card-border bg-black px-2 py-1.5 text-xs">
            {PLATFORM_TARGETS.map((p) => (
              <option key={p.id} value={p.id}>{p.label} ({p.lufs} LUFS)</option>
            ))}
          </select>
          <button className={btn} disabled={!!busy || !music} onClick={handleLoudness}>Match loudness</button>
        </div>
        {risk && (
          <p className={`mt-2 rounded-lg px-3 py-2 text-xs leading-5 ${risk.level === "high" ? "bg-red-500/10 text-red-400" : risk.level === "caution" ? "bg-yellow-500/10 text-yellow-400" : "bg-white/5 text-neutral-400"}`}>
            <strong>{risk.headline}</strong> {risk.detail}
          </p>
        )}
        <div className="mt-3 flex items-center gap-1.5">
          <input
            value={stockQ}
            onChange={(e) => setStockQ(e.target.value)}
            placeholder="Find CC music: “upbeat”, “lofi”, “cinematic”…"
            className="w-full rounded-lg border border-card-border bg-black px-3 py-2 text-xs outline-none placeholder:text-neutral-700 focus:border-accent"
          />
          <button className={btnAccent} disabled={!!busy || stockQ.trim().length < 2} onClick={handleStockSearch}>Search</button>
        </div>
        {stockResults.length > 0 && (
          <div className="mt-2 max-h-44 space-y-1 overflow-y-auto">
            {stockResults.map((r) => (
              <button key={r.id} onClick={() => pickStock(r)} className="block w-full rounded-lg border border-card-border px-3 py-1.5 text-left text-xs hover:border-accent">
                <span className="text-neutral-200">{r.title}</span>
                <span className="ml-2 text-neutral-500">{r.creator} · {r.license}{r.duration ? ` · ${r.duration}s` : ""}</span>
              </button>
            ))}
          </div>
        )}
        {assets.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-[10px] uppercase tracking-wider text-neutral-600">License tracker ({assets.length})</p>
            <button className={btn} onClick={() => { navigator.clipboard.writeText(attributionText(assets)); say("Attribution text copied — paste it in your post description."); }}>
              <span className="flex items-center gap-1"><Copy size={12} /> Copy attribution</span>
            </button>
          </div>
        )}
        <p className="mt-2 text-[10px] leading-4 text-neutral-600">
          Copyright check reads the file&apos;s tags (not fingerprinting — platforms fingerprint, so treat commercial releases as risky).
          CC search runs on Openverse, keyless; every pick lands in the license tracker automatically.
        </p>
      </Section>

      <Section icon={<Mic2 size={14} className="text-accent" />} title="AI Voiceover">
        <textarea
          value={ttsText}
          onChange={(e) => setTtsText(e.target.value)}
          placeholder="Type the narration script — it becomes a spoken track under your edit."
          rows={2}
          className="w-full rounded-lg border border-card-border bg-black px-3 py-2 text-xs outline-none placeholder:text-neutral-700 focus:border-accent"
        />
        <button className={`${btnAccent} mt-1.5`} disabled={!!busy || ttsText.trim().length < 4} onClick={handleTts}>Generate voiceover</button>
        <p className="mt-1.5 text-[10px] text-neutral-600">Needs MINIMAX_API_KEY in .env.local. The script is sent to MiniMax; nothing else leaves the device.</p>
      </Section>

      <Section icon={<Wand2 size={14} className="text-accent" />} title="Hook Writer">
        <button className={btnAccent} onClick={handleHooks}>{hooks.length ? "Reroll hooks" : `Write hooks for ${blueprint?.niche?.label ?? "my niche"}`}</button>
        {hooks.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {hooks.map((h, i) => (
              <li key={i} className="rounded-lg border border-card-border px-3 py-2 text-xs">
                <button className="float-right p-0.5 text-neutral-600" aria-label={`Copy hook ${i + 1}`} onClick={() => navigator.clipboard.writeText(h.line)}>
                  <Copy size={12} />
                </button>
                <span className="text-neutral-200">{h.line}</span>
                <span className="mt-0.5 block text-[10px] text-neutral-600">{h.pattern} — {h.why}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section icon={<FileText size={14} className="text-accent" />} title="Edit by Text">
        <div className="flex flex-wrap items-center gap-1.5">
          <select value={txClip} onChange={(e) => setTxClip(e.target.value)} className="rounded-lg border border-card-border bg-black px-2 py-1.5 text-xs">
            <option value="">Transcribe which clip…</option>
            {clips.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button className={btnAccent} disabled={!!busy || !txClip} onClick={handleTranscribe}>Transcribe</button>
          {words.length > 0 && (
            <>
              <button className={btn} disabled={!!busy} onClick={markFillers}>Mark ums & fillers</button>
              <button className={btnAccent} disabled={!!busy || killed.size === 0} onClick={applyWordCuts}>Cut {killed.size || ""} marked</button>
            </>
          )}
        </div>
        {words.length > 0 && (
          <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-card-border p-2 leading-6">
            {transcriptLines(words).map((line, li) => (
              <p key={li} className="text-xs">
                {line.map((w) => {
                  const idx = words.indexOf(w);
                  const dead = killed.has(idx);
                  return (
                    <button
                      key={idx}
                      onClick={() => {
                        const next = new Set(killed);
                        if (dead) next.delete(idx);
                        else next.add(idx);
                        setKilled(next);
                      }}
                      className={`mr-1 rounded px-0.5 ${dead ? "bg-red-500/25 text-red-300 line-through" : "text-neutral-300 hover:bg-white/10"}`}
                    >
                      {w.w}
                    </button>
                  );
                })}
              </p>
            ))}
          </div>
        )}
        <p className="mt-1.5 text-[10px] text-neutral-600">
          Descript-style: tap words to delete them from the VIDEO. Whisper transcription needs OPENAI_API_KEY; the cutting itself is local.
        </p>
      </Section>

      <Section icon={<Languages size={14} className="text-accent" />} title="Caption Translations">
        <div className="flex items-center gap-1.5">
          <input
            value={langs}
            onChange={(e) => setLangs(e.target.value)}
            placeholder="es, pt-BR, hi, ja"
            className="w-full rounded-lg border border-card-border bg-black px-3 py-2 text-xs outline-none placeholder:text-neutral-700 focus:border-accent"
          />
          <button className={btnAccent} disabled={!!busy} onClick={handleTranslate}>Translate</button>
        </div>
        <p className="mt-1.5 text-[10px] text-neutral-600">Downloads a caption pack in each language (needs any AI key). Lines stay count-matched for re-timing.</p>
      </Section>

      <Section icon={<Download size={14} className="text-accent" />} title="Handoff (Premiere / Resolve / FCP)">
        <div className="flex flex-wrap gap-1.5">
          <button
            className={btn}
            disabled={!plan}
            onClick={() =>
              plan &&
              download(
                "viraledit.edl",
                edlFromPlan(plan, clips, {
                  title: "ViralEdit",
                  dissolve: (t) => {
                    const r = transitionByType(t as Parameters<typeof transitionByType>[0]);
                    return r.xfade ? r.defaultDuration : 0;
                  },
                })
              )
            }
          >
            Export EDL
          </button>
          <button className={btn} disabled={!plan} onClick={() => plan && download("viraledit.fcpxml", fcpxmlFromPlan(plan, clips), "application/xml")}>
            Export FCPXML
          </button>
          <button
            className={btn}
            onClick={() => {
              const cube = gradeToCube(studio.look.grade);
              download(cube.filename, cube.text);
              say(`LUT baked from the “${studio.look.grade}” grade — load it in your NLE's Lumetri/Color page.`);
            }}
          >
            Export look as .cube LUT
          </button>
          <button
            className={btn}
            onClick={() =>
              download(
                "project.viraledit.json",
                projectToFile({ blueprint, plan, studio, clips, comments, exportedAt: Date.now() }),
                "application/json"
              )
            }
          >
            Export project file
          </button>
          <label className={`${btn} cursor-pointer`}>
            <span className="flex items-center gap-1"><Upload size={12} /> Import project file</span>
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImportProject(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <select value={lutClip} onChange={(e) => setLutClip(e.target.value)} className="rounded-lg border border-card-border bg-black px-2 py-1.5 text-xs">
            <option value="">Apply a LUT to which clip…</option>
            {clips.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <label className={`${btn} cursor-pointer ${!lutClip || busy ? "opacity-40" : ""}`}>
            <span className="flex items-center gap-1"><Upload size={12} /> Import .cube LUT</span>
            <input
              type="file"
              accept=".cube"
              className="hidden"
              disabled={!lutClip || !!busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleLutImport(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <p className="mt-2 text-[10px] leading-4 text-neutral-600">
          The cut list leaves the app: EDL (universal), FCPXML (Final Cut / Resolve), your grade as an industry .cube LUT, or the whole
          project as a file (media stays on your device — the file carries the recipe, not the footage).
        </p>
      </Section>

      <Section icon={<MessageSquare size={14} className="text-accent" />} title="Review Notes">
        <p className="mb-2 text-[10px] leading-4 text-neutral-500">
          Leave timestamped notes on the edit. They save inside the exported project file — hand the file to a
          collaborator and they see every note at its timecode. (Live realtime threads are coming soon.)
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            value={noteTime}
            onChange={(e) => setNoteTime(e.target.value)}
            inputMode="decimal"
            placeholder="0:00 → secs"
            className="w-20 rounded-lg border border-card-border bg-black px-2 py-1.5 text-xs"
            aria-label="Note time in seconds"
          />
          <input
            value={noteAuthor}
            onChange={(e) => setNoteAuthor(e.target.value)}
            placeholder="Your name"
            className="w-24 rounded-lg border border-card-border bg-black px-2 py-1.5 text-xs"
            aria-label="Your name"
          />
          <input
            value={noteBody}
            onChange={(e) => setNoteBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addReviewNote();
              }
            }}
            placeholder="Note — e.g. “tighten this cut”"
            className="min-w-0 flex-1 rounded-lg border border-card-border bg-black px-2 py-1.5 text-xs"
            aria-label="Note text"
          />
          <button className={btn} onClick={addReviewNote}>
            <span className="flex items-center gap-1"><Plus size={12} /> Add</span>
          </button>
        </div>
        {comments.length > 0 && (
          <>
            <div className="mt-2 flex items-center justify-between text-[10px] text-neutral-500">
              <span>{reviewSummary(comments).open} open · {reviewSummary(comments).resolved} resolved</span>
              <button className="underline" onClick={exportNotes}>Export as text</button>
            </div>
            <ul className="mt-1.5 flex flex-col gap-1">
              {comments.map((c: ReviewComment) => (
                <li key={c.id} className="flex items-start gap-2 rounded-lg border border-card-border px-2.5 py-1.5 text-xs">
                  <span className="mt-0.5 font-mono text-[10px] text-accent">{timecode(c.time)}</span>
                  <span className={`min-w-0 flex-1 ${c.resolved ? "text-neutral-600 line-through" : "text-neutral-300"}`}>
                    <span className="text-neutral-500">{c.author}: </span>{c.body}
                  </span>
                  <button
                    onClick={() => setComments(setResolved(comments, c.id, !c.resolved))}
                    className={c.resolved ? "text-green-400" : "text-neutral-600"}
                    aria-label={c.resolved ? "Mark open" : "Mark resolved"}
                  >
                    <Check size={13} />
                  </button>
                  <button onClick={() => setComments(deleteComment(comments, c.id))} className="text-neutral-600" aria-label="Delete note">
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <Section icon={<Library size={14} className="text-accent" />} title="Shared Library">
        <p className="mb-2 text-[10px] leading-4 text-neutral-500">
          Save the looks, grades and brand kits you reuse, then apply them in any project. Export the whole kit as one
          file to share with your team. (Cloud-synced team libraries are coming soon.)
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            value={libSaveName}
            onChange={(e) => setLibSaveName(e.target.value)}
            placeholder="Name this preset (optional)"
            className="min-w-0 flex-1 rounded-lg border border-card-border bg-black px-2 py-1.5 text-xs"
            aria-label="Library item name"
          />
          <button className={btn} disabled={!!busy} onClick={saveLookToLibrary}>Save current look</button>
          <button className={btn} disabled={!!busy} onClick={saveBrandToLibrary}>Save brand kit</button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button className={btn} onClick={exportLibraryFile}>
            <span className="flex items-center gap-1"><Download size={12} /> Export kit</span>
          </button>
          <label className={`${btn} cursor-pointer`}>
            <span className="flex items-center gap-1"><Upload size={12} /> Import kit</span>
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importLibraryFile(f);
                e.target.value = "";
              }}
            />
          </label>
          {library.length > 3 && (
            <input
              value={libQuery}
              onChange={(e) => setLibQuery(e.target.value)}
              placeholder="Filter…"
              className="w-24 rounded-lg border border-card-border bg-black px-2 py-1.5 text-xs"
              aria-label="Filter library"
            />
          )}
        </div>
        {library.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1">
            {searchItems(library, libQuery).map((it) => {
              const kind = LIBRARY_KINDS.find((k) => k.kind === it.kind);
              const applicable = it.kind === "look" || it.kind === "brand";
              return (
                <li key={it.id} className="flex items-center gap-2 rounded-lg border border-card-border px-2.5 py-1.5 text-xs">
                  <span>{kind?.emoji ?? "📦"}</span>
                  <span className="min-w-0 flex-1 truncate text-neutral-300">{it.name}</span>
                  <span className="text-[10px] text-neutral-600">{kind?.label ?? it.kind}</span>
                  {applicable && (
                    <button onClick={() => applyLibraryItem(it)} className="text-accent" disabled={!!busy}>Apply</button>
                  )}
                  <button onClick={() => removeLibraryItem(it.id)} className="text-neutral-600" aria-label="Remove from library" disabled={!!busy}>
                    <Trash2 size={13} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-[10px] text-neutral-600">Your library is empty — save a look or brand kit to start your reusable kit.</p>
        )}
      </Section>

      <Section icon={<Sparkle size={14} className="text-accent" />} title="AI Frame Studio">
        <p className="mb-2 text-[10px] leading-4 text-neutral-500">
          Generative edits that need a bigger model than runs on-device — sky replacement, relighting, object removal,
          eye-contact, and outpainting — applied to a still frame (a cover, title background, or B-roll plate).
          Needs <span className="text-neutral-300">FAL_KEY</span> in <span className="text-neutral-300">.env.local</span>.
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <label className={`${btn} cursor-pointer`}>
            <span className="flex items-center gap-1"><Upload size={12} /> Pick a frame</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) loadFrame(f);
                e.target.value = "";
              }}
            />
          </label>
          {FRAME_TASKS.map((t) => (
            <button
              key={t.id}
              onClick={() => setFrameTask(t.id)}
              className={`rounded-full px-3 py-1.5 text-xs ${frameTask === t.id ? "bg-accent/15 font-semibold text-accent" : "border border-card-border text-neutral-400"}`}
            >
              {t.label}
            </button>
          ))}
          <button className={btn} disabled={!frameSrc || !!busy} onClick={runFrameEdit}>Apply AI edit</button>
        </div>
        {(frameSrc || frameOut) && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            {frameSrc && (
              <div>
                <p className="mb-1 text-[10px] text-neutral-600">Source</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={frameSrc} alt="source frame" className="w-full rounded-lg border border-card-border" />
              </div>
            )}
            {frameOut && (
              <div>
                <p className="mb-1 text-[10px] text-neutral-600">Edited</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={frameOut} alt="edited frame" className="w-full rounded-lg border border-accent" />
                <a href={frameOut} download="frame-edit.png" target="_blank" rel="noreferrer" className="mt-1 block text-[11px] font-semibold text-accent">
                  Download edited frame
                </a>
              </div>
            )}
          </div>
        )}
      </Section>
    </section>
  );
}
