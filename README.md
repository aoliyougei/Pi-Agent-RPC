# Pi Agent RPC

Standalone authenticated HTTP/SSE backend for Pi, built from the official source
in `source/upstream/pi` and the backend packages in `packages/`.

| Component | Version |
| --- | --- |
| Project / Agent Server | 0.4.0 |
| Official Pi | 1.4.0 |
| Contract / wire protocol | 0.1.0 / v1 |

## Build

Use a Docker build environment (linux/amd64). `build-image.sh` is the human-facing
Docker CLI entrypoint; automated agent work uses the Docker Engine API directly.
The output tag is `pi-agent-rpc:0.4.0`. See `Dockerfile` and `UPSTREAM.md` for build
inputs and provenance. Builds require network access; no API keys are needed.

Pi's own lockfile governs its build. The root npm lockfile governs the backend
workspace. The final global installation uses local package tarballs, but still
resolves external runtime dependencies; it is not a bit-for-bit reproducible
release until that final installation is also locked.

## Run and deploy

- Default address: `0.0.0.0:8080`; configure `PI_AGENT_RPC_HOST` / `PI_AGENT_RPC_PORT`.
- Required Token file: `/run/secrets/pi-agent-rpc-token`, or
  `PI_AGENT_RPC_TOKEN_FILE`. Use a nonempty random secret, owned by the runtime
  user with mode 0400, or root-owned mode 0440 with a runtime supplementary group.
- Persist the project workspace at `/app` and Pi data at `/home/node/.pi`.
- Only `/internal/v1/health/live` is unauthenticated. Other routes require
  `Authorization: Bearer <token>`, including readiness and version discovery.
- Kubernetes base: `deploy/kubernetes/base`. Create the referenced Secret and
  workspace/data PVCs separately. Single active replica only.
- Keep this high-privilege agent endpoint on a trusted network. The Token grants
  access to project files, shell execution and model credential management.

## Development and acceptance

All dependency installs, builds and tests belong in Docker. Build upstream Pi
first, then run root `npm run build` and `npm test`. The source test suite covers
the contract and backend; do not use the upstream all-workspace test command as
a replacement for backend acceptance.

Upload `tests/` into a task-owned candidate-image container and run:

- `node release-smoke.mjs`
- `node verify-session-lock.mjs`
- `node phase2-runtime-e2e.mjs`
- `node phase2-ui-e2e.mjs`
- `python3 verify-cli-tui.py` (install Python only in the test container)

These tests use a deterministic local provider, not a paid external model.
The historical `verify-artifacts.sh` and bridge lock refer to the old vendor
release and are not part of the current build.

## Selected-project sessions (candidate)

With optional capability `project-session-discovery`, pass a validated absolute
`cwd` to session listing to include that directory's `.pi/sessions` alongside
existing global history. Discovery does not depend on settings; `sessionDir`
controls new-session storage only. Existing sessions keep their original files.
See [the interface and cold-navigation guide](docs/project-session-discovery.md),
including the shared session-lock requirement for multiple RPC/CLI processes.

## Upgrade notes

The Web repository is not changed here. Its Pi-version compatibility gate must
accept 1.4.0 before the two projects can be deployed together. See
`docs/releases/0.4.0.md` for verification and remaining limits.
