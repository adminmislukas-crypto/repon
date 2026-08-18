# syntax=docker/dockerfile:1
#
# apps/proveedor-mobile — Expo Router web export, served as a static site.
# Build from the repo root:
#   docker build -f apps/proveedor-mobile/Dockerfile \
#     --build-arg EXPO_PUBLIC_API_URL=https://api.example.com \
#     -t repon-proveedor-mobile .
#
# Mirror of apps/usuario-mobile/Dockerfile — see that file's comments for the
# full rationale (workspace hoisting, EXPO_PUBLIC_* build-time inlining,
# static per-route export). Kept as a separate file, not a shared base image,
# so each app's dependency drift stays independently visible in its own
# Docker build cache.

FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
WORKDIR /repo

# ---- manifests only, for the best Docker layer-cache hit rate ----
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/types/package.json packages/types/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY apps/proveedor-mobile/package.json apps/proveedor-mobile/package.json

# ---- build: full workspace install (Metro needs devDeps too) + export ----
FROM manifests AS build
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/types packages/types
COPY packages/auth packages/auth
COPY apps/proveedor-mobile apps/proveedor-mobile

ARG EXPO_PUBLIC_API_URL
ENV EXPO_PUBLIC_API_URL=${EXPO_PUBLIC_API_URL}
ENV EXPO_USE_METRO_WORKSPACE_ROOT=1
RUN pnpm --filter proveedor-mobile exec expo export --platform web

# ---- runtime: static file server ----
FROM nginx:1.27-alpine AS runtime
COPY apps/proveedor-mobile/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/proveedor-mobile/dist /usr/share/nginx/html
EXPOSE 80
