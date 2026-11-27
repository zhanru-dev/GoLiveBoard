# syntax=docker/dockerfile:1

# Production images, built from the repository root:
#
#   docker build -f infra/docker/Dockerfile --target api -t goliveboard-api .
#   docker build -f infra/docker/Dockerfile --target web -t goliveboard-web .
#
# `api` runs three ways from one image, so what is migrated, served and
# worked on is always the same build:
#   (default)                                   the HTTP API
#   node --import ./dist/telemetry.js dist/worker.js   the background worker
#   node ../../node_modules/prisma/build/index.js migrate deploy
#                                               the migrations
#
# Both targets build for linux/amd64 and linux/arm64 (the AWS host is ARM).
# They run as the unprivileged `node` user, own none of their files, and keep
# no build tools: the runtime stages copy only compiled output and production
# dependencies.

# Building for arm64 on an x86 machine runs each step under QEMU, whose
# default CPU model ("max", with experimental features such as SME) makes
# Prisma's WebAssembly schema parser panic. A Graviton CPU model (Neoverse-N1)
# does not. QEMU reads this variable; a native build ignores it. As a build
# argument, never an ENV, it stays out of the images.
ARG QEMU_CPU=neoverse-n1

# Both base stages start from the same Node.js image, by exact version and digest:
# a tag can be moved, a digest cannot. Dependabot proposes updates to both.

# Building: Node.js with npm.
FROM node:26.13.1-alpine3.24@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS base
ARG QEMU_CPU
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Running: Node.js and tini, without npm. Nothing installs packages at run
# time, and npm's own dependencies would only bring vulnerabilities to patch.
FROM node:26.13.1-alpine3.24@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS runtime
ARG QEMU_CPU
# Alpine publishes security fixes before the Node.js image is rebuilt on
# them: the image above ships zlib 1.3.2-r1 and OpenSSL 3.5.9-r0, which ECR's
# scan flagged (1 critical, 4 high) while 1.4-r0 and 3.5.9-r1 were already
# out. So the runtime upgrades its OS packages at build time, and CI fails
# an image that still has one with a newer version available
# (scripts/check-image-packages.sh). Node.js bundles its own OpenSSL and
# zlib; only apk and busybox use these.
# tini runs as PID 1: it forwards SIGTERM to Node.js (which then shuts down
# gracefully) and reaps orphaned processes, which Node.js does not do.
RUN apk upgrade --no-cache \
 && apk add --no-cache tini \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
WORKDIR /app

# The manifests and the Prisma schema, which `npm ci` needs: the API's
# postinstall step generates the Prisma client from the schema.
FROM base AS manifests
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/prisma.config.ts apps/api/
COPY apps/api/prisma apps/api/prisma
COPY apps/web/package.json apps/web/

# Every dependency, for compiling.
FROM manifests AS deps
ARG QEMU_CPU
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

FROM deps AS build
ARG QEMU_CPU
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/api apps/api
COPY apps/web apps/web
RUN npm run build -w @goliveboard/contracts \
 && npm run build -w @goliveboard/api \
 && npm run build -w @goliveboard/web

# The API's production dependencies only. They include the Prisma CLI, which
# `@prisma/client` declares as an optional peer, so the image can migrate.
FROM manifests AS api-deps
ARG QEMU_CPU
# npm installs a dependency under apps/api/node_modules when its version
# differs from the one hoisted to the root (`cookie`: the API's 2.x beside
# Express's 0.7). Both directories go into the image; mkdir keeps the COPY
# below valid when nothing needs nesting.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --workspace @goliveboard/api --no-audit --no-fund \
 && mkdir -p apps/api/node_modules

FROM runtime AS api
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=4301
# Files copied from the checkout keep its permissions, which depend on the
# machine (a umask of 077 makes them unreadable to `node`). The runtime stages
# set them: readable by everyone, writable by no one but root.
COPY --from=api-deps --chmod=a+rX,go-w /app/node_modules node_modules
COPY --from=api-deps --chmod=a+rX,go-w /app/apps/api/node_modules apps/api/node_modules
COPY --chmod=a+rX,go-w package.json ./
COPY --chmod=a+rX,go-w packages/contracts/package.json packages/contracts/
COPY --from=build --chmod=a+rX,go-w /app/packages/contracts/dist packages/contracts/dist
COPY --chmod=a+rX,go-w apps/api/package.json apps/api/prisma.config.ts apps/api/
COPY --chmod=a+rX,go-w apps/api/prisma apps/api/prisma
COPY --from=build --chmod=a+rX,go-w /app/apps/api/dist apps/api/dist
WORKDIR /app/apps/api
USER node
EXPOSE 4301
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--enable-source-maps", "--import", "./dist/telemetry.js", "dist/main.js"]

# Next.js standalone output: the server and only the files it traced as used.
FROM runtime AS web
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3301
COPY --from=build --chmod=a+rX,go-w /app/apps/web/.next/standalone ./
COPY --from=build --chmod=a+rX,go-w /app/apps/web/.next/static apps/web/.next/static
USER node
EXPOSE 3301
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]
