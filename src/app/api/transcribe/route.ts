import { NextRequest } from "next/server";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";

export const maxDuration = 120;

const LIMIT = 15;
const WINDOW_MS = 10 * 60_000;

// Optional speech-to-text for auto-captions. Send an audio file (extracted
// from a clip in the browser) and get back timed lines. Uses OpenAI Whisper
// when OPENAI_API_KEY is set. Without a key the app falls back to typed
// captions — which always work, fully offline.
//
// (MiniMax's text key doesn't cover speech-to-text, so it isn't used here;
// typed captions cover the no-ASR case.)
export async function POST(req: NextRequest) {
  const rl = checkRateLimit(`${clientIp(req)}:transcribe`, LIMIT, WINDOW_MS);
  if (!rl.ok) return rateLimitResponse(rl);

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return Response.json(
      {
        available: false,
        error: "No speech-to-text key. Add OPENAI_API_KEY for auto-transcription, or just type your captions — that works offline.",
      },
      { status: 200 }
    );
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("audio");
  if (!(file instanceof Blob)) {
    return Response.json({ error: "Missing audio file" }, { status: 400 });
  }

  const upstream = new FormData();
  upstream.append("file", file, "audio.mp3");
  upstream.append("model", "whisper-1");
  upstream.append("response_format", "verbose_json");
  // Edit-by-transcript needs per-word timing; segment lines stay the default
  const wantWords = form?.get("words") === "1";
  if (wantWords) upstream.append("timestamp_granularities[]", "word");

  try {
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: upstream,
    });
    if (!res.ok) {
      return Response.json({ available: true, error: `Whisper ${res.status}: ${(await res.text()).slice(0, 200)}` }, { status: 502 });
    }
    const data = await res.json();
    // Normalize to { lines: [{start, end, text}] }
    const segments: { start: number; end: number; text: string }[] = Array.isArray(data.segments)
      ? data.segments.map((s: { start: number; end: number; text: string }) => ({
          start: Number(s.start) || 0,
          end: Number(s.end) || 0,
          text: String(s.text || "").trim(),
        }))
      : [];
    const words: { word: string; start: number; end: number }[] =
      wantWords && Array.isArray(data.words)
        ? data.words.map((w: { word: string; start: number; end: number }) => ({
            word: String(w.word ?? "").trim(),
            start: Number(w.start) || 0,
            end: Number(w.end) || 0,
          }))
        : [];
    return Response.json({ available: true, lines: segments, words, text: String(data.text ?? "") });
  } catch (err) {
    return Response.json({ available: true, error: `Transcription failed: ${String(err).slice(0, 150)}` }, { status: 502 });
  }
}
