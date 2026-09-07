# trustworthier — Design Spec

Self-hosted family document vault. A personal replacement for Trustworthy.com,
run on hardware you own, open source.

Status: **design complete, pre-implementation.** UI designed in Paper
(`app.paper.design/file/01M1VQQFCBZZKMYX760BE4STAV`). Implementation plan follows.

## What it does

- **Ingest** paperwork by bulk drag-and-drop, by emailing it to the vault's own mailbox, or by
  connecting a mailbox you already use and letting it find the invoices (§7).
- **OCR** every scanned page so the words inside are searchable; born-digital PDFs skip OCR.
- **Organise** by categories (two levels), the family member a document is *about*, and tags.
- **Suggest** a title, category, items and dates for each new document (pluggable provider).
- **Remind** about expiring documents — passports, policies, registrations.
- **Protect** everything at rest and offsite, with a tested restore path.

## Decisions (locked)

| Area | Decision |
|---|---|
| Users | Shared vault, 2–3 owner accounts, no roles. `users` (who log in) ≠ `items` (who and what documents are about). |
| Stack | Turborepo: `apps/web` (Next, App Router), `apps/api` (Nest: REST + BullMQ worker), `packages/shared` (Zod). Postgres + `tsvector`. Redis. Docker Compose. |
| Hosting | a spare **Protectli**, dedicated to this (not a firewall). Linux + Docker Compose. Reached over Tailscale only. Nothing rented. Disk unlocked by **passphrase at boot** (TPM auto-unlock is an opt-in setting). |
| OCR | `OCRmyPDF` (Tesseract) as a subprocess in an isolated worker container. |
| Suggestions | **LLM summarization + suggestions are a v1 feature** via a `SuggestionProvider` interface; `anthropic` (Claude, structured outputs) is the primary implementation, `none` the heuristic fallback, `ollama` planned. A knowing exception to the no-cloud rule: ~4k chars of OCR text per document goes to the provider. See §5. |
| Ingest | Web bulk upload; email-in via **IMAP** (never inbound SMTP) — both a forwarding mailbox and a connected inbox (§7). OAuth only for Microsoft, via device code; no URL is hardcoded. Phone capture **parked** — phones scan with their own scanner and email the result. |
| Encryption | LUKS volume → app KEK → per-file DEKs. Encrypted offsite backups via restic. No E2EE (server-side OCR/search need plaintext). |
| Open source | Multi-arch images, no telemetry, no secrets in repo, SECURITY.md threat model, printed restore runbook. License **AGPL-3.0**. |

## Approaches considered

- **A — custom Next + Nest monorepo (chosen).** Most work; your stack; one deployable unit; no vendor sees documents.
- **B — Paperless-ngx as engine + custom Next UI.** Skips ~60% of the build, battle-tested, but a Django backend and its data model. The honest choice if the goal is *having* a vault rather than *building* one.
- **C — Next-only with in-process jobs.** Long OCR jobs in a Next process are a poor fit; rejected.

## Open questions

None blocking. (Resolved 2026-09-06: dedicated Protectli; passphrase at boot; AGPL-3.0.)

## Sections

1. [Data model](01-data-model.md)
2. [Ingest & OCR pipeline](02-ingest-pipeline.md)
3. [Security & hosting](03-security-hosting.md)
4. [UI surfaces](04-ui-surfaces.md)
5. [LLM integration](05-llm-integration.md)
6. [Items — people and things](06-items.md)
7. [Email connections](07-email-connections.md)
