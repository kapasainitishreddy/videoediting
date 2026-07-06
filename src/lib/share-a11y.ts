"use client";

// Share + accessibility helpers.
//   • shareFile()  — Web Share Level 2: hand the rendered MP4 straight to
//     the OS share sheet (TikTok / Instagram / YouTube apps on mobile) —
//     the closest thing to "direct upload" that needs no platform OAuth.
//   • speakLines() — read captions / post copy aloud via SpeechSynthesis,
//     an accessibility review pass for creators who work by ear.

export function canShareFiles(): boolean {
  if (typeof navigator === "undefined" || !("canShare" in navigator)) return false;
  try {
    const probe = new File([new Uint8Array(1)], "probe.mp4", { type: "video/mp4" });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

export async function shareFile(blob: Blob, name: string, title: string): Promise<"shared" | "cancelled" | "unsupported"> {
  if (!canShareFiles()) return "unsupported";
  const file = new File([blob], name, { type: blob.type || "video/mp4" });
  try {
    await navigator.share({ files: [file], title });
    return "shared";
  } catch (e) {
    // AbortError = the user closed the sheet; anything else = no support
    return (e as Error)?.name === "AbortError" ? "cancelled" : "unsupported";
  }
}

export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function speakLines(lines: string[], opts: { rate?: number; onDone?: () => void } = {}): void {
  if (!canSpeak() || lines.length === 0) return;
  window.speechSynthesis.cancel();
  lines.forEach((line, i) => {
    const u = new SpeechSynthesisUtterance(line);
    u.rate = opts.rate ?? 1;
    if (i === lines.length - 1 && opts.onDone) u.onend = opts.onDone;
    window.speechSynthesis.speak(u);
  });
}

export function stopSpeaking(): void {
  if (canSpeak()) window.speechSynthesis.cancel();
}
