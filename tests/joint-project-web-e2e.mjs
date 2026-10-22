// Run only in an isolated final Web candidate sharing a loopback network with joint-project-rpc.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const source = readFileSync(new URL("./joint-web-session-scope.ts", import.meta.url), "utf8");
const code = stripTypeScriptTypes(source.replace('import { getSelectedBackendId } from "./agent-backend-selection";', 'const getSelectedBackendId = () => "default";'));
const { createSessionScope } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const base = "http://127.0.0.1:30141", control = "http://127.0.0.1:8089";
const fixture = await (await fetch(`${control}/fixture`)).json();
const storage = new Map();
const scope = createSessionScope({ backend: () => "default", storage: () => ({ getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) }), send: (path, init) => fetch(base + path, init) });
const expect = async (response, status = 200) => { const body = await response.json(); assert.equal(response.status, status, JSON.stringify(body)); return body; };
async function command(id, body, status = 200) {
  return expect(await scope.fetch(`/api/agent/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), status);
}
async function idle(id) {
  for (let i = 0; i < 200; i++) {
    if (!(await command(id, { type: "get_state" })).data.isPromptRunning) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Prompt did not settle");
}
async function stream(id, cursor) {
  const abort = new AbortController();
  const response = await scope.fetch(`/api/agent/${id}/events${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { signal: abort.signal });
  assert.equal(response.status, 200); assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const reader = response.body.getReader();
  let buffer = "";
  return {
    async next(type) {
      for (;;) {
        while (buffer.includes("\n\n")) {
          const at = buffer.indexOf("\n\n"), frame = buffer.slice(0, at); buffer = buffer.slice(at + 2);
          const data = frame.split("\n").find((line) => line.startsWith("data: "));
          if (!data) continue;
          const event = JSON.parse(data.slice(6));
          if (event.type === type) return { event, id: frame.split("\n").find((line) => line.startsWith("id: "))?.slice(4) };
        }
        const chunk = await reader.read(); if (chunk.done) throw new Error("SSE ended");
        buffer += new TextDecoder().decode(chunk.value, { stream: true });
      }
    },
    async close() { abort.abort(); await reader.cancel().catch(() => {}); },
  };
}
assert.equal(await scope.enabled(), true);
scope.remember(fixture.localA.id, fixture.a); scope.remember(fixture.localB.id, fixture.b); scope.remember(fixture.globalA.id, fixture.a);
// Cold detail before LIST, using exactly Web's browser scope helper.
await expect(await scope.fetch(`/api/sessions/${fixture.localA.id}?tail=50&deferMedia=1`));
const [listA, listB] = await Promise.all([fixture.a, fixture.b].map(async (cwd) => {
  const normalized = await scope.validate(cwd);
  return expect(await fetch(`${base}/api/sessions?cwd=${encodeURIComponent(normalized)}&force=1`));
}));
assert.ok(listA.sessions.some((session) => session.id === fixture.localA.id)); assert.ok(listA.sessions.some((session) => session.id === fixture.globalA.id));
assert.equal(listA.sessions.some((session) => session.id === fixture.localB.id), false);
assert.ok(listB.sessions.some((session) => session.id === fixture.localB.id)); assert.equal(listB.sessions.some((session) => session.id === fixture.localA.id), false);
const events = await stream(fixture.localA.id); await events.next("connected");
await command(fixture.localA.id, { type: "prompt", message: "joint first" });
const completed = await events.next("prompt_done"); assert.ok(completed.id); await idle(fixture.localA.id); await events.close();
let snapshot = await (await fetch(`${control}/snapshot?id=${fixture.localA.id}`)).json();
assert.equal(snapshot.file, fixture.localA.file); assert.match(snapshot.content, /echo:joint first/);
// SSE cursor mapping must retain the independently supplied lookup cwd.
await command(fixture.localA.id, { type: "set_session_name", name: "replay-name" });
const replay = await stream(fixture.localA.id, completed.id); await replay.next("connected");
assert.equal((await replay.next("session_info_changed")).event.name, "replay-name"); await replay.close();
// Remove config during an active deterministic request: no storage migration.
const active = await stream(fixture.localA.id); await active.next("connected");
await command(fixture.localA.id, { type: "prompt", message: "slow joint settings removal" });
await expect(await fetch(`${control}/settings?project=0`, { method: "POST" }));
await active.next("prompt_done"); await idle(fixture.localA.id); await active.close();
snapshot = await (await fetch(`${control}/snapshot?id=${fixture.localA.id}`)).json();
assert.equal(snapshot.file, fixture.localA.file); assert.match(snapshot.content, /echo:slow joint settings removal/);
// Real RPC restart clears its selected roots and runtime cache. Web must revalidate.
await expect(await fetch(`${control}/restart`, { method: "POST" }));
const cold = await expect(await scope.fetch(`/api/sessions/${fixture.localA.id}?deferMedia=1&tail=50`));
assert.equal(cold.filePath, fixture.localA.file);
const image = cold.context.messages.find((message) => message.role === "toolResult").content[0].source.url;
assert.equal(new URL(image, base).searchParams.get("cwd"), fixture.a);
const imageResponse = await scope.fetch(image); assert.equal(imageResponse.status, 200); assert.equal(await imageResponse.text(), "abc");
const continued = await stream(fixture.localA.id); await continued.next("connected");
await command(fixture.localA.id, { type: "prompt", message: "joint after restart" }); await continued.next("prompt_done"); await idle(fixture.localA.id); await continued.close();
snapshot = await (await fetch(`${control}/snapshot?id=${fixture.localA.id}`)).json();
assert.equal(snapshot.file, fixture.localA.file); assert.match(snapshot.content, /echo:joint after restart/);
// Global sessions continue in the original global file even with project hints.
await command(fixture.globalA.id, { type: "prompt", message: "global joint continuation" }); await idle(fixture.globalA.id);
const globalSnapshot = await (await fetch(`${control}/snapshot?id=${fixture.globalA.id}`)).json();
assert.equal(globalSnapshot.file, fixture.globalA.file); assert.match(globalSnapshot.content, /echo:global joint continuation/);
// Creation follows settings, not discovery.
const create = async (name) => {
  const response = await fetch(`${base}/api/agent/new`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd: fixture.a, type: "ensure_session", provider: "phase2", modelId: "echo" }) });
  const result = await expect(response); scope.remember(result.sessionId, fixture.a);
  await command(result.sessionId, { type: "prompt", message: name }); await idle(result.sessionId);
  return (await command(result.sessionId, { type: "get_state" })).data;
};
const globalNew = await create("new global"); assert.ok(globalNew.sessionFile.startsWith(`${fixture.root}/agent/sessions/`));
await expect(await fetch(`${control}/settings?project=1`, { method: "POST" }));
const localNew = await create("new local"); assert.ok(localNew.sessionFile.startsWith(`${fixture.a}/.pi/sessions/`));
// Worktree removal must respect a CLI-style local lease even without LIST/runtime registration.
const worktree = await expect(await fetch(`${control}/worktree`, { method: "POST" }));
await scope.validate(worktree.repo);
const removal = await expect(await fetch(`${base}/api/worktrees`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd: worktree.repo, path: worktree.linked, force: true }) }), 409);
assert.equal(removal.code, "session_locked");
// Different-file duplicate conflicts must stay 409 through Web, not become success/resync.
await expect(await fetch(`${control}/duplicate?id=${fixture.localA.id}`, { method: "POST" }));
const conflict = await command(fixture.localA.id, { type: "get_state" }, 409); assert.equal(conflict.code, "session_id_conflict");
const conflictEvents = await scope.fetch(`/api/agent/${fixture.localA.id}/events`); assert.equal(conflictEvents.status, 409); assert.equal((await conflictEvents.json()).code, "session_id_conflict");
const trace = await (await fetch(`${control}/trace`)).json();
assert.ok(trace.some((item) => item.url === `/internal/v1/api/agent/${fixture.localA.id}` && item.type === "prompt" && item.cwd === fixture.a));
assert.ok(trace.some((item) => item.url.includes(`/agent/${fixture.localA.id}/events?`) && new URL(item.url, base).searchParams.get("cwd") === fixture.a && item.cursor === completed.id));
assert.ok(trace.some((item) => item.url.includes("/tool-result-image?") && new URL(item.url, base).searchParams.get("cwd") === fixture.a));
for (const item of trace.filter((item) => item.type && item.url.match(/\/agent\/[^/]+$/) && !item.url.endsWith("/new"))) {
  assert.equal(new URL(item.url, base).searchParams.has("cwd"), false);
  assert.ok(item.keys.includes("cwd"));
}
console.log("PASS joint final candidates: Web scope helper and production proxy -> deterministic RPC prompt/SSE/replay, A/B+global union, settings removal mid-run, real restart and validation, same JSONL continuation, deferred image, global/local creation, worktree lock, duplicate conflict, captured query/body/cursor contract");
console.log(JSON.stringify({ checks: "all passed", tracedRequests: trace.length, webDigest: "740cc9550e58760faa825a1cef1db5fa367d9efe4c7dfe41a607af96cd9694dc", rpcDigest: "f126913ad141f44c22b0c8a6bff5ae88e837600f36dc23de676ceade26272659" }));
