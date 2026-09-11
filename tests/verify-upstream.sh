#!/bin/sh
set -eu
REFERENCE=${1:?usage: verify-upstream.sh BASELINE_PI_DIR}
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
diff -qr "$REFERENCE" source/upstream/pi
run_node() {
  if command -v node >/dev/null 2>&1; then
    node -
  else
    docker run --rm -i -v "$ROOT:/work:ro" -w /work node:22-alpine node -
  fi
}
run_node <<'NODE'
const manifest = require("./SOURCE_MANIFEST.json");
const pkg = require("./source/upstream/pi/packages/coding-agent/package.json");
if (manifest.project?.version !== "0.1.0") throw new Error("unexpected project version");
if (manifest.pi?.version !== "0.84.4") throw new Error("unexpected Pi manifest version");
if (manifest.pi.revision !== "b79e4cc834970cca69daebffab7df1da7d1e52c4") throw new Error("unexpected Pi revision");
if (manifest.pi.path !== "source/upstream/pi") throw new Error("unexpected Pi path");
if (pkg.version !== manifest.pi.version) throw new Error("Pi package version mismatch");
if ("pi-web" in manifest) throw new Error("Pi Web must not be part of pi-agent-rpc");
NODE
printf '%s\n' "Pi upstream verification passed"
