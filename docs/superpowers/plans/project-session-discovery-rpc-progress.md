# RPC implementation ledger — selected-workspace session discovery

Binding spec: user/Web/RPC agreement in this conversation; source plan `2026-10-22-project-session-discovery.md`.

## Execution
- Isolated branch: feat/project-session-discovery; base 31b9480.
- Local work is source inspection/editing only. All build/test commands use task container `rpc-session-discovery-test`.
- No user authorization to commit, push, deploy, or delegate. Implement and self-review inline; leave changes uncommitted.
- Initial Docker builder tests: 5 failures due to missing git. Added git/bash/ripgrep/fd only inside task test container; rerun baseline: contract 7 tests passed; backend 411 tests passed.
- npm installation reported 6 audit findings (5 moderate, 1 high) and upstream autoevals engine warning. No dependency changes or audit fixes included.

## Task sequence and interfaces
1. Scoped discovery/lookup: `listAllSessions({force?, cwd?})`, `resolveSessionPath(id, cwd?)`, `resolveSessionIdByPath(path, cwd?)`. Explicit project scope verified against previously selected directory; project candidate files must be regular and real-path-contained. Global cache retained; project results not permanently cached. Conflict code `session_id_conflict`, status 409.
2. HTTP propagation: resource query cwd; command JSON cwd extracted at route boundary; runtime adapters accept optional cwd. Shared request context carries scope to existing deep callers without process-global current cwd. Scope checks cover cached/runtime paths and standard errors. Delayed media URLs retain scope.
3. Storage: effective SettingsManager sessionDir resolved relative to creation cwd, reused by normal and subagent creation. Existing opens and fork destinations unchanged.
4. Optional capability, acceptance coverage, worktree deletion lock safety, docs and final self-review.

## Rulings
- Place worktree under project `.worktrees/session-discovery` because Docker context API refuses sibling directory. Ignore via local `.git/info/exclude`, no tracked ignore change.
- Do not change upstream snapshot. Do not use native async agents: no requested delegation.
- Preserve global linked storage directories supported by current tests; authorize each global directory as a selected global storage root, while reject file symlinks/nonregular files and project directory escapes.
- Cache retained for global list performance only; project discovery rescans on each request. This avoids per-project unbounded cache and naturally sees external writers.

## Status
- Baseline: passed (7 contract + 411 backend).
- Task 1: implemented and verified; focused discovery 9/9 under node. Global cache retained, project scan uncached; authorized lookup verifies file headers without trusting path caches.
- Task 2: implemented and verified; query scope uses AsyncLocalStorage (request-local, not global current cwd); POST metadata extracted before SDK command. Restart/detail/SSE/prompt and delayed image acceptance passed.
- Task 3: implemented and verified; global/project precedence, relative/absolute/unset storage, original file continuation, subagent allocation and lease tests passed.
- Task 4: RPC candidate complete for Web integration; full root and node-user suites each contract 8/8, backend 431 passed + 1 user-specific skip, complementary run executes each skipped case. Installed image project/release/lock/runtime/UI acceptance passed. Web compatibility/deployment gates remain open.

## Final review and rulings
- Final review: author self-review (operator did not request delegation). No independent review claimed.
- Fixed with failing tests first: out-of-scope parent read on delete; persisted/live ID collision outside selected scope; dedup cached response bypassing a new ID conflict; live runtime reused after disk header replaced; escaping .pi symlink with absent sessions child. Final source and installed candidate checks passed after fixes.
- Ruling: use request-local AsyncLocalStorage to propagate optional cwd into existing deep read/subagent/reference callers — avoids changing every SDK-facing interface and cannot overwrite another request's scope; cost if wrong is missed detached scope, covered by concurrent requests and real restart tests.
- Ruling: project session header cwd must canonically match selected cwd — aligns SDK custom-dir semantics and lets Web persist existing SessionInfo.cwd rather than new lookup field; relocated files with old headers are intentionally not reassigned.
- Ruling: preserve historical session-route 404 envelope and server versions for candidate — avoids unrelated error/version migration; Web must retain existing 404 handling and releases need separate version authorization.
- Ruling: multiple writers require shared agentDir lock namespace, no new distributed lock infrastructure — preserves existing lock mechanism; independent agentDirs are not a supported shared-writer deployment.
- Minor deferred: large-history lookup performance benchmark and independent external review. No runtime dependency changes.
- Verification and exact candidate identity: ../../project-session-discovery-verification.md.
- No commits/pushes/deployments performed. Original main worktree preserved. Task test containers may be removed after results are recorded; candidate image retained for integration.
