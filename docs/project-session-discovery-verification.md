# RPC selected-project sessions — candidate verification

Date: 2026-10-22. Docker-only, linux/amd64, Node 22.23.2.

## Source and candidate identity

- Worktree: `/app/Pi-Agent-RPC/.worktrees/session-discovery`
- Branch: `feat/project-session-discovery`
- Base: `31b9480` (changes deliberately uncommitted; no new commit SHA).
- Candidate tag: `pi-agent-rpc:project-session-discovery-candidate`
- Daemon-local image ID / inspected manifest digest:
  `sha256:f126913ad141f44c22b0c8a6bff5ae88e837600f36dc23de676ceade26272659`
- Not pushed; availability is limited to the configured Docker daemon.
- Server/package version remains 0.2.0 for this candidate; Pi 1.2.0; contract 0.1.0; protocol v1.

## Actual version response

```json
{"protocolVersion":1,"serverVersion":"0.2.0","piVersion":"1.2.0","piRevision":"06a466935536f8c9bcacb2d5efc0fc021be1bdff","capabilities":["extension-ui","custom-ui","remote-files","subagents","session-locks","project-session-discovery"]}
```

## Actual errors captured from installed candidate

```text
400 {"error":{"code":"invalid_request","message":"cwd must be an absolute path","requestId":"unknown"}}
404 {"error":"Session not found"}
409 {"error":{"code":"session_id_conflict","message":"Multiple distinct session files share this session ID","requestId":"unknown"}}
```

The historical-session 404 format is deliberately unchanged. New scope/conflict
errors use the structured envelope. Query/JSON examples and endpoint table are
in `docs/project-session-discovery.md`.

## Verified

- Baseline before edits: contract 7/7, backend 411/411 after adding missing Git test tooling only inside Docker.
- Final `npm run build`: contract/backend TypeScript builds passed.
- Final root `npm test`: contract 8/8; backend 431 passed, 1 permission test skipped because root bypasses permissions.
- Final node-user `npm test`: contract 8/8; backend 431 passed, 1 root-ownership fixture skipped because it requires root.
- Node-user focused project discovery suite: all 9 passed, including EACCES. Across root/non-root runs every test executed successfully.
- New discovery/lookup tests: global+project union without settings; A/B isolation; later external files; no recursion or implicit directory creation; cache scope revalidation; duplicate IDs; valid symlink cwd; escaping/dangling storage links; malformed headers/entries; file types; permission failure.
- HTTP tests: no-LIST cold detail/context/state/rename/delete; media URL retains cwd; command strips metadata; parallel A/B requests; mismatched runtime scope; live-ID conflicts; request dedup does not bypass a new conflict; replaced runtime file header rejected; parent links cannot authorize external reads.
- Storage tests: global/project precedence, relative paths per cwd, absolute path, unset default; subagent allocation honors settings and lease release; existing-session original-file continuation after config removal.
- Worktree route test: a project-local CLI lease prevents force removal even without runtime registration.
- Real subprocess restart: caches and selected-root grants cleared; validation then cold detail/SSE/prompt succeeds without LIST; local deterministic provider, no paid API.
- Installed final image: `node project-session-e2e.mjs` passed (version/errors, actual process restart, settings removal, original JSONL append, deferred image download, A/B scope, global creation fallback, conflict).
- Installed final image: `node release-smoke.mjs`, `node verify-session-lock.mjs`, `node phase2-runtime-e2e.mjs`, `node phase2-ui-e2e.mjs` all passed. Includes existing model/queue/abort/bash/compact/fork/clone/SSE replay and ordinary/custom UI behavior.
- Local static `git diff --check`: passed. Official snapshot, dependency manifests and locks unchanged.

## Review and outstanding gates

- Final review was author self-review; no independent agent was delegated. Tests found and pinned parent-path escape, live/runtime ID collision, request-dedup conflict bypass and replaced-file-header cases before final image build.
- Subsequent joint verification: see `project-session-joint-verification.md`. Actual final Web/RPC candidates passed deterministic prompt, settings changes, restart, media, locks/conflicts and captured-request contract checks. Web independently reports new-Web/old-RPC success and released-old-Web/new-RPC version 503; never deploy production RPC before compatible Web. Browser/full Web suite results remain Web-reported, not independently rerun here.
- No Kubernetes rollout, registry push, Git commit, real model/OAuth/SSH service, distributed/network-filesystem lock test, PTY retest or load benchmark in this change.
- Multiple writers must share canonical paths and `<agentDir>/locks/sessions` with functional flock semantics. Independent agentDirs do not coordinate project writers; not advertised as distributed locking support.
- Project discovery rescans per request; cold ID lookup reads bounded headers in authorized global/selected roots to detect collisions. Large-history performance is not benchmarked.
- Root install reported 6 audit findings including development dependencies. `npm audit --omit=dev --json` found 3 moderate production reports in mammoth → argparse → sprintf-js (GHSA-hp3w-g68c-fv3c), 0 high/critical. No dependency fixes were applied; this is not an OS/image vulnerability audit.
- Candidate installation still resolves external runtime dependencies and base/apk inputs are not fully pinned, as documented by the existing build.
