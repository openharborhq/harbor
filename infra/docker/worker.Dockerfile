# Worker image: same code as the API plus the OCR toolchain. Runs with no network egress.
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
# ocrmypdf pulls tesseract, ghostscript, qpdf, unpaper. eng+deu language packs. poppler for pdftotext/pdfinfo.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ocrmypdf tesseract-ocr-eng tesseract-ocr-deu poppler-utils libheif-examples \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /out /app
# Same uid as the api (node, 1000): the blobs it reads and the tmp it writes are bind mounts the
# api owns. A separate uid was isolation in name only and made those mounts unreadable on Linux.
USER node
CMD ["node", "dist/worker.js"]
