#!/bin/sh
set -eu
IMAGE=${1:-pi-agent-rpc:0.4.0}
meta=$(docker image inspect "$IMAGE" --format '{{.Architecture}}/{{.Os}} {{.Config.User}} {{.Config.WorkingDir}} {{index .Config.Labels "io.pi-agent-rpc.version"}} {{index .Config.Labels "io.pi-agent.version"}} {{index .Config.Labels "io.pi-agent-server.version"}}')
[ "$meta" = "amd64/linux node /app 0.4.0 1.4.0 0.4.0" ]
docker image inspect "$IMAGE" --format '{{json .Config.ExposedPorts}}' | grep -Fq '8080/tcp'
docker image inspect "$IMAGE" --format '{{json .Config.Healthcheck}}' | grep -Fq 'pi-agent-rpc-healthcheck'
docker run --rm "$IMAGE" pi --version | grep -Fq '1.4.0'
docker run --rm "$IMAGE" sh -lc 'command -v pi-agent-rpc >/dev/null; test ! -e /run/secrets/pi-agent-rpc-token'
if docker run --rm "$IMAGE" >/tmp/pi-agent-rpc-no-secret.log 2>&1; then
  echo "Agent Server started without its Secret" >&2
  exit 1
fi
grep -Fq 'Invalid RPC token file' /tmp/pi-agent-rpc-no-secret.log
printf '%s\n' "Pi Agent RPC image verified"
