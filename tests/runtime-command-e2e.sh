#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$ROOT/phase2-runtime-e2e.mjs"
