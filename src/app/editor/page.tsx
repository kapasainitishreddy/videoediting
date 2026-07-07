"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Captions, Crosshair, Eraser, Mic, Music, Plus, ScanFace, Sparkles, Trash2, Wand2, X } from "lucide-react";
import { v4 as uuid } from "uuid";
import { saveVideo, getVideo, saveClipMeta, deleteClipMeta, listClipMetas, deleteVideo, savePlan, saveRenderedVideo } from "@/lib/storage";
import { probeDuration, makeThumbnail, renderEdit, getFFmpeg, type BurnCaption, type RenderOptions } from "@/lib/ffmpeg-client";
import { smartAutoEdit } from "@/lib/auto-edit";
import { detectBeats, type BeatResult } from "@/lib/beats";
import { CAPTION_STYLES, type CaptionStyleId, layoutCaptions, renderCuePng } from "@/lib/captions";
import { kineticWordCues, renderTitleCard, renderCreditsPages } from "@/lib/titles";
import { measureColor, normalizeFilter } from "@/lib/cinematic";
import { analyzeClip, type ClipAnalysis } from "@/lib/clip-analysis";
import { isStaticShot, motionCentroidX, reframeFilter } from "@/lib/motion";
import { generateOverlayClip } from "@/lib/overlays";
import { composeScore, mixTimeline, SFX_FOR_TRANSITION, type SfxType } from "@/lib/audio-cinema";
import { compileDirection, applyPlanOps, mergeCompiled, type CompiledDirection } from "@/lib/prompt-compiler";
import { resolveTransitionSfx } from "@/lib/sfx-web";
import { applyTaste, restrainSfx, cleanCaptionWindows } from "@/lib/taste";
import { GENRE_PRESETS, compilePreset, brandFilterFromHex } from "@/lib/creator-kit";
import { counterCues, countdownCues, locationCard, progressBarCues, emojiCueTimes, emojiReactionCues, watermarkCue } from "@/lib/overlays-plus";
import { distillWindows, detectBars } from "@/lib/clip-analysis";
import { trackFace, trackAction, detectClipKeyColor, detectFacesAt } from "@/lib/track-client";
import { pathCenter, mapToCenterCrop, type TrackPath } from "@/lib/track-core";
import { DEFAULT_CHROMA, type ChromaSettings } from "@/lib/chroma";
import { removeBackground } from "@/lib/segmenter";
import { removeWatermark, blurFillClip, portraitBlurClip, privacyBlurClip, freezeFrameClip } from "@/lib/ffmpeg-client";
import { VIRTUAL_SETS, isVirtualSet, renderVirtualSet } from "@/lib/vset";
import ProTools from "@/components/ProTools";
import { normalizeAudioBlob, roomTone } from "@/lib/audio-polish";
import { estimateRenderCost, renderCostMessage } from "@/lib/render-cost";
import { withCredit } from "@/lib/wallet";
import CreditsChip from "@/components/CreditsChip";
import { checkClipLimits } from "@/lib/limits";
import { reportError } from "@/lib/report-error";
import StudioPanel from "@/components/StudioPanel";
import InsightsPanel from "@/components/InsightsPanel";
import CommandPalette from "@/components/CommandPalette";
import { TRANSITIONS, transitionByType, COLOR_GRADES } from "@/lib/transitions";
import { useProject } from "@/store/project";
import type { TransitionType, UserClip } from "@/lib/types";

const PROMPT_IDEAS = [
  "make it cinematic",
  "fast cuts, high energy",
  "smooth zoom transitions",
  "warm travel vibe",
  "calm & aesthetic",
  "edgy glitch style",
];

