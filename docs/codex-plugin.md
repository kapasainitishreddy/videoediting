# ViralEdit Codex Plugin

ViralEdit can now be operated from Codex without moving your footage out of the browser.

The Codex plugin lives at:

```text
plugins/viraledit/
```

It contains:

- a Codex plugin manifest
- a bundled stdio MCP server
- a ViralEdit operating skill

The MCP server talks only to a local ViralEdit control bridge. Video bytes stay in the browser's existing IndexedDB storage and final rendering still runs through ViralEdit's existing FFmpeg-WASM pipeline.

## 1. Start ViralEdit with the Codex bridge enabled

The bridge is opt-in and disabled by default.

### PowerShell

```powershell
$env:VIRALEDIT_CODEX_BRIDGE="1"
npm run dev
```

### macOS / Linux

```bash
VIRALEDIT_CODEX_BRIDGE=1 npm run dev
```

Open the local ViralEdit URL in your browser, normally:

```text
http://127.0.0.1:3000
```

If Next.js selects a different port, set `VIRALEDIT_URL` in the environment used to launch Codex, for example:

```powershell
$env:VIRALEDIT_URL="http://127.0.0.1:3001"
```

Only loopback `http://` URLs are accepted by the bundled MCP server.

## 2. Add this repository as a local Codex plugin marketplace

From Codex, add the repository root as a marketplace source:

```bash
codex plugin marketplace add /absolute/path/to/videoediting
```

Then install ViralEdit:

```bash
codex plugin add viraledit@viraledit-local
```

Start a fresh Codex conversation after installation so the plugin skill and MCP tools are discovered.

For a GitHub-hosted marketplace after this branch is merged, the same repository can be used as the marketplace source instead of a local filesystem path.

## 3. What Codex can do today

The plugin exposes these tools:

| Tool | Purpose |
| --- | --- |
| `viraledit_status` | Inspect the connected editor, loaded clips, timeline and render state |
| `viraledit_auto_edit` | Build a timeline from clips already loaded in ViralEdit |
| `viraledit_edit` | Apply one reversible natural-language edit instruction |
| `viraledit_render` | Run the real browser-side render pipeline and wait for export |
| `viraledit_undo` | Undo the latest timeline-plan change |
| `viraledit_reset` | Reset the current project state |
| `viraledit_navigate` | Move the connected tab between approved ViralEdit screens |

Example requests in Codex:

```text
Check my ViralEdit project and tell me what is loaded.
```

```text
Auto-edit the clips I already loaded into a fast cinematic Reel with a punchy hook.
```

```text
Tighten the hook, make the pacing faster, then render it.
```

```text
Cut the silences and make the edit 30 seconds.
```

## Architecture

```text
Codex
  |
  | MCP stdio
  v
plugins/viraledit/mcp/server.mjs
  |
  | loopback HTTP only
  v
/api/codex
  |
  v
CodexBridge in the open ViralEdit browser tab
  |
  +--> existing conversational editor
  +--> existing smartAutoEdit
  +--> Zustand state
  +--> IndexedDB footage
  +--> existing FFmpeg-WASM render
```

There is no second editing engine in the plugin. The plugin delegates to ViralEdit's existing code so browser UI edits and Codex edits stay consistent.

## Security model

The write bridge has two independent guards:

1. ViralEdit must be started with `VIRALEDIT_CODEX_BRIDGE=1`.
2. `/api/codex` accepts requests only when the request host is loopback (`127.0.0.1`, `localhost`, or `::1`).

The bundled MCP server also refuses a non-loopback `VIRALEDIT_URL`.

The MCP server does not expose a shell, arbitrary filesystem access, or arbitrary HTTP targets.

Do not enable the Codex bridge on an internet-facing deployment.

## Current limitation: loading footage

V1 intentionally does not inject arbitrary local files from Codex into browser IndexedDB. Add clips through ViralEdit first, then Codex can inspect, auto-edit, refine, undo and render them.

This keeps the first plugin small and preserves ViralEdit's existing local-first storage model.

## Not in V1

These are separate future modules rather than pretending the editor plugin already has them:

- autonomous TikTok / Instagram / X / YouTube trend discovery
- direct social publishing
- creator/lead discovery
- cold-email outreach
- cloud team workspaces

## Tests

Run the plugin-specific tests:

```bash
npm run test:codex
```

They cover:

- command queue lifecycle and bridge heartbeat expiry
- loopback security guard
- legacy MCP initialization
- current MCP `server/discover`
- tool discovery
- mocked status and edit tool calls

The normal repository lint/build checks still apply.
