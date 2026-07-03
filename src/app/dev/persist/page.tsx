"use client";

// Fast, targeted verification of the two QA fixes — exercises the exact
// persistence code paths (Zustand sessionStorage persist + IndexedDB
// render recovery) directly, without the slow video-capture/motion-
// analysis pipeline a full UI-driven E2E test would need.
import { useEffect, useState } from "react";
import { useProject } from "@/store/project";
import { saveRenderedVideo, getRenderedVideo } from "@/lib/storage";
import type { EditPlan, EditBlueprint } from "@/lib/types";

const FAKE_PLAN: EditPlan = {
  segments: [
    { id: "s1", clipId: "c1", start: 0, end: 1.5, transitionAfter: "whip-pan", speed: 1 },
    { id: "s2", clipId: "c2", start: 0, end: 1.5, transitionAfter: null, speed: 1 },
  ],
  colorGrade: "cinematic",
  aiDirection: "test direction",
  explanation: "PERSIST_TEST_PLAN",
};

const FAKE_BLUEPRINT: EditBlueprint = {
  id: "bp1",
  sourceName: "persist-test-reel",
  duration: 5,
  transitions: [],
  beats: null,
  style: { colorGrade: "cinematic", pacing: "fast", avgShotLength: 1.5, aspectRatio: "9:16", notes: [] },
  guide: [],
  createdAt: 0,
};

export default function PersistTest() {
  const { setPlan, setBlueprint, setStudio, plan, blueprint, studio } = useProject();
  const [phase, setPhase] = useState<"seed" | "verify">("seed");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("verify") === "1") {
      // Second load (simulating reload): check what the store rehydrated,
      // WITHOUT re-seeding — proves persistence, not just fresh state.
      setPhase("verify");
    } else {
      setPlan(FAKE_PLAN);
      setBlueprint(FAKE_BLUEPRINT);
      setStudio({ motionDefault: "ken-burns-in", scoreMood: "epic" });
      (window as unknown as { seedDone: boolean }).seedDone = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== "verify") return;
    const planOk = plan?.explanation === "PERSIST_TEST_PLAN" && plan.segments.length === 2;
    const blueprintOk = blueprint?.sourceName === "persist-test-reel";
    const studioOk = studio.motionDefault === "ken-burns-in" && studio.scoreMood === "epic";
    const r = { planOk, blueprintOk, studioOk, plan, blueprint, studioMotion: studio.motionDefault };
    setResult(r);
    (window as unknown as { verifyResult: unknown }).verifyResult = r;
  }, [phase, plan, blueprint, studio]);

  async function testRenderRecovery() {
    const fakeBlob = new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: "video/mp4" });
    await saveRenderedVideo(fakeBlob);
    const recovered = await getRenderedVideo();
    const bytes = recovered ? await recovered.arrayBuffer() : null;
    const ok = !!bytes && bytes.byteLength === 5 && new Uint8Array(bytes)[2] === 3;
    (window as unknown as { renderRecoveryResult: unknown }).renderRecoveryResult = { ok };
    setResult((r) => ({ ...r, renderRecoveryOk: ok }));
  }

  useEffect(() => {
    testRenderRecovery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="p-6 font-mono text-xs">
      <h1 className="mb-2 font-bold">persist test — phase: {phase}</h1>
      <pre>{JSON.stringify(result, null, 1)}</pre>
    </main>
  );
}
