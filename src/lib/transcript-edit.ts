// Text-based editing core — pure, Node-testable. Descript's signature move:
// edit the video by editing its words. This module is the deterministic
// core; the transcript itself comes from /api/transcribe (Whisper,
// OPENAI_API_KEY) with word timestamps, so the FEATURE is key-gated but the
// logic is fully testable offline.
//   • parseWhisperWords()  — verbose_json → Word[]
//   • fillerRanges()       — find "um / uh / like / you know / so basically"
//   • wordCutRanges()      — deleted words → source-time cut ranges
//   then plan-surgery.tightenSilences applies the ranges as jump cuts.
import type { Range } from "./plan-surgery";

export interface Word {
  w: string;
  start: number;
  end: number;
}

// Whisper verbose_json: { words: [{word, start, end}] } or segments[].words
export function parseWhisperWords(json: unknown): Word[] {
  const j = json as { words?: { word: string; start: number; end: number }[]; segments?: { words?: { word: string; start: number; end: number }[] }[] };
  const raw = j?.words ?? j?.segments?.flatMap((s) => s.words ?? []) ?? [];
  return raw
    .filter((w) => typeof w?.word === "string" && Number.isFinite(w.start) && Number.isFinite(w.end))
    .map((w) => ({ w: w.word.trim(), start: Number(w.start.toFixed(2)), end: Number(w.end.toFixed(2)) }));
}

// Single-word fillers plus two-word phrases. Case-insensitive; punctuation
// stripped before matching. Conservative: "like" only counts when isolated
// between pauses (it's a real word most of the time).
const FILLERS = new Set(["um", "uh", "uhm", "erm", "hmm", "mmm", "ah", "er"]);
const PHRASES: string[][] = [["you", "know"], ["i", "mean"], ["sort", "of"], ["kind", "of"], ["so", "basically"]];

const norm = (w: string) => w.toLowerCase().replace(/[^a-z']/g, "");

export function fillerRanges(words: Word[]): { range: Range; text: string }[] {
  const out: { range: Range; text: string }[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = norm(words[i].w);
    if (FILLERS.has(w)) {
      out.push({ range: { start: words[i].start, end: words[i].end }, text: words[i].w });
      continue;
    }
    if (w === "like") {
      const gapBefore = i === 0 || words[i].start - words[i - 1].end > 0.25;
      const gapAfter = i === words.length - 1 || words[i + 1].start - words[i].end > 0.25;
      if (gapBefore && gapAfter) out.push({ range: { start: words[i].start, end: words[i].end }, text: words[i].w });
      continue;
    }
    for (const ph of PHRASES) {
      if (ph.every((p, k) => norm(words[i + k]?.w ?? "") === p)) {
        out.push({
          range: { start: words[i].start, end: words[i + ph.length - 1].end },
          text: ph.join(" "),
        });
        i += ph.length - 1;
        break;
      }
    }
  }
  return out;
}

// The user deleted words[i..j] spans in the transcript editor → merge the
// selections into source-time cut ranges (with a tiny pad so cuts don't clip
// neighboring phonemes), ready for tightenSilences-style plan surgery.
export function wordCutRanges(deleted: Word[], pad = 0.04): Range[] {
  if (deleted.length === 0) return [];
  const sorted = [...deleted].sort((a, b) => a.start - b.start);
  const merged: Range[] = [];
  for (const w of sorted) {
    const s = Math.max(0, w.start - pad);
    const e = w.end + pad;
    const last = merged[merged.length - 1];
    if (last && s <= last.end + 0.12) last.end = Math.max(last.end, e);
    else merged.push({ start: s, end: e });
  }
  return merged.map((r) => ({ start: Number(r.start.toFixed(2)), end: Number(r.end.toFixed(2)) }));
}

// Reading view: words grouped into lines by pause boundaries — the UI renders
// these as tappable text.
export function transcriptLines(words: Word[], maxLine = 9): Word[][] {
  const lines: Word[][] = [];
  let line: Word[] = [];
  for (let i = 0; i < words.length; i++) {
    line.push(words[i]);
    const pause = i < words.length - 1 && words[i + 1].start - words[i].end > 0.55;
    if (line.length >= maxLine || pause) {
      lines.push(line);
      line = [];
    }
  }
  if (line.length) lines.push(line);
  return lines;
}
