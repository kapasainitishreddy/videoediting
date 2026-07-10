// Text → soundtrack parameters. Pure, Node-testable. ChatCut's "describe a
// vibe and get a royalty-free track matched to your video" — on-device: this
// maps a plain-English description to the mood + tempo the app's own
// procedural score composer (audio-cinema.composeScore) understands. The
// track is then synthesized locally, length-matched to the edit — no cloud,
// no license to track, royalty-free because it's generated.

export type ScoreMood = "epic" | "chill" | "dark" | "uplift";

export interface VibeSpec {
  mood: ScoreMood;
  bpm: number; // 60..160
  label: string; // human summary for the confirmation line
}

// mood keyword banks (checked most-specific first) with a base tempo each.
const MOODS: { mood: ScoreMood; base: number; re: RegExp }[] = [
  { mood: "dark", base: 90, re: /\bdark|ominous|tense|suspense|horror|moody|eerie|sinister|dramatic tension|brooding\b/ },
  { mood: "epic", base: 120, re: /\bepic|cinematic|trailer|orchestral|heroic|hero|grand|powerful|intense|battle|triumphant\b/ },
  { mood: "chill", base: 78, re: /\bchill|lo-?fi|calm|relax|mellow|ambient|study|soft|dreamy|smooth|laid.?back|aesthetic\b/ },
  { mood: "uplift", base: 122, re: /\buplift|happy|upbeat|pop|energetic|fun|dance|party|hype|joyful|feel.?good|bright|bouncy\b/ },
];

export function interpretVibe(text: string): VibeSpec {
  const s = (text ?? "").toLowerCase();
  const hit = MOODS.find((m) => m.re.test(s));
  const mood = hit?.mood ?? "uplift";
  let bpm = hit?.base ?? 110;

  // explicit tempo wins
  const explicit = s.match(/\b(\d{2,3})\s*bpm\b/);
  if (explicit) {
    bpm = Math.max(60, Math.min(160, parseInt(explicit[1], 10)));
  } else {
    // tempo adjectives nudge the mood's base tempo
    if (/\bslow|slower|downtempo|sluggish|half.?time\b/.test(s)) bpm -= 20;
    if (/\bfast|faster|driving|uptempo|high.?energy|racing\b/.test(s)) bpm += 20;
    bpm = Math.max(60, Math.min(160, bpm));
  }

  const names: Record<ScoreMood, string> = { epic: "epic cinematic", chill: "chill", dark: "dark & tense", uplift: "upbeat" };
  return { mood, bpm, label: `${names[mood]} · ~${bpm} BPM` };
}
