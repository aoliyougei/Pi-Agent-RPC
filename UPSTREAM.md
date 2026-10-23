# Upstream source

This repository vendors an unmodified official Pi source snapshot.

- Repository: https://github.com/earendil-works/pi
- Release: https://github.com/earendil-works/pi/releases/tag/v1.4.0
- Tag / version: `v1.4.0` / `1.4.0`
- Revision: `4a080252f06caf63a525d7873c5d94d3c23887e0`
- Path: `source/upstream/pi`
- Import: user-supplied clone checked out at the exact official tag; nested Git worktree verified clean. Git metadata, dependencies and generated output are not build inputs.

RPC integration lives in `packages/pi-web-agent-server`, with the shared v1
contract in `packages/agent-contract`. See `packages/PROVENANCE.md`. Do not patch
the official snapshot to implement RPC features.

## Build

Project/server version: `0.4.0`. Contract version: `0.1.0` (wire protocol unchanged).
The Docker build compiles Pi from this snapshot and the backend from local
sources. It uses the immutable official model catalog pinned in
`source/upstream/pi/nix/model-catalog.json`, verifies its SHA-256, hydrates it only
inside the builder, then runs Pi's offline build. No upstream file is edited
locally. Network access remains necessary for image/package downloads and the
pinned catalog.

The CLI intentionally uses `dist/cli.js` rather than the default bundled entry,
so explicit preload guards and the CLI share the same SDK classes. Both paths
must be retested when upgrading Pi.

The old `vendor/` packages, `bridge-package.lock.json`, and their verification
scripts describe the historical 0.1.0 release only; they are not current build
inputs. `tests/verify-upstream.sh OFFICIAL_PI_1_4_0_DIR` compares an independently
exported official tree against the vendored snapshot.

## Frontend coordination

Pi Agent Web's inspected compatibility check allows Pi `0.84.4` and `1.2.0`. Its maintainer
must precisely add this backend's reported `1.4.0` and complete joint acceptance before deploying
the upgraded pair. This repository does not alter Web code or claim frontend
acceptance.
