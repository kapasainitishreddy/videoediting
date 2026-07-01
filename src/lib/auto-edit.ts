"use client";

// Auto-Edit: maps the user's clips onto the blueprint's cut pattern and
// interprets plain-English direction into concrete edit settings.
// Fully local; when a MiniMax key is present /api/edit refines the plan.
import { v4 as uuid } from "uuid";
import type { EditBlueprint, EditPlan, TimelineSegment, TransitionType, UserClip } from "./types";

const DIRECTION_RULES: { match: RegExp; apply: (p: EditPlan) => void; note: string }[] = [
  {
    match: /cinematic|movie|film/i,
    apply: (p) => {
      p.colorGrade = "cinematic";
      for (const s of p.segments) if (s.transitionAfter === "hard-cut") s.transitionAfter = "fade";
    },
    note: "cinematic look: teal-orange grade + soft fades",
  },
  {
    match: /warm|golden|sunset|travel/i,
    apply: (p) => {
      p.colorGrade = "warm";
      for (const s of p.segments) if (s.transitionAfter === "flash") s.transitionAfter = "light-leak";
    },
    note: "warm travel vibe: golden grade + light leaks",
  },
  {
    match: /fast|energy|hype|beat/i,
    apply: (p) => {
      for (const s of p.segments) {
        s.end = Math.min(s.end, s.start + Math.max(0.6, (s.end - s.start) * 0.7));
        if (s.transitionAfter === "fade") s.transitionAfter = "whip-pan";
      }
    },
    note: "high energy: shorter cuts + whip pans",
  },
  {
    match: /slow|calm|chill|aesthetic/i,
    apply: (p) => {
      p.colorGrade = p.colorGrade === "none" ? "vintage" : p.colorGrade;
      for (const s of p.segments) {
        s.speed = 0.85;
        if (s.transitionAfter === "whip-pan" || s.transitionAfter === "flash") s.transitionAfter = "fade";
      }
    },
    note: "calm aesthetic: gentle slow-mo + dissolves",
  },
  {
    match: /glitch|edgy|dark/i,
    apply: (p) => {
      p.colorGrade = "cool";
      p.segments.forEach((s, i) => {
        if (i % 2 === 0) s.transitionAfter = "glitch";
      });
    },
    note: "edgy: glitch transitions + cool grade",
  },
  {
    match: /zoom/i,
    apply: (p) => {
      p.segments.forEach((s, i) => {
        s.transitionAfter = i % 2 === 0 ? "zoom-in" : "zoom-out";
      });
    },
    note: "zoom-driven transitions throughout",
  },
  {
    match: /black.?(and|&).?white|b&w|noir/i,
    apply: (p) => {
      p.colorGrade = "bw";
    },
    note: "black & white noir grade",
  },
  {
    match: /smooth/i,
    apply: (p) => {
      for (const s of p.segments) if (s.transitionAfter === "hard-cut") s.transitionAfter = "blur";
    },
    note: "smoothed every hard cut into a blur dissolve",
  },
];

export function autoEdit(
  blueprint: EditBlueprint | null,
  clips: UserClip[],
  aiDirection: string
): EditPlan {
  if (clips.length === 0) throw new Error("Add at least one clip first");

  // Target shot rhythm: from blueprint, else a sane 1.5s default
  const shotLen = blueprint ? Math.max(0.6, blueprint.style.avgShotLength) : 1.5;
  const pattern: TransitionType[] = blueprint && blueprint.transitions.length > 0
    ? blueprint.transitions.map((t) => t.type)
    : ["hard-cut", "whip-pan", "zoom-in", "flash"];

  // Slice user clips round-robin into segments matching the pattern length
  const segments: TimelineSegment[] = [];
  const targetCount = Math.max(clips.length, Math.min(pattern.length + 1, clips.length * 3));
  for (let i = 0; i < targetCount; i++) {
    const clip = clips[i % clips.length];
    const maxStart = Math.max(0, clip.duration - shotLen);
    // stagger trim windows across reuses of the same clip
    const reuse = Math.floor(i / clips.length);
    const start = Math.min(maxStart, reuse * shotLen * 1.2);
    segments.push({
      id: uuid(),
      clipId: clip.id,
      start: Number(start.toFixed(2)),
      end: Number(Math.min(clip.duration, start + shotLen).toFixed(2)),
      transitionAfter: i < targetCount - 1 ? pattern[i % pattern.length] : null,
      speed: 1,
    });
  }

  const plan: EditPlan = {
    segments,
    colorGrade: blueprint?.style.colorGrade ?? "none",
    aiDirection,
    explanation: blueprint
      ? `Matched your ${clips.length} clip${clips.length > 1 ? "s" : ""} to the reference: ${segments.length} shots at ~${shotLen.toFixed(1)}s each, using its ${pattern.length}-transition pattern.`
      : `Built a ${segments.length}-shot edit with a classic viral pattern.`,
  };

  // Apply plain-English direction
  const applied: string[] = [];
  for (const rule of DIRECTION_RULES) {
    if (rule.match.test(aiDirection)) {
      rule.apply(plan);
      applied.push(rule.note);
    }
  }
  if (applied.length > 0) {
    plan.explanation += ` Your direction: ${applied.join("; ")}.`;
  }
  return plan;
}
