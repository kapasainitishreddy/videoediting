import { NextRequest } from "next/server";

export const maxDuration = 60;

// Pluggable AI layer. Today: MiniMax (add MINIMAX_API_KEY to .env.local).
// The app never *requires* this route — analysis and auto-edit both have
// full local fallbacks — it only enriches results when a key exists.
//
// POST { task: "label-transitions" | "edit-directions", payload: {...} }
export async function POST(req: NextRequest) {
  const minimaxKey = process.env.MINIMAX_API_KEY;
  if (!minimaxKey) {
    return Response.json(
      { available: false, error: "No AI key configured. Add MINIMAX_API_KEY to .env.local — the app works locally without it." },
      { status: 200 }
    );
  }

  let body: { task?: string; payload?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const prompts: Record<string, string> = {
    "label-transitions": `You are a viral video editing expert. Given cut-detection data (timestamps, frame-difference deltas, brightness), label each cut with the most likely transition type (hard-cut, whip-pan, zoom-in, flash, fade, glitch) and write a one-line tip for recreating it. Respond as JSON: {"transitions":[{"time":number,"type":string,"description":string}]}.`,
    "edit-directions": `You are a viral video editor. The user gives you a plain-English direction and a current edit plan (segments with transitions, a color grade). Return the improved plan as JSON with the same shape, adjusting transitions, trim lengths, speed, and colorGrade to match the direction. Keep segment clipIds unchanged.`,
  };

  const system = prompts[body.task ?? ""];
  if (!system) return Response.json({ error: `Unknown task: ${body.task}` }, { status: 400 });

  try {
    const res = await fetch("https://api.minimax.io/v1/text/chatcompletion_v2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${minimaxKey}`,
      },
      body: JSON.stringify({
        model: "MiniMax-Text-01",
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(body.payload) },
        ],
        temperature: 0.3,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return Response.json({ available: true, error: `MiniMax error ${res.status}: ${text.slice(0, 300)}` }, { status: 502 });
    }
    const data = await res.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    // Extract the first JSON object from the reply
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return Response.json({ available: true, error: "AI returned no JSON" }, { status: 502 });
    return Response.json({ available: true, result: JSON.parse(match[0]) });
  } catch (err) {
    return Response.json({ available: true, error: `AI call failed: ${String(err).slice(0, 200)}` }, { status: 502 });
  }
}
