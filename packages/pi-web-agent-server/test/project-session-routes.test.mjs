import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const root = mkdtempSync(join(tmpdir(), "pi-project-http-"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
const { SessionManager } = await import("@earendil-works/pi-coding-agent");
const { createAgentServer } = await import("../dist/server.js");
const { createAgentRouteAdapter } = await import("../dist/runtime/agent-adapter.js");
const { getRpcSession } = await import("../dist/runtime/session-runtime.js");
const { acquireSessionLock } = await import("../dist/runtime/session-lock.js");
const { resolveSessionPath, invalidateSessionListCache } = await import("../dist/dependencies/session-reader.js");
const token = "project-route-token";
const authorization = `Bearer ${token}`;

async function start(t, agent = createAgentRouteAdapter()) {
  const app = createAgentServer({ token, version: { protocolVersion: 1 }, agent });
  await app.listen("127.0.0.1", 0);
  t.after(() => app.close());
  const url = `http://127.0.0.1:${app.address().port}/internal/v1/api`;
  return async (path, body, method = body ? "POST" : "GET") => {
    const response = await fetch(url + path, { method, headers: { authorization, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
}
function fixture(cwd, id) {
  const manager = SessionManager.create(cwd, join(cwd, ".pi", "sessions"));
  manager.appendMessage({ role: "user", content: "local history", timestamp: 1 });
  manager.appendMessage({ role: "toolResult", toolCallId: "c1", toolName: "read", content: [{ type: "image", data: "YWJj", mimeType: "image/png" }], timestamp: 2 });
  const header = { ...manager.getHeader(), ...(id ? { id } : {}) };
  writeFileSync(manager.getSessionFile(), [header, ...manager.getEntries()].map(JSON.stringify).join("\n") + "\n");
  return { id: header.id, file: manager.getSessionFile() };
}
function project(name) { const cwd = join(root, name); mkdirSync(cwd); return cwd; }
const hint = (cwd) => `cwd=${encodeURIComponent(cwd)}`;

test("cold project detail and resources require validation but never a preceding LIST", async (t) => {
  const cwd = project("cold A"); const saved = fixture(cwd);
  const request = await start(t);
  assert.equal((await request(`/sessions/${saved.id}?${hint(cwd)}`)).status, 403);
  assert.equal((await request("/cwd/validate", { cwd })).status, 200);
  const detail = await request(`/sessions/${saved.id}?deferMedia=1&${hint(cwd)}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.filePath, saved.file);
  const image = detail.body.context.messages.find((item) => item.role === "toolResult").content[0].source.url;
  assert.equal(new URL(image, "http://local").searchParams.get("cwd"), cwd);
  assert.equal((await request(`/sessions/${saved.id}/context?tail=1&${hint(cwd)}`)).status, 200);
  assert.deepEqual((await request(`/sessions/${saved.id}/state?${hint(cwd)}`)).body, { running: false });
  assert.equal((await request(`/sessions/${saved.id}?${hint(cwd)}`, { name: "renamed" }, "PATCH")).status, 200);
  assert.ok(readFileSync(saved.file, "utf8").includes("renamed"));
  assert.equal((await request(`/sessions/${saved.id}?${hint(cwd)}`, undefined, "DELETE")).status, 200);
  assert.equal((await request(`/sessions/${saved.id}?${hint(cwd)}`)).status, 404);
});

test("command cwd is lookup metadata, not an SDK command field, and conflicts are stable", async (t) => {
  const a = project("command A"), b = project("command B");
  const saved = fixture(a);
  const seen = [];
  const runtime = { send: async (command) => { seen.push(command); return {}; } };
  const adapter = { open: async () => runtime, send: async (id, command) => { seen.push(command); return { found: true }; }, create: async () => ({ id: "new", runtime }), running: () => ({ runningSessionIds: [], completionNotificationSuppressedSessionIds: [] }) };
  const request = await start(t, adapter);
  await request("/cwd/validate", { cwd: a }); await request("/cwd/validate", { cwd: b });
  assert.equal((await request(`/agent/${saved.id}`, { type: "get_state", cwd: a })).status, 200);
  assert.deepEqual(seen, [{ type: "get_state" }]);
  const duplicate = fixture(b, saved.id);
  // A's project is not in B's explicit scope; compare a real global duplicate instead.
  const global = SessionManager.create(a); const globalFile = global.getSessionFile();
  mkdirSync(dirname(globalFile), { recursive: true });
  writeFileSync(globalFile, JSON.stringify({ ...global.getHeader(), id: saved.id }) + "\n");
  invalidateSessionListCache();
  const conflict = await request(`/agent/${saved.id}`, { type: "get_state", cwd: a });
  assert.equal(conflict.status, 409); assert.equal(conflict.body.error.code, "session_id_conflict");
  assert.equal((await request(`/sessions?${hint(a)}&force=1`)).status, 409);
  assert.ok(readFileSync(duplicate.file, "utf8").includes(saved.id));
});

test("parallel A/B lists and cold commands keep independent request scopes", async (t) => {
  const a = project("parallel A"), b = project("parallel B");
  const savedA = fixture(a), savedB = fixture(b);
  const request = await start(t);
  await request("/cwd/validate", { cwd: a }); await request("/cwd/validate", { cwd: b });
  const [listA, listB] = await Promise.all([
    request(`/sessions?${hint(a)}&force=1`), request(`/sessions?${hint(b)}&force=1`),
  ]);
  assert.equal(listA.status, 200); assert.equal(listB.status, 200);
  assert.ok(listA.body.sessions.some((item) => item.id === savedA.id));
  assert.equal(listA.body.sessions.some((item) => item.id === savedB.id), false);
  assert.ok(listB.body.sessions.some((item) => item.id === savedB.id));
  assert.equal(listB.body.sessions.some((item) => item.id === savedA.id), false);
  t.after(async () => { await getRpcSession(savedA.id)?.shutdown(); await getRpcSession(savedB.id)?.shutdown(); });
  const [stateA, stateB] = await Promise.all([
    request(`/agent/${savedA.id}`, { cwd: a, type: "get_state" }),
    request(`/agent/${savedB.id}`, { cwd: b, type: "get_state" }),
  ]);
  assert.equal(stateA.status, 200); assert.equal(stateB.status, 200);
  assert.equal(stateA.body.data.sessionFile, savedA.file); assert.equal(stateB.body.data.sessionFile, savedB.file);
  assert.equal((await request(`/agent/${savedA.id}`, { cwd: b, type: "get_state" })).status, 403);
});

test("new sessions use settings; reopening and commands keep the original file and lease", async (t) => {
  const cwd = project("storage");
  mkdirSync(join(cwd, ".pi"));
  writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ sessionDir: ".pi/sessions" }));
  const request = await start(t);
  await request("/cwd/validate", { cwd });
  const created = await request("/agent/new", { cwd, type: "ensure_session", toolNames: [] });
  assert.equal(created.status, 200);
  const id = created.body.sessionId;
  t.after(() => getRpcSession(id)?.shutdown());
  const runtime = getRpcSession(id);
  assert.equal(dirname(runtime.sessionFile), join(cwd, ".pi", "sessions"));
  // Force persistence without needing a paid provider.
  writeFileSync(runtime.sessionFile, [runtime.inner.sessionManager.getHeader()].map(JSON.stringify).join("\n") + "\n");
  const file = runtime.sessionFile;
  await runtime.shutdown();
  writeFileSync(join(cwd, ".pi", "settings.json"), "{}\n");
  globalThis.__piSessionPathCache = undefined; globalThis.__piPathToSessionIdCache = undefined;
  const reopened = await request(`/agent/${id}`, { type: "set_session_name", name: "continued", cwd });
  assert.equal(reopened.status, 200);
  assert.equal(getRpcSession(id).sessionFile, file);
  assert.ok(readFileSync(file, "utf8").includes("continued"));
  assert.throws(() => acquireSessionLock(file, join(process.env.PI_CODING_AGENT_DIR, "locks", "sessions"), "other"), (error) => error.code === "session_locked");
  const next = await request("/agent/new", { cwd, type: "ensure_session", toolNames: [] });
  t.after(() => getRpcSession(next.body.sessionId)?.shutdown());
  assert.notEqual(dirname(getRpcSession(next.body.sessionId).sessionFile), join(cwd, ".pi", "sessions"));
});

test("LIST and commands reject a duplicate even when the original runtime is alive", async (t) => {
  const cwd = project("live collision");
  const request = await start(t);
  await request("/cwd/validate", { cwd });
  const created = await request("/agent/new", { cwd, type: "ensure_session", toolNames: [] });
  const id = created.body.sessionId;
  t.after(() => getRpcSession(id)?.shutdown());
  const original = getRpcSession(id);
  writeFileSync(original.sessionFile, JSON.stringify(original.inner.sessionManager.getHeader()) + "\n");
  fixture(cwd, id);
  const listing = await request(`/sessions?${hint(cwd)}&force=1`);
  assert.equal(listing.status, 409); assert.equal(listing.body.error.code, "session_id_conflict");
  assert.equal((await request(`/agent/${id}`, { cwd, type: "get_state" })).status, 409);
});

test("LIST rejects a global file colliding with a live runtime outside selected project", async (t) => {
  const a = project("live A"), b = project("live B");
  mkdirSync(join(a, ".pi"));
  writeFileSync(join(a, ".pi", "settings.json"), JSON.stringify({ sessionDir: ".pi/sessions" }));
  const request = await start(t);
  await request("/cwd/validate", { cwd: a }); await request("/cwd/validate", { cwd: b });
  const created = await request("/agent/new", { cwd: a, type: "ensure_session", toolNames: [] });
  const id = created.body.sessionId;
  t.after(() => getRpcSession(id)?.shutdown());
  const global = SessionManager.create(b); const file = global.getSessionFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ ...global.getHeader(), id }) + "\n");
  const listing = await request(`/sessions?${hint(b)}&force=1`);
  assert.equal(listing.status, 409); assert.equal(listing.body.error.code, "session_id_conflict");
});

test("a live project runtime cannot bypass a replaced session file header", async (t) => {
  const cwd = project("replaced-live-file"); mkdirSync(join(cwd, ".pi"));
  writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ sessionDir: ".pi/sessions" }));
  const request = await start(t); await request("/cwd/validate", { cwd });
  const created = await request("/agent/new", { cwd, type: "ensure_session", toolNames: [] });
  const id = created.body.sessionId; t.after(() => getRpcSession(id)?.shutdown());
  const runtime = getRpcSession(id);
  writeFileSync(runtime.sessionFile, JSON.stringify({ ...runtime.inner.sessionManager.getHeader(), id: "replaced-id" }) + "\n");
  const result = await request(`/agent/${id}`, { cwd, type: "set_session_name", name: "must not write" });
  assert.equal(result.status, 409);
  assert.equal(result.body.error.code, "session_id_conflict");
  assert.equal(readFileSync(runtime.sessionFile, "utf8").includes("must not write"), false);
});

test("deduplicated command responses do not bypass a newly introduced ID conflict", async (t) => {
  const cwd = project("dedup collision"), saved = fixture(cwd);
  const runtime = { send: async () => ({}) };
  const agent = { open: async () => runtime, send: async () => ({ found: true, data: {} }), running: () => ({ runningSessionIds: [], completionNotificationSuppressedSessionIds: [] }) };
  const app = createAgentServer({ token, version: { protocolVersion: 1 }, agent });
  await app.listen("127.0.0.1", 0); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.address().port}/internal/v1/api`;
  await fetch(`${base}/cwd/validate`, { method: "POST", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify({ cwd }) });
  const command = () => fetch(`${base}/agent/${saved.id}`, { method: "POST", headers: { authorization, "content-type": "application/json", "x-request-id": "replayed-command" }, body: JSON.stringify({ cwd, type: "get_state" }) });
  assert.equal((await command()).status, 200);
  const global = SessionManager.create(cwd); mkdirSync(dirname(global.getSessionFile()), { recursive: true });
  writeFileSync(global.getSessionFile(), JSON.stringify({ ...global.getHeader(), id: saved.id }) + "\n");
  const result = await command(); assert.equal(result.status, 409); assert.equal((await result.json()).error.code, "session_id_conflict");
});

test("project session delete does not read an out-of-scope parent header", async (t) => {
  const cwd = project("parent-boundary"); const saved = fixture(cwd);
  const parent = join(root, "outside-parent.jsonl");
  writeFileSync(parent, "not a session\n");
  const lines = readFileSync(saved.file, "utf8").split("\n");
  lines[0] = JSON.stringify({ ...JSON.parse(lines[0]), parentSession: parent });
  writeFileSync(saved.file, lines.join("\n"));
  const request = await start(t); await request("/cwd/validate", { cwd });
  // A symlink parent must not be followed or opened, even for reparent metadata.
  const { unlinkSync, symlinkSync } = await import("node:fs");
  unlinkSync(parent); symlinkSync("/dev/zero", parent);
  const result = await request(`/sessions/${saved.id}?${hint(cwd)}`, undefined, "DELETE");
  assert.equal(result.status, 200);
});

test.after(() => rmSync(root, { recursive: true, force: true }));
