"use client";

import { create } from "zustand";
import type { EditBlueprint, EditPlan, UserClip, AnalyzeProgress } from "@/lib/types";
import { DEFAULT_LOOK, type LookConfig } from "@/lib/cinematic";
import type { MotionEffect } from "@/lib/motion";
import type { OverlayType } from "@/lib/overlays";
import type { ScoreMood } from "@/lib/audio-cinema";

// Everything the Cinematic Studio panel controls, passed into renderEdit.
export interface StudioConfig {
  look: LookConfig;
  motionDefault: MotionEffect;
  autoKenBurns: boolean; // virtual dolly on static shots
  autoReframe: boolean; // subject-aware 9:16 crop for landscape clips
  overlay: OverlayType | null;
  overlayOpacity: number;
  scoreMood: ScoreMood | null; // compose an original score at this mood
  autoSfx: boolean; // whoosh/impact on transitions
  kineticCaptions: boolean; // word-by-word pop instead of full lines
  titleCard: { title: string; subtitle: string; style: "minimal" | "epic" | "typewriter" } | null;
  credits: string; // newline "role | name" lines, empty = off
}

export const DEFAULT_STUDIO: StudioConfig = {
  look: DEFAULT_LOOK,
  motionDefault: "none",
  autoKenBurns: false,
  autoReframe: false,
  overlay: null,
  overlayOpacity: 0.5,
  scoreMood: null,
  autoSfx: false,
  kineticCaptions: false,
  titleCard: null,
  credits: "",
};

interface ProjectState {
  blueprint: EditBlueprint | null;
  clips: UserClip[];
  plan: EditPlan | null;
  planHistory: EditPlan[]; // #17 uniqueness: undo history of plans
  progress: AnalyzeProgress | null;
  renderedUrl: string | null;
  studio: StudioConfig;
  setBlueprint: (bp: EditBlueprint | null) => void;
  setClips: (clips: UserClip[]) => void;
  addClip: (clip: UserClip) => void;
  removeClip: (id: string) => void;
  setPlan: (plan: EditPlan | null) => void;
  undoPlan: () => void;
  setProgress: (p: AnalyzeProgress | null) => void;
  setRenderedUrl: (url: string | null) => void;
  setStudio: (patch: Partial<StudioConfig>) => void;
}

export const useProject = create<ProjectState>((set) => ({
  blueprint: null,
  clips: [],
  plan: null,
  planHistory: [],
  progress: null,
  renderedUrl: null,
  studio: DEFAULT_STUDIO,
  setBlueprint: (blueprint) => set({ blueprint }),
  setClips: (clips) => set({ clips }),
  addClip: (clip) => set((s) => ({ clips: [...s.clips, clip] })),
  removeClip: (id) => set((s) => ({ clips: s.clips.filter((c) => c.id !== id) })),
  setPlan: (plan) =>
    set((s) => ({
      plan,
      planHistory: s.plan ? [...s.planHistory.slice(-19), s.plan] : s.planHistory,
    })),
  undoPlan: () =>
    set((s) => {
      const prev = s.planHistory[s.planHistory.length - 1];
      if (!prev) return {};
      return { plan: prev, planHistory: s.planHistory.slice(0, -1) };
    }),
  setProgress: (progress) => set({ progress }),
  setRenderedUrl: (renderedUrl) => set({ renderedUrl }),
  setStudio: (patch) => set((s) => ({ studio: { ...s.studio, ...patch } })),
}));
