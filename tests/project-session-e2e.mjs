import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "pi-installed-project-"));
const agentDir = join(root, "agent"), cwd = join(root, "project A"), b = join(root, "project B");
process.env.PI_CODING_AGENT_DIR = agentDir;
mkdirSync(join(agentDir, "extensions"), { recursive: true }); mkdirSync(cwd); mkdirSync(b);
cpSync(new URL("./fixtures/phase2-acceptance-extension.ts", import.meta.url), join(agentDir, "extensions", "echo.ts"));
const settings = join(agentDir, "settings.json"), tokenPath = join(root, "token");
writeFileSync(tokenPath, "installed-project-test\n"); chmodSync(tokenPath, 0o400);
writeFileSync(settings, JSON.stringify({ sessionDir: ".pi/sessions", compaction: { enabled: false } }));
let child, base, logs = "";
const headers = { authorization: "Bearer installed-project-test" };
const stop = async () => { if (child && child.exitCode === null) { const exited = once(child, "exit"); child.kill("SIGKILL"); await exited; } };
async function start() {
  child = fork("/usr/local/lib/node_modules/@aoliyougei/pi-web-agent-server/dist/main.js", {
    env: { ...process.env, HOME: root, PI_CODING_AGENT_DIR: agentDir, PI_AGENT_RPC_TOKEN_FILE: tokenPath, PI_AGENT_RPC_HOST: "127.0.0.1", PI_AGENT_RPC_PORT: "18743" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  child.stdout.on("data", (data) => { logs += data; }); child.stderr.on("data", (data) => { logs += data; });
  base = "http://127.0.0.1:18743";
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null) throw new Error(logs);
    try { if ((await fetch(`${base}/internal/v1/health/live`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Startup timeout: ${logs}`);
}
async function request(path, body, init = {}) {
  return fetch(base + path, { ...init, method: init.method ?? (body ? "POST" : "GET"), headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}), ...init.headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
const api = "/internal/v1/api";
const query = `cwd=${encodeURIComponent(cwd)}`;
async function command(id, value) {
  const response = await request(`${api}/agent/${id}`, { cwd, ...value });
  const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body.data;
}
async function idle(id) {
  for (let i = 0; i < 200; i++) {
    if (!(await command(id, { type: "get_state" })).isPromptRunning) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Prompt did not settle");
}
try {
  await start();
  const version = await (await request("/internal/v1/version")).json();
  assert.ok(version.capabilities.includes("project-session-discovery"));
  console.log("VERSION", JSON.stringify(version));
  const invalid = await request(`${api}/sessions?cwd=relative`); assert.equal(invalid.status, 400);
  console.log("INVALID_CWD", invalid.status, JSON.stringify(await invalid.json()));
  await request(`${api}/cwd/validate`, { cwd });
  const missing = await request(`${api}/sessions/missing?${query}`); assert.equal(missing.status, 404);
  console.log("MISSING_SESSION", missing.status, JSON.stringify(await missing.json()));
  const created = await (await request(`${api}/agent/new`, { cwd, type: "ensure_session", provider: "phase2", modelId: "echo" })).json();
  const id = created.sessionId; assert.ok(id);
  await command(id, { type: "prompt", message: "before restart" }); await idle(id);
  const file = (await command(id, { type: "get_state" })).sessionFile;
  assert.equal(dirname(file), join(cwd, ".pi", "sessions"));
  await stop();
  writeFileSync(settings, JSON.stringify({ compaction: { enabled: false } }));
  // Add a deferred image fixture without needing an external image/tool service.
  const { SessionManager } = await import("/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js");
  SessionManager.open(file).appendMessage({ role: "toolResult", toolName: "read", toolCallId: "image-call", content: [{ type: "image", data: "YWJj", mimeType: "image/png" }], timestamp: Date.now() });
  await start();
  assert.equal((await request(`${api}/sessions/${id}?${query}`)).status, 403);
  assert.equal((await request(`${api}/cwd/validate`, { cwd })).status, 200);
  const detailResponse = await request(`${api}/sessions/${id}?${query}&deferMedia=1`); assert.equal(detailResponse.status, 200);
  const detail = await detailResponse.json(); assert.equal(detail.filePath, file);
  const image = detail.context.messages.find((message) => message.role === "toolResult").content[0].source.url;
  assert.equal(new URL(image, base).searchParams.get("cwd"), cwd);
  const imageResponse = await request(image.replace("/api/", "/internal/v1/api/")); assert.equal(imageResponse.status, 200);
  assert.equal(await imageResponse.text(), "abc");
  const abort = new AbortController();
  const stream = await request(`${api}/agent/${id}/events?${query}`, undefined, { signal: abort.signal }); assert.equal(stream.status, 200);
  const reader = stream.body.getReader(); assert.match(new TextDecoder().decode((await reader.read()).value), /connected/);
  await command(id, { type: "prompt", message: "after restart" }); await idle(id);
  assert.equal((await command(id, { type: "get_state" })).sessionFile, file);
  assert.match(readFileSync(file, "utf8"), /echo:after restart/);
  abort.abort(); await reader.cancel().catch(() => {});
  const list = await (await request(`${api}/sessions?${query}&force=1`)).json(); assert.ok(list.sessions.some((session) => session.id === id));
  await request(`${api}/cwd/validate`, { cwd: b });
  // A remains a live runtime by design; stop it to isolate persisted discovery.
  await stop(); await start(); await request(`${api}/cwd/validate`, { cwd: b });
  const coldB = await (await request(`${api}/sessions?cwd=${encodeURIComponent(b)}&force=1`)).json();
  assert.equal(coldB.sessions.some((session) => session.id === id), false);
  await request(`${api}/cwd/validate`, { cwd });
  const next = await (await request(`${api}/agent/new`, { cwd, type: "ensure_session" })).json();
  const nextState = await command(next.sessionId, { type: "get_state" });
  assert.notEqual(dirname(nextState.sessionFile), join(cwd, ".pi", "sessions"));
  // A distinct global file with the same header ID must reject both cached and cold lookup.
  const global = SessionManager.create(cwd); mkdirSync(dirname(global.getSessionFile()), { recursive: true });
  writeFileSync(global.getSessionFile(), JSON.stringify({ ...global.getHeader(), id }) + "\n");
  const conflict = await request(`${api}/sessions/${id}?${query}`); assert.equal(conflict.status, 409);
  const conflictBody = await conflict.json(); assert.equal(conflictBody.error.code, "session_id_conflict");
  console.log("ID_CONFLICT", conflict.status, JSON.stringify(conflictBody));
  console.log("PASS installed project discovery: version/errors, settings storage, real restart without LIST, cold detail/SSE/prompt, original JSONL, deferred image, A/B isolation, global new-session fallback and ID conflict");
} finally { await stop(); rmSync(root, { recursive: true, force: true }); }
