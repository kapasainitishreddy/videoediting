import assert from "node:assert/strict";
import {
  __resetCodexControlForTests,
  completeCodexCommand,
  enqueueCodexCommand,
  getCodexBridgeSnapshot,
  getCodexCommand,
  takeNextCodexCommand,
  updateCodexHeartbeat,
} from "../src/lib/codex-control";

__resetCodexControlForTests();

const queued = enqueueCodexCommand("chat", { text: "tighten the hook" });
assert.equal(queued.kind, "chat");
assert.equal(queued.status, "pending");
assert.equal(queued.payload.text, "tighten the hook");

const taken = takeNextCodexCommand();
assert.equal(taken?.id, queued.id);
assert.equal(taken?.status, "dispatched");
assert.equal(takeNextCodexCommand(), null, "a dispatched command must not be handed out twice");

completeCodexCommand(queued.id, { ok: true, data: { reply: "Tightened." } });
const completed = getCodexCommand(queued.id);
assert.equal(completed?.status, "completed");
assert.deepEqual(completed?.result?.data, { reply: "Tightened." });

updateCodexHeartbeat({ route: "/editor", clipCount: 3, planReady: true, busy: null }, 1_000);
let snapshot = getCodexBridgeSnapshot(1_500, 1_000);
assert.equal(snapshot.connected, true);
assert.equal(snapshot.status?.route, "/editor");
assert.equal(snapshot.status?.clipCount, 3);

snapshot = getCodexBridgeSnapshot(2_500, 1_000);
assert.equal(snapshot.connected, false, "heartbeat older than TTL must be reported disconnected");

console.log("codex-control-test: pass");
