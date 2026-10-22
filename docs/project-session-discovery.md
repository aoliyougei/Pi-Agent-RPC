# Project session discovery (candidate, protocol v1)

## Behavior

`GET /internal/v1/api/sessions` retains global discovery. With an authorized absolute
`cwd`, it additionally reads direct regular `*.jsonl` files in `<cwd>/.pi/sessions`.
It does not recurse, replace cwd with a Git root, or remember a project registry.
The session header cwd must canonically match the selected workspace. Missing
optional storage is empty and listing creates nothing. Invalid headers are ignored;
permissions and other I/O errors fail rather than return empty success. Project
storage and session-file symlinks cannot escape the selected workspace.

Discovery is independent of `sessionDir`. New normal and subagent sessions use the
effective SDK global/project settings. Relative sessionDir values resolve against
the creation cwd; unset uses SDK default global storage. Existing sessions reopen
and append to the original JSONL, even after settings change. Fork/clone retain
the source storage directory. Arbitrary other custom storage destinations can be
written, but are not automatically discovered by this feature after shutdown.

Global list caching remains short-lived. Project discovery reads the selected
scope per request, so later CLI/other RPC files are visible without registration.
Live-runtime reporting remains unchanged when switching workspaces. Duplicate IDs
across distinct canonical paths are rejected, not merged into an arbitrary winner.

## Capability and versions

The server advertises optional `project-session-discovery`; existing required
capabilities do not change. Protocol remains v1; contract package remains 0.1.0
(additive types, capability parsing and error code). Candidate server retains 0.2.0;
this is not a published release/version bump. New version parsing accepts unknown
string capabilities. This cannot fix a deployed old client's strict parser.
Actual old-Web/new-RPC compatibility must be tested independently before rollout.

## Cold navigation and authorization

1. Web restores backend-scoped session ID and exact **local** lookup cwd.
2. Web calls `POST /internal/v1/api/cwd/validate` with `{ "cwd": "/workspace/A" }`.
3. Only after success, use returned normalized cwd for detail, commands and SSE.
4. No LIST is required. Hints do not rewrite the session header or authorize themselves.

Do not substitute SSH remote cwd for the local lookup cwd. Web must not replace
an opened session's hint when the dropdown changes to another project. A browser
without a hint first uses global lookup, then asks the user to select a workspace.

## Fields

All paths below have prefix `/internal/v1/api`. Existing resource query parameters
(cursor, tail, before, leafId, blockIndex, inline, start=false) remain intact.

| Endpoint | cwd placement | Operation |
| --- | --- | --- |
| GET /sessions | query | global + selected project + live merge |
| GET/PATCH/DELETE /sessions/:id | query | detail/rename/delete |
| GET /sessions/:id/context, /state, /export | query | read; state does not cold-start |
| POST /sessions/:id/auto-name | query | may cold-start |
| GET /sessions/:id/entries/:entryId/thinking or tool-result-image | query | historical content |
| GET /agent/:id | query | may start unless start=false |
| POST /agent/:id | JSON top-level | cwd stripped before SDK command execution |
| GET /agent/:id/events | query | may start; Last-Event-ID unchanged |
| GET /agent/:id/bash-output | query | saved shell output |
| extension-ui pending/response, custom-ui input | query | existing UI behavior |
| GET /sessions/:id/ssh-environment | query | saved local session metadata |
| GET /agent/:id/remote-files or remote-file | query | existing runtime only |
| GET/POST /subagents/:id | query | saved result / live controls |
| /files/... with sessionId reference authorization | query | session lookup only; no broader file grant |
| POST /agent/new | existing JSON cwd | creation cwd, storage selected by RPC |
| GET /agent/running | none | global runtime report |

RPC-generated deferred image URLs include lookup cwd when supplied. Web-generated
thinking, export, shell-output and other URLs must add the session's own hint,
without overriding an existing hint.

## Runnable requests

Use a disposable test service, set BASE and TOKEN locally (never put real tokens
in committed commands or transcripts), and replace workspace/session IDs below.

```sh
# Health/version uses /internal/v1, not /internal/v1/api.
curl -H "Authorization: Bearer $TOKEN" "$BASE/internal/v1/version"
curl -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"cwd":"/workspace/A"}' "$BASE/internal/v1/api/cwd/validate"
curl -G -H "Authorization: Bearer $TOKEN" --data-urlencode 'cwd=/workspace/A' \
  --data-urlencode 'force=1' "$BASE/internal/v1/api/sessions"
curl -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"cwd":"/workspace/A","type":"ensure_session"}' "$BASE/internal/v1/api/agent/new"
curl -G -H "Authorization: Bearer $TOKEN" --data-urlencode 'cwd=/workspace/A' \
  "$BASE/internal/v1/api/sessions/$SESSION_ID"
curl -N -G -H "Authorization: Bearer $TOKEN" --data-urlencode 'cwd=/workspace/A' \
  "$BASE/internal/v1/api/agent/$SESSION_ID/events"
curl -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"cwd":"/workspace/A","type":"prompt","message":"continue"}' \
  "$BASE/internal/v1/api/agent/$SESSION_ID"
```

## Errors

- Invalid/relative/missing cwd: 400 `error.code=invalid_request`.
- Unselected cwd or project-storage escape: 403 `error.code=invalid_request`.
- Duplicate ID: 409 `error.code=session_id_conflict`, with message
  `Multiple distinct session files share this session ID` and requestId.
- Writer lock: 409 `session_locked`.
- Missing session retains endpoint's existing behavior: agent commands use
  `session_not_found` (prompt uses `prompt_rejected`, accepted=false); historical
  session routes retain 404 `{ "error": "Session not found" }`.
- Other filesystem errors fail with 500; no empty-list success fallback.

## Shared storage warning

Multiple RPC/CLI processes must share the same canonical project paths **and the
same agent session-lock directory** (`<agentDir>/locks/sessions`), on storage with
working flock semantics. Sharing only project files while using independent
agentDirs does not coordinate writers. No distributed lock registry is added.
This candidate is not a claim of safe multi-host/network-filesystem deployment.

## Verification boundary

Automated tests use disposable temporary projects and a deterministic local model,
never paid provider APIs. Cross-browser/Web compatibility, production rollout,
external SSH, and multi-host filesystem lock semantics require separate acceptance.
