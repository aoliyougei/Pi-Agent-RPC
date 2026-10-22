#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT"
exec docker buildx build --platform linux/amd64 --load --tag pi-agent-rpc:0.3.0 .
