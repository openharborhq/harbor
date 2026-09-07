# 2. Ingest & OCR pipeline

**Principle:** the original bytes are sacred and the user sees the file immediately.
Everything else is a retryable background stage. A failed OCR degrades to "filed but not
searchable", never to lost paperwork.

## Stage 0 — Intake (synchronous)

Stream to a temp file computing sha256 → encrypt with a fresh DEK → write blob → create
`documents` (`category_id NULL`) + `document_files` (`processing_status = queued`) → enqueue
→ return. The card appears in the Inbox instantly with a spinner.

**Duplicates.** Content-addressed storage and per-file DEKs don't compose: identical
plaintext under different keys is different ciphertext, and sharing blobs would require
convergent encryption, which leaks equality. So `sha256` is used to *detect* duplicates and
prompt — "Add as new version" / "Skip" — but blobs are never shared. No refcount, no GC.

## Stage 1 — Normalize

Route by sniffed content type, not extension:

| Input | Handling |
|---|---|
| PDF **with** text layer | `pdftotext`; **skip OCR entirely** |
| PDF without text layer | → Stage 2 |
| HEIC (iPhone) | `libheif` → JPEG → wrap in PDF |
| JPEG / PNG | wrap in PDF |
| Office documents | **stored as-is, not searchable** (LibreOffice is ~500 MB for a rare case; not in v1) |

Skipping OCR on born-digital PDFs is the most important performance decision in the build —
statements, policies and tax forms mostly arrive with a text layer, and on a low-TDP box
wasted OCR is measured in minutes.

## Stage 2 — OCR (only when Stage 1 says so)

`ocrmypdf --skip-text --rotate-pages --deskew --optimize 1` as a subprocess inside the
isolated worker (§3.6). Output: a searchable PDF stored separately (`searchable_pdf_key`)
plus extracted text.

**Budget:** 2–5 s/page/core on fanless x86. Worker concurrency = `cores − 1`. Hard per-job
timeout. Documents over ~100 pages are flagged for confirmation rather than processed
silently. `page_progress` is updated per page for the upload UI.

## Stage 3 — Index

Build `tsv` weighted A = title, B = tags + items + notes + category path + aliases, C = OCR
text + the model summary — each under `simple`, `german` and `english` at once, so a query
stemmed by any of them matches. `document_search.terms` carries the same names as plain text for
the trigram fallback. One place builds it — `SearchIndexService.reindex()` — called by the worker here
and again by the suggester once the summary exists, so the two can never disagree. The index is a cache —
rebuildable from source at any time, never the source of truth.

## Stage 4 — Suggest

Send the first ~4k characters to the configured `SuggestionProvider` (§5); write the result
to `suggestions`, never to `documents`. Payload: summary, title, category, items,
document_date, expires_at, tags, confidence. Provider failure is non-fatal. The `anthropic`
provider is the primary v1 path; `none` (heuristics: sender → item, filename date →
document date) is the fallback, and the Inbox has a first-class card state for it.

Runs in the `suggester` container — the only processing container with internet egress.

## Failure handling

Every stage idempotent and retryable via BullMQ. Poison jobs → `processing_status = failed`
with `processing_error`, visible on the upload row and the Inbox card with a Retry action.

## Email-in

**IMAP, never inbound SMTP.** No public MX, no port 25, no spam stack; works behind NAT;
fails closed (mail queues at the provider if the fetcher is down).

Two models, both shipping — the **forwarding mailbox** described here, and the **connected
inbox** of §7, which points the vault at a mailbox you already use. The rules below are the
common floor; §7 says where a connected inbox differs and why.

- Fetch from the vault mailbox (`vault@…`) over IMAP/TLS with an app password. **IDLE with a
  periodic resync**, not a fixed poll interval (§7.5).
- **Allowed senders** list. Mail from anyone else is **held for review** (`status = held`,
  raw message kept in `raw_blob_key`) — never dropped silently, never auto-ingested. On a
  connected inbox this list is built by the backfill dry-run (§7.6).
- Attachments only (PDF, images); size caps. Each attachment is untrusted input and goes
  through the isolated worker. HTML bodies are ignored here; on a connected inbox they are a
  first-class case, since many invoices have no attachment at all (§7.9).
- Processed mail is deleted from the mailbox after 30 days. **This applies only to a
  dedicated forwarding mailbox** — the vault never deletes from a mailbox it does not own
  (§7.8).

## Phone capture — parked

A dedicated mobile scan flow was designed (two artboards, marked *Parked* in Paper) and then
deferred. The phone path is: scan with the phone's own scanner, email it to the vault.
Emailed photos arrive as HEIC/JPEG and hit the Stage 1 conversion path.
