"use client";

// Choose the transition that best carries the motion through a cut.
// Given the dominant flow leaving clip A and entering clip B, we pick a
// transition whose visual movement continues that motion — so a leftward
// whip out of A into a leftward start of B reads as one continuous whip,
// not a jarring cut.
import type { TransitionType } from "./types";
import type { FlowDir } from "./clip-analysis";

export interface MatchInput {
  flowOut: FlowDir; // motion at the END of clip A
  flowIn: FlowDir; // motion at the START of clip B
  onBeat: boolean; // does this cut land on a strong beat?
  energyOut: number; // 0..1 motion energy at the boundary
}

export function matchTransition(m: MatchInput): { type: TransitionType; reason: string } {
  const { flowOut, flowIn, onBeat, energyOut } = m;

  // Strong beat + high energy + little directional motion → flash/hard cut
  if (onBeat && energyOut > 0.18 && flowOut === "still" && flowIn === "still") {
    return { type: "flash", reason: "on a strong beat with a static frame — flash hits hardest here" };
  }

  // Horizontal continuity → whip / slide in the matching direction
  const horiz = (d: FlowDir) => d === "left" || d === "right";
  if (horiz(flowOut) || horiz(flowIn)) {
    const dir = horiz(flowOut) ? flowOut : flowIn;
    if (dir === "left") return { type: "whip-pan", reason: "camera moving left across the cut — whip carries it" };
    return { type: "slide-right", reason: "camera moving right across the cut — slide carries it" };
  }

  // Zoom continuity
  if (flowOut === "zoom-in" || flowIn === "zoom-in") {
    return { type: "zoom-in", reason: "pushing in through the cut — zoom punch matches" };
  }
  if (flowOut === "zoom-out" || flowIn === "zoom-out") {
    return { type: "zoom-out", reason: "pulling back through the cut — zoom-out matches" };
  }

  // Vertical motion → use blur/slide-ish smooth blends (we have smoothdown
  // mapped under zoom-out visually; prefer blur for verticals to stay clean)
  if (flowOut === "up" || flowOut === "down" || flowIn === "up" || flowIn === "down") {
    return { type: "blur", reason: "vertical camera move — a blur dissolve hides the seam" };
  }

  // Both essentially static: beat → hard cut (rhythm), else gentle fade
  if (onBeat) return { type: "hard-cut", reason: "static shots on a beat — a clean cut keeps the rhythm" };
  return { type: "fade", reason: "two calm static shots — a soft fade feels intentional" };
}
