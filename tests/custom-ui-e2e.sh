#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# UI acceptance includes actual custom component keyboard input and close lifecycle.
exec node "$ROOT/phase2-ui-e2e.mjs"
