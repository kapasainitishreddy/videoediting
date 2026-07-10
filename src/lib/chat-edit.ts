// Conversational editing — the turn interpreter. Pure, Node-testable.
//
// Instead of compiling ONE upfront direction into the whole edit, the chat
// panel lets the user steer turn-by-turn ("cut the silences" → "now make it
// moody" → "tighten the intro" → "render it"). Each turn is classified here
// into a single concrete ChatOp; the client component executes it against the
// CURRENT plan/studio and the plan-history undo already in the store makes
// every turn reversible. No AI key required — style turns reuse the same
// deterministic prompt-compiler the one-shot flow uses.
import { compileDirection, type CompiledDirection } from "./prompt-compiler";

export type ChatOp =
  | { kind: "style"; compiled: CompiledDirection } // look/mood/transitions/score/overlay/captions/motion
  | { kind: "pace"; tightenTo: number } // snappier cuts WITHOUT touching the look
  | { kind: "tighten" } // remove dead air (jump cuts)
  | { kind: "cutaways" } // auto B-roll at speech gaps
  | { kind: "speakerCut" } // multi-cam: cut to whoever's talking
  | { kind: "hook"; variant: "tight" | "swapped" | "teaser" }
  | { kind: "callback" } // replay the hook at the end (loop bait)
  | { kind: "length"; seconds: number } // cut to 15/30/60…
  | { kind: "undo" }
  | { kind: "reset" }
  | { kind: "render" };

export interface ChatTurn {
  op: ChatOp | null; // null = not understood
  reply: string; // the assistant's confirmation or clarification
  suggestions?: string[]; // offered when the turn wasn't understood
}

const NUM_WORDS: Record<string, number> = {
  ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, "forty-five": 45,
  fortyfive: 45, fifty: 50, sixty: 60, ninety: 90,
};

function parseSeconds(text: string): number | null {
  // "30s", "30 sec", "30 seconds", "to 15", "a minute"
  const digit = text.match(/\b(\d{1,3})\s*(?:s\b|sec|secs|second|seconds)\b/i) || text.match(/\bto\s+(\d{1,3})\b/i);
  if (digit) {
    const n = parseInt(digit[1], 10);
    if (n >= 3 && n <= 600) return n;
  }
  if (/\b(a|one)\s+min(ute)?\b/i.test(text)) return 60;
  if (/\bhalf a min(ute)?\b/i.test(text)) return 30;
  for (const [w, n] of Object.entries(NUM_WORDS)) {
    if (new RegExp(`\\b${w}\\b`, "i").test(text) && /\bsecond|sec\b/i.test(text)) return n;
  }
  return null;
}

// Classify a single conversational turn. Order matters: explicit structural
// commands are checked before the catch-all style compiler, so "cut the
// silences" is a jump-cut op, not a color grade.
export function interpretTurn(text: string): ChatTurn {
  const t = (text ?? "").trim();
  if (!t) return { op: null, reply: "Tell me what to change — e.g. “cut the silences” or “make it cinematic.”" };
  const s = t.toLowerCase();

  // --- meta -----------------------------------------------------------------
  if (/\b(undo|revert|go back|take that back|nevermind|never mind|cancel that)\b/.test(s))
    return { op: { kind: "undo" }, reply: "Reverted the last change." };
  if (/\b(start over|reset|from scratch|clear everything|back to the original|undo everything)\b/.test(s))
    return { op: { kind: "reset" }, reply: "Back to the edit as it was when we started." };
  if (/\b(render|export|ship it|i'?m done|that'?s (it|all|perfect)|looks good|finish( it)?|good to go|that works|make the video)\b/.test(s))
    return { op: { kind: "render" }, reply: "Rendering your edit now…" };

  // --- length (needs a number) ----------------------------------------------
  const secs = parseSeconds(s);
  if (secs && /\b(long|length|make it|cut (it )?to|trim to|version|second|sec|min)\b/.test(s))
    return { op: { kind: "length", seconds: secs }, reply: `Cutting a ${secs}s version — hook and payoff kept, the middle trimmed.` };

  // --- pacing (snappier cuts, no look change) -------------------------------
  if (/\b(short(er)?|snappi?er|punchi?er|tighter( cuts)?|cut it down|cut down|faster cuts|too long|trim it down|trim the shots)\b/.test(s))
    return { op: { kind: "pace", tightenTo: 0.7 }, reply: "Tightened every shot for a snappier rhythm." };

  // --- structural plan surgery ----------------------------------------------
  if (/\b(cut|remove|trim|kill|drop|delete).{0,14}(silences?|dead ?air|pauses?|gaps?|quiet bits?)\b/.test(s) ||
      /\btighten (up )?the (dead ?air|silences?|pauses?)\b/.test(s) || /\bjump ?cuts?\b/.test(s))
    return { op: { kind: "tighten" }, reply: "Listening for dead air and turning it into jump cuts…" };

  if (/\b(add|insert|throw in|drop in).{0,12}(b.?roll|cut.?aways?)\b/.test(s) || /\bcut.?aways?\b/.test(s))
    return { op: { kind: "cutaways" }, reply: "Placing B-roll cutaways at the speech gaps…" };

  if (/\b(speaker|whoever'?s? (is )?talking|multi.?cam|active speaker|cut between (the )?(cameras|people|speakers)|follow the talker)\b/.test(s))
    return { op: { kind: "speakerCut" }, reply: "Cutting to whoever is talking across your cameras…" };

  if (/\b(callback|loop|loopable|bookend|return to the (start|beginning|hook)|rewatch|make it loop)\b/.test(s))
    return { op: { kind: "callback" }, reply: "Added a callback — the hook returns for a beat at the end so it loops." };

  {
    const isHook = /\b(hook|intro|opening|cold ?open|opener|first (few )?seconds?)\b/.test(s);
    const isTeaser = /\btease\b|\bteaser\b|\bending first\b|\bend first\b|\bpayoff first\b|\breveal first\b|\bshow the (result|ending|payoff) first\b/.test(s);
    const isSwap = /\b(swap|second shot|lead with|different open|another open)\b/.test(s);
    if (isTeaser)
      return { op: { kind: "hook", variant: "teaser" }, reply: "Flashed the payoff up front, then the edit — ending-first teaser." };
    if (isHook && isSwap)
      return { op: { kind: "hook", variant: "swapped" }, reply: "Promoted your second shot to the opener." };
    if (isHook)
      return { op: { kind: "hook", variant: "tight" }, reply: "Tightened the opening shot to hook faster." };
  }

  // --- style (catch-all: the deterministic prompt compiler) -----------------
  const compiled = compileDirection(t);
  if (compiled.notes.length) return { op: { kind: "style", compiled }, reply: `Done — ${compiled.summary}.` };

  // --- not understood -------------------------------------------------------
  return {
    op: null,
    reply: "I didn't catch a specific change there. Try one of these:",
    suggestions: [
      "cut the silences",
      "make it cinematic and moody",
      "tighten the intro",
      "add b-roll cutaways",
      "make it 30 seconds",
      "loop the ending",
    ],
  };
}

// Opening line for a fresh chat session.
export const CHAT_GREETING =
  "Tell me how to shape the edit, one change at a time. Try “cut the silences,” “make it moody,” “tighten the hook,” or “make it 30 seconds.” Say “undo” anytime.";
