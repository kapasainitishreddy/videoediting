"use client";

// Live camera overlay — shoot vertical clips right in the app with pro
// framing guides (rule-of-thirds + 9:16 safe zone), then drop the take
// straight onto the editor timeline. Fully on-device: getUserMedia +
// MediaRecorder, nothing uploaded.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Circle, SwitchCamera, Square, Grid3x3 } from "lucide-react";
import { v4 as uuid } from "uuid";
import { probeDuration, makeThumbnail } from "@/lib/ffmpeg-client";
import { saveVideo, saveClipMeta } from "@/lib/storage";
import { useProject } from "@/store/project";
import type { UserClip } from "@/lib/types";

export default function FilmPage() {
  const router = useRouter();
  const { addClip } = useProject();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [facing, setFacing] = useState<"user" | "environment">("environment");
  const [guides, setGuides] = useState(true);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // (re)acquire the camera whenever the facing mode changes
  useEffect(() => {
    let cancelled = false;
    async function start() {
      setError(null);
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1080 }, height: { ideal: 1920 } },
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch {
        setError("Couldn't open the camera. Grant camera + mic permission, or use a device with a camera.");
      }
    }
    start();
    return () => {
      cancelled = true;
    };
  }, [facing]);

  // stop everything on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
    };
  }, []);

  // elapsed-time ticker while recording
  useEffect(() => {
    if (!recording) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed((Date.now() - t0) / 1000), 100);
    return () => clearInterval(id);
  }, [recording]);

  function pickMime(): string {
    const options = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
    for (const m of options) if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
    return "video/webm";
  }

  function startRec() {
    const stream = streamRef.current;
    if (!stream) return;
    chunksRef.current = [];
    const mime = pickMime();
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
    rec.onstop = () => void ingest(new Blob(chunksRef.current, { type: mime.split(";")[0] }));
    rec.start(200);
    recRef.current = rec;
    setElapsed(0);
    setRecording(true);
  }

  function stopRec() {
    if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
    setRecording(false);
  }

  async function ingest(blob: Blob) {
    setStatus("Saving your take…");
    try {
      const name = `Take ${new Date().toLocaleTimeString()}.webm`;
      const file = new File([blob], name, { type: blob.type });
      const duration = await probeDuration(file).catch(() => elapsed);
      const thumbnail = await makeThumbnail(file).catch(() => undefined);
      const id = uuid();
      await saveVideo(id, file, name);
      const clip: UserClip = { id, name, duration: duration || elapsed, thumbnail };
      await saveClipMeta(clip);
      addClip(clip);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      setStatus("Saved! Opening the editor…");
      router.push("/editor");
    } catch {
      setStatus(null);
      setError("Couldn't save the take. Try again.");
    }
  }

  return (
    <main className="relative flex flex-1 flex-col bg-black">
      <div className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between p-4">
        <button onClick={() => router.back()} aria-label="Back" className="rounded-full bg-black/50 p-2 text-white">
          <ArrowLeft size={18} />
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setGuides((g) => !g)}
            aria-label="Toggle framing guides"
            className={`rounded-full p-2 ${guides ? "bg-accent text-white" : "bg-black/50 text-white"}`}
          >
            <Grid3x3 size={18} />
          </button>
          <button
            onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
            aria-label="Switch camera"
            className="rounded-full bg-black/50 p-2 text-white"
            disabled={recording}
          >
            <SwitchCamera size={18} />
          </button>
        </div>
      </div>

      {/* camera preview (9:16) */}
      <div className="relative mx-auto flex w-full max-w-[440px] flex-1 items-center">
        <div className="relative aspect-[9/16] w-full overflow-hidden bg-neutral-950">
          <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />

          {guides && !error && (
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 90 160" preserveAspectRatio="none">
              {/* rule of thirds */}
              <g stroke="white" strokeOpacity="0.35" strokeWidth="0.3">
                <line x1="30" y1="0" x2="30" y2="160" />
                <line x1="60" y1="0" x2="60" y2="160" />
                <line x1="0" y1="53.3" x2="90" y2="53.3" />
                <line x1="0" y1="106.6" x2="90" y2="106.6" />
              </g>
              {/* caption safe-zone (bottom third where TikTok/Reels UI sits) */}
              <rect x="4" y="120" width="82" height="34" fill="none" stroke="#ff5c35" strokeOpacity="0.6" strokeWidth="0.4" strokeDasharray="2 2" />
            </svg>
          )}

          {error && (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-neutral-400">
              {error}
            </div>
          )}

          {recording && (
            <div className="absolute left-1/2 top-4 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> {elapsed.toFixed(1)}s
            </div>
          )}
        </div>
      </div>

      {/* record control */}
      <div className="z-20 flex flex-col items-center gap-2 p-6">
        {status ? (
          <p className="text-sm text-accent">{status}</p>
        ) : (
          <>
            {!recording ? (
              <button
                onClick={startRec}
                disabled={!!error}
                aria-label="Start recording"
                className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-red-500 disabled:opacity-40"
              >
                <Circle size={26} className="fill-white text-white" />
              </button>
            ) : (
              <button
                onClick={stopRec}
                aria-label="Stop recording"
                className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-red-600"
              >
                <Square size={24} className="fill-white text-white" />
              </button>
            )}
            <p className="text-[11px] text-neutral-500">
              {recording ? "Tap to stop — the take drops onto your timeline" : "Rule-of-thirds + caption safe-zone guides on"}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
