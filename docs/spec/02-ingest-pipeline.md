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
| HEIC (iPhone) | `libheif` → JPEG → Stage 1b → wrap in PDF |
| JPEG / PNG | Stage 1b → wrap in PDF |
| Office documents | **stored as-is, not searchable** (LibreOffice is ~500 MB for a rare case; not in v1) |

Skipping OCR on born-digital PDFs is the most important performance decision in the build —
statements, policies and tax forms mostly arrive with a text layer, and on a low-TDP box
wasted OCR is measured in minutes.

## Stage 1b — Photo to scan

A phone photo of a letter is not a scan: the page is a trapezoid on a table, lit unevenly, often
still bent where it was folded for the envelope. Printed again it comes out grey, skewed and
smaller than the paper was. Before OCR, every photo goes through
`apps/api/src/processing/scan_cleanup.py` (OpenCV, in the worker image at `/opt/scan`):

1. **Find the page.** Several outlines are tried — edges, brightness, "bright and colourless",
   local contrast — and the largest convincing four-cornered one wins. A page that runs off the
   photo's edge (the usual close-up) is found as a *partial* outline: the table is cropped away,
   the cut edge kept.
2. **Flatten it to its real proportions.** The page's true aspect is recovered from the
   perspective (Zhang & He, 2007) and snapped to A4 or US Letter when within 4%, so it prints at
   its real size; the script reports the DPI that does that, and ocrmypdf gets it as
   `--image-dpi`.
3. **Straighten folds.** A letter folded in three does not lie flat; its side edges bend at each
   fold. When they do, the page is cut along the folds and each panel is flattened on its own.
4. **Whiten.** The paper is estimated per colour channel with a window wider than any logo, and
   divided out: shadows and colour cast go, ink and stamps keep their colour.
5. **Drop show-through.** The back of a thin page shows through it as faint mirrored text, which
   whitening leaves as light grey that reads like content. Marks lighter than any ink's core,
   with no dark ink near them, on white paper, become paper. Halftone fills — the grey boxes on a
   bill — are faint dots too, but grey on average, and are kept.

The scan replaces the photo as the input to Stage 2, so the searchable PDF *is* the scan.
ocrmypdf runs without `--deskew` on it: the scan is square to the page's own edges, and on a
folded letter with show-through, deskew's guess from the text lines turned it 3° askew. The
photo is never touched and stays the file's original. `document_files.scan_outline` records which
outline was used (`page`, `partial`, or `none` for a photo that is all paper and was only
whitened); it is null for everything else.

**Best-effort, never a failure.** When no outline holds — a receipt on a patterned table — the
script declines and the photo is OCR'd as it was taken: whitening a table along with the page
turns it grey. A crash, a missing venv (`pnpm dev`), or a result the worker does not understand
does the same. Photos uploaded before this stage existed are **not reprocessed**.

**What people see.** When a file has a scan, the app shows, opens, downloads and shares the scan
(`GET /documents/:id/file?copy=scan`, named after the document).

**Two controls, no knobs.** Each document with a scan has a **Scan | Photo** switch
(`document_files.prefer_original`): choosing Photo makes the view, Download, Full size and shares
use the original, for when a scan came out wrong. Search keeps reading the scan's text.
**Settings → Documents → Turn photos into scans** (`documents.photosToScans`, on unless set to
`false`) is read by the worker per job; off, new photos are OCR'd as taken and existing scans stay.
The thresholds are deliberately not settings: a wrong value is fixed in code, for everyone.

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
Emailed photos arrive as HEIC/JPEG and hit the Stage 1 conversion path, and Stage 1b turns them
into scans — so a photo taken with the camera, not only the phone's scanner, comes out as one.
