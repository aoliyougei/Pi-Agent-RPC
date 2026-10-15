# syntax=docker/dockerfile:1

FROM registry.aoliyougei.com/library/node:22-alpine AS pi-builder
WORKDIR /build/pi
RUN apk add --no-cache git python3 make g++ linux-headers curl
COPY source/upstream/pi/ ./
RUN npm ci --ignore-scripts
# Hydrate the official immutable catalog pinned by this source release.
RUN revision=$(node -p 'require("./nix/model-catalog.json").revision') && \
    curl -fL --retry 3 "https://pi.dev/api/models/revisions/${revision}?types=chat,image,classifier" -o /tmp/models.all.json && \
    printf '%s  %s\n' "${revision#sha256-}" /tmp/models.all.json | sha256sum -c - && \
    node packages/ai/scripts/hydrate-model-catalog.ts /tmp/models.all.json
RUN npm run build:offline
COPY scripts/pack-pi-packages.mjs /tmp/pack-pi-packages.mjs
RUN mkdir -p /artifacts/pi-packages && node /tmp/pack-pi-packages.mjs

FROM registry.aoliyougei.com/library/node:22-alpine AS server-builder
WORKDIR /build
RUN apk add --no-cache python3 make g++ linux-headers
COPY package.json package-lock.json ./
COPY packages/ ./packages/
COPY source/upstream/pi/packages/ ./source/upstream/pi/packages/
RUN npm ci --ignore-scripts
COPY --from=pi-builder /build/pi/packages/ ./source/upstream/pi/packages/
RUN npm run build
RUN mkdir -p /artifacts/server && \
    npm pack --workspace=@aoliyougei/pi-agent-contract --ignore-scripts --pack-destination /artifacts/server && \
    npm pack --workspace=@aoliyougei/pi-web-agent-server --ignore-scripts --pack-destination /artifacts/server

FROM registry.aoliyougei.com/library/node:22-alpine AS runtime-builder
RUN apk add --no-cache python3 make g++ linux-headers
COPY --from=pi-builder /artifacts/pi-packages/ /artifacts/pi-packages/
COPY --from=server-builder /artifacts/server/ /artifacts/server/
RUN files=$(find /artifacts/pi-packages /artifacts/server -name '*.tgz' -type f | sort) && \
    npm install --global --prefix /artifacts/runtime --ignore-scripts $files && \
    cd /artifacts/runtime/lib/node_modules/@aoliyougei/pi-web-agent-server && \
    npm_config_nodedir=/usr/local npm rebuild fs-ext && \
    /artifacts/runtime/bin/pi --version

FROM registry.aoliyougei.com/library/node:22-alpine AS runtime
LABEL io.pi-agent-rpc.version="0.2.0" \
      io.pi-agent.version="1.2.0" \
      io.pi-agent.revision="06a466935536f8c9bcacb2d5efc0fc021be1bdff" \
      io.pi-agent-server.version="0.2.0" \
      io.pi-agent-contract.version="0.1.0"
ENV HOME=/home/node PI_CODING_AGENT_DIR=/home/node/.pi/agent PI_AGENT_RPC_HOST=0.0.0.0 PI_AGENT_RPC_PORT=8080
RUN apk add --no-cache bash ca-certificates curl fd file git jq openssh-client ripgrep && \
    mkdir -p /app /home/node/.pi/agent && chown -R node:node /app /home/node
COPY --from=runtime-builder /artifacts/runtime/ /usr/local/
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY pi-agent-rpc-healthcheck /usr/local/bin/pi-agent-rpc-healthcheck
COPY pi-cli-wrapper.sh /tmp/pi-cli-wrapper.sh
# Use the unbundled CLI so preload and CLI share the same guarded SDK classes.
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
