# syntax=docker/dockerfile:1

# Four stages: deps, build, prod-deps, and a distroless non-root runtime. Both base images are pinned by
# index digest (amd64 and arm64); re-inspect them with `docker buildx imagetools inspect` before bumping.

FROM node:26-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Install scripts are off: node-gyp would try to compile better-sqlite3, which ships prebuilds (T-14-45).
RUN npm ci --ignore-scripts

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY next.config.ts tsconfig.json postcss.config.mjs ./
COPY src ./src
# next build type-checks every file tsconfig includes, colocated tests and test/fixtures among them.
COPY test ./test
# Fonts are local, so the build needs no network after the install.
RUN --network=none node node_modules/next/dist/bin/next build
RUN mkdir -p /out/data /out/backups

FROM node:26-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM gcr.io/distroless/nodejs26-debian13:nonroot@sha256:33c86a63859efc2ebd88ea0a355863582ec6f1220d048de62baffb2584e709b3 AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_USE_ENV_PROXY=1 \
    NO_PROXY=localhost,127.0.0.1,::1 \
    HOSTNAME=0.0.0.0 \
    PORT=4000 \
    HAVADIS_DATA_DIR=/data \
    HAVADIS_BACKUP_DIR=/backups \
    NODE_OPTIONS=--disable-warning=MODULE_TYPELESS_PACKAGE_JSON
# The full production node_modules goes first (the worker and the command need it), the traced standalone server over it.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/src ./src
COPY --chmod=755 bin/havadis /usr/local/bin/havadis
# A fresh named volume inherits the owner of the directory it is mounted over.
COPY --from=build --chown=65532:65532 /out/data /data
COPY --from=build --chown=65532:65532 /out/backups /backups
USER 65532:65532
EXPOSE 4000
CMD ["server.js"]
