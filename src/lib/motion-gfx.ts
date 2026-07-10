// Text → motion graphic. Pure, Node-testable. ChatCut's "describe an
// animation in plain English" — but on-device: this classifies a plain
// description into one of the app's existing ANIMATED overlay primitives
// (title card, lower third, animated counter, 3-2-1 countdown, location
// card, kinetic caption) and pulls out the text/params. The editor then
// drives the same renderers it already uses to burn them — no generative
// model, no cloud, works offline.

export type MotionGfxKind = "title" | "lowerThird" | "counter" | "countdown" | "location" | "caption";

export interface MotionGfxSpec {
  kind: MotionGfxKind;
  text: string; // main line (or the counter prefix)
  subtext?: string; // role for a lower third
  from?: string; // counter start
  to?: string; // counter end
  style?: "minimal" | "epic" | "typewriter";
  reason: string; // what it understood, for the confirmation line
}

// Pull the payload text out of a description: prefer quotes, then "that says
// / saying / reads X", else the trailing phrase after the trigger word.
function extractText(s: string): string {
  const q = s.match(/["'“”]([^"'“”]{1,80})["'“”]/);
  if (q) return q[1].trim();
  const says = s.match(/\b(?:that says|saying|reads|labell?ed|titled|for)\s+(.{1,80})$/i);
  if (says) return says[1].replace(/[.!]+$/, "").trim();
  return "";
}

const STYLE = (s: string): MotionGfxSpec["style"] =>
  /\btypewriter|type ?on\b/.test(s) ? "typewriter" : /\bepic|bold|dramatic|big\b/.test(s) ? "epic" : "minimal";

export function interpretMotionGfx(text: string): MotionGfxSpec | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  const s = t.toLowerCase();

  // countdown — no text payload needed
  if (/\bcount ?down\b|\b3 ?[,\- ]?2 ?[,\- ]?1\b|\bthree,? ?two,? ?one\b/.test(s))
    return { kind: "countdown", text: "", reason: "a 3-2-1 countdown intro" };

  // animated counter: "count from 0 to 1000", "Day 1 to 7", "$0 → $10k"
  const range = s.match(/from\s+\$?([\d,]+)\s*(?:to|→|-|through|up to)\s*\$?([\d,]+)/i) ||
    s.match(/\$?([\d,]+)\s*(?:to|→)\s*\$?([\d,]+)/);
  if (/\bcount(er|ing)?\b/.test(s) || range) {
    const from = range ? range[1].replace(/,/g, "") : "0";
    const to = range ? range[2].replace(/,/g, "") : "100";
    const prefix = /\bday\b/.test(s) ? "Day " : /\$/.test(t) ? "$" : "";
    return { kind: "counter", text: prefix, from, to, reason: `an animated counter ${prefix}${from} → ${prefix}${to}` };
  }

  // location card
  if (/\blocation( card)?\b|📍|\bplace card\b|\bcity card\b/.test(s)) {
    const place = extractText(t) || t.replace(/.*\b(location|place|city)( card)?\b\s*/i, "").replace(/^[:\-\s]+/, "").trim();
    return { kind: "location", text: place || "Location", reason: `a location card${place ? ` for ${place}` : ""}` };
  }

  // lower third: "John Doe, CEO" or "lower third for Jane — designer"
  if (/\blower ?third\b|\bname (tag|plate|card)\b/.test(s)) {
    const payload = extractText(t) || t.replace(/.*lower ?third( for)?\s*/i, "").trim();
    const [name, role] = payload.split(/\s*[,—\-|]\s*/, 2);
    return { kind: "lowerThird", text: (name || "Name").trim(), subtext: role?.trim(), reason: `a lower third for ${name || "the name"}` };
  }

  // title card
  if (/\btitle( card)?\b|\bheadline\b|\bbig text\b|\btitle screen\b/.test(s)) {
    const title = extractText(t) || t.replace(/.*title( card| screen)?\s*/i, "").replace(/^[:\-\s]+/, "").trim();
    return { kind: "title", text: title || "Title", style: STYLE(s), reason: `a ${STYLE(s)} title card${title ? ` — “${title}”` : ""}` };
  }

  // kinetic caption / callout — the catch-all when there IS a text payload
  if (/\bcaption|callout|pop.?up|banner|text (overlay|that says|pop)|subtitle\b/.test(s) || extractText(t)) {
    const cap = extractText(t) || t.replace(/.*\b(caption|callout|banner|text)\b\s*/i, "").replace(/^[:\-\s]+/, "").trim();
    if (cap) return { kind: "caption", text: cap, reason: `a kinetic caption — “${cap}”` };
  }

  return null;
}
