FROM node:22.20.0-bookworm-slim@sha256:b21fe589dfbe5cc39365d0544b9be3f1f33f55f3c86c87a76ff65a02f8f5848e AS build
WORKDIR /src
COPY . .
RUN npm ci --ignore-scripts && npm run build --workspace=@aubos/web

FROM nginx:1.28.0-alpine@sha256:30f1c0d78e0ad60901648be663a710bdadf19e4c10ac6782c235200619158284
COPY apps/web/nginx.conf /etc/nginx/aubos.conf.template
COPY apps/web/docker-entrypoint.d/40-aubos-runtime-config.sh /docker-entrypoint.d/40-aubos-runtime-config.sh
COPY --from=build /src/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
