// Plan surgery — pure, Node-testable timeline operations that competitors
// gate behind subscriptions (or don't have):
//   • tightenSilences()   — Descript-style jump-cut tightener: physically
//     removes dead air from segments instead of just flagging it
//   • insertCutaways()    — auto B-roll: replaces a beat of the talking shot
//     with B-roll at natural speech gaps (duration preserved)
//   • activeSpeakerCut()  — multi-cam interview cut: given per-camera speech
//     energy over shared time, cut to whoever is talking (energy diarization
//     — honest about being audio-driven, no cloud, no model)
//   • longformClips()     — Opus-Clip-style: rank the best short-clip windows
//     inside a long recording, scored and reasoned
// Everything returns NEW plans/segments — nothing mutates, nothing
// auto-applies without a tap in the UI.
import type { EditPlan, TimelineSegment } from "./types";
import type { ClipAnalysis } from "./clip-analysis";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export interface Range {
  start: number;
  end: number;
}

// Subtract `cuts` from `keep`, dropping slivers under minPiece.
export function subtractRanges(keep: Range, cuts: Range[], minPiece = 0.25): Range[] {
  let pieces: Range[] = [{ ...keep }];
  for (const c of cuts) {
    const next: Range[] = [];
    for (const p of pieces) {
      if (c.end <= p.start || c.start >= p.end) {
        next.push(p);
        continue;
      }
      if (c.start > p.start) next.push({ start: p.start, end: Math.max(p.start, c.start) });
      if (c.end < p.end) next.push({ start: Math.min(p.end, c.end), end: p.end });
    }
    pieces = next;
  }
  return pieces.filter((p) => p.end - p.start >= minPiece).map((p) => ({ start: Number(p.start.toFixed(2)), end: Number(p.end.toFixed(2)) }));
}

// --- jump-cut tightener --------------------------------------------------------------
// silencesByClip: dead-air ranges in each clip's SOURCE time (from
// audio-polish.silenceRanges). Each segment loses the silent stretches it
// overlaps; the survivors become jump-cut pieces (hard cuts, like every
// talking-head editor does by hand).

export function tightenSilences(
  plan: EditPlan,
  silencesByClip: Map<string, Range[]>,
  opts: { pad?: number; minPiece?: number } = {}
): { plan: EditPlan; removedSeconds: number; cuts: number } {
  const pad = opts.pad ?? 0.12; // keep a breath on either side so cuts don't clip words
  const next = clone(plan);
  const segments: TimelineSegment[] = [];
  let removed = 0;
  let cuts = 0;

  for (const seg of next.segments) {
    const silences = (silencesByClip.get(seg.clipId) ?? [])
      .map((r) => ({ start: r.start + pad, end: r.end - pad }))
      .filter((r) => r.end - r.start > 0.15 && r.end > seg.start && r.start < seg.end)
      .map((r) => ({ start: Math.max(seg.start, r.start), end: Math.min(seg.end, r.end) }));
    if (silences.length === 0) {
      segments.push(seg);
      continue;
    }
    const pieces = subtractRanges({ start: seg.start, end: seg.end }, silences, opts.minPiece ?? 0.25);
    if (pieces.length === 0) {
      segments.push(seg); // everything was "silent" — trust the original over an empty cut
      continue;
    }
    removed += seg.end - seg.start - pieces.reduce((s, p) => s + (p.end - p.start), 0);
    pieces.forEach((p, i) => {
      const last = i === pieces.length - 1;
      segments.push({
        ...seg,
        id: pieces.length === 1 ? seg.id : `${seg.id}_jc${i}`,
        start: p.start,
        end: p.end,
        transitionAfter: last ? seg.transitionAfter : "hard-cut",
      });
      if (!last) cuts++;
    });
  }
  next.segments = segments;
  if (removed > 0.05) {
    next.explanation = (next.explanation ? next.explanation + " " : "") + `Tightened ${removed.toFixed(1)}s of dead air into jump cuts.`;
  }
  return { plan: next, removedSeconds: Number(removed.toFixed(2)), cuts };
}

