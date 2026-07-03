// FFmpeg WASM runs inside the browser tab's memory — there's no swap, no
// OOM-killer restart, just a crashed tab. These ceilings exist to fail
// with a clear message BEFORE a user's clip triggers that crash, not after.
// Numbers are deliberately conservative; they were chosen for "won't crash
// a mid-range phone," not "the theoretical WASM limit."
export const MAX_CLIP_DURATION_SEC = 5 * 60; // 5 minutes per clip
export const MAX_CLIP_SIZE_BYTES = 300 * 1024 * 1024; // 300MB per file
export const MAX_REFERENCE_DURATION_SEC = 4 * 60; // reels are usually <90s anyway

export interface ClipCheck {
  ok: boolean;
  reason?: string;
}

export function checkClipLimits(file: { size: number }, durationSec: number): ClipCheck {
  if (durationSec > MAX_CLIP_DURATION_SEC) {
    return {
      ok: false,
      reason: `That clip is ${Math.round(durationSec / 60)} min long — over the ${MAX_CLIP_DURATION_SEC / 60} min limit. Longer clips risk crashing the browser tab during render. Trim it and try again.`,
    };
  }
  if (file.size > MAX_CLIP_SIZE_BYTES) {
    return {
      ok: false,
      reason: `That file is ${(file.size / 1024 / 1024).toFixed(0)}MB — over the ${MAX_CLIP_SIZE_BYTES / 1024 / 1024}MB limit for in-browser processing.`,
    };
  }
  return { ok: true };
}

export function checkReferenceLimits(durationSec: number): ClipCheck {
  if (durationSec > MAX_REFERENCE_DURATION_SEC) {
    return {
      ok: false,
      reason: `This video is ${Math.round(durationSec / 60)} min long — over the ${MAX_REFERENCE_DURATION_SEC / 60} min limit for analysis. Reels/shorts are almost always under 90s; trim longer footage first.`,
    };
  }
  return { ok: true };
}
