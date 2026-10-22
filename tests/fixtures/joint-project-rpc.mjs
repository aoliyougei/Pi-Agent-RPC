// Disposable loopback-only harness, never install as a production endpoint.
import assert from "node:assert/strict";
import { fork, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const root = mkdtempSync("/tmp/joint-project-");
const agentDir = join(root, "agent"), a = join(root, "A"), b = join(root, "B");
process.env.PI_CODING_AGENT_DIR = agentDir;
for (const path of [join(agentDir, "extensions"), a, b]) mkdirSync(path, { recursive: true });
cpSync(new URL("./phase2-acceptance-extension.ts", import.meta.url), join(agentDir, "extensions", "echo.ts"));
const settingsFile = join(agentDir, "settings.json"), tokenFile = join(root, "token");
const token = randomBytes(32).toString("hex");
writeFileSync(tokenFile, token, { mode: 0o400 }); chmodSync(tokenFile, 0o400);
function settings(project) {
  writeFileSync(settingsFile, JSON.stringify({ ...(project ? { sessionDir: ".pi/sessions" } : {}), defaultProvider: "phase2", defaultModel: "echo", compaction: { enabled: false } }));
}
settings(true);
const { SessionManager } = await import("/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js");
function persist(cwd, directory, text) {
  const manager = SessionManager.create(cwd, directory);
  manager.appendMessage({ role: "user", content: text, timestamp: Date.now() });
  manager.appendMessage({ role: "assistant", api: "phase2-test", provider: "phase2", model: "echo", content: [{ type: "text", text: `seed:${text}` }], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() });
  return { id: manager.getSessionId(), file: manager.getSessionFile() };
}
const localA = persist(a, join(a, ".pi", "sessions"), "local-A");
const localB = persist(b, join(b, ".pi", "sessions"), "local-B");
const globalA = persist(a, undefined, "global-A");
const mediaEntry = SessionManager.open(localA.file).appendMessage({ role: "toolResult", toolName: "read", toolCallId: "media", content: [{ type: "image", data: "YWJj", mimeType: "image/png" }], timestamp: Date.now() });
const trace = [];
let child;
async function stop() {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
  }
}
async function start() {
  child = fork("/usr/local/lib/node_modules/@aoliyougei/pi-web-agent-server/dist/main.js", { env: { ...process.env, HOME: root, PI_AGENT_RPC_TOKEN_FILE: tokenFile, PI_AGENT_RPC_HOST: "127.0.0.1", PI_AGENT_RPC_PORT: "8080" }, stdio: ["ignore", "ignore", "inherit", "ipc"] });
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("RPC exited");
    try { if ((await fetch("http://127.0.0.1:8080/internal/v1/health/live")).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("RPC startup timeout");
}
const control = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://fixture");
    let result;
    if (url.pathname === "/fixture") result = { root, a, b, localA, localB, globalA, mediaEntry };
    else if (url.pathname === "/trace") result = trace;
    else if (url.pathname === "/restart" && req.method === "POST") { await stop(); await start(); result = { ok: true }; }
    else if (url.pathname === "/settings" && req.method === "POST") { settings(url.searchParams.get("project") === "1"); result = { ok: true }; }
    else if (url.pathname === "/snapshot") {
      const id = url.searchParams.get("id");
      const list = [...await SessionManager.list(a, join(a, ".pi", "sessions")), ...await SessionManager.list(b, join(b, ".pi", "sessions")), ...await SessionManager.listAll()];
      const item = list.find((session) => session.id === id);
      result = item ? { file: item.path, content: readFileSync(item.path, "utf8") } : null;
    } else if (url.pathname === "/duplicate" && req.method === "POST") {
      const id = url.searchParams.get("id"); assert.match(id, /^[A-Za-z0-9-]+$/);
      const manager = SessionManager.create(a); const file = manager.getSessionFile();
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ ...manager.getHeader(), id }) + "\n"); result = { ok: true };
    } else if (url.pathname === "/worktree" && req.method === "POST") {
      const repo = join(root, "repo"), linked = join(root, "linked");
      const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
      git("init", "-q", "-b", "main", repo); git("-C", repo, "config", "user.email", "joint@example.invalid"); git("-C", repo, "config", "user.name", "Joint Test");
      writeFileSync(join(repo, "file"), "fixture\n"); git("-C", repo, "add", "file"); git("-C", repo, "commit", "-qm", "fixture"); git("-C", repo, "worktree", "add", "-b", "test", linked);
      const saved = persist(linked, join(linked, ".pi", "sessions"), "locked-local");
      const { acquireSessionLock } = await import("/usr/local/lib/node_modules/@aoliyougei/pi-web-agent-server/dist/runtime/session-lock.js");
      globalThis.jointLease = acquireSessionLock(saved.file, join(agentDir, "locks", "sessions"), "joint-cli");
      result = { repo, linked, saved };
    } else { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(result));
  } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); }
});
const relay = createServer(async (req, res) => {
  const abort = new AbortController();
  res.once("close", () => { if (!res.writableEnded) abort.abort(); });
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    let json; try { json = JSON.parse(body.toString()); } catch {}
    // No auth or prompt content recorded; trace only fields needed for contract review.
    trace.push({ method: req.method, url: req.url, keys: json ? Object.keys(json) : [], cwd: json?.cwd, type: json?.type, cursor: req.headers["last-event-id"] ?? null });
    const headers = new Headers({ authorization: `Bearer ${token}` });
    for (const name of ["content-type", "accept", "last-event-id", "x-request-id", "range"]) if (req.headers[name]) headers.set(name, req.headers[name]);
    const upstream = await fetch(`http://127.0.0.1:8080${req.url}`, { method: req.method, headers, signal: abort.signal, ...(body.length ? { body } : {}) });
    const outgoing = new Headers(upstream.headers);
    for (const name of ["transfer-encoding", "connection", "content-encoding", "content-length"]) outgoing.delete(name);
    res.writeHead(upstream.status, Object.fromEntries(outgoing));
    if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), res); else res.end();
  } catch { if (!res.headersSent) res.writeHead(502); res.end(); }
});
await start();
control.listen(8089, "127.0.0.1"); relay.listen(8081, "127.0.0.1");
console.log("READY joint deterministic RPC fixture (loopback only, credentials not logged)");
