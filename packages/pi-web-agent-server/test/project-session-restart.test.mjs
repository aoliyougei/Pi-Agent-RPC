import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

// Actual process restart must discard all discovery, path and authorization caches.
test("project history survives process restart and settings removal with cold SSE and prompt", { timeout: 30000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-project-restart-"));
  const agentDir = join(root, "agent"), cwd = join(root, "workspace");
  mkdirSync(join(agentDir, "extensions"), { recursive: true }); mkdirSync(cwd);
  cpSync(new URL("../../../tests/fixtures/phase2-acceptance-extension.ts", import.meta.url), join(agentDir, "extensions", "echo.ts"));
  const settingsFile = join(agentDir, "settings.json");
  writeFileSync(settingsFile, JSON.stringify({ sessionDir: ".pi/sessions", compaction: { enabled: false } }));
  let child;
  let logs = "";
  const stop = async () => { if (child && child.exitCode === null) { const exited = once(child, "exit"); child.kill("SIGKILL"); await exited; } };
  t.after(async () => { await stop(); rmSync(root, { recursive: true, force: true }); });
  async function start() {
    child = fork(new URL("./fixtures/project-session-server.mjs", import.meta.url), { env: { ...process.env, HOME: root, PI_CODING_AGENT_DIR: agentDir }, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    child.stdout.on("data", (data) => { logs += data; }); child.stderr.on("data", (data) => { logs += data; });
    const [ready] = await once(child, "message");
    const base = `http://127.0.0.1:${ready.port}`;
    return async (path, body, init = {}) => {
      const response = await fetch(base + path, { ...init, method: body ? "POST" : "GET", headers: { authorization: "Bearer project-process-test", ...(body ? { "content-type": "application/json" } : {}), ...init.headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return response;
    };
  }
  let request = await start();
  const api = "/internal/v1/api";
  assert.equal((await request(`${api}/cwd/validate`, { cwd })).status, 200);
  const version = await (await request("/internal/v1/version")).json();
  assert.ok(version.capabilities.includes("project-session-discovery"));
  const created = await (await request(`${api}/agent/new`, { cwd, type: "ensure_session", provider: "phase2", modelId: "echo" })).json();
  const id = created.sessionId; assert.ok(id, logs);
  const command = async (body) => {
    const response = await request(`${api}/agent/${id}`, { cwd, ...body });
    assert.equal(response.status, 200, `${await response.clone().text()}\n${logs}`);
    return (await response.json()).data;
  };
  await command({ type: "prompt", message: "before restart" });
  for (let i = 0; i < 100; i++) {
    if (!(await command({ type: "get_state" })).isPromptRunning) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const file = (await command({ type: "get_state" })).sessionFile;
  assert.equal(dirname(file), join(cwd, ".pi", "sessions"));
  assert.match(readFileSync(file, "utf8"), /echo:before restart/);
  await stop();
  writeFileSync(settingsFile, JSON.stringify({ compaction: { enabled: false } }));
  request = await start();
  const query = `cwd=${encodeURIComponent(cwd)}`;
  assert.equal((await request(`${api}/sessions/${id}?${query}`)).status, 403);
  assert.equal((await request(`${api}/cwd/validate`, { cwd })).status, 200);
  // No LIST request in this process before any of these cold opens.
  const detail = await request(`${api}/sessions/${id}?${query}`);
  assert.equal(detail.status, 200); assert.equal((await detail.json()).filePath, file);
  const abort = new AbortController();
  const events = await request(`${api}/agent/${id}/events?${query}`, undefined, { signal: abort.signal });
  assert.equal(events.status, 200);
  const reader = events.body.getReader();
  const first = await reader.read(); assert.match(new TextDecoder().decode(first.value), /connected/);
  await command({ type: "prompt", message: "after restart" });
  for (let i = 0; i < 100; i++) {
    if (!(await command({ type: "get_state" })).isPromptRunning) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.match(readFileSync(file, "utf8"), /echo:after restart/);
  assert.equal((await command({ type: "get_state" })).sessionFile, file);
  abort.abort(); await reader.cancel().catch(() => {});
  const listing = await (await request(`${api}/sessions?${query}&force=1`)).json();
  assert.ok(listing.sessions.some((item) => item.id === id));
  const next = await (await request(`${api}/agent/new`, { cwd, type: "ensure_session" })).json();
  const nextState = await (await request(`${api}/agent/${next.sessionId}?${query}`)).json();
  assert.notEqual(dirname(nextState.state.sessionFile), join(cwd, ".pi", "sessions"));
});
