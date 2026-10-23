import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  normalizeStreamingToolCalls,
  normalizeToolCalls,
} = await jiti.import("../../src/dependencies/normalize.ts");

function assistant(block) {
  return {
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [block],
  };
}

test("keeps SDK scratch input only for an in-flight snapshot", () => {
  const message = assistant({
    type: "toolCall",
    id: "call-1",
    name: "write",
    arguments: { path: "/tmp/file" },
    partialJson: '{"path":"/tmp/file","content":"hel',
  });

  assert.deepEqual(normalizeStreamingToolCalls(message).content[0], {
    type: "toolCall",
    toolCallId: "call-1",
    toolName: "write",
    input: { path: "/tmp/file" },
    rawInput: '{"path":"/tmp/file","content":"hel',
  });
  assert.deepEqual(normalizeToolCalls(message).content[0], {
    type: "toolCall",
    toolCallId: "call-1",
    toolName: "write",
    input: { path: "/tmp/file" },
  });
});

test("preserves malformed tool argument diagnostics in completed and streaming messages", () => {
  for (const argumentsValue of [{}, null, "bad", []]) {
    const message = assistant({ type: "toolCall", id: "bad-call", name: "write", arguments: argumentsValue, argumentsError: 'Invalid JSON: {"path":' });
    for (const normalize of [normalizeToolCalls, normalizeStreamingToolCalls]) {
      const block = normalize(message).content[0];
      assert.deepEqual(block.input, {});
      assert.equal(block.argumentsError, 'Invalid JSON: {"path":');
    }
  }
});

test("removes a client raw buffer when normalizing a completed message", () => {
  const message = assistant({
    type: "toolCall",
    toolCallId: "call-2",
    toolName: "write",
    input: { path: "/tmp/file", content: "complete" },
    rawInput: "temporary",
  });

  assert.equal(Object.hasOwn(normalizeToolCalls(message).content[0], "rawInput"), false);
});