// --- auto B-roll cutaways ---------------------------------------------------------------
// opportunities: SOURCE-time moments inside talking segments where a cutaway
// is safe (speech gaps / lulls). broll: candidate windows from OTHER clips.
// A cutaway replaces [at, at+len] of the host shot — total duration is
// preserved, each B-roll window is used once, hard cuts on both sides.

export function insertCutaways(
  plan: EditPlan,
  opportunities: { clipId: string; at: number }[],
  broll: { clipId: string; start: number; end: number }[],
  opts: { len?: number; max?: number } = {}
): { plan: EditPlan; inserted: number } {
  const len = opts.len ?? 1.0;
  const max = opts.max ?? 3;
  const next = clone(plan);
  const pool = [...broll];
  let inserted = 0;

  const out: TimelineSegment[] = [];
  for (const seg of next.segments) {
    if (inserted >= max || pool.length === 0) {
      out.push(seg);
      continue;
    }
    // one cutaway per host segment, at the first opportunity that fits with margin
    const opp = opportunities.find(
      (o) => o.clipId === seg.clipId && o.at >= seg.start + 0.6 && o.at + len <= seg.end - 0.6
    );
    const b = pool.find((p) => p.clipId !== seg.clipId && p.end - p.start >= len);
    if (!opp || !b) {
      out.push(seg);
      continue;
    }
    pool.splice(pool.indexOf(b), 1);
    out.push(
      { ...seg, id: `${seg.id}_pre`, end: Number(opp.at.toFixed(2)), transitionAfter: "hard-cut" },
      {
        id: `${seg.id}_broll`,
        clipId: b.clipId,
        start: Number(b.start.toFixed(2)),
        end: Number((b.start + len).toFixed(2)),
        transitionAfter: "hard-cut",
        speed: 1,
      },
      { ...seg, id: `${seg.id}_post`, start: Number((opp.at + len).toFixed(2)) }
    );
    inserted++;
  }
  next.segments = out;
  if (inserted > 0) {
    next.explanation = (next.explanation ? next.explanation + " " : "") + `${inserted} B-roll cutaway${inserted > 1 ? "s" : ""} placed at speech gaps.`;
  }
  return { plan: next, inserted };
}

// --- active-speaker multi-cam cut ------------------------------------------------------------
// tracks: per-camera speech energy sampled over the SAME conversation time
// (cameras rolling in parallel). Cuts to the loudest camera per window with
// hysteresis (a new speaker must clearly win twice before we switch) and a
// minimum shot length so the edit never machine-guns.

export interface SpeakerTrack {
  clipId: string;
  times: number[]; // shared conversation time, seconds
  rms: number[]; // speech energy per sample
}

