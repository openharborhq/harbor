# API image: Node only. No PDF/image parsers on purpose (spec §3.6).
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
COPY --from=build /out /app
# The release notes travel with the image, so a vault with no route out can still say what changed.
COPY CHANGELOG.md /app/CHANGELOG.md
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
