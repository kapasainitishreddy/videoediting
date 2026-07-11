import { NextRequest } from "next/server";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";

export const maxDuration = 120;

// Generative image edits that genuinely need a model bigger than anything the
// on-device WASM stack can run: sky replacement, relighting, object removal
// (inpainting), eye-contact correction, and content-aware outpainting. These
// run on a still frame (a cover / poster / B-roll plate pulled from the edit),
// which is where per-frame cloud editing is actually practical for a
// mobile-first app — full-video model passes are deliberately out of scope.
//
// Key-gated exactly like /api/generate: with no key configured the route
// reports { available: false } and the UI shows the feature as needing a key,
// never a broken button. Defaults to fal.ai; override the endpoint per task
// with AI_IMAGE_ENDPOINT to point at any provider.
//
// POST { task, imageB64, prompt? } → { available, imageUrl? | imageB64?, error? }

const LIMIT = 15;
const WINDOW_MS = 15 * 60_000;

type Task = "sky" | "relight" | "inpaint" | "eyecontact" | "outpaint";

// Each task maps to a fal.ai model (the documented `https://fal.run/{model}`
// sync endpoint) plus the default instruction that describes the edit. The
// operator can repoint any of these with AI_IMAGE_ENDPOINT.
const TASKS: Record<Task, { model: string; instruction: string }> = {
  sky: { model: "fal-ai/image-editing/sky-replacement", instruction: "Replace the sky with a dramatic, natural-looking sky that matches the scene lighting." },
  relight: { model: "fal-ai/image-editing/relight", instruction: "Relight the scene with soft cinematic key light; keep the subject natural." },
  inpaint: { model: "fal-ai/image-editing/object-removal", instruction: "Remove the distracting object and reconstruct a clean, plausible background." },
  eyecontact: { model: "fal-ai/image-editing/eye-contact", instruction: "Redirect the subject's gaze to look directly into the camera." },
  outpaint: { model: "fal-ai/image-editing/outpaint", instruction: "Extend the frame outward with content-consistent detail to fill a 9:16 canvas." },
};

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(`${clientIp(req)}:image-edit`, LIMIT, WINDOW_MS);
  if (!rl.ok) return rateLimitResponse(rl);

  const key = process.env.FAL_KEY ?? process.env.AI_IMAGE_KEY;
  if (!key) {
    return Response.json(
      { available: false, error: "AI image edits need FAL_KEY (or AI_IMAGE_KEY) in .env.local." },
      { status: 200 },
    );
  }

  let body: { task?: string; imageB64?: string; prompt?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const task = body.task as Task;
  if (!task || !(task in TASKS)) {
    return Response.json({ error: `Unknown task. One of: ${Object.keys(TASKS).join(", ")}` }, { status: 400 });
  }
  const image = (body.imageB64 ?? "").trim();
  if (!image || image.length > 12_000_000) {
    return Response.json({ error: "Missing or oversized image (send a data URL / base64 under ~9MB)." }, { status: 400 });
  }

  const conf = TASKS[task];
  const endpoint = process.env.AI_IMAGE_ENDPOINT ?? `https://fal.run/${conf.model}`;
  const prompt = (body.prompt ?? "").slice(0, 400).trim() || conf.instruction;
  const imageUrl = image.startsWith("data:") ? image : `data:image/png;base64,${image}`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Key ${key}` },
      body: JSON.stringify({ image_url: imageUrl, prompt }),
    });
    if (!res.ok) {
      return Response.json({ available: true, error: `Provider ${res.status}: ${(await res.text()).slice(0, 200)}` }, { status: 502 });
    }
    const data = await res.json();
    // fal returns { images: [{ url }] } or { image: { url } } depending on model
    const out: string | undefined = data?.images?.[0]?.url ?? data?.image?.url ?? data?.image_url ?? data?.url;
    if (!out) {
      return Response.json({ available: true, error: "Provider returned no image." }, { status: 502 });
    }
    return Response.json({ available: true, imageUrl: out });
  } catch (err) {
    return Response.json({ available: true, error: String(err).slice(0, 160) }, { status: 502 });
  }
}
