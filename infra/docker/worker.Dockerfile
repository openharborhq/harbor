# Worker image: same code as the API plus the OCR toolchain. Runs with no network egress.
FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10.25.0 --activate
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
# In the graph because the API seals share bundles with it. Without its package.json here,
# pnpm installs none of its devDependencies and the workspace build fails on `tsc: not found`.
COPY packages/bundle/package.json packages/bundle/
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
      ocrmypdf tesseract-ocr-eng tesseract-ocr-deu poppler-utils libheif-examples python3-venv \
    && rm -rf /var/lib/apt/lists/*
# Turns phone photos into scans before OCR (spec §2 stage 1b). Headless OpenCV from pinned,
# hashed wheels: Debian's python3-opencv drags in a GUI stack four times the size. The self-test
# photographs a synthetic page and checks it comes back flat and A4, so a broken install fails
# the build instead of leaving every photo quietly uncleaned. pip goes once it is done: the worker
# never installs anything, and it is 23 MB of the 190.
COPY infra/docker/scan-requirements.txt /opt/scan/requirements.txt
RUN python3 -m venv /opt/scan \
    && /opt/scan/bin/pip install --no-cache-dir --require-hashes --only-binary=:all: -r /opt/scan/requirements.txt \
    && rm -rf /opt/scan/bin/pip* /opt/scan/lib/python3*/site-packages/pip* /opt/scan/lib/python3*/site-packages/setuptools*
COPY apps/api/src/processing/scan_cleanup.py /opt/scan/scan_cleanup.py
RUN /opt/scan/bin/python /opt/scan/scan_cleanup.py --self-test
COPY --from=build /out /app
# Same uid as the api (node, 1000): the blobs it reads and the tmp it writes are bind mounts the
# api owns. A separate uid was isolation in name only and made those mounts unreadable on Linux.
USER node
CMD ["node", "dist/worker.js"]
