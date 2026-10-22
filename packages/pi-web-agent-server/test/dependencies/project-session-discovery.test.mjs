import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const reader = await jiti.import("../../src/dependencies/session-reader.ts");
const { allowFileRoot, getAdditionalAllowedRoots } = await jiti.import("../../src/dependencies/allowed-roots.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-project-discovery-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(root, "agent");
  const a = join(root, "项目 A"), b = join(root, "B");
  for (const cwd of [a, b]) { mkdirSync(cwd); allowFileRoot(cwd); }
  reader.invalidateSessionListCache();
  globalThis.__piSessionPathCache = undefined;
  globalThis.__piPathToSessionIdCache = undefined;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    reader.invalidateSessionListCache();
    globalThis.__piSessionPathCache = undefined;
    globalThis.__piPathToSessionIdCache = undefined;
    getAdditionalAllowedRoots().delete(a); getAdditionalAllowedRoots().delete(b);
    globalThis.__piAllowedRootsCache = undefined;
    rmSync(root, { recursive: true, force: true });
  });
  return { root, a, b };
}

function fixture(cwd, local = true, id) {
  const manager = SessionManager.create(cwd, local ? join(cwd, ".pi", "sessions") : undefined);
  manager.appendMessage({ role: "user", content: "question", timestamp: 1000 });
  const file = manager.getSessionFile();
  const header = { ...manager.getHeader(), ...(id ? { id } : {}) };
  writeFileSync(file, [header, ...manager.getEntries()].map(JSON.stringify).join("\n") + "\n");
  return { id: header.id, file };
}

// Removing selected-cwd discovery must fail these assertions even without settings.json.
test("selected project discovery unions globals and isolates A/B without settings", async (t) => {
  const { a, b } = setup(t);
  const global = fixture(a, false), localA = fixture(a), localB = fixture(b);
  const ids = (sessions) => sessions.map((item) => item.id).sort();
  assert.deepEqual(ids(await reader.listAllSessions({ cwd: a, force: true })), [global.id, localA.id].sort());
  assert.deepEqual(ids(await reader.listAllSessions({ cwd: b })), [global.id, localB.id].sort());
  assert.deepEqual(ids(await reader.listAllSessions()), [global.id]);
  const later = fixture(a);
  assert.ok(ids(await reader.listAllSessions({ cwd: a, force: true })).includes(later.id));
  mkdirSync(join(a, ".pi"), { recursive: true });
  writeFileSync(join(a, ".pi", "settings.json"), JSON.stringify({ sessionDir: "elsewhere" }));
  assert.ok(ids(await reader.listAllSessions({ cwd: a })).includes(localA.id));
});

test("project cold lookup verifies scope even with primed path caches", async (t) => {
  const { a, b } = setup(t);
  const local = fixture(a);
  assert.equal(await reader.resolveSessionPath(local.id, a), local.file);
  assert.equal(await reader.resolveSessionPath(local.id, b), null);
  assert.equal(await reader.resolveSessionPath(local.id), null);
  globalThis.__piSessionPathCache = undefined;
  globalThis.__piPathToSessionIdCache = undefined;
  assert.equal(await reader.resolveSessionIdByPath(local.file, a), local.id);
  assert.equal(await reader.resolveSessionIdByPath(local.file, b), undefined);
  unlinkSync(local.file);
  assert.equal(await reader.resolveSessionPath(local.id, a), null);
});

test("missing project storage does not create directories or recurse", async (t) => {
  const { a } = setup(t);
  const nested = join(a, "nested"); mkdirSync(nested);
  fixture(nested);
  assert.deepEqual(await reader.listAllSessions({ cwd: a, force: true }), []);
  assert.equal(existsSync(join(a, ".pi")), false);
});

test("project scope rejects invalid, unselected and symlink escaping storage", async (t) => {
  const { root, a, b } = setup(t);
  await assert.rejects(reader.listAllSessions({ cwd: "relative" }), (error) => error.status === 400);
  const unselected = join(root, "unselected"); mkdirSync(unselected);
  await assert.rejects(reader.listAllSessions({ cwd: unselected }), (error) => error.status === 403);
  fixture(b);
  mkdirSync(join(a, ".pi"));
  symlinkSync(join(b, ".pi", "sessions"), join(a, ".pi", "sessions"));
  await assert.rejects(reader.listAllSessions({ cwd: a }), (error) => error.status === 403);
});

test("inaccessible project storage fails instead of returning an empty success", { skip: process.getuid?.() === 0 }, async (t) => {
  const { a } = setup(t);
  fixture(a);
  const directory = join(a, ".pi", "sessions");
  chmodSync(directory, 0);
  try { await assert.rejects(reader.listAllSessions({ cwd: a }), (error) => error.code === "EACCES"); }
  finally { chmodSync(directory, 0o700); }
});

test("a symlink working directory resolves without authorizing an escaping session directory", async (t) => {
  const { root, a } = setup(t);
  const alias = join(root, "alias"); symlinkSync(a, alias, "dir");
  const saved = fixture(a);
  assert.equal(await reader.resolveSessionPath(saved.id, alias), saved.file);
});

test("missing storage beneath an escaping .pi link is rejected, not treated as absent", async (t) => {
  const { a, b } = setup(t);
  symlinkSync(b, join(a, ".pi"), "dir");
  await assert.rejects(reader.listAllSessions({ cwd: a }), (error) => error.status === 403);
});

test("duplicate headers reject lookup and list rather than selecting a cached winner", async (t) => {
  const { a } = setup(t);
  const global = fixture(a, false), local = fixture(a, true, global.id);
  reader.cacheSessionPath(global.id, global.file);
  await assert.rejects(reader.resolveSessionPath(global.id, a), (error) => error.code === "session_id_conflict" && error.status === 409);
  await assert.rejects(reader.listAllSessions({ cwd: a, force: true }), (error) => error.code === "session_id_conflict");
  assert.ok(readFileSync(local.file, "utf8").includes(global.id));
});

test("project discovery ignores malformed files, mismatched cwd and file symlinks", async (t) => {
  const { a, b } = setup(t);
  const valid = fixture(a), other = fixture(b);
  const dir = dirname(valid.file);
  writeFileSync(join(dir, "malformed.jsonl"), "{bad}\n");
  writeFileSync(join(dir, "invalid-date.jsonl"), JSON.stringify({ type: "session", id: "bad-date", cwd: a, timestamp: "invalid" }) + "\n");
  writeFileSync(valid.file, readFileSync(valid.file, "utf8") + 'null\n42\n{"type":"message","message":{"role":"user","content":[null]}}\n');
  writeFileSync(join(dir, "mismatched.jsonl"), readFileSync(other.file));
  symlinkSync(other.file, join(dir, "escape.jsonl"));
  mkdirSync(join(dir, "directory.jsonl"));
  assert.deepEqual((await reader.listAllSessions({ cwd: a, force: true })).map((item) => item.id), [valid.id]);
  assert.equal(await reader.resolveSessionPath(other.id, a), null);
});
