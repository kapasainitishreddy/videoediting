---
name: viraledit
description: Operate the user's live local ViralEdit AI video editor through the ViralEdit MCP tools. Use when the user asks Codex to inspect, auto-edit, restyle, tighten, undo, navigate, or render a ViralEdit project or Reel/Short/TikTok edit.
---

# ViralEdit AI

Use this skill to operate the live ViralEdit browser app rather than reimplementing video editing in shell scripts.

ViralEdit is local-first: the footage and rendered project live in the browser/IndexedDB and the heavy render runs through the app's existing FFmpeg-WASM pipeline. The MCP server sends structured control commands only.

## Before Every Editing Task

1. Call `viraledit_status` first.
2. If the bridge is disabled/unreachable, tell the user to start the app locally with:

   ```bash
   VIRALEDIT_CODEX_BRIDGE=1 npm run dev
   ```

   On PowerShell:

   ```powershell
   $env:VIRALEDIT_CODEX_BRIDGE="1"; npm run dev
   ```

   Then open the local ViralEdit URL in a browser.
3. Do not assume clips are loaded. Check `clipCount`.
4. Do not assume a timeline exists. Check `planReady`.

## Normal Workflow

For a request such as "make my loaded clips into a fast cinematic Reel":

1. `viraledit_status`
2. If `clipCount == 0`, ask the user to add footage in ViralEdit. V1 does not inject arbitrary filesystem video files into browser IndexedDB.
3. Call `viraledit_auto_edit` with the user's direction.
4. Call `viraledit_status` again.
5. Apply additional reversible changes one at a time with `viraledit_edit`.
6. Call `viraledit_render` only when the user asked for a final render/export or clearly approved the edit.

## Tool Guidance

### `viraledit_status`

Always prefer this over guessing browser state. Report the relevant state plainly: route, clips, timeline segments, reference readiness, render readiness, and bridge activity.

### `viraledit_auto_edit`

Use when clips are loaded but there is no timeline, or when the user explicitly wants the app to rebuild the timeline. The optional `direction` should describe editorial intent rather than implementation details.

Good directions:
- `fast cuts, high energy, punchy hook`
- `cinematic, restrained transitions, moody grade`
- `clean product Reel with quick visual resets`

The command uses ViralEdit's deterministic auto-edit and prompt-compiler path. It does not require a proprietary model key.

### `viraledit_edit`

Use for one reversible refinement at a time. It routes through the same conversational editing engine as the visible Chat Edit panel.

Examples:
- `tighten the hook`
- `cut the silences`
- `make it moodier`
- `make it 30 seconds`
- `add cutaways`
- `make the pacing faster`
- `add a callback ending`

After a material edit, check status if the next operation depends on the timeline.

### `viraledit_undo`

Use when the user rejects the last plan change or asks to undo. Prefer undo over rebuilding an entire edit.

### `viraledit_reset`

Destructive to the current project state. Use only when the user explicitly asks to reset/start over. Do not use as an error-recovery shortcut.

### `viraledit_navigate`

Use only approved internal routes. The tool itself enforces the route allow-list.

### `viraledit_render`

Rendering can take time because the real FFmpeg-WASM pipeline is executing in the browser. The tool waits for ViralEdit to reach the export screen. Do not call it speculatively.

## Creative Rules

When using a reference Reel/TikTok/Short as inspiration:

- Preserve abstract editing grammar where useful: pacing, cut rhythm, hook pattern, caption rhythm, transition energy, shot-length pattern, CTA position.
- Create original scripts, footage, graphics, branding, and assets.
- Do not copy another creator's actual footage, script, voice, or copyrighted music.
- Prefer platform-safe vertical composition for Reels/TikTok/Shorts unless the user asks for another format.

## What V1 Does Not Do Yet

Do not pretend these are available through the plugin today:

- finding viral trends autonomously across TikTok/Instagram/X/YouTube
- injecting arbitrary local video files into browser IndexedDB
- direct social publishing
- lead finding or cold email

Those belong in later tools. The current plugin is intentionally focused on reliably operating the existing ViralEdit editing engine.
