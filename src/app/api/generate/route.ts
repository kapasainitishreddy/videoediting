import { NextRequest } from "next/server";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";

export const maxDuration = 300;

// Video generation is the most expensive call in the app per-request
// (real compute on MiniMax's side) — keep this tight.
const LIMIT = 10;
const WINDOW_MS = 15 * 60_000;

// AI generation via MiniMax, key-gated.
// POST { action: "submit", prompt }  → { taskId }            (B-roll video)
// POST { action: "poll", taskId }    → { status, videoUrl? }
// POST { action: "tts", text, voice? } → { audioB64, format } (voiceover)
// Without MINIMAX_API_KEY this reports unavailable — the app treats AI
// generation as an optional Lab feature, never a dependency.
export async function POST(req: NextRequest) {
  const rl = checkRateLimit(`${clientIp(req)}:generate`, LIMIT, WINDOW_MS);
  if (!rl.ok) return rateLimitResponse(rl);

  const key = process.env.MINIMAX_API_KEY;
  if (!key) {
    return Response.json(
      { available: false, error: "AI video generation needs MINIMAX_API_KEY in .env.local." },
      { status: 200 }
    );
  }

  let body: { action?: string; prompt?: string; taskId?: string; text?: string; voice?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    if (body.action === "tts") {
      // Voiceover narration: type a script, get a spoken track to lay under
      // the edit (ducking + studio-sound run on-device afterwards).
      const text = (body.text ?? "").slice(0, 1200).trim();
      if (!text) return Response.json({ error: "Missing text" }, { status: 400 });
      const VOICES = new Set(["male-qn-qingse", "female-shaonv", "audiobook_male_1", "audiobook_female_1"]);
      const voice = VOICES.has(body.voice ?? "") ? body.voice! : "audiobook_female_1";
      const res = await fetch("https://api.minimax.io/v1/t2a_v2", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: "speech-02-turbo",
          text,
          stream: false,
          voice_setting: { voice_id: voice, speed: 1, vol: 1, pitch: 0 },
          audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 },
        }),
      });
      if (!res.ok) {
        return Response.json({ available: true, error: `MiniMax TTS ${res.status}: ${(await res.text()).slice(0, 200)}` }, { status: 502 });
      }
      const data = await res.json();
      const hex: string | undefined = data?.data?.audio;
      if (!hex || typeof hex !== "string") {
        return Response.json({ available: true, error: "MiniMax TTS returned no audio" }, { status: 502 });
      }
      // MiniMax returns hex-encoded MP3 — repack as base64 for the client
      const bytes = Buffer.from(hex, "hex");
      return Response.json({ available: true, audioB64: bytes.toString("base64"), format: "mp3" });
    }

    if (body.action === "submit") {
      const prompt = (body.prompt ?? "").slice(0, 500);
      if (!prompt) return Response.json({ error: "Missing prompt" }, { status: 400 });
      const res = await fetch("https://api.minimax.io/v1/video_generation", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: "T2V-01",
          prompt: `${prompt}. Vertical 9:16 composition, cinematic lighting, smooth camera movement.`,
        }),
      });
      if (!res.ok) {
        return Response.json({ available: true, error: `MiniMax ${res.status}: ${(await res.text()).slice(0, 200)}` }, { status: 502 });
      }
      const data = await res.json();
      const taskId = data?.task_id;
      if (!taskId) return Response.json({ available: true, error: "No task id returned" }, { status: 502 });
      return Response.json({ available: true, taskId });
    }

    if (body.action === "poll") {
      if (!body.taskId) return Response.json({ error: "Missing taskId" }, { status: 400 });
      const res = await fetch(
        `https://api.minimax.io/v1/query/video_generation?task_id=${encodeURIComponent(body.taskId)}`,
        { headers: { Authorization: `Bearer ${key}` } }
      );
      if (!res.ok) {
        return Response.json({ available: true, error: `MiniMax ${res.status}` }, { status: 502 });
      }
      const data = await res.json();
      const status: string = data?.status ?? "unknown";
      if (status === "Success" && data?.file_id) {
        // resolve the file to a URL
        const fres = await fetch(`https://api.minimax.io/v1/files/retrieve?file_id=${encodeURIComponent(data.file_id)}`, {
          headers: { Authorization: `Bearer ${key}` },
        });
        const fdata = await fres.json();
        return Response.json({ available: true, status: "done", videoUrl: fdata?.file?.download_url ?? null });
      }
      return Response.json({ available: true, status });
    }

    return Response.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  } catch (err) {
    return Response.json({ available: true, error: String(err).slice(0, 200) }, { status: 502 });
  }
}
