import type { IncomingMessage, ServerResponse } from "node:http";
import { agentError, type AgentVersion } from "@aoliyougei/pi-agent-contract";
import { isAuthorized } from "./auth.js";
import { routeAgentRequest, type AgentRouteAdapter } from "./routes/agent.js";
import { routeAuth, type ModelAuthAdapter } from "./routes/auth.js";
import { AgentEventChannels, routeAgentEvents } from "./routes/events.js";
import { routeExtensionUi } from "./routes/extension-ui.js";
import { routeFiles } from "./routes/files.js";
import { routeGit } from "./routes/git.js";
import { routeModels } from "./routes/models.js";
import { routePush, type PushAdapter } from "./routes/push.js";
import { routeResources, type ResourceAdapter } from "./routes/resources.js";
import { routeSessions } from "./routes/sessions.js";
import { routeSsh } from "./routes/ssh.js";
import { routeSubagents } from "./routes/subagents.js";
import { routeWorktrees } from "./routes/worktrees.js";
import { routeBashOutput } from "./routes/bash-output.js";
import { routeCustomUi } from "./routes/custom-ui.js";
import { RequestDeduplicator } from "./runtime/request-dedup.js";
import { currentSessionCwd, validateSessionCwd, withSessionCwd } from "./dependencies/session-scope.js";
import { assertDistinctSessions, assertSessionFileIdentity, resolveSessionPath } from "./dependencies/session-reader.js";
import { getRpcSession } from "./runtime/session-runtime.js";

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

export async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: {
    token: string;
    version: AgentVersion;
    ready: () => boolean;
    agent?: AgentRouteAdapter;
    modelAuth?: ModelAuthAdapter;
    push?: PushAdapter;
    resources?: ResourceAdapter;
    dedup?: RequestDeduplicator;
    events?: AgentEventChannels;
  },
): Promise<void> {
  const path = new URL(request.url ?? "/", "http://internal").pathname;
  if (request.method === "GET" && path === "/internal/v1/health/live") {
    send(response, 200, { status: "ok" });
    return;
  }
  const requestId = request.headers["x-request-id"]?.toString() ?? "unknown";
  if (!isAuthorized(request.headers.authorization, options.token)) {
    send(response, 401, agentError("unauthorized", "Unauthorized", requestId));
    return;
  }
  if (request.method === "GET" && path === "/internal/v1/health/ready") {
    if (options.ready()) send(response, 200, { status: "ok" });
    else send(response, 503, agentError("agent_unavailable", "Agent unavailable", requestId));
    return;
  }
  if (request.method === "GET" && path === "/internal/v1/version") {
    send(response, 200, options.version);
    return;
  }
  const query = new URL(request.url ?? "/", "http://internal").searchParams;
  const scopedResource = /^\/internal\/v1\/api\/(?:sessions(?:\/|$)|agent\/[^/]+\/|agent\/[^/]+$|subagents\/[^/]+$)/.test(path)
    || (path.startsWith("/internal/v1/api/files/") && query.has("sessionId"));
  const scopeHint = scopedResource ? query.get("cwd") : null;
  if (scopeHint !== null) {
    const cwd = await validateSessionCwd(scopeHint);
    return withSessionCwd(cwd, () => dispatch());
  }
  return dispatch();

  async function dispatch(): Promise<void> {
  const sessionMatch = /^\/internal\/v1\/api\/(?:sessions|agent|subagents)\/([^/]+)/.exec(path)
    ?? (path.startsWith("/internal/v1/api/files/") && query.has("sessionId") ? ["", encodeURIComponent(query.get("sessionId")!)] : null);
  // POST commands extract their lookup scope from JSON in routeAgentRequest.
  if (sessionMatch && !(request.method === "POST" && /^\/internal\/v1\/api\/agent\/[^/]+$/.test(path))) {
    let id: string;
    try { id = decodeURIComponent(sessionMatch[1]); }
    catch { throw Object.assign(new Error("Invalid session id"), { status: 400, code: "invalid_request" }); }
    if (!["new", "running", "settings", "profiles"].includes(id)) {
      const file = await resolveSessionPath(id);
      const runtime = getRpcSession(id);
      if (runtime?.isAlive()) assertSessionFileIdentity(runtime.sessionFile, id);
      if (file && runtime?.isAlive()) assertDistinctSessions([{ id, path: file }, { id, path: runtime.sessionFile }]);
      if (scopeHint !== null && runtime?.isAlive() && !file && runtime.cwd !== currentSessionCwd()) {
        throw Object.assign(new Error("Session is outside the selected lookup scope"), { status: 403, code: "invalid_request" });
      }
    }
  }
  if (await routeAuth(request, response, path, options.modelAuth)) return;
  if (await routeModels(request, response, path)) return;
  if (await routePush(request, response, path, options.push)) return;
  if (await routeResources(request, response, path, options.resources)) return;
  if (await routeFiles(request, response, path)) return;
  if (await routeGit(request, response, path)) return;
  if (await routeWorktrees(request, response, path)) return;
  if (await routeSubagents(request, response, path)) return;
  if (await routeSsh(request, response, path)) return;
  if (await routeSessions(request, response, path)) return;
  if (await routeBashOutput(request, response, path)) return;
  const agent = options.agent;
  if (agent) {
    return routeCustomUi(request, response, path, requestId, agent)
      .then((handled) => handled || routeExtensionUi(request, response, path, requestId, agent))
      .then((uiHandled) => {
      if (uiHandled) return;
      const route = options.events
        ? routeAgentEvents(request, response, path, requestId, agent, options.events)
        : Promise.resolve(false);
      return route.then((handled) => handled
        ? undefined
        : routeAgentRequest(request, response, path, requestId, agent, options.dedup ?? new RequestDeduplicator()).then((agentHandled) => {
          if (!agentHandled) send(response, 404, agentError("invalid_request", "Not found", requestId));
        }));
    });
  }
  send(response, 404, agentError("invalid_request", "Not found", requestId));
  }
}
