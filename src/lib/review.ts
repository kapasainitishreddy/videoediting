// Async collaborative review — pure, Node-testable. The app is local-first
// and account-less, so "collaboration" here works the way pro handoff
// actually works: timestamped notes that live INSIDE the portable project
// file (edl.projectToFile). You add notes on the timeline, export the
// project, hand the file to a collaborator; they import it and see every
// note at its exact timecode. No server, no login, no realtime — but a
// genuinely working review loop. (Realtime co-editing is the "coming soon"
// layer that needs a backend; this is the part that ships today.)

export interface ReviewComment {
  id: string;
  time: number; // seconds into the edit the note is anchored to
  author: string; // free-text display name (no accounts)
  body: string;
  resolved: boolean;
  createdAt: number; // epoch ms — for stable ordering within a timecode
}

// Factory kept separate from the pure ops so id/createdAt (the only
// non-deterministic bits) are injected by the caller — the UI passes a uuid
// and Date.now(); tests pass fixed values.
export function makeComment(
  fields: { time: number; author: string; body: string },
  meta: { id: string; createdAt: number },
): ReviewComment {
  return {
    id: meta.id,
    time: Math.max(0, Number.isFinite(fields.time) ? fields.time : 0),
    author: fields.author.trim() || "Anonymous",
    body: fields.body.trim(),
    resolved: false,
    createdAt: meta.createdAt,
  };
}

// Timeline order: by anchor time, then by creation time so a thread of notes
// on the same frame keeps its reply order.
export function sortComments(list: ReviewComment[]): ReviewComment[] {
  return [...list].sort((a, b) => a.time - b.time || a.createdAt - b.createdAt);
}

export function addComment(list: ReviewComment[], c: ReviewComment): ReviewComment[] {
  return sortComments([...list.filter((x) => x.id !== c.id), c]);
}

export function editComment(list: ReviewComment[], id: string, body: string): ReviewComment[] {
  return list.map((c) => (c.id === id ? { ...c, body: body.trim() } : c));
}

export function setResolved(list: ReviewComment[], id: string, resolved: boolean): ReviewComment[] {
  return list.map((c) => (c.id === id ? { ...c, resolved } : c));
}

export function deleteComment(list: ReviewComment[], id: string): ReviewComment[] {
  return list.filter((c) => c.id !== id);
}

// Merge two note sets (e.g. yours + an imported project's), newest write per
// id winning, back in timeline order. Lets two people's notes coexist after
// a file exchange without clobbering.
export function mergeComments(a: ReviewComment[], b: ReviewComment[]): ReviewComment[] {
  const byId = new Map<string, ReviewComment>();
  for (const c of [...a, ...b]) {
    const prev = byId.get(c.id);
    if (!prev || c.createdAt >= prev.createdAt) byId.set(c.id, c);
  }
  return sortComments([...byId.values()]);
}

export interface ReviewSummary {
  total: number;
  open: number;
  resolved: number;
  authors: string[];
}

export function reviewSummary(list: ReviewComment[]): ReviewSummary {
  return {
    total: list.length,
    open: list.filter((c) => !c.resolved).length,
    resolved: list.filter((c) => c.resolved).length,
    authors: [...new Set(list.map((c) => c.author))].sort(),
  };
}

// "0:04 · Alex: tighten this cut" — one-line render for a notes list/export.
export function timecode(time: number): string {
  const t = Math.max(0, Math.round(time));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatComment(c: ReviewComment): string {
  return `${timecode(c.time)}${c.resolved ? " ✓" : ""} · ${c.author}: ${c.body}`;
}
