import { NextRequest } from "next/server";

export const maxDuration = 300;

// AI B-roll generation (#36) via MiniMax video generation, key-gated.
// POST { action: "submit", prompt }  → { taskId }
// POST { action: "poll", taskId }    → { status, videoUrl? }
// Without MINIMAX_API_KEY this reports unavailable — the app treats AI
// generation as an optional Lab feature, never a dependency.
export async function POST(req: NextRequest) {
  const key = process.env.MINIMAX_API_KEY;
  if (!key) {
    return Response.json(
      { available: false, error: "AI video generation needs MINIMAX_API_KEY in .env.local." },
      { status: 200 }
    );
  }

  let body: { action?: string; prompt?: string; taskId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
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
