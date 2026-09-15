# ViralEdit Codex Plugin Design

## Goal

Make the existing local-first ViralEdit AI editor operable from Codex without replacing its browser/IndexedDB architecture or uploading footage to a new backend.

A user with ViralEdit open locally should be able to ask Codex to inspect the current edit, apply conversational edit commands, auto-edit the loaded clips, undo/reset, render the current timeline, and navigate between ViralEdit screens.

## Constraints

- Keep the existing Next.js/React/FFmpeg-WASM editor as the rendering engine.
- Keep video bytes in the browser's existing IndexedDB path.
- Do not require OpenAI, Anthropic, MiniMax, fal.ai, or another paid model/API for the control layer.
- Codex integration must be opt-in and disabled by default.
- The control bridge must not expose write controls on a public ViralEdit deployment.
- Reuse existing deterministic editor logic (`interpretTurn`, `smartAutoEdit`, `handleRender`, Zustand state) instead of duplicating editing behavior in the plugin.
- Package the integration using the current Codex plugin structure: `.codex-plugin/plugin.json`, `skills/`, and `.mcp.json`.

## Architecture

```text
Codex
  |
  | MCP stdio
  v
bundled ViralEdit MCP server
  |
  | HTTP on loopback only
  v
Next.js /api/codex bridge
  |
  | queued command
  v
CodexBridge client component
  |
  | CustomEvent
  v
existing ViralEdit editor functions
  |
  +--> Zustand project state
  +--> IndexedDB footage
  +--> FFmpeg WASM render
```

The MCP process never reads footage. It only sends structured commands to the running local ViralEdit app. The browser executes those commands in the same context that already owns the project state and video blobs.

## Security Model

The server bridge is rendered and enabled only when `VIRALEDIT_CODEX_BRIDGE=1`.

The API rejects non-loopback hosts. The default MCP base URL is `http://127.0.0.1:3000`, overridable with `VIRALEDIT_URL` for local port changes. A remote/public deployment therefore does not become remotely controllable by merely installing the plugin.

The MCP server exposes editing actions only; it does not provide arbitrary shell or filesystem execution.

## MCP Tools

### `viraledit_status`
Returns the live browser/editor status: route, clip count, whether a reference/plan/render exists, segment count, editing mode, and current busy state.

### `viraledit_edit`
Takes a natural-language edit instruction and routes it through the existing conversational edit interpreter. Examples: `tighten the hook`, `make it moody`, `cut the silences`, `make it 30 seconds`, `undo`, `render`.

### `viraledit_auto_edit`
Runs ViralEdit's existing automatic editor on clips already loaded in the browser. Accepts an optional direction string.

### `viraledit_render`
Renders the current timeline through the existing FFmpeg-WASM pipeline and returns a completion/error result. Rendering remains in the browser.

### `viraledit_undo`
Reverts the last plan edit using the existing plan history.

### `viraledit_reset`
Resets the current project through the existing Zustand action.

### `viraledit_navigate`
Navigates to a safe ViralEdit route (`/home`, `/editor`, `/marketing`, `/features`, `/export`).

## Browser Bridge

`CodexBridge` polls the local `/api/codex` command queue while the feature flag is enabled. It sends a small heartbeat/status snapshot so the MCP server can detect whether a ViralEdit tab is connected.

For commands that already have rich editor implementations, the bridge emits typed custom events instead of reimplementing logic:

- `viraledit:codex-chat`
- `viraledit:codex-auto-edit`
- `viraledit:codex-render`

The receiving component reports completion via a matching result event. `CodexBridge` then marks the queued API command complete.

## Codex Skill

The plugin skill instructs Codex to:

1. Check `viraledit_status` first.
2. Tell the user to start ViralEdit locally with `VIRALEDIT_CODEX_BRIDGE=1` if no browser client is connected.
3. Never assume footage is loaded; inspect status.
4. Prefer one reversible edit instruction at a time.
5. Render only when requested or when the user explicitly asks for a finished export.
6. Preserve the reference video's editing grammar while creating original content; do not copy a creator's actual footage/script/music.
7. Keep platform output vertical/social-safe unless the user asks otherwise.

## Out of Scope for V1

- Uploading arbitrary local files from Codex into browser IndexedDB.
- Autonomous trend scraping.
- Publishing directly to Instagram/TikTok/YouTube/X.
- Email/lead generation.
- Multi-user cloud collaboration.

Those can be added as separate plugin tools after the editor-control path is proven.