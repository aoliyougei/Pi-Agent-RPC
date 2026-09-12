import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "pi-phase2-ui-"));
process.env.HOME = root;
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
mkdirSync(join(process.env.PI_CODING_AGENT_DIR, "extensions"), { recursive: true });
cpSync(new URL("./fixtures/phase2-acceptance-extension.ts", import.meta.url), join(process.env.PI_CODING_AGENT_DIR, "extensions", "phase2.ts"));
const { createAgentServer } = await import("/usr/local/lib/node_modules/@aoliyougei/pi-web-agent-server/dist/server.js");
const { createAgentRouteAdapter } = await import("/usr/local/lib/node_modules/@aoliyougei/pi-web-agent-server/dist/runtime/agent-adapter.js");
const { getRpcSession } = await import("/usr/local/lib/node_modules/@aoliyougei/pi-web-agent-server/dist/runtime/session-runtime.js");
const app = createAgentServer({ token: "token", version: { protocolVersion: 1 }, agent: createAgentRouteAdapter() });
await app.listen("127.0.0.1", 0);
const base = `http://127.0.0.1:${app.address().port}/internal/v1/api/agent`;
const headers = { authorization: "Bearer token", "content-type": "application/json" };
let sessionId;
const post = async (path, body) => fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
const pending = async (method) => {
  for (let i = 0; i < 200; i++) {
    const response = await fetch(`${base}/${sessionId}/extension-ui/pending`, { headers });
    assert.equal(response.status, 200);
    const found = (await response.json()).requests.find((item) => item.method === method);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Missing ${method}`);
};
async function eventStream() {
  const controller = new AbortController();
  const response = await fetch(`${base}/${sessionId}/events`, { headers, signal: controller.signal });
  const reader = response.body.getReader();
  let buffer = "";
  return {
    async next(predicate) {
      for (;;) {
        while (buffer.includes("\n\n")) {
          const split = buffer.indexOf("\n\n"), frame = buffer.slice(0, split); buffer = buffer.slice(split + 2);
          const line = frame.split("\n").find((value) => value.startsWith("data: "));
          if (line) { const event = JSON.parse(line.slice(6)); if (predicate(event)) return event; }
        }
        const chunk = await reader.read();
        if (chunk.done) throw new Error("SSE ended");
        buffer += new TextDecoder().decode(chunk.value, { stream: true });
      }
    },
    async close() { controller.abort(); await reader.cancel().catch(() => {}); },
  };
}
try {
  const created = await post("/new", { cwd: root, type: "ensure_session" });
  assert.equal(created.status, 200); sessionId = (await created.json()).sessionId;
  const events = await eventStream();
  await events.next((event) => event.type === "connected");

  const dialogCommand = post(`/${sessionId}`, { type: "prompt", message: "/phase2-dialogs" });
  const methods = [
    ["select", { value: "b" }], ["confirm", { confirmed: true }],
    ["input", { value: "typed" }], ["editor", { value: "edited" }],
  ];
  for (const [method, response] of methods) {
    const request = await pending(method);
    const answered = await post(`/${sessionId}/extension-ui/${request.id}/response`, response);
    assert.equal(answered.status, 200);
  }
  assert.equal((await dialogCommand).status, 200);
  const notices = [];
  while (!notices.some((event) => event.method === "notify" && event.message === "b:true:typed:edited")) {
    notices.push(await events.next((event) => event.type === "extension_ui_request"));
  }
  for (const method of ["setStatus", "setWidget", "setTitle", "set_editor_text", "notify"]) {
    assert.ok(notices.some((event) => event.method === method), `missing ${method}`);
  }

  const customCommand = post(`/${sessionId}`, { type: "prompt", message: "/phase2-custom" });
  const initial = await events.next((event) => event.method === "custom" && event.closed === false);
  assert.deepEqual(initial.lines, ["initial"]);
  const keys = ["\u001b[A", "\u001b[B", "\u001b", "\u001b[200~pasted\ntext\u001b[201~"];
  let current = initial;
  for (const data of keys) {
    const update = await post(`/${sessionId}/custom-ui/${initial.id}/input`, { data, revision: initial.revision });
    assert.equal(update.status, 200);
    current = await events.next((event) => event.method === "custom" && event.revision > current.revision);
  }
  assert.deepEqual(current.lines, keys.map((value) => JSON.stringify(value)).join("|").split("\n"));
  const finish = await post(`/${sessionId}/custom-ui/${initial.id}/input`, { data: "\r", revision: initial.revision });
  assert.equal(finish.status, 200);
  const closed = await events.next((event) => event.method === "custom" && event.closed === true);
  assert.ok(closed.revision > current.revision);
  assert.equal((await customCommand).status, 200);
  await events.next((event) => event.method === "notify" && event.message === `custom:${keys.join(",")}`);
  await events.close();
  console.log("PASS extension-ui-e2e: ordinary methods round-trip and fire-and-forget events");
  console.log("PASS custom-ui-e2e: frame/input/stale revision/close keyboard round-trip");
} finally {
  if (sessionId) await getRpcSession(sessionId)?.shutdown();
  await app.close();
  rmSync(root, { recursive: true, force: true });
}
