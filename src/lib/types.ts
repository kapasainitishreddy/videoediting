// Shared types for the whole app

export type TransitionType =
  | "hard-cut"
  | "whip-pan"
  | "zoom-in"
  | "zoom-out"
  | "flash"
  | "fade"
  | "glitch"
  | "spin"
  | "slide-left"
  | "slide-right"
  | "blur"
  | "light-leak";

export interface DetectedTransition {
  id: string;
  time: number; // seconds into the reference video
  type: TransitionType;
  confidence: number; // 0-1
  durationFrames: number;
  description: string; // human-readable, e.g. "Whip pan left-to-right on the beat"
}

export interface BeatInfo {
  bpm: number;
  beatTimes: number[]; // seconds
  energy: "low" | "medium" | "high";
}

export interface StyleProfile {
  colorGrade: string; // e.g. "warm", "cool", "high-contrast", "vintage"
  pacing: "slow" | "medium" | "fast" | "frenetic";
  avgShotLength: number; // seconds
  aspectRatio: string; // "9:16"
  notes: string[];
}

// The niche/category the reference reel belongs to (travel, fitness, food…).
// Optional so older saved blueprints stay valid. Kept structural (not the
// NicheId union) to avoid a client-module import in this shared types file;
// niche.ts owns the canonical taxonomy and validates ids.
export interface BlueprintNiche {
  id: string;
  label: string;
  confidence: number;
  source: "title" | "style" | "ai" | "fallback";
}

export interface EditBlueprint {
  id: string;
  sourceName: string;
  sourceUrl?: string;
  duration: number;
  transitions: DetectedTransition[];
  beats: BeatInfo | null;
  style: StyleProfile;
  guide: GuideStep[]; // step-by-step recreation guide
  niche?: BlueprintNiche; // detected content category (optional/back-compat)
  createdAt: number;
}

export interface GuideStep {
  step: number;
  title: string;
  detail: string;
  timestamp?: number;
}

export interface UserClip {
  id: string;
  name: string;
  duration: number;
  // Blob stored in IndexedDB, object URL created at runtime
  thumbnail?: string;
  // FFmpeg crop filter that strips letterbox/pillarbox bars baked into the
  // source file (detected at upload, applied before reframe/scale at render)
  sourceCrop?: string;
  // AI subject lock: the render crop follows the face (on-device ML face
  // detection) or the motion energy. The path itself is computed at render
  // time and cached in memory — only the intent persists here.
  track?: "face" | "action" | null;
  // Green-screen key detected on this clip. Kept structural (not the
  // ChromaSettings import) like BlueprintNiche above; chroma.ts owns the
  // canonical type and the two are assignment-compatible.
  chroma?: { color: string; similarity: number; blend: number; bg: string } | null;
  // True when this clip is a derived "background removed" copy of an upload
  bgRemoved?: boolean;
}

export interface TimelineSegment {
  id: string;
  clipId: string;
  start: number; // trim start within source clip
  end: number; // trim end within source clip
  transitionAfter: TransitionType | null;
  speed: number; // 1 = normal
}

export interface EditPlan {
  segments: TimelineSegment[];
  colorGrade: string;
  music?: string;
  aiDirection: string; // the user's prompt
  explanation: string; // AI's explanation of what it did
}

export interface AnalyzeProgress {
  stage: "downloading" | "extracting" | "detecting" | "beats" | "style" | "guide" | "done";
  percent: number;
  message: string;
}
