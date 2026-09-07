# Worker image: same code as the API plus the OCR toolchain. Runs with no network egress.
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
# ocrmypdf pulls tesseract, ghostscript, qpdf, unpaper. eng+deu language packs. poppler for pdftotext/pdfinfo.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ocrmypdf tesseract-ocr-eng tesseract-ocr-deu poppler-utils libheif-examples \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -u 10001 -r -s /usr/sbin/nologin worker
COPY --from=build /out /app
USER 10001
CMD ["node", "dist/worker.js"]
