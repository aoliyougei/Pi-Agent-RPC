#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT"
read_json() { docker run --rm -i -v "$ROOT:/work:ro" -w /work registry.aoliyougei.com/library/node:22-alpine node -e 'const fs=require("fs");const [file,...keys]=process.argv.slice(1);let value=JSON.parse(fs.readFileSync(file));for(const key of keys)value=value[key];process.stdout.write(String(value))' "$@"; }
PROJECT_VERSION=$(read_json SOURCE_MANIFEST.json project version)
PI_VERSION=$(read_json SOURCE_MANIFEST.json pi version)
PI_REVISION=$(read_json SOURCE_MANIFEST.json pi revision)
AGENT_SERVER_VERSION=$(read_json bridge-package.lock.json packages 1 version)
CONTRACT_VERSION=$(read_json bridge-package.lock.json packages 0 version)
MODELS_DEV_REVISION=${MODELS_DEV_REVISION:-49da05ac67b5d4958cfea2ce92d4ee2867dfbc59}
NVIDIA_API_IPV4=${NVIDIA_API_IPV4:-99.83.136.103}
OPENROUTER_IPV4=${OPENROUTER_IPV4:-104.18.3.115}
VERCEL_AI_GATEWAY_IPV4=${VERCEL_AI_GATEWAY_IPV4:-64.239.109.129}
exec docker buildx build --platform linux/amd64 --load \
  --tag "pi-agent-rpc:$PROJECT_VERSION" \
  --build-arg "PROJECT_VERSION=$PROJECT_VERSION" \
  --build-arg "PI_VERSION=$PI_VERSION" \
  --build-arg "PI_REVISION=$PI_REVISION" \
  --build-arg "AGENT_SERVER_VERSION=$AGENT_SERVER_VERSION" \
  --build-arg "CONTRACT_VERSION=$CONTRACT_VERSION" \
  --build-arg "MODELS_DEV_REVISION=$MODELS_DEV_REVISION" \
  --build-arg "NVIDIA_API_IPV4=$NVIDIA_API_IPV4" \
  --build-arg "OPENROUTER_IPV4=$OPENROUTER_IPV4" \
  --build-arg "VERCEL_AI_GATEWAY_IPV4=$VERCEL_AI_GATEWAY_IPV4" .
