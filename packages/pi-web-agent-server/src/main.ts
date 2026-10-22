#!/usr/bin/env node
import { OPTIONAL_CAPABILITIES, PROTOCOL_VERSION, REQUIRED_CAPABILITIES } from "@aoliyougei/pi-agent-contract";
import { loadToken } from "./config.js";
import { configureHttpDispatcher } from "./dependencies/http-dispatcher.js";
import { createAgentRouteAdapter } from "./runtime/agent-adapter.js";
import { createAgentServer } from "./server.js";

const tokenPath = process.env.PI_AGENT_RPC_TOKEN_FILE ?? "/run/secrets/pi-agent-rpc-token";
const host = process.env.PI_AGENT_RPC_HOST ?? "0.0.0.0";
const port = Number(process.env.PI_AGENT_RPC_PORT ?? "8080");
const eventBufferCapacity = Number(process.env.PI_AGENT_RPC_EVENT_BUFFER_CAPACITY ?? "1000");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid RPC port");
configureHttpDispatcher();
const token = await loadToken(tokenPath, {
  uid: process.getuid?.() ?? -1,
  gids: process.getgroups?.() ?? [],
});
const app = createAgentServer({
  token,
  agent: createAgentRouteAdapter(),
  eventBufferCapacity,
  version: {
    protocolVersion: PROTOCOL_VERSION,
    serverVersion: "0.3.0",
    piVersion: "1.2.0",
    piRevision: "06a466935536f8c9bcacb2d5efc0fc021be1bdff",
    capabilities: [...REQUIRED_CAPABILITIES, ...OPTIONAL_CAPABILITIES],
  },
});
await app.listen(host, port);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    app.beginShutdown();
    await app.close();
  });
}
