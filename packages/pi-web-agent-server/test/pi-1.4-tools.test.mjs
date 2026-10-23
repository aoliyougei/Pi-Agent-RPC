import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = mkdtempSync(join(tmpdir(), "pi140-tools-"));
const agentDir = join(root, "agent");
process.env.PI_CODING_AGENT_DIR = agentDir;
mkdirSync(join(agentDir, "extensions"), { recursive: true });
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultTools: ["read", "bash", "edit", "write"] }));
writeFileSync(join(agentDir, "extensions", "tools.ts"), `
export default function (pi) {
  for (const [name, defaultActive] of [["removed_tool", true], ["new_tool", true], ["inactive_tool", false]]) {
    pi.registerTool({ name, label: name, description: name, parameters: { type: "object", properties: {} }, defaultActive,
      execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }) });
  }
}
`);
const { SessionManager } = await import("@earendil-works/pi-coding-agent");
const { startRpcSession } = await import("../dist/runtime/session-runtime.js");
const { appendSessionToolSelection } = await import("../dist/dependencies/session-tool-selection.js");
const active = async (session) => (await session.send({ type: "get_tools" })).filter((tool) => tool.active).map((tool) => tool.name);

function fixture(selection) {
  const manager = SessionManager.create(root);
  if (selection !== undefined) appendSessionToolSelection(manager, selection);
  const refs = (names) => names.map((name) => ({ name, description: name, parameters: { type: "object", properties: {} } }));
  manager.appendMessage({ role: "system", content: "", toolsAdded: refs(["read", "removed_tool"]), timestamp: Date.now() });
  manager.appendMessage({ role: "system", content: "", toolsRemoved: refs(["removed_tool"]), timestamp: Date.now() });
  manager.appendMessage({ role: "user", content: "seed", timestamp: Date.now() });
  // Persist before opening through the actual RPC startup boundary.
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "seed" }], api: "test", provider: "test", model: "test", stopReason: "stop", timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  return manager;
}

test("cold resume retains recorded extension removals and default-inactive tools", async () => {
  for (const selection of [undefined, ["read"]]) {
    const manager = fixture(selection);
    const { session } = await startRpcSession(manager.getSessionId(), manager.getSessionFile());
    try {
      const names = await active(session);
      assert.ok(names.includes("read"));
      assert.ok(names.includes("new_tool"));
      assert.equal(names.includes("removed_tool"), false);
      assert.equal(names.includes("inactive_tool"), false);
      assert.equal(names.includes("bash"), false);
    } finally { await session.shutdown(); }
  }
});

test("new explicit builtin selection preserves SDK extension activation defaults", async () => {
  const { session } = await startRpcSession("__new__explicit", "", root, { toolNames: ["read"] });
  try {
    const names = await active(session);
    assert.ok(names.includes("read")); assert.ok(names.includes("new_tool"));
    assert.equal(names.includes("inactive_tool"), false); assert.equal(names.includes("bash"), false);
  } finally { await session.shutdown(); }
});

test("persisted Chat only wins over browser startup preference", async () => {
  const manager = fixture([]);
  const { session } = await startRpcSession(manager.getSessionId(), manager.getSessionFile(), undefined, { toolNames: ["read"] });
  try { assert.deepEqual(await active(session), []); }
  finally { await session.shutdown(); }
});

test.after(() => rmSync(root, { recursive: true, force: true }));
