# Pi 1.4.0 RPC adaptation verification

Date: 2026-10-23. Branch: feat/pi-1.4-adaptation, based on 4a6ad87.
All changes uncommitted. No Git push, registry push, merge or deployment.

## Exact source / candidate

Official tag v1.4.0, revision 4a080252f06caf63a525d7873c5d94d3c23887e0.
The user-provided nested clone initially pointed to a later commit; with explicit
permission it was switched to the exact tag. Nested worktree remains clean.
No patches to upstream. Docker ignores nested .git and local .pi/.worktrees/
.superpowers metadata. Pi model catalog hydration verifies the pinned SHA-256.

Daemon-local candidate (linux/amd64, node user):

    pi-agent-rpc:pi-1.4.0-candidate
    sha256:11ee30f6798174db1b26bf906da61cfea5cb5b7518d517d1982fd2d69c48f858

Both Docker image ID and manifest digest returned by daemon match the value above.
Project/server version remains 0.3.0 (not a new release); contract 0.1.0/protocol v1.
Do not identify this candidate by serverVersion alone. test/latest/0.3.0 release
registry tags were NOT changed.

Actual authenticated version response from installed candidate:

```json
{"protocolVersion":1,"serverVersion":"0.3.0","piVersion":"1.4.0","piRevision":"4a080252f06caf63a525d7873c5d94d3c23887e0","capabilities":["extension-ui","custom-ui","remote-files","subagents","session-locks","project-session-discovery"]}
```

## Product changes

- Pin server SDK peers to 1.4.0; update current provenance and version assertions.
- Rebind four fail-closed SDK lock guards to exactly 1.4.0 after confirming
  SessionManager and AgentSessionRuntime have zero source diff from old snapshot.
- Delegate ambiguous enabledModels scopes to SDK: return candidates and warnings,
  preserve provider-qualified/literal slash/colon IDs and thinking pins.
- Startup no longer rewrites SDK-restored active tools without explicit selection.
  Builtin tool selections retain only already-active extensions, not every
  registered extension. Removed/default-inactive extensions stay inactive.
  Persisted Web builtin selection remains explicit application policy; Chat only
  and fixed subagent profiles retain their existing resource/exclusion behavior.
- Preserve argumentsError when normalizing tool calls (streaming and completed).
- Add optional totalFromProvider type; no cost recomputation introduced.

Important correction to initial pre-tag assessment: the official v1.4.0 tag does
NOT contain totalFromProvider or OpenRouter billed-total override. They existed
in the initially supplied post-release checkout. RPC tolerates/preserves that
optional field as agreed, but this candidate does not claim SDK-native billed
accounting. Server usage.cost.total remains authoritative when supplied.

## Actual Docker verification

Developer container: rpc-pi140-dev, /work. No host mounts or production data.

- Root lock refresh on npm 10.9.8 failed internally (edgesOut); refresh with
  npm 11.6.2 inside dev container succeeded. Dockerfile unchanged: final image's
  npm 10.9.8 npm ci accepted resulting lock and completed full build.
- Reviewed root lock: existing resolved package versions and RPC direct runtime
  dependency versions unchanged; upstream workspace graph adds dev dependencies.
- Full official offline build plus RPC TypeScript build passed.
- TDD: old guard failed 6/8 manager tests; updated lock tests 38/38 passed.
- TDD: ambiguous scope tests failed 2/16; delegate to SDK -> 16/16 passed.
- TDD: removed/default-inactive tools failed 2/3; activation fix -> 3/3 passed.
- TDD: normalized argumentsError missing; fix -> normalization/fee tests 4/4.
- Local real Agent test: malformed tool arguments produce error result, tool
  execute count zero, next assistant response completes; passed.
- Final npm test root: contract 8/8; server 439 tests, 438 passed, 0 failed,
  1 root permission skip. Nonroot: contract 8/8; server 438 passed, 0 failed,
  1 root-owned fixture skip. Complementary runs execute both permission cases.
- Initial full dev suite had six Git-dependent failures (git missing in clean
  dev container). Task-only git/bash/rg/fd installed, all reruns green.
- Official focused tests in Docker: tool restoration + codemode worker admission
  27/27; malformed JSON and tool validation 18/18. No live provider tests.
- verify-upstream.sh passed against exact tag archive in disposable clean tree;
  GNU diffutils needed for -x .git on Alpine. Local nested Git clean/tag identity
  separately checked. No generated files returned into upstream directory.
- git diff --check passed; shared contract package unchanged.

Installed candidate container: rpc-pi140-acceptance, NetworkMode=none, node user.

Passed with exit 0:

    node /app/release-smoke.mjs
    node /app/project-session-e2e.mjs
    node /app/verify-session-lock.mjs
    node /app/phase2-runtime-e2e.mjs
    node /app/phase2-ui-e2e.mjs

