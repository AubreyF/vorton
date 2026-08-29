FROM node:22.20.0-bookworm-slim@sha256:b21fe589dfbe5cc39365d0544b9be3f1f33f55f3c86c87a76ff65a02f8f5848e AS build
WORKDIR /src
ARG VITE_AUBOS_SUPABASE_URL
ARG VITE_AUBOS_SUPABASE_ANON_KEY
ARG VITE_AUBOS_API_URL
ENV VITE_AUBOS_SUPABASE_URL=$VITE_AUBOS_SUPABASE_URL
ENV VITE_AUBOS_SUPABASE_ANON_KEY=$VITE_AUBOS_SUPABASE_ANON_KEY
ENV VITE_AUBOS_API_URL=$VITE_AUBOS_API_URL
COPY . .
RUN npm ci --ignore-scripts && npm run build --workspace=@aubos/web

FROM nginx:1.28.0-alpine@sha256:30f1c0d78e0ad60901648be663a710bdadf19e4c10ac6782c235200619158284
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
