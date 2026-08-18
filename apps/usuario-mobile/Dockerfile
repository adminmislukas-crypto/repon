# syntax=docker/dockerfile:1
#
# apps/usuario-mobile — Expo Router web export, served as a static site.
# Build from the repo root:
#   docker build -f apps/usuario-mobile/Dockerfile \
#     --build-arg EXPO_PUBLIC_API_URL=https://api.example.com \
#     -t repon-usuario-mobile .
#
# Expo inlines every `EXPO_PUBLIC_*` var into the JS bundle at export time
# (see apps/usuario-mobile/.env.example) — it must be a build arg, not a
# runtime env var; changing it means rebuilding the image.
#
# `web.output: "static"` in app.json (metro bundler) makes `expo export`
# produce one static HTML file per route, not a single SPA shell — this
# image just serves that output directory with nginx.

FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
WORKDIR /repo

# ---- manifests only, for the best Docker layer-cache hit rate ----
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/types/package.json packages/types/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY apps/usuario-mobile/package.json apps/usuario-mobile/package.json

# ---- build: full workspace install (Metro needs devDeps too) + export ----
FROM manifests AS build
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/types packages/types
COPY packages/auth packages/auth
COPY apps/usuario-mobile apps/usuario-mobile

ARG EXPO_PUBLIC_API_URL
ENV EXPO_PUBLIC_API_URL=${EXPO_PUBLIC_API_URL}
ENV EXPO_USE_METRO_WORKSPACE_ROOT=1
# `pnpm --filter` runs inside apps/usuario-mobile, but from the repo-root
# install above — matches the workspace's own EXPO_USE_METRO_WORKSPACE_ROOT
# convention (see apps/usuario-mobile/metro.config.js).
RUN pnpm --filter usuario-mobile exec expo export --platform web

# ---- runtime: static file server ----
FROM nginx:1.27-alpine AS runtime
COPY apps/usuario-mobile/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/usuario-mobile/dist /usr/share/nginx/html
EXPOSE 80
