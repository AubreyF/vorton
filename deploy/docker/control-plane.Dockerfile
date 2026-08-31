FROM node:22.20.0-bookworm-slim@sha256:b21fe589dfbe5cc39365d0544b9be3f1f33f55f3c86c87a76ff65a02f8f5848e AS build
WORKDIR /src
COPY package.json package-lock.json tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/executive/package.json packages/executive/package.json
COPY packages/kernel/package.json packages/kernel/package.json
COPY packages/memory/package.json packages/memory/package.json
COPY packages/workers/package.json packages/workers/package.json
RUN npm ci --ignore-scripts
COPY apps/api apps/api
COPY packages/contracts packages/contracts
COPY packages/database packages/database
COPY packages/executive packages/executive
COPY packages/kernel packages/kernel
COPY packages/memory packages/memory
COPY packages/workers packages/workers
RUN npm run build --workspace=@vorton/api

FROM node:22.20.0-bookworm-slim@sha256:b21fe589dfbe5cc39365d0544b9be3f1f33f55f3c86c87a76ff65a02f8f5848e AS runtime
ENV NODE_ENV=production
USER node
WORKDIR /app
COPY --from=build --chown=node:node /src/apps/api/dist/main.cjs ./main.cjs
EXPOSE 8080
CMD ["node", "main.cjs"]
