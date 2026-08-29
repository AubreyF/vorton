FROM node:22.20.0-bookworm-slim@sha256:b21fe589dfbe5cc39365d0544b9be3f1f33f55f3c86c87a76ff65a02f8f5848e AS build
WORKDIR /src
COPY package.json package-lock.json tsconfig.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/workers/package.json packages/workers/package.json
RUN npm ci --ignore-scripts
COPY apps/worker apps/worker
COPY packages/contracts packages/contracts
COPY packages/workers packages/workers
RUN npm run build --workspace=@aubos/worker-runtime

FROM node:22.20.0-bookworm-slim@sha256:b21fe589dfbe5cc39365d0544b9be3f1f33f55f3c86c87a76ff65a02f8f5848e AS runtime
ENV NODE_ENV=production
ENV AUBOS_CODEX_PATH=/usr/local/bin/codex
WORKDIR /app
COPY --from=build --chown=node:node /src/apps/worker/dist/main.cjs ./main.cjs
COPY --from=build /src/node_modules/@openai/codex /usr/local/lib/node_modules/@openai/codex
COPY --from=build /src/node_modules/@openai/codex-linux-*/vendor /usr/local/lib/node_modules/@openai/codex/vendor
RUN ln -s /usr/local/lib/node_modules/@openai/codex/bin/codex.js /usr/local/bin/codex \
    && codex --version
EXPOSE 8080
CMD ["node", "main.cjs"]
