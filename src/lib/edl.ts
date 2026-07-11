// NLE interop — pure, Node-testable. Nobody else in the mobile-first editor
// space lets you LEAVE: CapCut/InShot keep the cut list locked inside their
// app. This module exports the timeline three ways so a pro can finish the
// edit in Premiere / Resolve / Final Cut:
//   • edlFromPlan()      — CMX3600 EDL (the universal cut-list format)
//   • fcpxmlFromPlan()   — FCPXML 1.9 (Final Cut Pro / Resolve import)
//   • projectToFile()    — a portable .viraledit.json project file that
//     round-trips the FULL project (blueprint + plan + studio + clip meta,
//     media stays on-device) — projectFromFile() validates and reimports.
// NO runtime imports (types only) — like track-core/chroma, this file must
// load under plain `node --experimental-strip-types` for the unit suite.
// The dissolve-duration lookup is injected by the caller (opts.dissolve).
import type { EditBlueprint, EditPlan, UserClip } from "./types";
import type { ReviewComment } from "./review";

// --- timecode ------------------------------------------------------------------

export function toTimecode(seconds: number, fps = 30): string {
  const total = Math.max(0, Math.round(seconds * fps));
  const f = total % fps;
  const s = Math.floor(total / fps) % 60;
  const m = Math.floor(total / (fps * 60)) % 60;
  const h = Math.floor(total / (fps * 3600));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(s)}:${p(f)}`;
}

const segOutLen = (s: { start: number; end: number; speed: number }) => (s.end - s.start) / s.speed;

// --- CMX3600 EDL -----------------------------------------------------------------
// One event per segment. Cross-fade transitions become D (dissolve) events
// with the recipe's duration in frames; everything else is a C (cut). Speed
// changes emit an M2 motion memo — the NLE re-times the source to match.

export function edlFromPlan(
  plan: EditPlan,
  clips: UserClip[],
  opts: { fps?: number; title?: string; dissolve?: (type: string) => number } = {}
): string {
  const fps = opts.fps ?? 30;
  const lines: string[] = [
    `TITLE: ${(opts.title ?? "ViralEdit export").toUpperCase().slice(0, 60)}`,
    "FCM: NON-DROP FRAME",
    "",
  ];
  let record = 0;
  plan.segments.forEach((seg, i) => {
    const num = String(i + 1).padStart(3, "0");
    const clip = clips.find((c) => c.id === seg.clipId);
    const name = clip?.name ?? seg.clipId;
    const outLen = segOutLen(seg);

    // transition INTO this event comes from the previous segment
    const prevType = i > 0 ? plan.segments[i - 1].transitionAfter : null;
    const dissolveSec = prevType && opts.dissolve ? opts.dissolve(prevType) : 0;
    const dissolveFrames = dissolveSec > 0 ? Math.round(dissolveSec * fps) : 0;
    const kind = dissolveFrames > 0 ? `D    ${String(dissolveFrames).padStart(3, "0")}` : "C        ";

    const srcIn = toTimecode(seg.start, fps);
    const srcOut = toTimecode(seg.end, fps);
    const recIn = toTimecode(record, fps);
    const recOut = toTimecode(record + outLen, fps);
    lines.push(`${num}  AX       V     ${kind} ${srcIn} ${srcOut} ${recIn} ${recOut}`);
    if (seg.speed !== 1) {
      lines.push(`M2   AX             ${(fps * seg.speed).toFixed(1).padStart(5, "0")}                ${srcIn}`);
    }
    lines.push(`* FROM CLIP NAME: ${name}`);
    if (i > 0 && plan.segments[i - 1].transitionAfter && dissolveFrames === 0) {
      lines.push(`* COMMENT: TRANSITION IN WAS ${plan.segments[i - 1].transitionAfter}`);
    }
    lines.push("");
    record += outLen;
  });
  return lines.join("\n");
}

// --- FCPXML 1.9 ----------------------------------------------------------------
// Minimal-but-valid: one format, one asset per clip, a spine of asset-clips.
// Times are rational (Ns/fpsDs). Media paths are the clip names — the NLE
// prompts to relink, which is the standard workflow for a cut-list handoff.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function fcpxmlFromPlan(
  plan: EditPlan,
  clips: UserClip[],
  opts: { fps?: number; title?: string; width?: number; height?: number } = {}
): string {
  const fps = opts.fps ?? 30;
  const W = opts.width ?? 1080;
  const H = opts.height ?? 1920;
  const rt = (sec: number) => `${Math.round(sec * fps)}/${fps}s`;

  const used = [...new Set(plan.segments.map((s) => s.clipId))];
  const assets = used
    .map((id, i) => {
      const c = clips.find((x) => x.id === id);
      const dur = rt(c?.duration ?? 60);
      return (
        `    <asset id="a${i + 1}" name="${esc(c?.name ?? id)}" start="0s" duration="${dur}" hasVideo="1" format="r1">` +
        `<media-rep kind="original-media" src="file://./${esc(c?.name ?? id)}"/></asset>`
      );
    })
    .join("\n");

  let clock = 0;
  const spine = plan.segments
    .map((seg) => {
      const aIdx = used.indexOf(seg.clipId) + 1;
      const c = clips.find((x) => x.id === seg.clipId);
      const el =
        `        <asset-clip ref="a${aIdx}" name="${esc(c?.name ?? seg.clipId)}" offset="${rt(clock)}" ` +
        `start="${rt(seg.start)}" duration="${rt(seg.end - seg.start)}"` +
        (seg.speed !== 1 ? ` conform-rate="0"><timeMap><timept time="0s" value="0s" interp="smooth2"/><timept time="${rt((seg.end - seg.start) / seg.speed)}" value="${rt(seg.end - seg.start)}" interp="smooth2"/></timeMap></asset-clip>` : "/>");
      clock += segOutLen(seg);
      return el;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" name="FFVideoFormat${H}p${fps}" frameDuration="1/${fps}s" width="${W}" height="${H}"/>
${assets}
  </resources>
  <library>
    <event name="${esc(opts.title ?? "ViralEdit")}">
      <project name="${esc(opts.title ?? "ViralEdit export")}">
        <sequence format="r1" duration="${rt(clock)}" tcStart="0s">
          <spine>
${spine}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>`;
}

