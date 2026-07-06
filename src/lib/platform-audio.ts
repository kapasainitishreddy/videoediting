// Platform loudness targets — pure, Node-testable. Every platform normalizes
// audio to its own loudness spec; audio mastered for the wrong target gets
// turned down (sounds weak) or squashed. This maps a measured RMS to an
// approximate LUFS and computes the one-tap gain per platform.
//
// Honest scope: true ITU-R BS.1770 LUFS needs K-weighting + gating; the
// approximation here (RMS → LUFS-ish) is within ~1–2 LU on speech/music
// program material, which is enough to stop the "my audio is quiet on
// TikTok" failure. Labeled as an estimate in the UI.

export interface PlatformLoudness {
  id: string;
  label: string;
  lufs: number; // integrated target
  peak: number; // true-peak ceiling, dBFS
}

export const PLATFORM_TARGETS: PlatformLoudness[] = [
  { id: "tiktok", label: "TikTok", lufs: -14, peak: -1 },
  { id: "reels", label: "Instagram Reels", lufs: -14, peak: -1 },
  { id: "shorts", label: "YouTube Shorts", lufs: -14, peak: -1 },
  { id: "youtube", label: "YouTube (long-form)", lufs: -14, peak: -1 },
  { id: "podcast", label: "Podcast", lufs: -16, peak: -1.5 },
  { id: "broadcast", label: "Broadcast (EBU R128)", lufs: -23, peak: -1 },
];

// RMS (0..1 linear) → approximate LUFS. 0 dBFS sine has RMS 0.707; program
// LUFS sits close to 20·log10(rms) with a small K-weighting offset.
export function estimateLufs(rms: number): number {
  if (rms <= 1e-6) return -70;
  return Number((20 * Math.log10(rms) - 0.7).toFixed(1));
}

export interface PlatformGain {
  platform: PlatformLoudness;
  gainDb: number; // apply this much gain
  gainLinear: number; // same, linear multiplier
  limited: boolean; // true when the peak ceiling capped the gain
  message: string;
}

export function platformGain(
  measured: { rms: number; peak: number },
  platformId: string
): PlatformGain {
  const platform = PLATFORM_TARGETS.find((p) => p.id === platformId) ?? PLATFORM_TARGETS[0];
  const lufs = estimateLufs(measured.rms);
  let gainDb = platform.lufs - lufs;

  // never push the (linear) peak past the ceiling
  const peakDb = measured.peak <= 1e-6 ? -70 : 20 * Math.log10(measured.peak);
  const headroom = platform.peak - peakDb;
  const limited = gainDb > headroom;
  if (limited) gainDb = headroom;
  gainDb = Math.max(-24, Math.min(24, gainDb));

  const direction = gainDb > 0.5 ? `${gainDb.toFixed(1)} dB louder` : gainDb < -0.5 ? `${Math.abs(gainDb).toFixed(1)} dB quieter` : "already on target";
  return {
    platform,
    gainDb: Number(gainDb.toFixed(2)),
    gainLinear: Number(Math.pow(10, gainDb / 20).toFixed(4)),
    limited,
    message:
      `Estimated ${lufs} LUFS → ${platform.label} targets ${platform.lufs} LUFS: ${direction}.` +
      (limited ? " Gain capped by the true-peak ceiling — consider light compression first." : ""),
  };
}
