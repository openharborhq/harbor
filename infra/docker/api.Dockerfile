# API image: Node only. No PDF/image parsers on purpose (spec §3.6).
FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10.25.0 --activate
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --filter @trustworthier/api...
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @trustworthier/api... build && pnpm --filter @trustworthier/api deploy --prod --legacy /out

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /out /app
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
