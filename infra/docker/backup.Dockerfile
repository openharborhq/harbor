# Backup image: the API code plus restic and the Postgres 16 client tools (spec §3.4).
# It is the only container that talks to the backup repository; it never opens a document.
FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10.25.0 --activate
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --filter @harbor/api...
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @harbor/api... build && pnpm --filter @harbor/api deploy --prod --legacy /out

FROM base AS runtime
ENV NODE_ENV=production
# Stamped at build so a running vault can say what it is. "dev" when built by hand.
ARG HARBOR_VERSION=dev
ARG HARBOR_COMMIT=unknown
ENV HARBOR_VERSION=$HARBOR_VERSION HARBOR_COMMIT=$HARBOR_COMMIT
LABEL org.opencontainers.image.version=$HARBOR_VERSION \
      org.opencontainers.image.revision=$HARBOR_COMMIT \
      org.opencontainers.image.source=https://github.com/openharborhq/harbor
# pg_dump/pg_restore must match the server's major version (postgres:16); Debian ships 15, so PGDG.
# restic comes from upstream, pinned and checksummed: Debian's 0.14 opens files with O_NOATIME,
# which Docker Desktop's virtiofs answers with EIO, so every file "could not be read" on a Mac.
ARG RESTIC_VERSION=0.17.3
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg bzip2 \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends postgresql-client-16 \
    && arch="$(dpkg --print-architecture)" \
    && cd /tmp \
    && curl -fsSLO "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_${arch}.bz2" \
    && curl -fsSLO "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/SHA256SUMS" \
    && sha256sum --check --ignore-missing SHA256SUMS \
    && bunzip2 "restic_${RESTIC_VERSION}_linux_${arch}.bz2" \
    && install -m 0755 "restic_${RESTIC_VERSION}_linux_${arch}" /usr/local/bin/restic \
    && rm -f /tmp/restic_* /tmp/SHA256SUMS \
    && apt-get purge -y curl gnupg bzip2 && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY --from=build /out /app
USER node
CMD ["node", "dist/backup.js"]