Coverage: token permissions/auth/health, actual version, global/project storage,
settings removal and fallback, true subprocess restart without LIST, cold
validation/detail/SSE/prompt and same JSONL, media, A/B isolation, duplicate 409,
CLI/RPC bidirectional flock and crash/shutdown release, model/thinking, queue,
abort, bash, compact, fork/clone, SSE replay, extension UI and custom terminal.

Installed tools/malformed tests additionally passed 4/4. Tests mounted nothing;
only test files and test-only import symlinks added inside disposable container.

## Dependency audit

Current npm audit --omit=dev reports zero findings. Full root workspace audit:
2 moderate dev findings in Vitest/@vitest/mocker (GHSA-qxg6-89mg-rqv8 and
GHSA-xp26-3454-mjgp); upstream install reports 5 findings including 3 high in its
larger development graph. No blanket clean-security claim. Historical sprintf-js
1.0.3 remains through mammoth/argparse unchanged, so a changed advisory report
must not be described as a code fix. No unrelated dependency audit fixes applied.

## Web handoff / remaining gate

Web must precisely admit piVersion 1.4.0 alongside existing versions, retain
protocol/capability checks, and use this fixed digest for isolated acceptance.
HTTP paths/command envelopes/query cwd/SSE cursor mapping remain unchanged.
Do not write browser-default tool preferences on cold resume or reconnect.
Preserve optional argumentsError; cost.total need not equal estimated parts.
Kimi custom baseUrl requires /v1: warn, do not rewrite credentials/config.

Reusable deterministic fixture: tests/fixtures/phase2-acceptance-extension.ts.
Existing project session and joint relay fixtures remain available. Prior
joint-project-web-e2e.mjs embeds old candidate digests and must not be used to
claim this candidate's acceptance without updating the identity assertions.

Required before release: final compatible Web candidate -> this exact RPC image,
version/model/thinking, resumed default/explicit/Chat-only tools, malformed tool
rendering, fee fixtures, compact, SSE replay and real restart continuation.
## Subsequent Web joint acceptance and RPC evidence review (2026-10-23)

Web executed the agreed real-candidate matrix and all three supplemental gaps.
RPC author independently read Web's compatibility report, original successful
web log, supplemental log/evidence JSON and supplemental Chromium test source;
searched the upstream trace for compact/set_tools and inspected both images.
This is evidence review, NOT an independent rerun of the browser suite.

Fixed Web image: pi-agent-web:pi140-joint-candidate,
sha256:14257d652ac4fcc1ec70c53a54e137bf0250534f278b8d6e2ca7f298f329e6eb.
RPC digest remains the exact candidate above. Both manifest identities confirmed
in shared daemon. Web's inherited release-ready image label is not authorization.

Reviewed evidence in /app/Pi-Agent-Web:
- docs/pi-140-compatibility.md
- docs/verification/pi140/pi140-web.log
- docs/verification/pi140/pi140-remaining.log
- docs/verification/pi140/pi140-remaining-evidence.json
- docs/verification/pi140/pi140-remaining-trace.json
- scripts/pi140-joint-remaining.mjs

Supplemental evidence supports active reconnect for explicit nonempty and
original Chat only (unchanged tools, replacement connection, reply received),
actual composer creation (creation-only toolNames, existing session unchanged),
and refresh during provider-gated compaction. Before refresh isCompacting=true
and one provider waiting; after refresh connected + compaction_end observed,
persisted compaction count 0 -> 1, later reply succeeds. Supplemental trace has
one compact and no set_tools. Default new sessions legitimately also activate
new_tool/removed_tool extension fixtures: removed_tool is only disabled in the
old session transcript, not globally disabled for all newly created sessions.

Original Web report covers model/thinking, cold default/explicit/Chat-only,
explicit user change, malformed rendering + separate SDK execution rejection,
optional fee fixtures, manual/auto compaction, ordered replay and true
project/global restart continuation. Expired cursor handling remains RPC 409
resync_required -> existing Web SSE control translation (not a new protocol).
Web suite 619/619, TypeScript and script lint are Web-executed results, not rerun
by RPC author. One-off global/new creation evidence is described in Web report,
not asserted to be reproducible by the original sequential script alone.

Conclusion: agreed joint functional acceptance gate is satisfied for this exact
candidate pair; no demonstrated production RPC defect or code/image changes
required by the feedback. No registry publication, merge, version bump or deploy
authorized by acceptance alone. Release/version/rollout remain separate operator
decisions; compatible Web must precede 1.4 RPC when upgrading old Web.

Author self-review only (no delegation authorized); no independent reviewer.
No SSH/OAuth/paid-model calls, multi-host/network-filesystem lock validation,
large-history/load benchmarks, runtime OS CVE scan or PTY interactive retest.
Upstream codemode worker queue tested with upstream deterministic suite; no
claim of actual browser-level nested-subagent codemode stress acceptance.
