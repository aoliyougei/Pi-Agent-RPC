import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "image-lock-"));
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
process.env.HOME = dir;
const { SessionManager } = await import("/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js");
const { acquireSessionLock } = await import("/usr/local/lib/node_modules/@aoliyougei/pi-web-agent-server/dist/runtime/session-lock.js");
const children = [];
async function stop(child, signal = "SIGKILL") {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const done = once(child, "exit"); child.kill(signal); await done;
}
function session() {
  const manager = SessionManager.create(dir);
  writeFileSync(manager.getSessionFile(), JSON.stringify(manager.getHeader()) + "\n");
  return manager;
}
try {
  assert.equal(spawnSync("pi", ["--version"], { encoding: "utf8" }).stdout.trim(), "0.84.4");
  const token = randomBytes(32).toString("hex"), secret = join(dir, "token");
  writeFileSync(secret, token, { mode: 0o400 });
  const server = spawn("pi-agent-rpc", [], { env: { ...process.env, PI_AGENT_RPC_TOKEN_FILE: secret, PI_AGENT_RPC_PORT: "18088", PI_AGENT_RPC_HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"] });
  children.push(server);
  let errors = ""; server.stderr.on("data", (chunk) => { errors += chunk; });
  for (let i = 0; ; i++) {
    try { if ((await fetch("http://127.0.0.1:18088/internal/v1/health/live")).ok) break; } catch {}
    if (i > 100 || server.exitCode !== null) throw new Error(`Server did not start: ${errors}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const headers = { authorization: `Bearer ${token}` };
  const first = session();
  const opened = await fetch(`http://127.0.0.1:18088/internal/v1/api/agent/${first.getSessionId()}`, { headers });
  assert.equal(opened.status, 200);
  const refused = spawnSync("pi", ["--mode", "rpc", "--no-extensions", "--session", first.getSessionFile()], { encoding: "utf8", timeout: 10000 });
  assert.equal(refused.error, undefined);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr + refused.stdout, /Session is already owned/);
  const second = session();
  const cli = spawn("pi", ["--mode", "rpc", "--no-extensions", "--session", second.getSessionFile()], { stdio: ["pipe", "pipe", "pipe"] });
  children.push(cli);
  let text = "", cliErrors = "";
  cli.stderr.on("data", (chunk) => { cliErrors += chunk; });
  await new Promise((resolve, reject) => {
    cli.once("exit", () => reject(new Error(cliErrors)));
    cli.stdout.on("data", (chunk) => { text += chunk; if (text.includes('"command":"get_state"')) resolve(); });
    cli.stdin.write('{"type":"get_state"}\n');
  });
  const conflict = await fetch(`http://127.0.0.1:18088/internal/v1/api/agent/${second.getSessionId()}`, { headers });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, "session_locked");
  assert.ok((await SessionManager.list(dir)).length >= 2, "read-only listing while both processes own sessions");
  await stop(cli);
  acquireSessionLock(second.getSessionFile(), join(process.env.PI_CODING_AGENT_DIR, "locks/sessions"), "check").release();
  await stop(server, "SIGTERM");
  acquireSessionLock(first.getSessionFile(), join(process.env.PI_CODING_AGENT_DIR, "locks/sessions"), "check").release();
  console.log("PASS: installed pi wrapper / Agent Server bidirectional locks, independent sessions, listing, SIGKILL and SIGTERM release");
} finally {
  for (const child of children) await stop(child);
  rmSync(dir, { recursive: true, force: true });
}