export default function EditorPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const musicRef = useRef<HTMLInputElement>(null);
  const { blueprint, clips, setClips, addClip, updateClip, removeClip, plan, setPlan, undoPlan, planHistory, setRenderedUrl, studio, setStudio } = useProject();

  const [music, setMusic] = useState<{ name: string; blob: Blob } | null>(null);
  const [beats, setBeats] = useState<BeatResult | null>(null);
  const [captionText, setCaptionText] = useState("");
  const [captionStyle, setCaptionStyle] = useState<CaptionStyleId>("bold");
  // Overlays+ : location card, counter, countdown, progress bar, emoji
  // reactions, watermark. All burned via the caption pipeline at render.
  const [locationText, setLocationText] = useState("");
  const [counter, setCounter] = useState<{ prefix: string; from: string; to: string }>({ prefix: "Day ", from: "", to: "" });
  const [countdownIntro, setCountdownIntro] = useState(false);
  const [progressBar, setProgressBar] = useState(false);
  const [emojiReacts, setEmojiReacts] = useState(false);
  const [watermark, setWatermark] = useState<{ name: string; blob: Blob } | null>(null);
  const watermarkRef = useRef<HTMLInputElement>(null);
  const [direction, setDirection] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [renderPct, setRenderPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<number | null>(null); // segment index
  const [toolsFor, setToolsFor] = useState<string | null>(null); // clip id → AI tools card
  // Multi-face picker: several faces were found — the user chooses which one
  // the lock follows before any tracking runs.
  const [faceChoices, setFaceChoices] = useState<{ clipId: string; faces: { cx: number; cy: number; size: number }[] } | null>(null);
  const [draftUrl, setDraftUrl] = useState<string | null>(null); // quick low-res cut preview
  const [listening, setListening] = useState(false);
  const [tasteNotes, setTasteNotes] = useState<string[]>([]);
  // Tracks the last render stage so a mid-pipeline failure tells the user
  // WHICH step broke (captions vs color match vs mux) instead of a bare
  // "render failed" that gives no clue what to retry or report.
  const renderStageRef = useRef<string | null>(null);
  const ffmpegLoadedRef = useRef(false);
  // Per-clip motion/brightness analysis is the single most expensive thing a
  // render does (seek-heavy). Cache it by clipId so auto Ken Burns, emoji
  // reactions, AND repeat renders reuse ONE pass per clip instead of 2–3.
  // Clip bytes are immutable per id, so the cache never goes stale; it's
  // cleared when clips are removed.
  const analysisRef = useRef<Map<string, ClipAnalysis>>(new Map());
  const getAnalysis = async (id: string, blob: Blob): Promise<ClipAnalysis> => {
    const cached = analysisRef.current.get(id);
    if (cached) return cached;
    const a = await analyzeClip(blob, { samplesPerSecond: 5, maxSamples: 60 });
    analysisRef.current.set(id, a);
    return a;
  };
  // Subject-track paths are expensive (a seek-heavy ML pass per clip) and
  // clip bytes are immutable per id — cache by clipId + mode, like analysisRef.
  // facePathsRef additionally remembers "tried, no face" (null) so auto
  // punch-in never re-scans a faceless clip.
  const trackPathsRef = useRef<Map<string, { mode: "face" | "action"; path: TrackPath }>>(new Map());
  const facePathsRef = useRef<Map<string, TrackPath | null>>(new Map());
  const setStage = (msg: string) => {
    renderStageRef.current = msg;
    setBusy(msg);
  };

  // #8 uniqueness: voice-directed editing via the Web Speech API
  function handleVoiceDirection() {
    type SR = { new (): { lang: string; onresult: (e: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void; onend: () => void; onerror: () => void; start: () => void } };
    const w = window as unknown as { SpeechRecognition?: SR; webkitSpeechRecognition?: SR };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setError("Voice input isn't supported in this browser — type your direction instead.");
      return;
    }
    const rec = new Ctor();
    rec.lang = "en-US";
    setListening(true);
    rec.onresult = (e) => setDirection(e.results[0][0].transcript);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.start();
  }

  // `plan`, `blueprint`, and `studio` survive a reload automatically via
  // the store's sessionStorage persistence (store/project.ts). This is a
  // fallback ONLY for `clips`: if sessionStorage was cleared (private
  // browsing, manual clear) but the actual video files are still in
  // IndexedDB, recover the clip list from there so footage isn't
  // orphaned with no way to reference it.
  useEffect(() => {
    if (clips.length === 0) {
      listClipMetas().then((metas) => metas.length && setClips(metas)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleFiles(files: FileList) {
    setError(null);
    for (const f of Array.from(files)) {
      setBusy(`Adding ${f.name}…`);
      try {
        const duration = await probeDuration(f);
        const check = checkClipLimits(f, duration);
        if (!check.ok) {
          setError(check.reason!);
          continue;
        }
        const id = uuid();
        const thumbnail = await makeThumbnail(f);
        // Strip letterbox/pillarbox bars baked into the source file — the
        // crop rides the clip meta and is applied before reframe at render.
        let sourceCrop: string | undefined;
        try {
          const bars = await detectBars(f);
          if (bars) sourceCrop = bars.crop;
        } catch {
          // bar detection is best-effort
        }
        await saveVideo(id, f, f.name);
        const clip: UserClip = { id, name: f.name, duration, thumbnail, sourceCrop };
        await saveClipMeta(clip);
        addClip(clip);
      } catch {
        setError(`Couldn't read ${f.name}`);
      }
    }
    setBusy(null);
  }

  // Distill a long clip into a highlight reel: analyze once, keep the best
  // non-overlapping moments (~12s worth), and load them as the plan.
  async function handleDistill(clip: UserClip) {
    setError(null);
    try {
      setBusy(`Finding the best moments in ${clip.name}…`);
      const v = await getVideo(clip.id);
      if (!v) throw new Error("Clip missing from storage");
      const analysis = await analyzeClip(v.blob, { samplesPerSecond: 4, maxSamples: 160 });
      const windows = distillWindows(analysis, 12);
      const segments = windows.map((w, i) => ({
        id: uuid(),
        clipId: clip.id,
        start: w.start,
        end: w.end,
        transitionAfter: i === windows.length - 1 ? null : ("hard-cut" as const),
        speed: 1,
      }));
      const p = {
        segments,
        colorGrade: plan?.colorGrade ?? "none",
        aiDirection: direction,
        explanation: `Highlight reel: the ${windows.length} strongest moments distilled from ${clip.name} (${clip.duration.toFixed(0)}s → ~12s).`,
      };
      setPlan(p);
      await savePlan("current", p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't distill that clip");
    } finally {
      setBusy(null);
    }
  }

  // One-tap genre preset: fills the direction AND applies the compiled
  // pipeline immediately (same engine as typing the prompt).
  function applyPreset(presetId: string) {
    const preset = GENRE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setDirection(preset.direction);
    const compiled = compilePreset(preset);
    applyDirectionToStudio(compiled);
    if (plan && (compiled.plan.transitionCycle || compiled.plan.transitionMap)) {
      setPlan({
        ...plan,
        colorGrade: compiled.plan.colorGrade ?? plan.colorGrade,
        segments: applyPlanOps(plan.segments, compiled.plan),
      });
    }
  }

  async function handleRemoveClip(id: string) {
    removeClip(id);
    analysisRef.current.delete(id);
    trackPathsRef.current.delete(id);
    facePathsRef.current.delete(id);
    if (toolsFor === id) setToolsFor(null);
    await Promise.all([deleteClipMeta(id), deleteVideo(id)]);
  }

  // ---- AI subject tools (per-clip, all on-device) --------------------------

  // Face lock / Action lock: run the tracker NOW (instant feedback if there's
  // no face / no motion to follow), cache the path, persist only the intent.
  async function handleTrackToggle(clip: UserClip, mode: "face" | "action", near?: { cx: number; cy: number }) {
    setError(null);
    setFaceChoices(null);
    if (clip.track === mode && !near) {
      trackPathsRef.current.delete(clip.id);
      updateClip(clip.id, { track: null });
      await saveClipMeta({ ...clip, track: null }).catch(() => {});
      return;
    }
    try {
      setBusy(mode === "face" ? `Locking onto the face in ${clip.name}…` : `Reading the motion in ${clip.name}…`);
      const v = await getVideo(clip.id);
      if (!v) throw new Error("Clip missing from storage");
      // Several faces in frame → let the user pick WHO to follow first
      if (mode === "face" && !near) {
        const faces = await detectFacesAt(v.blob);
        if (faces.length >= 2) {
          setFaceChoices({ clipId: clip.id, faces });
          setBusy(null);
          return;
        }
      }
      const res =
        mode === "face"
          ? await trackFace(v.blob, { near, onProgress: (f) => setBusy(`Locking onto the face… ${Math.round(f * 100)}%`) })
          : await trackAction(v.blob, { onProgress: (f) => setBusy(`Reading the motion… ${Math.round(f * 100)}%`) });
      if (!res.path) {
        throw new Error(
          mode === "face"
            ? "Couldn't find a steady face in this clip — try Action lock instead."
            : "Not enough motion in this clip to follow."
        );
      }
      trackPathsRef.current.set(clip.id, { mode, path: res.path });
      if (mode === "face") facePathsRef.current.set(clip.id, res.path);
      updateClip(clip.id, { track: mode });
      await saveClipMeta({ ...clip, track: mode }).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tracking failed");
    } finally {
      setBusy(null);
    }
  }

  // Green screen: auto-detect the key color from the frame border. Refuses
  // politely on normal footage instead of keying random greens.
  async function handleChromaToggle(clip: UserClip) {
    setError(null);
    if (clip.chroma) {
      updateClip(clip.id, { chroma: null });
      await saveClipMeta({ ...clip, chroma: null }).catch(() => {});
      return;
    }
    try {
      setBusy(`Looking for a green/blue screen in ${clip.name}…`);
      const v = await getVideo(clip.id);
      if (!v) throw new Error("Clip missing from storage");
      const key = await detectClipKeyColor(v.blob);
      if (!key) {
        throw new Error(
          "No solid green/blue backdrop found in this clip — green screen needs an even, saturated backdrop behind the subject."
        );
      }
      const chroma = { ...DEFAULT_CHROMA, color: key.color };
      updateClip(clip.id, { chroma });
      await saveClipMeta({ ...clip, chroma }).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Green screen detection failed");
    } finally {
      setBusy(null);
    }
  }

  function setChromaBg(clip: UserClip, bg: string) {
    if (!clip.chroma) return;
    const chroma = { ...clip.chroma, bg };
    updateClip(clip.id, { chroma });
    saveClipMeta({ ...clip, chroma }).catch(() => {});
  }

  // Shared: save a freshly-composited blob as a new clip on the shelf,
  // probing its real duration and thumbnail (both best-effort).
  async function addDerivedClip(base: UserClip, blob: Blob, suffix: string, extra: Partial<UserClip> = {}) {
    const id = uuid();
    const name = `${base.name.replace(/\.[a-z0-9]+$/i, "")} · ${suffix}`;
    let duration = base.duration;
    try {
      const d = await probeDuration(blob);
      if (Number.isFinite(d) && d > 0) duration = d;
    } catch {
      // keep the source duration
    }
    let thumbnail: string | undefined;
    try {
      thumbnail = await makeThumbnail(blob);
    } catch {
      // stripes placeholder is fine
    }
    await saveVideo(id, blob, name);
    const derived: UserClip = { id, name, duration, thumbnail, ...extra };
    await saveClipMeta(derived).catch(() => {});
    addClip(derived);
    setToolsFor(id);
  }

  // Blur-fill: a non-vertical clip fills 9:16 with a defocused copy of
  // itself instead of black bars — the standard social background look.
  async function handleBlurFill(clip: UserClip) {
    setError(null);
    try {
      setBusy(`Blur-filling ${clip.name} to vertical…`);
      const v = await getVideo(clip.id);
      if (!v) throw new Error("Clip missing from storage");
      await addDerivedClip(clip, await blurFillClip(v.blob), "blur-fill");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Blur-fill failed");
    } finally {
      setBusy(null);
    }
  }

  // Portrait blur (fake depth-of-field): sharp subject over a blurred frame.
  // Uses the cached face position if there is one, else the frame center.
  async function handlePortraitBlur(clip: UserClip) {
    setError(null);
    try {
      setBusy(`Adding portrait blur to ${clip.name}…`);
      const v = await getVideo(clip.id);
      if (!v) throw new Error("Clip missing from storage");
      const fp = facePathsRef.current.get(clip.id);
      const c = fp ? pathCenter(fp, 0, fp.duration) : { cx: 0.5, cy: 0.4 };
      await addDerivedClip(clip, await portraitBlurClip(v.blob, c.cx, c.cy), "portrait");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Portrait blur failed");
    } finally {
      setBusy(null);
    }
  }

  // Privacy blur: track a face, then blur a box that follows it.
  async function handlePrivacyBlur(clip: UserClip) {
    setError(null);
    try {
      setBusy(`Finding the face to blur in ${clip.name}…`);
      const v = await getVideo(clip.id);
      if (!v) throw new Error("Clip missing from storage");
      let path = facePathsRef.current.get(clip.id) ?? null;
      if (!path) {
        const res = await trackFace(v.blob, { onProgress: (f) => setBusy(`Tracking the face… ${Math.round(f * 100)}%`) });
        path = res.path;
        facePathsRef.current.set(clip.id, path);
      }
      if (!path) throw new Error("Couldn't find a face to blur in this clip.");
      setBusy(`Blurring the face in ${clip.name}…`);
      await addDerivedClip(clip, await privacyBlurClip(v.blob, path), "face blurred");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Privacy blur failed");
    } finally {
      setBusy(null);
    }
  }

  // Freeze-frame: hold the middle frame for ~1.2s (a call-out beat).
  async function handleFreezeFrame(clip: UserClip) {
    setError(null);
    try {
      setBusy(`Adding a freeze-frame to ${clip.name}…`);
      const v = await getVideo(clip.id);
      if (!v) throw new Error("Clip missing from storage");
      await addDerivedClip(clip, await freezeFrameClip(v.blob, Math.max(0.1, clip.duration / 2), 1.2), "freeze");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Freeze-frame failed");
    } finally {
      setBusy(null);
    }
  }

  // AI background removal: selfie segmentation plays the clip through a
  // canvas once and records a NEW derived clip — the original stays intact.
  async function handleRemoveBg(clip: UserClip) {
    setError(null);
    try {
      setBusy(`Removing the background from ${clip.name}…`);
      const v = await getVideo(clip.id);
      if (!v) throw new Error("Clip missing from storage");
      const { blob } = await removeBackground(v.blob, {
        bg: "blur",
        onProgress: (f) => setBusy(`Removing the background… ${Math.round(f * 100)}% (plays the clip through once)`),
      });
      const id = uuid();
      const name = `${clip.name.replace(/\.[a-z0-9]+$/i, "")} · no bg`;
      let duration = clip.duration;
      try {
        const d = await probeDuration(blob);
        if (Number.isFinite(d) && d > 0) duration = d;
      } catch {
        // MediaRecorder webm sometimes reports no duration — keep the source's
      }
      let thumbnail: string | undefined;
      try {
        thumbnail = await makeThumbnail(blob);
      } catch {
        // stripes placeholder is fine
      }
      await saveVideo(id, blob, name);
      const derived: UserClip = { id, name, duration, thumbnail, bgRemoved: true };
      await saveClipMeta(derived);
      addClip(derived);
      setToolsFor(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Background removal failed on this clip");
    } finally {
      setBusy(null);
    }
  }

  // Watermark removal: the user picks the corner it sits in; FFmpeg's delogo
  // interpolates the box away and a NEW derived clip is added.
  async function handleRemoveWatermark(clip: UserClip, corner: "tl" | "tr" | "bl" | "br") {
    setError(null);
    try {
      setBusy(`Removing the ${corner.toUpperCase()} watermark from ${clip.name}…`);
      const v = await getVideo(clip.id);
      if (!v) throw new Error("Clip missing from storage");
      const dims = await new Promise<{ w: number; h: number }>((res, rej) => {
        const el = document.createElement("video");
        el.preload = "metadata";
        el.muted = true;
        el.onloadedmetadata = () => res({ w: el.videoWidth, h: el.videoHeight });
        el.onerror = () => rej(new Error("Couldn't read clip dimensions"));
        el.src = URL.createObjectURL(v.blob);
      });
      const region = {
        x: corner === "tl" || corner === "bl" ? 0.02 : 0.66,
        y: corner === "tl" || corner === "tr" ? 0.03 : 0.85,
        w: 0.32,
        h: 0.12,
      };
      const blob = await removeWatermark(v.blob, region, dims);
      const id = uuid();
      const name = `${clip.name.replace(/\.[a-z0-9]+$/i, "")} · clean`;
      let thumbnail: string | undefined;
      try {
        thumbnail = await makeThumbnail(blob);
      } catch {
        // stripes placeholder is fine
      }
      await saveVideo(id, blob, name);
      const derived: UserClip = { id, name, duration: clip.duration, thumbnail };
      await saveClipMeta(derived);
      addClip(derived);
      setToolsFor(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Watermark removal failed");
    } finally {
      setBusy(null);
    }
  }

  // Quick draft preview: the cut at 360p with the heavy filters skipped —
  // seconds instead of minutes, for checking rhythm before the real render.
  async function handleDraftPreview() {
    if (!plan) return;
    setError(null);
    try {
      setBusy("Drafting a quick preview…");
      const blobs = new Map<string, Blob>();
      for (const id of new Set(plan.segments.map((s) => s.clipId))) {
        const v = await getVideo(id);
        if (v) blobs.set(id, v.blob);
      }
      const lookBySegment = new Map<string, string>();
      for (const s of plan.segments) if (s.look) lookBySegment.set(s.id, s.look);
      const out = await renderEdit(blobs, plan.segments, {
        colorGrade: plan.colorGrade,
        look: { ...studio.look, grade: studio.look.grade === "none" ? plan.colorGrade : studio.look.grade },
        lookBySegment: lookBySegment.size > 0 ? lookBySegment : undefined,
        draft: true,
        onProgress: (pct, msg) => setBusy(`Draft ${pct}% — ${msg}`),
      });
      if (draftUrl) URL.revokeObjectURL(draftUrl);
      setDraftUrl(URL.createObjectURL(out));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Draft preview failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleAutoEdit() {
    setError(null);
    try {
      // Pull every clip's actual bytes so we can analyze motion + highlights
      setBusy("Loading clips…");
      const clipBlobs = new Map<string, Blob>();
      for (const c of clips) {
        const v = await getVideo(c.id);
        if (v) clipBlobs.set(c.id, v.blob);
      }

      // Detect real beats from the attached music (once)
      let beats: BeatResult | null = null;
      if (music) {
        setBusy("Listening to your music for the beat…");
        try {
          beats = await detectBeats(music.blob);
          setBeats(beats);
        } catch {
          beats = null; // fall back to reference/estimated rhythm
        }
      }

      const p = await smartAutoEdit({
        blueprint,
        clips,
        clipBlobs,
        direction,
        beats,
        onProgress: (msg) => setBusy(msg),
      });

      // Turn the ONE plain-English direction into the whole edit. smartAutoEdit
      // already shaped the cut pattern + motion-matched transitions; the prompt
      // compiler now resolves the rest of the pipeline the direction implies —
      // color look, score mood, transition SOUND EFFECTS, atmosphere, captions —
      // deterministically and with no key required (the quality floor).
      setBusy("Interpreting your direction…");
      let compiled: CompiledDirection | null = direction.trim() ? compileDirection(direction) : null;

      // Optional AI refinement — BOTH the plan (edit-directions) and the
      // pipeline settings (compile-direction) in parallel. Works identically
      // no matter which key is set: every provider's reply is clamped to the
      // same schema server-side, and if no key is configured both just no-op
      // and the deterministic result stands.
      setBusy("Refining…");
      const post = (task: string, payload: unknown) =>
        fetch("/api/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task, payload }),
        }).then((r) => r.json());

      // The AI refine (edit-directions + compile-direction) is ONE credited
      // action. If the user is out of credits we skip it and keep the fully-
      // working on-device edit; if no provider key is configured the credit is
      // auto-refunded (the request was free). Editing itself is never charged.
      type EditReply = { available?: boolean; provider?: string; result?: { segments?: typeof p.segments; colorGrade?: string } };
      type CompileReply = { available?: boolean; result?: Partial<CompiledDirection> };
      let editReply: EditReply | null = null;
      let compileReply: CompileReply | null = null;
      const gate = await withCredit("ai-edit", async () => {
        const [e, c] = await Promise.allSettled([
          post("edit-directions", { direction, plan: p }),
          compiled ? post("compile-direction", { direction }) : Promise.resolve(null),
        ]);
        editReply = e.status === "fulfilled" ? (e.value as EditReply) : null;
        compileReply = c.status === "fulfilled" ? (c.value as CompileReply) : null;
        return { available: !!(editReply?.available || compileReply?.available) };
      });
      if (gate.broke) {
        p.explanation += " (Out of AI credits — using the on-device edit; add credits on the Pricing page for AI refinement.)";
      }

      const er = editReply as EditReply | null;
      if (er?.available && er.result?.segments?.length) {
        p.segments = er.result.segments;
        p.colorGrade = er.result.colorGrade ?? p.colorGrade;
        p.explanation += ` Refined by AI (${er.provider}).`;
      }
      const cr = compileReply as CompileReply | null;
      if (compiled && cr?.available && cr.result) {
        compiled = mergeCompiled(compiled, cr.result);
      }

      // Apply the compiled direction: drive the Studio (look/score/SFX/overlay/
      // captions), keep the color-grade chip in sync, and honor any explicit
      // transition style the user asked for (whip/zoom/glitch/flash/slide…).
      if (compiled) {
        applyDirectionToStudio(compiled);
        if (compiled.plan.colorGrade) p.colorGrade = compiled.plan.colorGrade;
        if (compiled.plan.transitionCycle || compiled.plan.transitionMap) {
          p.segments = applyPlanOps(p.segments, {
            transitionCycle: compiled.plan.transitionCycle,
            transitionMap: compiled.plan.transitionMap,
          });
        }
        if (compiled.notes.length) p.explanation += ` Pipeline: ${compiled.summary}.`;
      }

      setPlan(p);
      await savePlan("current", p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Auto-edit failed");
    } finally {
      setBusy(null);
    }
  }

  // Map a compiled direction onto the Studio config. Only fields the compiler
  // actually set are written (undefined never clobbers a user's toggle), and
  // the look is merged onto the current look rather than replacing it.
  function applyDirectionToStudio(c: CompiledDirection) {
    const cur = useProject.getState().studio;
    const s = c.studio;
    const patch: Partial<typeof cur> = {};
    if (s.motionDefault !== undefined) patch.motionDefault = s.motionDefault;
    if (s.autoKenBurns !== undefined) patch.autoKenBurns = s.autoKenBurns;
    if (s.autoReframe !== undefined) patch.autoReframe = s.autoReframe;
    if (s.overlay !== undefined) patch.overlay = s.overlay;
    if (s.overlayOpacity !== undefined) patch.overlayOpacity = s.overlayOpacity;
    if (s.scoreMood !== undefined) patch.scoreMood = s.scoreMood;
    if (s.autoSfx !== undefined) patch.autoSfx = s.autoSfx;
    if (s.kineticCaptions !== undefined) patch.kineticCaptions = s.kineticCaptions;
    if (Object.keys(s.look).length) patch.look = { ...cur.look, ...s.look };
    setStudio(patch);
  }

  // Mirror renderEdit's duration math so captions line up with the output.
  function estimateOutputDuration(segments: typeof plan extends null ? never : NonNullable<typeof plan>["segments"]): number {
    let total = 0;
    for (const s of segments) total += (s.end - s.start) / s.speed;
    for (let i = 0; i < segments.length - 1; i++) {
      const r = transitionByType(segments[i].transitionAfter ?? "hard-cut");
      if (r.xfade && r.defaultDuration > 0) total -= r.defaultDuration;
    }
    return Math.max(0.5, total);
  }

  function setTransition(segIndex: number, t: TransitionType) {
    if (!plan) return;
    const segments = plan.segments.map((s, i) => (i === segIndex ? { ...s, transitionAfter: t } : s));
    setPlan({ ...plan, segments });
    setPickerFor(null);
  }

  // Live render-cost estimate from the current settings — recomputed as the
  // user toggles effects, so a heavy combo (Ken Burns + grain + atmosphere…)
  // warns BEFORE they commit to a multi-minute render instead of after.
  const costEstimate = useMemo(() => {
    if (!plan) return null;
    const captionLines = captionText.split("\n").map((l) => l.trim()).filter(Boolean);
    const captionCount =
      (studio.kineticCaptions
        ? captionLines.reduce((n, l) => n + l.split(/\s+/).length, 0)
        : captionLines.length) +
      (studio.titleCard?.title ? 1 : 0) +
      studio.credits.split("\n").filter((l) => l.trim()).length +
      (locationText.trim() ? 1 : 0) +
      (countdownIntro ? 3 : 0) +
      (progressBar ? 8 : 0) +
      (emojiReacts ? 3 : 0) +
      (watermark ? 1 : 0) +
      (Number.isFinite(parseInt(counter.from, 10)) && Number.isFinite(parseInt(counter.to, 10))
        ? Math.min(30, Math.abs(parseInt(counter.to, 10) - parseInt(counter.from, 10)) + 1)
        : 0);
    const usedIds = new Set(plan.segments.map((s) => s.clipId));
    return estimateRenderCost({
      clipCount: usedIds.size,
      trackedClips: clips.filter((c) => usedIds.has(c.id) && c.track).length,
      chromaClips: clips.filter((c) => usedIds.has(c.id) && c.chroma).length,
      facePunchSegments: studio.autoFacePunch ? plan.segments.length : 0,
      segmentCount: plan.segments.length,
      grade: studio.look.grade,
      grain: studio.look.grain > 0,
      halation: studio.look.halation,
      vignette: studio.look.vignette > 0,
      anamorphic: studio.look.anamorphic,
      letterbox: studio.look.letterbox,
      denoise: studio.look.denoise,
      autoNormalize: studio.look.autoNormalize,
      autoKenBurns: studio.autoKenBurns,
      autoReframe: studio.autoReframe,
      motionDefault: studio.motionDefault,
      emojiReactions: emojiReacts,
      overlay: !!studio.overlay,
      scoreMood: !!studio.scoreMood || !!music,
      music: !!music,
      captionCount,
    });
  }, [plan, studio, clips, captionText, locationText, counter, countdownIntro, progressBar, emojiReacts, watermark, music]);

  async function handleRender() {
    if (!plan) return;
    setError(null);
    setRenderPct(0);
    try {
      // First render ever on this device downloads the ~31MB WASM engine
      // (instant on repeat visits — the service worker caches it). Load it
      // explicitly up front so the wait has an honest label instead of
      // looking like the render itself is just slow.
      if (!ffmpegLoadedRef.current) {
        setStage("Loading video engine — first time only (~31MB, Wi-Fi recommended)…");
        await getFFmpeg();
        ffmpegLoadedRef.current = true;
      }
      setStage("Rendering…");

      const blobs = new Map<string, Blob>();
      for (const seg of plan.segments) {
        if (!blobs.has(seg.clipId)) {
          const v = await getVideo(seg.clipId);
          if (!v) throw new Error("A clip is missing from storage");
          blobs.set(seg.clipId, v.blob);
        }
      }
      // The taste pass: enforce editorial restraint (one transition
      // language, flash limits, effect budget, tight hook) before anything
      // is built. This is the difference between an edit and a demo reel.
      const taste = applyTaste(plan, studio);
      const plan2 = taste.plan;
      const studio2 = taste.studio;
      setTasteNotes(taste.report.changes);

      const outDur = estimateOutputDuration(plan2.segments);
      // Director's report: everything that actually fires in this render,
      // so the user learns the toolbox by seeing it work.
      const featureNotes: string[] = [];

      // Watch-muted mode: with no music and no score, most viewers will see
      // this silent — kinetic word-pops keep it legible with the sound off.
      const willHaveAudio = !!music || !!studio2.scoreMood;
      let useKinetic = studio2.kineticCaptions;
      const lines = captionText.split("\n").map((l) => l.trim()).filter(Boolean);
      if (!willHaveAudio && lines.length > 0 && !useKinetic) {
        useKinetic = true;
        featureNotes.push("Watch-muted mode: no audio track, so captions switched to kinetic word-pops for silent legibility.");
      }

      // Captions: typed lines → full-line cues or kinetic word-pops.
      const burnCaptions: BurnCaption[] = [];
      if (lines.length > 0) {
        setStage("Styling captions…");
        const cues = layoutCaptions(lines, outDur, beats?.beatTimes);
        for (const cue of cues) {
          if (useKinetic) {
            burnCaptions.push(...(await kineticWordCues(cue.text, cue.start, cue.end)));
          } else {
            burnCaptions.push({ png: await renderCuePng(cue.text, captionStyle), start: cue.start, end: cue.end });
          }
        }
        featureNotes.push(`${lines.length} caption line${lines.length > 1 ? "s" : ""} burned in (${useKinetic ? "kinetic word-pop" : CAPTION_STYLES[captionStyle].label} style).`);
      }

      // Title card over the first ~2.2s, credits over the tail.
      if (studio2.titleCard?.title) {
        setStage("Rendering title card…");
        burnCaptions.push({
          png: await renderTitleCard(studio2.titleCard),
          start: 0,
          end: Math.min(2.2, outDur),
        });
      }
      const creditLines = studio2.credits.split("\n").map((l) => l.trim()).filter(Boolean);
      if (creditLines.length > 0) {
        setStage("Rolling credits…");
        const pages = await renderCreditsPages(creditLines);
        let t = Math.max(0, outDur - pages.length * 2.2);
        for (const p of pages) {
          burnCaptions.push({ png: p.png, start: Number(t.toFixed(2)), end: Number(Math.min(outDur, t + p.duration).toFixed(2)) });
          t += p.duration;
        }
      }

      // Overlays+ : location card, counter, countdown, progress bar, emoji
      // reactions, watermark — all burned through the same caption pipeline.
      if (locationText.trim()) {
        burnCaptions.push(await locationCard(locationText.trim(), outDur));
        featureNotes.push(`Location card: 📍 ${locationText.trim()}.`);
      }
      const counterFrom = parseInt(counter.from, 10);
      const counterTo = parseInt(counter.to, 10);
      if (Number.isFinite(counterFrom) && Number.isFinite(counterTo) && counterFrom !== counterTo) {
        setStage("Rendering counter overlay…");
        burnCaptions.push(...(await counterCues({ prefix: counter.prefix, from: counterFrom, to: counterTo, totalDuration: outDur })));
        featureNotes.push(`Animated counter: ${counter.prefix}${counterFrom} → ${counter.prefix}${counterTo}.`);
      }
      if (countdownIntro && outDur > 4) {
        burnCaptions.push(...(await countdownCues(3)));
        featureNotes.push("3-2-1 countdown intro.");
      }
      if (progressBar) {
        setStage("Rendering progress bar…");
        burnCaptions.push(...(await progressBarCues(outDur)));
        featureNotes.push("Progress bar along the bottom.");
      }
      if (emojiReacts) {
        setStage("Placing emoji reactions on the peaks…");
        const analyses2 = new Map<string, ClipAnalysis>();
        for (const [id, blob] of blobs) analyses2.set(id, await getAnalysis(id, blob));
        const times = emojiCueTimes(plan2.segments, analyses2);
        if (times.length > 0) {
          burnCaptions.push(...(await emojiReactionCues(times, outDur)));
          featureNotes.push(`Emoji reactions on ${times.length} excitement peak${times.length > 1 ? "s" : ""}.`);
        }
      }
      if (watermark) {
        burnCaptions.push(await watermarkCue(watermark.blob, outDur));
        featureNotes.push("Watermark burned in (bottom-right).");
      }

      // Per-clip auto color/exposure normalize (#5/#46)
      const normalizeByClip = new Map<string, string>();
      if (studio2.look.autoNormalize) {
        setStage("Matching color across clips…");
        const stats = new Map<string, Awaited<ReturnType<typeof measureColor>>>();
        for (const [id, blob] of blobs) stats.set(id, await measureColor(blob));
        const target = [...stats.values()].reduce((s, x) => s + x.luma, 0) / Math.max(1, stats.size);
        for (const [id, st] of stats) {
          const f = normalizeFilter(st, target);
          if (f) normalizeByClip.set(id, f);
        }
        featureNotes.push("Color and exposure matched across clips.");
      }

      // Brand palette nudge: gentle tint toward the user's hex colors,
      // applied with (after) the per-clip normalize filter.
      const brand = studio2.brandHex?.trim() ? brandFilterFromHex(studio2.brandHex.split(/[\s,]+/)) : null;
      if (brand) {
        for (const id of blobs.keys()) {
          const existing = normalizeByClip.get(id);
          normalizeByClip.set(id, existing ? `${existing},${brand.filter}` : brand.filter);
        }
        featureNotes.push(`Footage nudged toward your brand palette (${brand.summary}).`);
      }

      // Subject-aware reframe (#11)
      const reframeByClip = new Map<string, string>();
      if (studio2.autoReframe) {
        setStage("Finding your subject…");
        for (const [id, blob] of blobs) {
          reframeByClip.set(id, reframeFilter(await motionCentroidX(blob)));
        }
        featureNotes.push("Subject-aware 9:16 reframe applied.");
      }

      // Baked-in letterbox/pillarbox bars detected at upload get stripped
      // FIRST (crop before reframe/scale), for every clip that has them.
      let strippedBars = 0;
      for (const id of blobs.keys()) {
        const crop = clips.find((c) => c.id === id)?.sourceCrop;
        if (!crop) continue;
        const existing = reframeByClip.get(id);
        reframeByClip.set(id, existing ? `${crop},${existing}` : crop);
        strippedBars++;
      }
      if (strippedBars > 0) featureNotes.push(`Stripped baked-in bars from ${strippedBars} clip${strippedBars > 1 ? "s" : ""}.`);

      // AI subject locks: the crop FOLLOWS the face (ML face detection) or
      // the motion. Paths are cached per clip; recompute after a reload.
      const trackByClip = new Map<string, TrackPath>();
      let faceLocks = 0, actionLocks = 0;
      for (const [id, blob] of blobs) {
        const mode = clips.find((c) => c.id === id)?.track;
        if (!mode) continue;
        const cached = trackPathsRef.current.get(id);
        let path = cached && cached.mode === mode ? cached.path : null;
        if (!path) {
          setStage(mode === "face" ? "Locking onto the face…" : "Tracking the action…");
          const res = mode === "face" ? await trackFace(blob) : await trackAction(blob);
          path = res.path;
          if (path) {
            trackPathsRef.current.set(id, { mode, path });
            if (mode === "face") facePathsRef.current.set(id, path);
          }
        }
        if (path) {
          trackByClip.set(id, path);
          if (mode === "face") faceLocks++;
          else actionLocks++;
        }
      }
      if (faceLocks > 0) featureNotes.push(`Face lock: the crop follows the face in ${faceLocks} clip${faceLocks > 1 ? "s" : ""}.`);
      if (actionLocks > 0) featureNotes.push(`Action lock: the crop follows the motion in ${actionLocks} clip${actionLocks > 1 ? "s" : ""}.`);

      // Green screen keys detected on the clip cards
      const chromaByClip = new Map<string, ChromaSettings>();
      for (const id of blobs.keys()) {
        const c = clips.find((cc) => cc.id === id);
        if (c?.chroma) chromaByClip.set(id, c.chroma);
      }
      if (chromaByClip.size > 0) featureNotes.push(`Green screen keyed on ${chromaByClip.size} clip${chromaByClip.size > 1 ? "s" : ""}.`);

      // Auto face punch-in: find the face in each shot and push the camera
      // toward it. Skips short shots and back-to-back punches (taste), and
      // shots where the face already fills the frame.
      const punchBySegment = new Map<string, { cx: number; cy: number }>();
      if (studio2.autoFacePunch) {
        setStage("Finding faces to punch in on…");
        const facePathFor = async (clipId: string): Promise<TrackPath | null> => {
          if (facePathsRef.current.has(clipId)) return facePathsRef.current.get(clipId)!;
          const blob = blobs.get(clipId);
          if (!blob) return null;
          const res = await trackFace(blob);
          facePathsRef.current.set(clipId, res.path);
          return res.path;
        };
        let prevPunched = false;
        for (const seg of plan2.segments) {
          const segDur = (seg.end - seg.start) / seg.speed;
          if (segDur < 1.2 || prevPunched) {
            prevPunched = false;
            continue;
          }
          const path = await facePathFor(seg.clipId);
          const c = path ? pathCenter(path, seg.start, seg.end) : null;
          if (!c || c.size > 0.55) {
            prevPunched = false;
            continue; // no face, or already a close-up
          }
          // A face-locked clip is already centered by its follow crop; other
          // footage needs the source cx remapped into the 9:16 center crop.
          const faceLocked = clips.find((cc) => cc.id === seg.clipId)?.track === "face" && trackByClip.has(seg.clipId);
          const cx = faceLocked ? 0.5 : mapToCenterCrop(c.cx, path!.aspect);
          punchBySegment.set(seg.id, { cx, cy: c.cy });
          prevPunched = true;
        }
        if (punchBySegment.size > 0) {
          featureNotes.push(`Auto face punch-in on ${punchBySegment.size} shot${punchBySegment.size > 1 ? "s" : ""}.`);
        }
      }

      // Auto Ken Burns on static shots (#6)
      const motionBySegment = new Map<string, import("@/lib/motion").MotionEffect>();
      if (studio2.autoKenBurns) {
        setStage("Adding virtual camera moves…");
        const analyses = new Map<string, ClipAnalysis>();
        for (const [id, blob] of blobs) analyses.set(id, await getAnalysis(id, blob));
        plan2.segments.forEach((seg, i) => {
          const a = analyses.get(seg.clipId);
          if (a && isStaticShot(a, seg.start, seg.end)) {
            motionBySegment.set(seg.id, i % 2 === 0 ? "ken-burns-in" : "ken-burns-out");
          }
        });
      }

      // Atmosphere overlay clip (#17/#19/#39)
      let overlay: RenderOptions["overlay"];
      if (studio2.overlay) {
        setStage(`Generating ${studio2.overlay} layer…`);
        overlay = { blob: await generateOverlayClip(studio2.overlay, outDur + 1), opacity: studio2.overlayOpacity };
      }

      // Audio: uploaded music, or composed score; plus auto SFX; mixed once.
      let finalAudio: Blob | undefined = music?.blob;
      if (finalAudio) {
        // Loudness-match the uploaded track so quiet rips and hot masters
        // land at the same perceived level.
        setStage("Matching music loudness…");
        try {
          const norm = await normalizeAudioBlob(finalAudio);
          finalAudio = norm.blob;
          if (norm.gain !== 1) featureNotes.push(`Music loudness matched (gain ×${norm.gain.toFixed(2)}).`);
        } catch {
          // normalization is best-effort; the original track still plays
        }
      }
      const sfxAt: { time: number; type: SfxType }[] = [];
      if (studio2.autoSfx) {
        let clock = 0;
        for (const seg of plan2.segments) {
          clock += (seg.end - seg.start) / seg.speed;
          const recipe = transitionByType(seg.transitionAfter ?? "hard-cut");
          if (seg.transitionAfter && recipe.xfade) clock -= recipe.defaultDuration;
          const sfx = seg.transitionAfter ? SFX_FOR_TRANSITION[seg.transitionAfter] : undefined;
          if (sfx && clock < outDur) sfxAt.push({ time: Number(clock.toFixed(2)), type: sfx });
        }
        const restrained = restrainSfx(plan2, sfxAt, taste.report);
        sfxAt.length = 0;
        sfxAt.push(...restrained);
        setTasteNotes([...taste.report.changes]);
      }
      if (studio2.titleCard?.title && burnCaptions.length > 0) {
        cleanCaptionWindows(burnCaptions, { start: 0, end: Math.min(2.2, outDur) }, taste.report);
        setTasteNotes([...taste.report.changes]);
      }
      if (!finalAudio && studio2.scoreMood) {
        setStage("Composing your score…");
        finalAudio = await composeScore({ bpm: beats?.bpm ?? blueprint?.beats?.bpm ?? 100, seconds: outDur + 0.5, mood: studio2.scoreMood });
      }
      // Resolve each transition SFX cue to a real audio file from the web
      // (bundled /sfx/*.wav, or an owner-configured CDN), falling back to
      // synthesis per-cue if a fetch fails — so the SFX always land.
      let sfxCues: { time: number; type: SfxType; blob?: Blob }[] = sfxAt;
      if (sfxAt.length > 0) {
        setStage("Loading sound effects…");
        try {
          sfxCues = await resolveTransitionSfx(sfxAt);
        } catch {
          sfxCues = sfxAt; // mixTimeline synthesizes when no blob is attached
        }
      }
      // Completely silent edit? Lay in a barely-there room-tone bed so the
      // output doesn't read as a broken/no-audio file on platforms.
      if (!finalAudio && sfxCues.length === 0) {
        setStage("Adding ambience…");
        try {
          finalAudio = await roomTone(outDur + 0.5);
          featureNotes.push("Subtle room-tone ambience added (the edit had no audio at all).");
        } catch {
          // ambience is optional
        }
      }
      if (finalAudio || sfxCues.length > 0) {
        setStage("Mixing audio…");
        finalAudio = await mixTimeline({ seconds: outDur + 0.5, music: finalAudio, sfxAt: sfxCues });
      }

      // Fill in the rest of the director's report and publish it.
      if (studio2.look.grade !== "none") featureNotes.push(`Grade: ${studio2.look.grade}.`);
      if (studio2.look.letterbox) featureNotes.push("Cinema letterbox bars.");
      if (studio2.overlay) featureNotes.push(`${studio2.overlay} atmosphere layer at ${Math.round(studio2.overlayOpacity * 100)}%.`);
      if (!music && studio2.scoreMood) featureNotes.push(`Original ${studio2.scoreMood} score composed on-device.`);
      if (sfxCues.length > 0) featureNotes.push(`${sfxCues.length} transition sound effect${sfxCues.length > 1 ? "s" : ""} placed.`);
      if (studio2.motionDefault !== "none") featureNotes.push(`Camera motion: ${studio2.motionDefault}.`);
      if (motionBySegment.size > 0) featureNotes.push(`Auto Ken Burns on ${motionBySegment.size} static shot${motionBySegment.size > 1 ? "s" : ""}.`);
      setTasteNotes([...taste.report.changes, ...featureNotes]);

      // virtual-set plates for keyed clips using a "vset:*" background, and
      // per-segment grade overrides (section looks)
      const chromaBgImages = new Map<string, Blob>();
      for (const c of chromaByClip.values()) {
        if (isVirtualSet(c.bg) && !chromaBgImages.has(c.bg)) chromaBgImages.set(c.bg, await renderVirtualSet(c.bg));
      }
      const lookBySegment = new Map<string, string>();
      for (const s of plan2.segments) if (s.look) lookBySegment.set(s.id, s.look);
      if (lookBySegment.size > 0) featureNotes.push(`Section looks on ${lookBySegment.size} shot${lookBySegment.size > 1 ? "s" : ""}.`);

      const out = await renderEdit(blobs, plan2.segments, {
        colorGrade: plan2.colorGrade,
        look: { ...studio2.look, grade: studio2.look.grade === "none" ? plan2.colorGrade : studio2.look.grade },
        motionDefault: studio2.motionDefault,
        motionBySegment,
        normalizeByClip,
        reframeByClip,
        trackByClip: trackByClip.size > 0 ? trackByClip : undefined,
        chromaByClip: chromaByClip.size > 0 ? chromaByClip : undefined,
        chromaBgImages: chromaBgImages.size > 0 ? chromaBgImages : undefined,
        lookBySegment: lookBySegment.size > 0 ? lookBySegment : undefined,
        beauty: studio2.beauty > 0 ? studio2.beauty : undefined,
        punchBySegment: punchBySegment.size > 0 ? punchBySegment : undefined,
        music: finalAudio,
        captions: burnCaptions.length ? burnCaptions : undefined,
        overlay,
        onProgress: (pct, msg) => {
          setRenderPct(pct);
          setStage(msg);
        },
      });
      // Save the actual bytes to IndexedDB so /export survives a reload —
      // the blob: URL below only lives as long as this tab stays open.
      await saveRenderedVideo(out);
      const url = URL.createObjectURL(out);
      setRenderedUrl(url);
      router.push("/export");
    } catch (e) {
      const stage = renderStageRef.current;
      reportError(e, { where: "handleRender", stage, segmentCount: plan?.segments.length });
      setError(
        e instanceof Error
          ? `Render failed${stage ? ` while ${stage}` : ""}: ${e.message}`
          : `Render failed${stage ? ` while ${stage}` : ""} — try shorter clips`
      );
      setBusy(null);
    }
  }

  return (
    <main className="flex flex-1 flex-col px-6 pb-10 pt-12">
      <header className="mb-6">
        <div className="flex items-start justify-between">
          <p className="text-xs font-bold uppercase tracking-widest text-accent">Step 2 — your clips</p>
          <CreditsChip />
        </div>
        <h1 className="mt-1 text-2xl font-extrabold">Build your edit</h1>
        {blueprint ? (
          <p className="mt-1 text-sm text-neutral-400">
            Matching “{blueprint.sourceName}” — {blueprint.transitions.length} transitions, {blueprint.style.pacing} pacing
          </p>
        ) : (
          <p className="mt-1 text-sm text-neutral-400">No reference loaded — I&apos;ll use a classic viral pattern.</p>
        )}
      </header>

      {/* Clips shelf */}
      <section>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {clips.map((c) => (
            <div key={c.id} className="relative shrink-0">
              {c.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.thumbnail} alt={c.name} className="h-28 w-20 rounded-xl object-cover" />
              ) : (
                <div className="stripes h-28 w-20 rounded-xl" />
              )}
              <button
                onClick={() => handleRemoveClip(c.id)}
                className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-neutral-800"
                aria-label={`Remove ${c.name}`}
              >
                <X size={12} />
              </button>
              <button
                onClick={() => setToolsFor(toolsFor === c.id ? null : c.id)}
                className={`absolute -left-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full ${
                  c.track || c.chroma ? "bg-accent text-white" : "bg-neutral-800 text-neutral-300"
                } ${toolsFor === c.id ? "ring-2 ring-accent" : ""}`}
                aria-label={`AI tools for ${c.name}`}
                title="AI tools: face lock, action lock, green screen, remove background"
              >
                <ScanFace size={12} />
              </button>
              <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 font-mono text-[10px]">
                {c.duration.toFixed(1)}s
              </span>
              {c.duration > 25 && (
                <button
                  onClick={() => handleDistill(c)}
                  disabled={!!busy}
                  className="absolute bottom-1 right-1 rounded bg-accent px-1.5 py-0.5 text-[9px] font-bold text-white"
                  title="Distill this long clip into its best moments"
                >
                  ⚡ Distill
                </button>
              )}
            </div>
          ))}
          <button
            onClick={() => fileRef.current?.click()}
            className="flex h-28 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-neutral-700 text-neutral-500 active:border-accent"
          >
            <Plus size={20} className="text-accent" />
            <span className="text-[10px]">Add clip</span>
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          multiple
          hidden
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />

        {/* AI subject tools for the selected clip — face lock, action lock,
            green screen key, background removal. All on-device ML. */}
        {(() => {
          const tc = clips.find((c) => c.id === toolsFor);
          if (!tc) return null;
          return (
            <div className="card mt-3 p-4">
              <div className="flex items-center justify-between">
                <span className="flex min-w-0 items-center gap-2 text-sm font-bold">
                  <ScanFace size={15} className="shrink-0 text-accent" />
                  <span className="truncate">AI tools — {tc.name}</span>
                </span>
                <button onClick={() => setToolsFor(null)} aria-label="Close AI tools" className="p-1 text-neutral-500">
                  <X size={14} />
                </button>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                <button
                  onClick={() => handleTrackToggle(tc, "face")}
                  disabled={!!busy}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs ${
                    tc.track === "face" ? "bg-accent font-semibold text-white" : "border border-card-border text-neutral-300"
                  }`}
                >
                  <ScanFace size={12} /> Face lock
                </button>
                <button
                  onClick={() => handleTrackToggle(tc, "action")}
                  disabled={!!busy}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs ${
                    tc.track === "action" ? "bg-accent font-semibold text-white" : "border border-card-border text-neutral-300"
                  }`}
                >
                  <Crosshair size={12} /> Action lock
                </button>
                <button
                  onClick={() => handleChromaToggle(tc)}
                  disabled={!!busy}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs ${
                    tc.chroma ? "bg-accent font-semibold text-white" : "border border-card-border text-neutral-300"
                  }`}
                >
                  <span
                    className="h-3 w-3 rounded-sm border border-black/30"
                    style={{ background: tc.chroma?.color ?? "#22c55e" }}
                  />
                  Green screen
                </button>
                {!tc.bgRemoved && (
                  <button
                    onClick={() => handleRemoveBg(tc)}
                    disabled={!!busy}
                    className="flex items-center gap-1.5 rounded-full border border-card-border px-3 py-1.5 text-xs text-neutral-300"
                  >
                    <Eraser size={12} /> Remove background
                  </button>
                )}
              </div>

              {faceChoices && faceChoices.clipId === tc.id && (
                <div className="mt-3">
                  <p className="mb-1.5 text-[10px] uppercase tracking-wider text-neutral-600">
                    {faceChoices.faces.length} faces found — follow which one?
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {faceChoices.faces.map((f, i) => (
                      <button
                        key={i}
                        onClick={() => handleTrackToggle(tc, "face", { cx: f.cx, cy: f.cy })}
                        disabled={!!busy}
                        className="rounded-full border border-card-border px-3 py-1 text-xs text-neutral-300"
                      >
                        {f.cx < 0.4 ? "Left" : f.cx > 0.6 ? "Right" : "Center"} face
                      </button>
                    ))}
                    <button onClick={() => setFaceChoices(null)} className="rounded-full px-2 py-1 text-xs text-neutral-600">
                      cancel
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-3">
                <p className="mb-1.5 text-[10px] uppercase tracking-wider text-neutral-600">Remove a corner watermark</p>
                <div className="flex flex-wrap gap-1.5">
                  {(["tl", "tr", "bl", "br"] as const).map((corner) => (
                    <button
                      key={corner}
                      onClick={() => handleRemoveWatermark(tc, corner)}
                      disabled={!!busy}
                      className="rounded-full border border-card-border px-3 py-1 text-xs text-neutral-400"
                    >
                      {{ tl: "Top left", tr: "Top right", bl: "Bottom left", br: "Bottom right" }[corner]}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[10px] text-neutral-600">
                  Interpolates a corner box away (delogo) into a new clean copy of the clip.
                </p>
              </div>

              <div className="mt-3">
                <p className="mb-1.5 text-[10px] uppercase tracking-wider text-neutral-600">Effects (make a new clip)</p>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => handleBlurFill(tc)} disabled={!!busy} className="rounded-full border border-card-border px-3 py-1 text-xs text-neutral-300">
                    Blur-fill vertical
                  </button>
                  <button onClick={() => handlePortraitBlur(tc)} disabled={!!busy} className="rounded-full border border-card-border px-3 py-1 text-xs text-neutral-300">
                    Portrait blur (DoF)
                  </button>
                  <button onClick={() => handlePrivacyBlur(tc)} disabled={!!busy} className="rounded-full border border-card-border px-3 py-1 text-xs text-neutral-300">
                    Blur the face (privacy)
                  </button>
                  <button onClick={() => handleFreezeFrame(tc)} disabled={!!busy} className="rounded-full border border-card-border px-3 py-1 text-xs text-neutral-300">
                    Freeze-frame
                  </button>
                </div>
              </div>

              {tc.chroma && (
                <div className="mt-3">
                  <p className="mb-1.5 text-[10px] uppercase tracking-wider text-neutral-600">
                    Keyed {tc.chroma.color} — replace it with
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { id: "studio", label: "Studio dark" },
                      { id: "blur", label: "Blur (bokeh)" },
                      { id: "#ffffff", label: "White" },
                      { id: "#0b1e3a", label: "Deep blue" },
                      ...VIRTUAL_SETS.map((v) => ({ id: v.id, label: v.label })),
                    ].map((b) => (
                      <button
                        key={b.id}
                        onClick={() => setChromaBg(tc, b.id)}
                        className={`rounded-full px-3 py-1 text-xs ${
                          tc.chroma?.bg === b.id ? "bg-accent font-semibold text-white" : "border border-card-border text-neutral-400"
                        }`}
                      >
                        {b.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <p className="mt-3 text-[10px] leading-4 text-neutral-600">
                {tc.track === "face" && "The 9:16 crop follows this face through the shot (on-device ML face detection). "}
                {tc.track === "action" && "The 9:16 crop follows where the motion is. "}
                {tc.bgRemoved && "This clip already has its background removed. "}
                Everything runs on your device — no footage is uploaded.
              </p>
            </div>
          );
        })()}
      </section>

      {/* AI direction */}
      <section className="card mt-5 p-4">
        <div className="flex items-center justify-between text-sm font-bold">
          <span className="flex items-center gap-2"><Sparkles size={15} className="text-accent" /> Direct the AI</span>
          <button
            onClick={handleVoiceDirection}
            aria-label="Speak your direction"
            className={`rounded-full p-2 ${listening ? "bg-accent text-white" : "border border-card-border text-neutral-400"}`}
          >
            <Mic size={14} className={listening ? "pulse-soft" : ""} />
          </button>
        </div>
        <textarea
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
          placeholder="e.g. make it cinematic with smooth transitions, cut on every beat…"
          rows={2}
          className="mt-3 w-full resize-none rounded-xl border border-card-border bg-black px-4 py-3 text-sm outline-none placeholder:text-neutral-600 focus:border-accent"
        />
        {/* One-tap genre presets — curated prompts through the same compiler */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {GENRE_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => applyPreset(p.id)}
              title={p.tagline}
              className={`rounded-full px-3 py-1.5 text-xs ${
                direction === p.direction
                  ? "bg-accent font-semibold text-white"
                  : "border border-card-border text-neutral-300"
              }`}
            >
              {p.emoji} {p.label}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PROMPT_IDEAS.map((p) => (
            <button
              key={p}
              onClick={() => setDirection(p)}
              className="rounded-full border border-card-border px-3 py-1 text-xs text-neutral-400 active:border-accent"
            >
              {p}
            </button>
          ))}
        </div>
        <button
          onClick={handleAutoEdit}
          disabled={!!busy || clips.length === 0}
          className="btn-primary mt-4 flex w-full items-center justify-center gap-2 py-3.5"
        >
          <Wand2 size={17} /> {plan ? "Re-edit with AI" : "Auto-edit my clips"}
        </button>
      </section>

      <StudioPanel />
      <ProTools music={music} setMusic={setMusic} captionLines={captionText.split("\n").map((l) => l.trim()).filter(Boolean)} />

      {/* Timeline */}
      {plan && (
        <section className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-bold">Timeline — tap a transition to change it</h2>
            {planHistory.length > 0 && (
              <button onClick={undoPlan} className="text-xs text-neutral-500 underline">undo</button>
            )}
          </div>
          <p className="mb-3 text-xs leading-5 text-neutral-500">{plan.explanation}</p>
          <div className="flex items-center gap-1 overflow-x-auto pb-2">
            {plan.segments.map((seg, i) => {
              const clip = clips.find((c) => c.id === seg.clipId);
              return (
                <div key={seg.id} className="flex shrink-0 items-center gap-1">
                  <div className="relative">
                    {clip?.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={clip.thumbnail}
                        alt={`Shot ${i + 1}: ${clip.name}, ${(seg.end - seg.start).toFixed(1)}s`}
                        className="h-16 w-12 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="stripes h-16 w-12 rounded-lg" />
                    )}
                    <span className="absolute bottom-0.5 left-0.5 rounded bg-black/70 px-0.5 font-mono text-[9px]">
                      {(seg.end - seg.start).toFixed(1)}s
                    </span>
                  </div>
                  {seg.transitionAfter !== null && (
                    <button
                      onClick={() => setPickerFor(i)}
                      className="flex h-11 w-11 items-center justify-center rounded-full border border-card-border bg-card text-base active:border-accent"
                      aria-label={`Change transition after shot ${i + 1}, currently ${transitionByType(seg.transitionAfter).label}`}
                    >
                      {transitionByType(seg.transitionAfter).emoji}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Section looks: adjustment-layer-style grade override per shot */}
          <div className="mt-1 flex items-center gap-1 overflow-x-auto pb-1">
            <span className="shrink-0 text-[10px] text-neutral-600">Shot looks:</span>
            {plan.segments.map((seg, i) => (
              <select
                key={seg.id}
                value={seg.look ?? ""}
                onChange={(e) =>
                  setPlan({
                    ...plan,
                    segments: plan.segments.map((s) => (s.id === seg.id ? { ...s, look: e.target.value || undefined } : s)),
                  })
                }
                aria-label={`Look for shot ${i + 1}`}
                className="shrink-0 rounded border border-card-border bg-black px-1 py-0.5 text-[10px] text-neutral-400"
              >
                <option value="">S{i + 1}: Studio</option>
                {Object.keys(COLOR_GRADES)
                  .filter((g) => g !== "none")
                  .map((g) => (
                    <option key={g} value={g}>
                      S{i + 1}: {g}
                    </option>
                  ))}
              </select>
            ))}
          </div>

          {/* Music */}
          <div className="mt-3">
            <label className="text-xs font-semibold text-neutral-500">Music</label>
            <div className="mt-1.5 flex items-center gap-2">
              <button
                onClick={() => musicRef.current?.click()}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs ${
                  music ? "bg-accent/15 font-semibold text-accent" : "border border-card-border text-neutral-400"
                }`}
              >
                <Music size={13} />
                {music ? music.name.slice(0, 28) : "Add a music track"}
              </button>
              {music && (
                <button onClick={() => setMusic(null)} className="text-neutral-600" aria-label="Remove music">
                  <X size={14} />
                </button>
              )}
            </div>
            <input
              ref={musicRef}
              type="file"
              accept="audio/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setMusic({ name: f.name, blob: f });
              }}
            />
          </div>

          {/* Captions */}
          <div className="mt-3">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-neutral-500">
              <Captions size={13} /> Captions <span className="text-neutral-500">— one line per caption</span>
            </label>
            <textarea
              value={captionText}
              onChange={(e) => setCaptionText(e.target.value)}
              rows={2}
              placeholder={"POV: you finally tried it\nwait for it…\nno way 🤯"}
              className="mt-1.5 w-full resize-none rounded-xl border border-card-border bg-black px-4 py-3 text-sm outline-none placeholder:text-neutral-600 focus:border-accent"
            />
            {captionText.trim() && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.values(CAPTION_STYLES).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setCaptionStyle(s.id)}
                    className={`rounded-full px-3 py-1 text-xs ${
                      captionStyle === s.id ? "bg-accent font-semibold text-white" : "border border-card-border text-neutral-400"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-1 text-[10px] text-neutral-500">
              {beats ? "Timed to your music's beats." : "Spread evenly across the edit. Add music to time them to the beat."}
            </p>
          </div>

          {/* Overlays+ : counters, cards, bars, reactions, watermark */}
          <div className="mt-3">
            <label className="text-xs font-semibold text-neutral-500">Overlays+</label>
            <div className="mt-1.5 flex flex-col gap-2">
              <input
                value={locationText}
                onChange={(e) => setLocationText(e.target.value)}
                placeholder="📍 Location card — e.g. Bali, Indonesia"
                className="rounded-xl border border-card-border bg-black px-4 py-2.5 text-xs outline-none placeholder:text-neutral-600 focus:border-accent"
              />
              <div className="flex gap-2">
                <input
                  value={counter.prefix}
                  onChange={(e) => setCounter({ ...counter, prefix: e.target.value })}
                  placeholder="Day "
                  aria-label="Counter prefix"
                  className="w-20 rounded-xl border border-card-border bg-black px-3 py-2.5 text-xs outline-none placeholder:text-neutral-600 focus:border-accent"
                />
                <input
                  value={counter.from}
                  onChange={(e) => setCounter({ ...counter, from: e.target.value })}
                  placeholder="from 1"
                  inputMode="numeric"
                  aria-label="Counter start"
                  className="min-w-0 flex-1 rounded-xl border border-card-border bg-black px-3 py-2.5 text-xs outline-none placeholder:text-neutral-600 focus:border-accent"
                />
                <input
                  value={counter.to}
                  onChange={(e) => setCounter({ ...counter, to: e.target.value })}
                  placeholder="to 7"
                  inputMode="numeric"
                  aria-label="Counter end"
                  className="min-w-0 flex-1 rounded-xl border border-card-border bg-black px-3 py-2.5 text-xs outline-none placeholder:text-neutral-600 focus:border-accent"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setCountdownIntro(!countdownIntro)}
                  className={`rounded-full px-3 py-1.5 text-xs ${countdownIntro ? "bg-accent font-semibold text-white" : "border border-card-border text-neutral-400"}`}
                >
                  3·2·1 intro
                </button>
                <button
                  onClick={() => setProgressBar(!progressBar)}
                  className={`rounded-full px-3 py-1.5 text-xs ${progressBar ? "bg-accent font-semibold text-white" : "border border-card-border text-neutral-400"}`}
                >
                  Progress bar
                </button>
                <button
                  onClick={() => setEmojiReacts(!emojiReacts)}
                  className={`rounded-full px-3 py-1.5 text-xs ${emojiReacts ? "bg-accent font-semibold text-white" : "border border-card-border text-neutral-400"}`}
                >
                  🔥 Emoji reactions
                </button>
                <button
                  onClick={() => (watermark ? setWatermark(null) : watermarkRef.current?.click())}
                  className={`rounded-full px-3 py-1.5 text-xs ${watermark ? "bg-accent font-semibold text-white" : "border border-card-border text-neutral-400"}`}
                >
                  {watermark ? `Logo: ${watermark.name.slice(0, 14)} ✕` : "Add watermark logo"}
                </button>
              </div>
              <input
                ref={watermarkRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setWatermark({ name: f.name, blob: f });
                }}
              />
            </div>
          </div>

          {/* Color grade — a quick-access shortcut for the same grade the
              Studio's Look & Grade panel controls. renderEdit always uses
              studio.look.grade when it's set (genre looks/film stocks there
              win over this simple picker), so this sets BOTH fields and
              shows active state from studio.look.grade — otherwise picking a
              grade here would silently do nothing whenever a richer look is
              already selected in the Studio. */}
          <div className="mt-3">
            <label className="text-xs font-semibold text-neutral-500">Color grade</label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {Object.entries(COLOR_GRADES).map(([key, g]) => (
                <button
                  key={key}
                  onClick={() => {
                    setPlan({ ...plan, colorGrade: key });
                    setStudio({ look: { ...studio.look, grade: key } });
                  }}
                  className={`rounded-full px-3 py-1 text-xs ${
                    studio.look.grade === key
                      ? "bg-accent font-semibold text-white"
                      : "border border-card-border text-neutral-400"
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          {costEstimate && (
            <div
              className={`mt-4 flex items-start gap-2 rounded-xl px-3 py-2 text-[11px] leading-4 ${
                costEstimate.level === "heavy"
                  ? "bg-amber-500/10 text-amber-400"
                  : costEstimate.level === "moderate"
                    ? "bg-neutral-800/60 text-neutral-400"
                    : "bg-neutral-800/40 text-neutral-500"
              }`}
            >
              <span className="mt-px shrink-0">{costEstimate.level === "heavy" ? "⏳" : "⚡"}</span>
              <span>{renderCostMessage(costEstimate)}</span>
            </div>
          )}
          <button
            onClick={handleRender}
            disabled={!!busy}
            className="btn-primary mt-3 w-full py-4 text-lg"
          >
            Render my edit →
          </button>
          <button
            onClick={handleDraftPreview}
            disabled={!!busy}
            className="mt-2 w-full rounded-full border border-card-border py-2.5 text-sm text-neutral-300 disabled:opacity-40"
          >
            ⚡ Quick draft preview (360p, skips the slow filters)
          </button>
          {draftUrl && (
            <div className="mt-3 rounded-xl border border-card-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-neutral-400">Draft preview — the cut only, not final quality</span>
                <button
                  onClick={() => {
                    URL.revokeObjectURL(draftUrl);
                    setDraftUrl(null);
                  }}
                  className="p-1 text-neutral-500"
                  aria-label="Close draft preview"
                >
                  <X size={14} />
                </button>
              </div>
              <video src={draftUrl} controls playsInline className="mx-auto max-h-72 rounded-lg" />
            </div>
          )}
          <InsightsPanel />
        </section>
      )}

      {busy && (
        <div className="mt-5">
          <div className="pulse-soft rounded-xl bg-accent/10 px-4 py-3 text-center text-sm font-medium text-accent">
            {busy}
          </div>
          {renderPct > 0 && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-800">
              <div className="h-full bg-accent transition-all" style={{ width: `${renderPct}%` }} />
            </div>
          )}
        </div>
      )}
      {error && (
        <div className="mt-5 rounded-xl bg-red-500/10 px-4 py-3 text-center text-sm text-red-400">{error}</div>
      )}
      {tasteNotes.length > 0 && (
        <div className="card mt-5 px-4 py-3">
          <p className="text-xs font-bold text-neutral-300">🎬 Director&apos;s notes — everything this render did</p>
          {tasteNotes.map((n, i) => (
            <p key={i} className="mt-1 text-[11px] leading-4 text-neutral-500">• {n}</p>
          ))}
        </div>
      )}

      {/* Transition picker sheet */}
      {pickerFor !== null && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/70" onClick={() => setPickerFor(null)}>
          <div
            className="slide-up mx-auto w-full max-w-md rounded-t-3xl border-t border-card-border bg-card p-5 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 text-center text-sm font-bold">Pick a transition</h3>
            <div className="grid grid-cols-3 gap-2">
              {TRANSITIONS.map((t) => (
                <button
                  key={t.type}
                  onClick={() => setTransition(pickerFor, t.type)}
                  className="flex flex-col items-center gap-1 rounded-xl border border-card-border px-2 py-3 active:border-accent"
                >
                  <span className="text-2xl">{t.emoji}</span>
                  <span className="text-[11px] font-medium">{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {clips.length > 0 && !plan && !busy && (
        <button
          onClick={() => clips.forEach((c) => handleRemoveClip(c.id))}
          className="mt-6 flex items-center justify-center gap-1 text-xs text-neutral-600"
        >
          <Trash2 size={12} /> Clear all clips
        </button>
      )}

      {/* ⌘K — every tool, searchable */}
      <CommandPalette />
    </main>
  );
}
