FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10.25.0 --activate
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/share/package.json apps/share/
COPY packages/bundle/package.json packages/bundle/
RUN pnpm install --frozen-lockfile --filter @harbor/share...
COPY packages/bundle ./packages/bundle
COPY apps/share ./apps/share
RUN pnpm --filter @harbor/share... build

FROM base AS runtime
ARG HARBOR_VERSION=dev
ARG HARBOR_COMMIT=unknown
ENV HARBOR_VERSION=$HARBOR_VERSION HARBOR_COMMIT=$HARBOR_COMMIT
LABEL org.opencontainers.image.version=$HARBOR_VERSION \
      org.opencontainers.image.revision=$HARBOR_COMMIT \
      org.opencontainers.image.source=https://github.com/openharborhq/harbor
ENV NODE_ENV=production
# The doorman (spec §10.2). Nothing else from the monorepo is copied in: no API, no database
# client, no KEK, no framework. What it can reach is a share directory mounted read-only and one
# writable state directory — so a compromise here holds the bundles that were already being
# handed out, and nothing else.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/bundle ./packages/bundle
COPY --from=build /app/apps/share/dist ./apps/share/dist
COPY --from=build /app/apps/share/node_modules ./apps/share/node_modules
USER node
EXPOSE 4010
CMD ["node", "apps/share/dist/main.js"]
