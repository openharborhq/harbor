# Milestone 1 — a scan goes in, a word comes out

**Definition of done:** on the Protectli, `docker compose up`, sign in with password + TOTP,
drag a scanned PDF onto Add documents, wait, type a word that appears only inside the scan
into search, get the document back with a highlighted snippet. Bytes on disk are ciphertext.

Everything else (Inbox suggestions, email-in, people, backups, settings) is M2–M6 and bolts
onto this pipeline. Do not start them until this is true on real hardware.

## Stack decisions for M1

| Concern | Choice | Why |
|---|---|---|
| Monorepo | Turborepo + pnpm workspaces | Kai's stack; shared Zod package between web and api |
| API | NestJS 11 | Kai's stack; modules map cleanly onto the pipeline stages |
| Web | Next (App Router) + Tailwind, tokens from Paper | Kai's stack |
| ORM | **Drizzle** + drizzle-kit migrations | SQL-first; first-class `tsvector`, generated columns, GIN indexes. Prisma fights Postgres FTS. |
| Queue | BullMQ on Redis | Retryable, staged jobs; worker is a second Nest entrypoint |
| Crypto | Node `crypto` AES-256-GCM, KEK from a secret file | No extra deps; `key_version` for rotation |
| Auth | `argon2`, `otplib` (TOTP), server-side sessions in Postgres, httpOnly cookie | Spec §3.5 |
| OCR | `ocrmypdf` CLI in the **worker image only** (Debian: ocrmypdf, tesseract eng+deu, poppler-utils, libheif) | Spec §2, §3.6 — API image has no parsers |
| Search | Postgres `tsvector` (weights A/B/C), `websearch_to_tsquery`, `ts_headline` for snippets | Spec §2 stage 3 |
| Storage | `/data/blobs/<uuid>` on the LUKS volume; iv/tag/dek in Postgres | Spec §3.3 |

Deferred from M1 on purpose: invites (one owner created by a CLI `setup` command), recovery
codes UI (generated + printed to stdout), HEIC conversion, LLM provider, IMAP, backups,
Tailscale packaging. Each is a later milestone with its own checklist.

## Repo layout

```
apps/
  web/                 Next App Router. Pages: /sign-in, /sign-in/totp, /inbox (list only), /add, /library
  api/                 Nest. src/modules: auth, crypto, storage, documents, ingest, search, health
                       src/main.ts (HTTP) and src/worker.ts (BullMQ processors) — same code, two entrypoints
packages/
  shared/              Zod schemas + inferred types used by both apps (document, upload, search, auth)
  db/                  Drizzle schema, migrations, client factory (imported by api only)
infra/
  docker/api.Dockerfile      node:22-slim, no OCR tools
  docker/worker.Dockerfile   node:22-slim + ocrmypdf/tesseract/poppler/libheif
  docker/web.Dockerfile
  compose.yml                postgres:16, redis:7, api, worker, web
docs/
  spec/  plan/
```

## Work order

1. [x] Workspace: pnpm + Turborepo, shared tsconfig, eslint, prettier, `.env.example`, `.gitignore`.
2. [x] `packages/db`: Drizzle schema for §1 tables needed in M1 — `users`, `sessions`, `documents`,
       `document_files`, `document_text`, `document_search` (generated `tsvector`), `audit_log`.
       First migration. Local Postgres via compose.
3. [x] `packages/shared`: Zod for `UploadInit`, `DocumentSummary`, `SearchQuery`, `SearchHit`, auth DTOs.
4. [x] `apps/api` auth: `setup` CLI command creates the first owner (argon2 + TOTP secret, prints
       otpauth URI + recovery codes). `/auth/login` → password check → `/auth/totp` → session cookie.
       Guard on every other route. `audit_log` writes.
5. [x] `apps/api` crypto + storage: `CryptoService` (KEK from `TW_KEK_FILE`, wrap/unwrap DEK,
       encrypt/decrypt streams), `BlobStore` (write ciphertext to `/data/blobs/<uuid>`, fsync).
6. [x] `apps/api` ingest: `POST /documents` multipart → temp file → sha256 → duplicate check →
       encrypt → `documents` + `document_files(processing_status=queued)` → enqueue `process-file`.
       `GET /documents/:id/file` decrypts and streams the original.
7. [x] `apps/api` worker: `process-file` processor — sniff type → pdftotext-or-ocrmypdf →
       `document_text` → status updates (`extracting`, `ocr`, `indexing`, `ready`/`failed`,
       `page_progress`). Concurrency `cores-1`, 20-minute timeout, 5 retries with backoff.
8. [x] `apps/api` search: `GET /search?q=` → ranked `tsvector` query, `ts_headline` snippet,
       page number where possible. `GET /documents` list for the Inbox/Library.
9. [ ] `apps/web`: tokens → Tailwind theme; sign-in + TOTP pages; Add documents page with the
       upload queue (poll `processing_status`); Library search with highlighted snippets; a
       minimal document view that streams the original. Match the Paper artboards.
10. [ ] `infra`: Dockerfiles (multi-arch via buildx), `compose.yml`, `/data` volume check that
        refuses to start if not a mount. `pnpm dev` runs postgres+redis+worker in Docker and
        web+api on the host.
11. [ ] Deploy to the Protectli: Debian + LUKS data volume + Docker. Run the definition of done
        with a real scanned German bill and a real born-digital PDF. Record OCR s/page.
12. [ ] Write `docs/deploy.md` from what actually happened in step 11.

## Verified 2026-09-07 (steps 1–8, on the dev Mac)

Born-digital PDF: `pdftotext`, 31 ms, OCR skipped. Same bytes re-uploaded: reported as a
duplicate, not merged. Image-only PDF (0 text chars): `ocrmypdf`, 1 613 ms for one page on an
M3 under Docker, 499 chars recovered; searchable PDF stored as a second blob. Search for a
control word that exists only inside the scan returns it with a `<mark>` snippet in 3 ms.
Download hash equals the original; blobs on disk do not start with `%PDF`. No temp files left.

## Local dev on the M3

Postgres, Redis and the worker run in Docker (the worker image carries the OCR toolchain, so
nothing is installed on the Mac). `web` and `api` run on the host with hot reload. Images are
built for `linux/amd64` for the Protectli and `linux/arm64` for local Docker.
