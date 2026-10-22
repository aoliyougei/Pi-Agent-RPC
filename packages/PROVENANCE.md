# Backend source provenance

`agent-contract/` and `pi-web-agent-server/` were copied from
https://github.com/aoliyougei/Pi-Agent-Web at commit
`400fc7b8701e76666d93ba3b376d9bc0cad852bf` with the user's approval.
The originating checkout was not modified. The original MIT license is retained
as `LICENSE` in this directory. Backend changes now belong in this repository.

The HTTP protocol remains v1 and the contract package remains 0.1.0. The server
package and this project are 0.3.0, targeting the vendored Pi 1.2.0 SDK.

The repository root npm workspace links these packages to the local Pi packages.
Docker builds Pi independently with its official lockfile, then compiles the
backend with the root lockfile. The old `vendor/` tarballs and bridge lock are
historical 0.1.0 artifacts, not inputs to the 0.2.0 Docker build.