// --- portable project file ---------------------------------------------------------
// The whole project as one JSON file: blueprint + plan + studio config + clip
// metadata. Media bytes stay in the user's browser (privacy + file size) —
// on import the app relinks by clip name, or the user re-adds the files.

export interface PortableProject {
  magic: "viraledit-project";
  version: 1;
  exportedAt: number;
  blueprint: EditBlueprint | null;
  plan: EditPlan | null;
  studio: unknown; // StudioConfig — structural to avoid a store import cycle
  clips: UserClip[]; // metadata only (no media, no thumbnails)
  note?: string;
  comments?: ReviewComment[]; // async review notes that travel with the project
}

export function projectToFile(p: {
  blueprint: EditBlueprint | null;
  plan: EditPlan | null;
  studio: unknown;
  clips: UserClip[];
  exportedAt: number;
  note?: string;
  comments?: ReviewComment[];
}): string {
  const out: PortableProject = {
    magic: "viraledit-project",
    version: 1,
    exportedAt: p.exportedAt,
    blueprint: p.blueprint,
    plan: p.plan,
    studio: p.studio,
    clips: p.clips.map((c) => ({ ...c, thumbnail: undefined })),
    ...(p.note ? { note: p.note } : {}),
    ...(p.comments && p.comments.length ? { comments: p.comments } : {}),
  };
  return JSON.stringify(out, null, 2);
}

export function projectFromFile(text: string): { ok: true; project: PortableProject } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "Not a valid JSON file." };
  }
  const p = parsed as Partial<PortableProject>;
  if (p?.magic !== "viraledit-project") return { ok: false, error: "Not a ViralEdit project file." };
  if (p.version !== 1) return { ok: false, error: `Unsupported project version ${String(p.version)}.` };
  if (!Array.isArray(p.clips)) return { ok: false, error: "Project file has no clip list." };
  if (p.plan && !Array.isArray((p.plan as EditPlan).segments)) return { ok: false, error: "Project plan is malformed." };
  return { ok: true, project: p as PortableProject };
}
