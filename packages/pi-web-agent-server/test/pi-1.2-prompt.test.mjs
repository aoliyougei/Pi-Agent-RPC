import assert from "node:assert/strict";
import test from "node:test";
import { Agent } from "@earendil-works/pi-agent-core";
import { SessionRuntime } from "../dist/runtime/session-runtime.js";

test("exact prompts use Pi 1.2 system messages and survive request projection", async () => {
  const agent = new Agent({ initialState: { systemPrompt: "SDK default" }, streamFn: () => { throw new Error("unused"); } });
  const inner = { agent, sessionId: "exact", extensionRunner: {}, dispose() {} };
  const runtime = new SessionRuntime(inner, { exactSystemPrompt: () => "only project context" });
  assert.equal(agent.state.systemPrompt, "only project context");
  const projected = await agent.transformContext([
    { role: "system", content: "rebuilt SDK prompt", timestamp: 0 },
    { role: "user", content: "hello", timestamp: 1 },
  ]);
  assert.equal(projected[0].content, "only project context");
  assert.equal(projected.filter((message) => message.role === "system").length, 1);
  assert.equal(projected[1].content, "hello");
  runtime.destroy();
});
