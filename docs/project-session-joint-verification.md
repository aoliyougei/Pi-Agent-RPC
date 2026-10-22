# Final Web/RPC candidate joint verification

Date: 2026-10-22. No production deployment, image push, Git commit, host port,
production data mount, privileged container or external model request.

## Fixed candidate identities

- Web: `pi-agent-web:project-session-discovery-candidate`
  `sha256:740cc9550e58760faa825a1cef1db5fa367d9efe4c7dfe41a607af96cd9694dc`
- RPC: `pi-agent-rpc:project-session-discovery-candidate`
  `sha256:f126913ad141f44c22b0c8a6bff5ae88e837600f36dc23de676ceade26272659`
- Both inspected and containers created using immutable image IDs, not mutable tags.
- RPC source still uncommitted on feat/project-session-discovery, base 31b9480.
- Neither candidate version string nor Web's inherited release-ready label is a
  release approval or unique identity for this test build.

## Request implementation review

Read-only review of Web source in `/app/Pi-Agent-Web`:

- `lib/session-scope.ts`: backend-scoped locator map; only in-flight validation
  sharing; later operations validate again; backend changes stop prepared requests;
  resource query cwd vs agent POST top-level JSON cwd; explicit media cwd retained.
- `lib/agent-rpc/routes/sessions.ts`: complete query preservation for list/detail,
  context/state/export/auto-name/thinking/image and mutations.
- `lib/agent-rpc/routes/agent.ts`: SSE cursor maps to Last-Event-ID while retaining
  query cwd; ordinary conflicts remain 409; only resync_required is SSE-translated.
- `lib/agent-client.ts`, `hooks/useAgentSession.ts`, sidebar/AppShell call sites:
  session helper used; validation before SSE; new/fork IDs remember local hint;
  generation checks ignore late LIST updates; current selection not blindly used
  for another session's command.
- No mismatch found in the reviewed request contract. This is not a full Web audit.

## Isolation / reproduction

RPC candidate ran in a task container with NetworkMode=none. Web candidate shared
that task container's network namespace; traffic used loopback only. No host ports
or shared production filesystem. Both default non-root users retained.

- `tests/fixtures/joint-project-rpc.mjs` runs in RPC candidate beside existing
  `phase2-acceptance-extension.ts`; uses random ephemeral Token, temp A/B projects,
  global/project JSONL fixtures, deterministic echo provider, actual RPC main,
  loopback-only test relay/control. Credentials and prompt contents are not logged.
- `tests/joint-project-web-e2e.mjs` runs in final Web candidate against actual
  production `server.js` routes. It loads a test-only snapshot of Web's browser
  scope helper from `tests/fixtures/joint-web-session-scope.ts` (copied read-only
  from `/app/Pi-Agent-Web/lib/session-scope.ts` on this date). The selected-backend
  import is replaced only in the disposable test evaluation; no production code
  or candidate layers are modified. Node stripTypeScriptTypes emitted its expected
  experimental warning; no runtime/test errors.
- Web's deployment Token file contains an ephemeral relay placeholder; relay
  injects the real random RPC Token inside the RPC container. Test control/relay
  listen only on this isolated loopback and must never be deployed as services.

## Observed result

`node /tmp/joint-project-web-e2e.mjs`: exit 0, all assertions passed; 58 captured
upstream requests. Capture records only method, path/query, JSON field names,
lookup cwd, command type and Last-Event-ID (no credentials or prompt bodies).

Passed:

1. Actual production Web `/api/agent/version` returns 200 with optional capability.
2. Cold project detail uses browser helper validation without preceding LIST.
3. A/B parallel lists contain selected local + original global rows, not other
   persisted project files.
4. Deterministic prompt produces echo assistant content in the original project
   JSONL through Web command proxy and live SSE.
5. SSE Last-Event-ID replay preserves query cwd and replays session name event.
6. Remove sessionDir during an active slow deterministic run: run completes into
   original JSONL; discovery remains independent of settings.
7. Actual RPC SIGKILL/restart clears roots/runtimes. Web helper revalidates before
   cold detail, image download, SSE and another prompt without preceding LIST.
8. RPC-generated delayed image URL retains correct cwd; bytes download through Web.
9. Continued original global session remains in its original global JSONL while
   carrying project lookup cwd.
10. New session without sessionDir persists globally; re-enable .pi/sessions and
    another new session persists in selected project. Both tested with prompts.
11. Project-local CLI-style lease blocks worktree force removal via Web with 409
    session_locked even when not registered in a runtime.
12. Duplicate ID introduced as another global file rejects command and SSE through
    Web with 409 session_id_conflict; not success or resync-required translation.
13. Captured command requests place cwd in JSON, not query; resource/SSE/image
    requests carry query cwd; browser cursor becomes upstream Last-Event-ID.

## Compatibility evidence and rollout restriction

Web agent reports (not rerun here): new Web 607/607, contract 5/5, typecheck/lint/
production build; new Web -> old RPC 0.3.1 global functionality; released Web 0.2.3
-> candidate RPC version endpoint 503 although global list returns 200; Chromium
navigation, refresh, custom-directory switch and late-response isolation passed.

The old-Web parser incompatibility is consistent with RPC source review. Do not
upgrade production RPC first. A staged new-Web-first upgrade is the supported
order from reported matrix, still requiring operator-authorized rollout and
rollback procedure. No production release performed or blanket compatibility claim.

## Remaining boundaries

No Chromium rerun by RPC agent, no full Web suite rerun, no independent third-party
review, real SSH/OAuth, multi-host flock test, large-history benchmark or OS audit.
All model execution used the deterministic local provider. No paid API requests.
Multiple writers must share canonical paths and a functional shared agent session
lock directory. Existing production dependency audit limitations remain unchanged.
