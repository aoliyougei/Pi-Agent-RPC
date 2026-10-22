import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "rpc-release-"));
const tokenFile = join(root, "token");
const token = randomBytes(32).toString("hex");
const env = { ...process.env, HOME: root, PI_CODING_AGENT_DIR: join(root, "agent"), PI_AGENT_RPC_TOKEN_FILE: tokenFile, PI_AGENT_RPC_PORT: "18089", PI_AGENT_RPC_HOST: "127.0.0.1" };
const base = "http://127.0.0.1:18089";
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
let child;
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, "exit");
  child.kill("SIGTERM");
  await Promise.race([exit, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("Graceful shutdown timed out")), 10000); timer.unref(); })]);
  assert.equal(child.exitCode, 0);
}
async function start() {
  child = spawn("pi-agent-rpc", [], { env, stdio: ["ignore", "pipe", "pipe"] });
  let error = "";
  child.stderr.on("data", (chunk) => { error += chunk; });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/internal/v1/health/live`)).ok) return; } catch {}
    if (child.exitCode !== null) throw new Error(`Server exited: ${error}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server startup timed out: ${error}`);
}
try {
  assert.equal(spawnSync("pi", ["--version"], { env, encoding: "utf8" }).stdout.trim(), "1.2.0");
  let rejected = spawnSync("pi-agent-rpc", [], { env, encoding: "utf8", timeout: 10000 });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /Invalid RPC token file/);
  writeFileSync(tokenFile, token, { mode: 0o644 });
  rejected = spawnSync("pi-agent-rpc", [], { env, encoding: "utf8", timeout: 10000 });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /Invalid RPC token file/);
  rmSync(tokenFile);
  writeFileSync(tokenFile, token, { mode: 0o400 });
  await start();
  assert.equal((await fetch(`${base}/internal/v1/health/ready`)).status, 401);
  assert.equal((await fetch(`${base}/internal/v1/version`, { headers: { authorization: "Bearer wrong" } })).status, 401);
  assert.equal((await fetch(`${base}/internal/v1/health/ready`, { headers })).status, 200);
  const version = await (await fetch(`${base}/internal/v1/version`, { headers })).json();
  assert.equal(version.serverVersion, "0.3.0");
  assert.equal(version.piVersion, "1.2.0");
  assert.equal(version.protocolVersion, 1);
  assert.equal(version.piRevision, "06a466935536f8c9bcacb2d5efc0fc021be1bdff");
  assert.equal(spawnSync("pi-agent-rpc-healthcheck", [], { env }).status, 0);
  const created = await fetch(`${base}/internal/v1/api/agent/new`, { method: "POST", headers, body: JSON.stringify({ cwd: root, type: "ensure_session" }) });
  assert.equal(created.status, 200);
  const { sessionId } = await created.json();
  const command = async (body) => {
    const response = await fetch(`${base}/internal/v1/api/agent/${sessionId}`, { method: "POST", headers, body: JSON.stringify(body) });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    return response.json();
  };
  assert.equal((await command({ type: "bash", command: "printf persisted" })).data.output, "persisted");
  const state = (await command({ type: "get_state" })).data;
  assert.match(readFileSync(state.sessionFile, "utf8"), /persisted/);
  await stop();
  await start();
  const reopened = await fetch(`${base}/internal/v1/api/agent/${sessionId}`, { headers });
  assert.equal(reopened.status, 200);
  assert.equal((await reopened.json()).state.sessionFile, state.sessionFile);
  assert.match(readFileSync(state.sessionFile, "utf8"), /persisted/);
  await stop();
  console.log("PASS release smoke: Pi/server versions, Secret enforcement, unauthorized/ready/live, configured healthcheck port, bash persistence, restart and graceful shutdown");
} finally {
  if (child && child.exitCode === null && child.signalCode === null) { const exit = once(child, "exit"); child.kill("SIGKILL"); await exit; }
  rmSync(root, { recursive: true, force: true });
}
