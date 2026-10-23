import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "pi-phase2-e2e-"));
process.env.HOME = root;
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
mkdirSync(join(process.env.PI_CODING_AGENT_DIR, "extensions"), { recursive: true });
writeFileSync(join(process.env.PI_CODING_AGENT_DIR, "settings.json"), JSON.stringify({ compaction: { keepRecentTokens: 1 } }));
cpSync(new URL("./fixtures/phase2-acceptance-extension.ts", import.meta.url), join(process.env.PI_CODING_AGENT_DIR, "extensions", "phase2.ts"));

const { createAgentServer } = await import("/usr/local/lib/node_modules/@aoliyougei/pi-web-agent-server/dist/server.js");
const { createAgentRouteAdapter } = await import("/usr/local/lib/node_modules/@aoliyougei/pi-web-agent-server/dist/runtime/agent-adapter.js");
const { getRpcSession } = await import("/usr/local/lib/node_modules/@aoliyougei/pi-web-agent-server/dist/runtime/session-runtime.js");
const { SessionManager } = await import("/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js");
const token = "phase2-acceptance-token";
const agent = createAgentRouteAdapter();
const app = createAgentServer({ token, version: { protocolVersion: 1, serverVersion: "0.2.0", piVersion: "1.4.0", piRevision: "4a080252f06caf63a525d7873c5d94d3c23887e0", capabilities: ["extension-ui", "custom-ui", "remote-files", "subagents", "session-locks"] }, agent, eventBufferCapacity: 32 });
await app.listen("127.0.0.1", 0);
const base = `http://127.0.0.1:${app.address().port}/internal/v1/api/agent`;
const auth = { authorization: `Bearer ${token}` };
const sessions = [];
const request = async (path, init = {}) => {
  const response = await fetch(`${base}${path}`, { ...init, headers: { ...auth, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers } });
  const body = await response.json().catch(() => null);
  assert.equal(response.ok, true, `${path}: ${response.status} ${JSON.stringify(body)}`);
  return body;
};
const command = (id, body) => request(`/${id}`, { method: "POST", body: JSON.stringify(body) });
const wait = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually(operation, label) {
  for (let i = 0; i < 200; i++) {
    const result = await operation();
    if (result) return result;
    await wait();
  }
  throw new Error(`Timed out: ${label}`);
}
async function openEvents(id, lastEventId) {
  const abort = new AbortController();
  const response = await fetch(`${base}/${id}/events`, { headers: { ...auth, ...(lastEventId ? { "last-event-id": lastEventId } : {}) }, signal: abort.signal });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  let buffer = "";
  const queue = [];
  return {
    async next(predicate) {
      for (;;) {
        while (buffer.includes("\n\n")) {
          const split = buffer.indexOf("\n\n"), frame = buffer.slice(0, split); buffer = buffer.slice(split + 2);
          const idLine = frame.split("\n").find((line) => line.startsWith("id: "));
          const data = frame.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
          if (data) queue.push({ id: idLine?.slice(4), event: JSON.parse(data) });
        }
        const found = queue.findIndex(({ event }) => predicate(event));
        if (found >= 0) return queue.splice(found, 1)[0];
        const chunk = await reader.read();
        if (chunk.done) throw new Error("SSE ended");
        buffer += new TextDecoder().decode(chunk.value, { stream: true });
      }
    },
    async close() { abort.abort(); await reader.cancel().catch(() => {}); },
  };
}

try {
  const created = await request("/new", { method: "POST", body: JSON.stringify({ cwd: root, type: "ensure_session" }) });
  const id = created.sessionId; sessions.push(id);
  const stream = await openEvents(id);
  assert.equal((await stream.next((event) => event.type === "connected")).event.sessionId, id);

  const commands = (await command(id, { type: "get_commands" })).data.commands.map((item) => item.name);
  assert.ok(commands.includes("phase2-dialogs") && commands.includes("phase2-custom"));
  await command(id, { type: "set_auto_compaction", enabled: false });
  await command(id, { type: "set_auto_retry", enabled: false });
  await command(id, { type: "set_model", provider: "phase2", modelId: "echo" });
  await command(id, { type: "set_thinking_level", level: "medium" });
  let state = (await command(id, { type: "get_state" })).data;
  assert.equal(state.autoCompactionEnabled, false);
  assert.equal(state.autoRetryEnabled, false);
  assert.equal(state.thinkingLevel, "medium");
  assert.deepEqual(state.model, { provider: "phase2", id: "echo" });

  await command(id, { type: "prompt", message: "hello" });
  const firstDone = await stream.next((event) => event.type === "prompt_done");
  assert.ok(firstDone.id);
  assert.match((await command(id, { type: "get_last_assistant_text" })).data.text, /echo:hello/);
  const sessionFile = (await command(id, { type: "get_state" })).data.sessionFile;
  const manager = SessionManager.open(sessionFile);
  assert.ok(manager.getBranch().some((entry) => entry.type === "message" && entry.message.role === "assistant"));

  await stream.close();
  await command(id, { type: "set_session_name", name: "phase2-a" });
  await command(id, { type: "set_session_name", name: "phase2-b" });
  const replay = await openEvents(id, firstDone.id);
  const replayedA = await replay.next((event) => event.type === "session_info_changed");
  const replayedB = await replay.next((event) => event.type === "session_info_changed");
  assert.equal(replayedA.event.name, "phase2-a");
  assert.equal(replayedB.event.name, "phase2-b");
  assert.notEqual(replayedA.id, replayedB.id);
  await replay.close();
  for (let i = 0; i < 40; i++) await command(id, { type: "set_session_name", name: `overflow-${i}` });
  const stale = await fetch(`${base}/${id}/events`, { headers: { ...auth, "last-event-id": firstDone.id } });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error.code, "resync_required");

  await command(id, { type: "prompt", message: "slow request" });
  await command(id, { type: "follow_up", message: "queued" });
  state = (await command(id, { type: "get_state" })).data;
  assert.ok(state.queuedMessages.followUp.length >= 1);
  await command(id, { type: "clear_queue" });
  await command(id, { type: "abort" });
  await eventually(async () => !(await command(id, { type: "get_state" })).data.isPromptRunning, "abort settlement");

  const bash = (await command(id, { type: "bash", command: "printf phase2" })).data;
  assert.equal(bash.output, "phase2");
  await command(id, { type: "compact", customInstructions: "short" });
  assert.equal((await command(id, { type: "get_state" })).data.isCompacting, false);

  const branch = SessionManager.open(sessionFile).getBranch();
  const assistant = branch.findLast((entry) => entry.type === "message" && entry.message.role === "assistant");
  assert.ok(assistant);
  const clone = (await command(id, { type: "clone", leafId: assistant.id })).data;
  assert.equal(clone.cancelled, false); sessions.push(clone.newSessionId);
  await request(`/${id}`); // reopen original after replacement shutdown
  const forkEntry = SessionManager.open(sessionFile).getBranch().find((entry) => entry.type === "message");
  const fork = (await command(id, { type: "fork", entryId: forkEntry.id })).data;
  assert.equal(fork.cancelled, false); sessions.push(fork.newSessionId);

  console.log("PASS runtime-command-e2e: model/thinking/settings/prompt/queue/abort/bash/compact/fork/clone and SSE replay");
} finally {
  for (const id of sessions) await getRpcSession(id)?.shutdown();
  await app.close();
  rmSync(root, { recursive: true, force: true });
}
