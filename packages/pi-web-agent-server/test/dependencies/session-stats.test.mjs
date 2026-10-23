import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { computeSessionStats, mergeSessionStats } = await jiti.import("../../src/dependencies/session-stats.ts");
const { normalizeToolCalls } = await jiti.import("../../src/dependencies/normalize.ts");

test("billed totals override estimated component sums without requiring a provider-origin flag", () => {
  for (const flag of [undefined, false, true]) {
    const usage = { input: 10, output: 2, cacheRead: 3, cacheWrite: 1, cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 0.125, ...(flag === undefined ? {} : { totalFromProvider: flag }) } };
    const message = { role: "assistant", content: [{ type: "text", text: "ok" }], model: "test", provider: "test", usage };
    assert.deepEqual(normalizeToolCalls(message).usage, usage);
    const stats = computeSessionStats([{ type: "message", message }, { type: "compaction", usage }, { type: "branch_summary", usage }]);
    assert.equal(stats.cost, 0.375);
    const merged = mergeSessionStats(stats, [message], [message, message]);
    assert.equal(merged.cost, 0.5);
  }
});
