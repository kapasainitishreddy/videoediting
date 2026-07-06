// Creator growth tools — pure, Node-testable.
//   • hookLines()  — opening lines proven to work in the video's niche,
//     generated locally from pattern banks (an LLM key makes them sharper
//     via /api/ai, but the floor works offline)
//   • showNotes()  — one shoot → many formats: turns the edit's own metadata
//     (chapters, niche, captions, hashtags) into ready-to-post show notes /
//     blog markdown. Repurposing without re-editing.
import type { EditBlueprint, EditPlan, UserClip } from "./types";

// Deterministic tiny PRNG so tests are stable and the same edit gets the
// same suggestions until the user asks to reroll (seed bump).
function lcg(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export interface HookLine {
  line: string;
  pattern: string; // which psychological pattern it uses
  why: string;
}

// Pattern bank: {topic} is replaced with the niche/topic phrase.
const HOOK_PATTERNS: { pattern: string; why: string; forms: string[] }[] = [
  {
    pattern: "Negativity hook",
    why: "Contrarian opens out-perform agreeable ones — viewers stay to argue or agree.",
    forms: ["Stop doing {topic} like this.", "Everything you know about {topic} is wrong.", "This {topic} mistake is costing you views."],
  },
  {
    pattern: "Curiosity gap",
    why: "An unresolved question keeps viewers through the first 3 seconds.",
    forms: ["Nobody talks about this part of {topic}.", "The {topic} trick I wish I knew sooner.", "Here's what {topic} looks like behind the scenes."],
  },
  {
    pattern: "Specific number",
    why: "Concrete numbers read as a promise with a defined payoff.",
    forms: ["3 {topic} rules that changed everything.", "I tried {topic} for 30 days — here's what happened.", "The 10-second {topic} fix."],
  },
  {
    pattern: "Direct callout",
    why: "Naming the viewer filters IN the right audience — the algorithm reads the retention.",
    forms: ["If you're into {topic}, watch this.", "You're doing {topic} — so you need to see this.", "POV: you finally figured out {topic}."],
  },
  {
    pattern: "Ending first",
    why: "Showing the payoff up front makes viewers stay to see how you got there.",
    forms: ["This is the result. Here's how.", "Wait for what {topic} turns into.", "The before is unrecognizable."],
  },
];

const NICHE_TOPICS: Record<string, string> = {
  travel: "travel reels",
  fitness: "training",
  food: "cooking",
  gaming: "your gameplay",
  fashion: "outfits",
  beauty: "your routine",
  business: "building your business",
  education: "learning this",
  music: "your sound",
  comedy: "your skits",
  pets: "your pet content",
  sports: "your highlights",
};

export function hookLines(nicheId: string, topic?: string, seed = 1): HookLine[] {
  const t = (topic?.trim() || NICHE_TOPICS[nicheId] || "this").replace(/\.$/, "");
  const rnd = lcg(seed * 7919 + nicheId.length);
  return HOOK_PATTERNS.map((p) => {
    const form = p.forms[Math.floor(rnd() * p.forms.length) % p.forms.length];
    return { line: form.replace(/\{topic\}/g, t), pattern: p.pattern, why: p.why };
  });
}

// --- show notes / blog repurposing ------------------------------------------------------

export interface ShowNotesInput {
  title?: string;
  blueprint?: EditBlueprint | null;
  plan: EditPlan;
  clips: UserClip[];
  chapters?: string; // from retention.chapterMarkers
  hashtags?: string[]; // from export-kit
  captionsText?: string[]; // burned caption lines, if any
  attribution?: string; // from media-trust license tracker
}

export function showNotes(i: ShowNotesInput): string {
  const niche = i.blueprint?.niche?.label;
  const dur = i.plan.segments.reduce((s, x) => s + (x.end - x.start) / x.speed, 0);
  const shots = i.plan.segments.length;
  const title = i.title || (niche ? `New ${niche} edit` : "New edit");

  const lines: string[] = [`# ${title}`, ""];
  lines.push(
    `A ${Math.round(dur)}s edit cut from ${new Set(i.plan.segments.map((s) => s.clipId)).size} clips into ${shots} shots.` +
      (niche ? ` Niche: ${niche}.` : "") +
      (i.plan.aiDirection ? ` Direction: “${i.plan.aiDirection}”.` : "")
  );
  lines.push("");

  if (i.captionsText && i.captionsText.length > 0) {
    lines.push("## Key moments", "");
    for (const c of i.captionsText.slice(0, 8)) lines.push(`- ${c}`);
    lines.push("");
  }
  if (i.chapters) {
    lines.push("## Chapters", "", "```", i.chapters, "```", "");
  }
  lines.push("## Behind the edit", "");
  lines.push(i.plan.explanation || "Auto-edited with beat-matched cuts and motion-matched transitions.");
  lines.push("");
  if (i.hashtags && i.hashtags.length > 0) {
    lines.push("## Tags", "", i.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" "), "");
  }
  if (i.attribution) {
    lines.push("## Credits & licenses", "", i.attribution, "");
  }
  lines.push("---", "*Edited on-device with ViralEdit — no uploads, no watermark.*");
  return lines.join("\n");
}
