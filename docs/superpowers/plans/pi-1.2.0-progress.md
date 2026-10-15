# SDD ledger — plan: docs/superpowers/plans/2026-10-14-pi-1.2.0-upgrade.md

- Execution authorized in current checkout by user after plan review; preserve existing uncommitted upstream replacement. No commits, branch changes or Web edits.
- Pre-flight: Tasks 1→2 share backend package interfaces; retain protocol 1 / contract 0.1.0. Tasks 2→3 share SDK/CLI module identity; bundled CLI must not bypass lock preload. Tasks 3→4 share installed paths/version assertions.
- Ruling: Use this tracked progress file instead of executing skill helper scripts locally; all project execution belongs in Docker, and no commits were authorized.
- Task 1: complete — copied backend and contract from Web commit 400fc7b8701e76666d93ba3b376d9bc0cad852bf, Web unchanged. Task container `pi-rpc-120-upgrade`; dependency install and native fs-ext rebuild succeeded. Baseline compilation exposed readonly prompts and changed callback types; baseline tests 101/184 before missing test dependency/theme initialization were repaired.
- Task 2: complete — Pi and backend compile. Getter-only prompt regression observed RED then GREEN. SDK lifecycle/fork/manager methods inspected; version-bound guard tests and actual CLI verified. Import collision-suffixed destination now guarded. Final contract 7/7 and backend 411/411 passed.
- Ruling: Retain contract 0.1.0/protocol v1 — wire shape unchanged; frontend's hardcoded Pi gate is reported, not spoofed or edited.
- Ruling: Import collision fixtures now leave the initial target absent, and a dedicated collision test verifies suffixed-target locking/preserved original bytes — upstream imports no longer overwrite existing target paths.
- Ruling: Use pinned upstream catalog hydration instead of old models.dev builder — official hash verified, avoids live model provider dependence.
- Ruling: Update backend undici to official 8.10.2 after release-note review — closes high audit reports; dispatcher tests pass. Three mammoth-chain moderate advisories remain and are disclosed.
- Task 3: complete — image built by Docker API, `pi-agent-rpc:0.2.0`, ID a8ae9eacbb5feeb95005df02d3853be2dcadc6d37b294e9be013de724a27bb5f; amd64/linux, user node, port/healthcheck/labels inspected.
- Task 4: installed final image passed release smoke, runtime command/SSE acceptance, ordinary/custom UI, CLI/RPC locking and actual PTY --session/--resume. No real provider credentials used.
- Final review: self-review (no subagent tool). Read changed runtime/type/build boundaries and associated SDK implementations as a separate pass. No unresolved critical finding in tested backend scope.
- Final: minor (deferred): historical vendor/bridge verification retained for old-release provenance; not build inputs.
- Final: Ruling: Do not claim full frontend/production readiness — Web version gate, live services, OS audit and Kubernetes rollout remain outside verified scope.
- Final: Ruling: Final global runtime dependency resolution is not fully locked — disclose reproducibility limit rather than silently claiming bit-for-bit builds.
