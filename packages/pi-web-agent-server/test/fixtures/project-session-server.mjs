import { createAgentServer } from "../../dist/server.js";
import { createAgentRouteAdapter } from "../../dist/runtime/agent-adapter.js";
import { OPTIONAL_CAPABILITIES, REQUIRED_CAPABILITIES } from "../../../agent-contract/dist/index.js";

const app = createAgentServer({
  token: "project-process-test",
  agent: createAgentRouteAdapter(),
  version: { protocolVersion: 1, serverVersion: "0.2.0", piVersion: "1.2.0", piRevision: "06a466935536f8c9bcacb2d5efc0fc021be1bdff", capabilities: [...REQUIRED_CAPABILITIES, ...OPTIONAL_CAPABILITIES] },
});
await app.listen("127.0.0.1", 0);
process.send({ port: app.address().port });
