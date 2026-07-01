"use client";

import { create } from "zustand";
import type { EditBlueprint, EditPlan, UserClip, AnalyzeProgress } from "@/lib/types";

interface ProjectState {
  blueprint: EditBlueprint | null;
  clips: UserClip[];
  plan: EditPlan | null;
  progress: AnalyzeProgress | null;
  renderedUrl: string | null;
  setBlueprint: (bp: EditBlueprint | null) => void;
  setClips: (clips: UserClip[]) => void;
  addClip: (clip: UserClip) => void;
  removeClip: (id: string) => void;
  setPlan: (plan: EditPlan | null) => void;
  setProgress: (p: AnalyzeProgress | null) => void;
  setRenderedUrl: (url: string | null) => void;
}

export const useProject = create<ProjectState>((set) => ({
  blueprint: null,
  clips: [],
  plan: null,
  progress: null,
  renderedUrl: null,
  setBlueprint: (blueprint) => set({ blueprint }),
  setClips: (clips) => set({ clips }),
  addClip: (clip) => set((s) => ({ clips: [...s.clips, clip] })),
  removeClip: (id) => set((s) => ({ clips: s.clips.filter((c) => c.id !== id) })),
  setPlan: (plan) => set({ plan }),
  setProgress: (progress) => set({ progress }),
  setRenderedUrl: (renderedUrl) => set({ renderedUrl }),
}));
