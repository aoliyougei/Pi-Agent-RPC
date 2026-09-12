#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# Runtime acceptance includes disconnect, cursor replay and exactly-once assertions.
exec node "$ROOT/phase2-runtime-e2e.mjs"
