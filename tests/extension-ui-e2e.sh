#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$ROOT/phase2-ui-e2e.mjs"
