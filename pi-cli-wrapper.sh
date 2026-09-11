#!/bin/sh
set -eu
# Explicit CLI preload, never inherited by tools through NODE_OPTIONS.
exec node --import /usr/local/lib/node_modules/@aoliyougei/pi-web-agent-server/dist/runtime/cli-preload.js /usr/local/libexec/pi-real "$@"
