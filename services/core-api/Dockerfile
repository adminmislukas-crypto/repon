# syntax=docker/dockerfile:1
#
# services/core-api — NestJS backend. Build from the repo root:
#   docker build -f services/core-api/Dockerfile -t repon-core-api .
#
# This is a pnpm workspace with `nodeLinker: hoisted` (see pnpm-workspace.yaml)
# — third-party deps live in a single flat root node_modules, so every stage
# below installs from the repo root, never from services/core-api/ alone.
#
# `@repon/types` (core-api's only workspace dependency) is imported for
# TypeScript types only — `tsc` erases every import, so the compiled `dist/`
# has zero runtime `require("@repon/types")` calls (verified: grepping dist/
# for it returns nothing). The runtime stage therefore never needs
# packages/types/ at all, only core-api's own npm dependencies.

FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
WORKDIR /repo

# ---- manifests only, for the best Docker layer-cache hit rate ----
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/core-api/package.json services/core-api/package.json
COPY packages/types/package.json packages/types/package.json

# ---- build: full workspace install (incl. devDeps) + compile ----
FROM manifests AS build
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/types packages/types
COPY services/core-api services/core-api
RUN pnpm --filter core-api build

# ---- prod-deps: a second, production-only install for the runtime image ----
FROM manifests AS prod-deps
COPY packages/types packages/types
RUN pnpm install --frozen-lockfile --prod --filter core-api...

# ---- runtime ----
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=prod-deps /repo/services/core-api/node_modules ./services/core-api/node_modules
COPY --from=prod-deps /repo/services/core-api/package.json ./services/core-api/package.json
COPY --from=build /repo/services/core-api/dist ./services/core-api/dist

WORKDIR /app/services/core-api
# All required env vars (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
# SUPABASE_ANON_KEY, DATABASE_URL, AUTH_JWT_*, etc.) are validated fail-fast
# at boot by src/config/env.schema.ts — see .env.example for the full list.
# Pass them at `docker run` time (--env-file or -e), never bake them in here.
EXPOSE 3000
CMD ["node", "dist/main.js"]
