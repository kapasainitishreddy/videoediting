// Every provider exposes the exact same call() signature and is expected
// to return raw text containing one JSON object. Whichever key the user
// has configured, the route picks the matching provider and the response
// flows through the same normalize*() functions in ai-schema.ts — so the
// app behaves identically no matter which LLM answered.
export interface AiProvider {
  name: string;
  envVar: string;
  call: (system: string, userContent: string) => Promise<string>;
}

async function minimaxCall(system: string, userContent: string): Promise<string> {
  const key = process.env.MINIMAX_API_KEY!;
  const res = await fetch("https://api.minimax.io/v1/text/chatcompletion_v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "MiniMax-Text-01",
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`MiniMax ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

async function anthropicCall(system: string, userContent: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY!;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: userContent }],
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data?.content?.[0]?.text ?? "";
}

async function openaiCall(system: string, userContent: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY!;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

// Priority order when multiple keys happen to be set. Each entry is only
// eligible once its env var actually has a value.
const PROVIDERS: AiProvider[] = [
  { name: "minimax", envVar: "MINIMAX_API_KEY", call: minimaxCall },
  { name: "anthropic", envVar: "ANTHROPIC_API_KEY", call: anthropicCall },
  { name: "openai", envVar: "OPENAI_API_KEY", call: openaiCall },
];

export function pickProvider(preferred?: string): AiProvider | null {
  if (preferred) {
    const p = PROVIDERS.find((p) => p.name === preferred && process.env[p.envVar]);
    if (p) return p;
  }
  return PROVIDERS.find((p) => process.env[p.envVar]) ?? null;
}

export function availableProviders(): string[] {
  return PROVIDERS.filter((p) => process.env[p.envVar]).map((p) => p.name);
}

// Pull the first {...} block out of a reply, tolerating stray prose or
// markdown fences that some models add despite instructions not to.
export function extractJson(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const match = candidate.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}
