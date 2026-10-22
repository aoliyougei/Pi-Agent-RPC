import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const root = mkdtempSync(join(tmpdir(), "pi-storage-settings-"));
const agentDir = join(root, "agent");
process.env.PI_CODING_AGENT_DIR = agentDir;
const { startRpcSession } = await import("../dist/runtime/session-runtime.js");
mkdirSync(agentDir);

async function create(cwd) {
  const { session } = await startRpcSession(`__new__${Math.random()}`, "", cwd, { toolNames: [] });
  const path = session.sessionFile;
  await session.shutdown();
  return path;
}

test("new storage resolves effective global/project settings relative to each creation cwd", async () => {
  const a = join(root, "A"), b = join(root, "B");
  mkdirSync(join(a, ".pi"), { recursive: true }); mkdirSync(b);
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ sessionDir: "history" }));
  assert.equal(dirname(await create(a)), join(a, "history"));
  assert.equal(dirname(await create(b)), join(b, "history"));
  writeFileSync(join(a, ".pi", "settings.json"), JSON.stringify({ sessionDir: "./.pi/sessions" }));
  assert.equal(dirname(await create(a)), join(a, ".pi", "sessions"));
  assert.equal(dirname(await create(b)), join(b, "history"));
  const absolute = join(root, "absolute-history");
  writeFileSync(join(a, ".pi", "settings.json"), JSON.stringify({ sessionDir: absolute }));
  assert.equal(dirname(await create(a)), absolute);
  writeFileSync(join(a, ".pi", "settings.json"), "{}\n");
  writeFileSync(join(agentDir, "settings.json"), "{}\n");
  assert.ok((await create(a)).startsWith(join(agentDir, "sessions") + "/"));
});

test.after(() => rmSync(root, { recursive: true, force: true }));