export function activeSpeakerCut(
  tracks: SpeakerTrack[],
  opts: { minShot?: number; switchMargin?: number } = {}
): { segments: TimelineSegment[]; switches: number; explanation: string } {
  const minShot = opts.minShot ?? 1.2;
  const margin = opts.switchMargin ?? 1.25;
  if (tracks.length < 2 || tracks[0].times.length === 0) {
    return { segments: [], switches: 0, explanation: "Speaker cut needs at least two cameras with audio." };
  }

  // 3-sample smoothing per track so plosives don't cause flicker
  const smooth = (arr: number[]) => arr.map((v, i) => (v + (arr[i - 1] ?? v) + (arr[i + 1] ?? v)) / 3);
  const energy = tracks.map((t) => smooth(t.rms));
  const times = tracks[0].times;
  const end = times[times.length - 1];

  let current = 0;
  let pendingWinner = -1;
  let pendingCount = 0;
  const winners: number[] = [];
  for (let i = 0; i < times.length; i++) {
    let best = 0;
    for (let k = 1; k < tracks.length; k++) if ((energy[k][i] ?? 0) > (energy[best][i] ?? 0)) best = k;
    if (best !== current && (energy[best][i] ?? 0) > (energy[current][i] ?? 0) * margin) {
      if (best === pendingWinner) pendingCount++;
      else {
        pendingWinner = best;
        pendingCount = 1;
      }
      if (pendingCount >= 2) {
        current = best;
        pendingWinner = -1;
        pendingCount = 0;
      }
    } else {
      pendingWinner = -1;
      pendingCount = 0;
    }
    winners.push(current);
  }

  // collapse to shots, enforcing minShot by absorbing too-quick switches
  const segments: TimelineSegment[] = [];
  let shotStart = 0;
  let shotCam = winners[0];
  for (let i = 1; i <= winners.length; i++) {
    const t = i < winners.length ? times[i] : end;
    if (i === winners.length || winners[i] !== shotCam) {
      if (t - shotStart >= minShot || segments.length === 0) {
        segments.push({
          id: `spk_${segments.length}`,
          clipId: tracks[shotCam].clipId,
          start: Number(shotStart.toFixed(2)),
          end: Number(t.toFixed(2)),
          transitionAfter: "hard-cut",
          speed: 1,
        });
        shotStart = t;
      } else {
        // too short — extend the previous shot instead of flashing a camera
        if (segments.length > 0) segments[segments.length - 1].end = Number(t.toFixed(2));
        shotStart = t;
      }
      if (i < winners.length) shotCam = winners[i];
    }
  }
  if (segments.length > 0) segments[segments.length - 1].transitionAfter = null;
  const switches = Math.max(0, segments.length - 1);
  return {
    segments,
    switches,
    explanation: `Speaker cut: ${segments.length} shots across ${tracks.length} cameras — the edit follows whoever is talking.`,
  };
}

// --- long-form → shorts candidates --------------------------------------------------------------
// Rank the best `count` non-overlapping windows of clipLen seconds inside a
// long recording. Score favors motion (things happening), motion VARIETY
// (build-ups read better than constant noise), and penalizes darkness.

export interface LongformCandidate {
  start: number;
  end: number;
  score: number; // 0..100
  reason: string;
}

export function longformClips(
  a: Pick<ClipAnalysis, "duration" | "times" | "motion" | "brightness">,
  opts: { clipLen?: number; count?: number } = {}
): LongformCandidate[] {
  const clipLen = opts.clipLen ?? 22;
  const count = opts.count ?? 5;
  const n = a.times.length;
  if (n === 0 || a.duration <= clipLen) {
    return [{ start: 0, end: Number(Math.min(a.duration, clipLen).toFixed(2)), score: 50, reason: "Whole recording fits the target length." }];
  }
  const dt = a.duration / n;
  const win = Math.max(2, Math.round(clipLen / dt));

  const raw: { i: number; score: number; motion: number; variety: number }[] = [];
  for (let i = 0; i + win <= n; i += Math.max(1, Math.round(win / 8))) {
    let sum = 0;
    let dark = 0;
    for (let k = i; k < i + win; k++) {
      sum += a.motion[k];
      if (a.brightness[k] < 0.06) dark++;
    }
    const mean = sum / win;
    let varSum = 0;
    for (let k = i; k < i + win; k++) varSum += (a.motion[k] - mean) ** 2;
    const variety = Math.sqrt(varSum / win);
    raw.push({ i, score: mean * 0.7 + variety * 0.5 - (dark / win) * 0.4, motion: mean, variety });
  }
  raw.sort((x, y) => y.score - x.score);

  const picked: typeof raw = [];
  for (const c of raw) {
    if (picked.length >= count) break;
    if (picked.some((p) => Math.abs(p.i - c.i) < win)) continue; // overlap
    picked.push(c);
  }
  const top = picked[0]?.score || 1e-6;
  return picked
    .map((p) => {
      const start = Number(a.times[p.i].toFixed(2));
      const reason =
        p.variety > p.motion * 0.6
          ? "Strong build-up — the energy rises inside this window."
          : p.motion > 0.08
            ? "Consistently high action throughout."
            : "The calmest strong moment — good for a slower-burn clip.";
      return {
        start,
        end: Number(Math.min(a.duration, start + clipLen).toFixed(2)),
        score: Math.round(Math.max(5, Math.min(100, (p.score / top) * 100))),
        reason,
      };
    })
    .sort((x, y) => y.score - x.score);
}
