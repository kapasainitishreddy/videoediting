"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
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
  autoFacePunch: boolean; // zoom-in punch targeted at the detected face
  overlay: OverlayType | null;
  overlayOpacity: number;
  scoreMood: ScoreMood | null; // compose an original score at this mood
  autoSfx: boolean; // whoosh/impact on transitions
  kineticCaptions: boolean; // word-by-word pop instead of full lines
  titleCard: { title: string; subtitle: string; style: "minimal" | "epic" | "typewriter" } | null;
  credits: string; // newline "role | name" lines, empty = off
  brandHex: string; // comma/space-separated brand hex colors, "" = off
}

export const DEFAULT_STUDIO: StudioConfig = {
  look: DEFAULT_LOOK,
  motionDefault: "none",
  autoKenBurns: false,
  autoReframe: false,
  autoFacePunch: false,
  overlay: null,
  overlayOpacity: 0.5,
  scoreMood: null,
  autoSfx: false,
  kineticCaptions: false,
  titleCard: null,
  credits: "",
  brandHex: "",
};

interface ProjectState {
  blueprint: EditBlueprint | null;
  clips: UserClip[];
  plan: EditPlan | null;
  planHistory: EditPlan[]; // undo history of plans
  progress: AnalyzeProgress | null;
  // The blob: URL of the last render. This is a LIVE-SESSION-ONLY value —
  // it is deliberately excluded from persistence (see partialize below)
  // because a blob: URL dies with the page; after a reload it always
  // points nowhere. The durable copy is the actual video bytes, kept in
  // IndexedDB by the export page (see storage.ts saveRenderedVideo).
  renderedUrl: string | null;
  studio: StudioConfig;
  setBlueprint: (bp: EditBlueprint | null) => void;
  setClips: (clips: UserClip[]) => void;
  addClip: (clip: UserClip) => void;
  updateClip: (id: string, patch: Partial<UserClip>) => void;
  removeClip: (id: string) => void;
  setPlan: (plan: EditPlan | null) => void;
  undoPlan: () => void;
  setProgress: (p: AnalyzeProgress | null) => void;
  setRenderedUrl: (url: string | null) => void;
  setStudio: (patch: Partial<StudioConfig>) => void;
  resetProject: () => void;
}

// Persisted to sessionStorage (survives reload, clears when the tab
// closes — matches "still mid-edit" intent without accumulating stale
// state across unrelated visits). Everything here is small JSON; actual
// video bytes always live in IndexedDB, never in this store.
export const useProject = create<ProjectState>()(
  persist(
    (set) => ({
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
      updateClip: (id, patch) =>
        set((s) => ({ clips: s.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
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
      resetProject: () =>
        set({ blueprint: null, clips: [], plan: null, planHistory: [], renderedUrl: null, studio: DEFAULT_STUDIO }),
    }),
    {
      name: "viraledit-session",
      storage: createJSONStorage(() => sessionStorage),
      // renderedUrl and progress are excluded: blob URLs and in-flight
      // progress are meaningless after a reload.
      partialize: (s) => ({
        blueprint: s.blueprint,
        clips: s.clips,
        plan: s.plan,
        planHistory: s.planHistory,
        studio: s.studio,
      }),
    }
  )
);
