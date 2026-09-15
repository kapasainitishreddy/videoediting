# ViralEdit Codex Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package ViralEdit as a Codex plugin with a bundled MCP server that can operate the live local-first editor through a secure loopback bridge.

**Architecture:** A tiny stdio MCP process sends structured commands to an opt-in Next.js command queue. A mounted client bridge polls that queue and executes commands inside the existing browser context, delegating editing and rendering to ViralEdit's current functions and state. No video bytes pass through MCP.

**Tech Stack:** Next.js 16, React 19, TypeScript, Zustand, IndexedDB, Node.js stdio MCP, existing ViralEdit FFmpeg-WASM editor.

**Spec:** `docs/superpowers/specs/2026-09-15-viraledit-codex-plugin-design.md`

## Global Constraints

- `VIRALEDIT_CODEX_BRIDGE=1` is required to expose the control bridge.
- Bridge requests are accepted only on loopback hostnames.
- No proprietary AI provider is required for the plugin control path.
- Do not duplicate the editor's render/plan logic in the MCP server.
- Keep MCP server tool names underscore-only for Codex compatibility.
- V1 does not upload arbitrary local files into IndexedDB.

---

### Task 1: Command Queue Core

**Files:**
- Create: `src/lib/codex-control.ts`
- Test: `scripts/codex-control-test.mjs`

**Interfaces:**
- Produces: `enqueueCodexCommand`, `takeNextCodexCommand`, `completeCodexCommand`, `getCodexCommand`, `updateCodexHeartbeat`, `getCodexBridgeSnapshot`.

- [ ] Write a failing pure test covering enqueue → dispatch → complete and heartbeat expiry.
- [ ] Run the test and confirm the missing implementation fails.
- [ ] Implement the smallest in-memory queue with a `globalThis` singleton for Next.js hot-reload stability.
- [ ] Re-run the test and confirm it passes.

### Task 2: Secure Next.js Control Route

**Files:**
- Create: `src/app/api/codex/route.ts`

**Interfaces:**
- Consumes: command queue functions from Task 1.
- Produces: local HTTP actions `health`, `next`, `result`, `enqueue`, `complete`, `heartbeat`.

- [ ] Add route validation for `VIRALEDIT_CODEX_BRIDGE=1` and loopback hostname.
- [ ] Implement GET health/next/result requests.
- [ ] Implement POST enqueue/complete/heartbeat requests with JSON validation.
- [ ] Return bounded error messages and appropriate 4xx statuses.

### Task 3: Browser Command Bridge

**Files:**
- Create: `src/components/CodexBridge.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: `/api/codex` commands and `useProject` state.
- Emits: `viraledit:codex-chat`, `viraledit:codex-auto-edit`, `viraledit:codex-render` custom events.
- Produces: heartbeat/status snapshots and command completion callbacks.

- [ ] Poll for one command at a time only when the bridge flag renders the component.
- [ ] Execute status/undo/reset/navigate directly through safe state/actions.
- [ ] Dispatch editor actions to existing components and await result events with timeouts.
- [ ] Mount the bridge from the server layout only when explicitly enabled.

### Task 4: Reuse Conversational Editing from Codex

**Files:**
- Modify: `src/components/ChatEdit.tsx`

**Interfaces:**
- Consumes: `viraledit:codex-chat` `{ id, text }`.
- Produces: `viraledit:codex-chat-result` `{ id, ok, reply, detail?, error? }`.

- [ ] Extract the existing submit execution path into a reusable command runner.
- [ ] Keep normal chat UI behavior unchanged.
- [ ] Add a window event listener that invokes the same runner without duplicating edit logic.
- [ ] Report structured result/error events back to `CodexBridge`.

### Task 5: Expose Auto-edit and Render Events

**Files:**
- Modify: `src/app/editor/page.tsx`

**Interfaces:**
- Consumes: `viraledit:codex-auto-edit`, `viraledit:codex-render`.
- Produces: matching `*-result` events.

- [ ] Refactor auto-edit internals so an explicit direction string can be supplied without relying on asynchronous React state propagation.
- [ ] Keep existing button-driven behavior unchanged.
- [ ] Add a listener for Codex auto-edit commands and return structured success/errors.
- [ ] Add a listener for render commands and return success/errors after the existing render pipeline resolves.

### Task 6: Bundled MCP Server

**Files:**
- Create: `codex-plugin/mcp/server.mjs`
- Create: `scripts/codex-mcp-test.mjs`

**Interfaces:**
- Consumes: `VIRALEDIT_URL` (default `http://127.0.0.1:3000`).
- Produces MCP tools: `viraledit_status`, `viraledit_edit`, `viraledit_auto_edit`, `viraledit_render`, `viraledit_undo`, `viraledit_reset`, `viraledit_navigate`.

- [ ] Write a failing protocol test that starts the server process and exercises initialize, tools/list, and one mocked tools/call.
- [ ] Implement the minimal self-contained stdio MCP protocol needed by Codex, without adding a runtime package dependency.
- [ ] Implement loopback bridge enqueue/poll helpers with bounded timeouts.
- [ ] Re-run protocol tests.

### Task 7: Codex Plugin Package + Skill

**Files:**
- Create: `.codex-plugin/plugin.json`
- Create: `.mcp.json`
- Create: `skills/viraledit/SKILL.md`
- Create: `.agents/plugins/marketplace.json`
- Create: `docs/codex-plugin.md`

**Interfaces:**
- Plugin manifest points to `./skills/` and `./.mcp.json`.
- MCP entry uses an underscore-only server key and plugin-root `cwd`.

- [ ] Add a strict-semver plugin manifest with current Codex plugin fields.
- [ ] Point the bundled stdio server at `node codex-plugin/mcp/server.mjs` with `cwd: "."`.
- [ ] Write the ViralEdit operating skill, emphasizing status-first, reversible edits, local footage, and explicit rendering.
- [ ] Add repo-local marketplace metadata so the plugin can be discovered/installed from this repository.
- [ ] Document local start/install/use steps and security behavior.

### Task 8: Verification and Pull Request

**Files:**
- Modify if needed based on verification failures.

- [ ] Run the pure command-queue test.
- [ ] Run the MCP stdio protocol test.
- [ ] Run repository unit tests, lint, and build in CI through a pull request.
- [ ] Inspect CI logs/status rather than assuming success.
- [ ] Review the final diff for accidental unrelated changes/secrets.
- [ ] Open a pull request from `codex/viraledit-plugin` to `claude/ai-video-editing-app-vrohjm` with usage and verification notes.