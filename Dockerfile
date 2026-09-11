# syntax=docker/dockerfile:1

FROM registry.aoliyougei.com/oven/bun:1.3.3-alpine AS models-builder
ARG MODELS_DEV_REVISION
RUN apk add --no-cache git
WORKDIR /build
RUN set -eu; \
    for attempt in 1 2 3; do \
      rm -rf models-dev && mkdir models-dev && cd models-dev && \
      git init -q && git remote add origin https://github.com/anomalyco/models.dev.git && \
      if git -c http.version=HTTP/1.1 fetch --depth=1 origin "$MODELS_DEV_REVISION" && git checkout --detach FETCH_HEAD; then \
        test "$(git rev-parse HEAD)" = "$MODELS_DEV_REVISION"; exit 0; \
      fi; \
      cd /build; test "$attempt" -lt 3; sleep $((attempt * 5)); \
    done
WORKDIR /build/models-dev
RUN bun install --frozen-lockfile
RUN cd packages/web && bun run build && test -s dist/_api.json

FROM registry.aoliyougei.com/library/node:22-alpine AS pi-builder
ARG PI_VERSION
ARG NVIDIA_API_IPV4
ARG OPENROUTER_IPV4
ARG VERCEL_AI_GATEWAY_IPV4
WORKDIR /build/pi
RUN apk add --no-cache git python3 make g++
COPY source/upstream/pi/package.json source/upstream/pi/package-lock.json source/upstream/pi/.npmrc ./
COPY source/upstream/pi/packages ./packages
COPY source/upstream/pi/scripts ./scripts
COPY scripts/pack-pi-packages.mjs /tmp/pack-pi-packages.mjs
COPY source/upstream/pi/tsconfig*.json source/upstream/pi/vitest.base.ts ./
COPY --from=models-builder /build/models-dev/packages/web/dist/_api.json /tmp/models-dev-api.json
RUN node -e 'const p=require("./packages/coding-agent/package.json");if(p.version!==process.argv[1])process.exit(1)' "$PI_VERSION"
RUN npm ci --ignore-scripts
RUN set -eu; \
    printf '%s %s\n%s %s\n%s %s\n' \
      "$NVIDIA_API_IPV4" integrate.api.nvidia.com \
      "$OPENROUTER_IPV4" openrouter.ai \
      "$VERCEL_AI_GATEWAY_IPV4" ai-gateway.vercel.sh >> /etc/hosts; \
    sed -i 's#https://models.dev/api.json#http://127.0.0.1:18080/api.json#' packages/ai/scripts/generate-models.ts; \
    mkdir -p /tmp/model-api; cp /tmp/models-dev-api.json /tmp/model-api/api.json; \
    python3 -m http.server 18080 --directory /tmp/model-api >/tmp/model-api.log 2>&1 & server=$!; \
    trap 'kill "$server" 2>/dev/null || true' EXIT; \
    ready=; for i in 1 2 3 4 5; do if wget -q -O /dev/null http://127.0.0.1:18080/api.json; then ready=1; break; fi; sleep 1; done; \
    test "$ready" = 1; \
    hydrated=; for attempt in 1 2 3; do if npm run hydrate:model-data; then hydrated=1; break; fi; test "$attempt" -lt 3; sleep $((attempt * 5)); done; \
    test "$hydrated" = 1; kill "$server"; wait "$server" 2>/dev/null || true
RUN npm run build:offline
RUN mkdir -p /artifacts/pi-packages && node /tmp/pack-pi-packages.mjs

FROM registry.aoliyougei.com/library/node:22-alpine AS runtime-builder
RUN apk add --no-cache python3 make g++
WORKDIR /build
COPY --from=pi-builder /artifacts/pi-packages /artifacts/pi-packages
COPY vendor /vendor
COPY bridge-package.lock.json /bridge-package.lock.json
COPY scripts/verify-bridge-artifacts.mjs /tmp/verify-bridge-artifacts.mjs
RUN node /tmp/verify-bridge-artifacts.mjs
RUN files=$(find /artifacts/pi-packages /vendor -name '*.tgz' -type f | sort) && \
    npm install --global --prefix /artifacts/runtime --ignore-scripts $files && \
    cd /artifacts/runtime/lib/node_modules/@aoliyougei/pi-web-agent-server && \
    npm_config_nodedir=/usr/local npm rebuild fs-ext && \
    /artifacts/runtime/bin/pi --version && \
    test -x /artifacts/runtime/bin/pi-agent-rpc

FROM registry.aoliyougei.com/library/node:22-alpine AS runtime
ARG PROJECT_VERSION
ARG PI_VERSION
ARG PI_REVISION
ARG AGENT_SERVER_VERSION
ARG CONTRACT_VERSION
ARG MODELS_DEV_REVISION
LABEL io.pi-agent-rpc.version="$PROJECT_VERSION" \
      io.pi-agent.version="$PI_VERSION" \
      io.pi-agent.revision="$PI_REVISION" \
      io.pi-agent-server.version="$AGENT_SERVER_VERSION" \
      io.pi-agent-contract.version="$CONTRACT_VERSION" \
      io.pi-agent.models-dev.revision="$MODELS_DEV_REVISION"
ENV HOME=/home/node PI_CODING_AGENT_DIR=/home/node/.pi/agent PI_AGENT_RPC_HOST=0.0.0.0 PI_AGENT_RPC_PORT=8080
RUN apk add --no-cache bash ca-certificates curl fd file git jq openssh-client ripgrep && \
    mkdir -p /app /home/node/.pi/agent && chown -R node:node /app /home/node
COPY --from=runtime-builder /artifacts/runtime/ /usr/local/
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY pi-agent-rpc-healthcheck /usr/local/bin/pi-agent-rpc-healthcheck
COPY pi-cli-wrapper.sh /tmp/pi-cli-wrapper.sh
RUN mkdir -p /usr/local/libexec && \
    ln -s /usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js /usr/local/libexec/pi-real && \
    rm /usr/local/bin/pi && mv /tmp/pi-cli-wrapper.sh /usr/local/bin/pi && \
    chmod 0755 /usr/local/bin/pi /usr/local/bin/docker-entrypoint.sh /usr/local/bin/pi-agent-rpc-healthcheck
USER node
WORKDIR /app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["pi-agent-rpc-healthcheck"]
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["pi-agent-rpc"]
