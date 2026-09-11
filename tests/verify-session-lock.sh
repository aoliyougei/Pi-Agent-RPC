#!/bin/sh
set -eu
# Run inside the candidate image, via Docker API exec. No daemon/host mounts required.
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$ROOT/verify-session-lock.mjs"
