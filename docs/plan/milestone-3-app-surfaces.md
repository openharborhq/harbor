# Milestone 3 — the upload path, then the rest of the app

Direction from Kai (2026-09-07): the Inbox is good enough for now; make the upload path solid and
build out the remaining screens from the Paper file. Email-in (IMAP) moves to a later milestone.

**Definition of done:** every artboard in the Paper file except Settings › backups has a working
page; a family can add, find, open, edit, and delete documents without touching the API; the
upload page can file documents directly (batch defaults) so the Inbox is optional.

## A. Upload path (the feature most likely to decide whether the vault gets used)

1. [x] **Batch defaults** from the design: FOR, FILE TO and TAGS applied to every file in the
       batch at upload time (`POST /documents` accepts `categoryId`, `personIds`, `tags`). A file
       uploaded with a category skips the Inbox entirely.
2. [x] **Bounded concurrency** in the queue (3 uploads at a time; the rest show "waiting"), plus
       Pause / Cancel remaining, and Retry on a failed row.
3. [~] Unknown types are refused up front with a clear row; folder traversal still to do. **Folder drops** (`webkitGetAsEntry` traversal) and a clear "not supported" row for
       unknown types instead of a failed upload.
4. [ ] **Photos**: HEIC from an iPhone through the worker (`heif-convert`) verified with a real
       file; JPEG/PNG OCR verified.
5. [x] **Versions**: "Add as new version" actually creates a version on the existing document
       (`document_files.version`, `is_current`) instead of a second document.
6. [ ] Large-file behaviour: a 100-page scan shows page progress; the 200 MB limit fails cleanly.

## B. The rest of the app

7. [x] **Home**: family cards with record counts and next expiry, the category grid with counts,
       Expiring soon (next 90 days, from `expires_at`), Recently added. Needs `GET /home`.
8. [x] **Person page**: header, key-document slots (`person_key_documents`, incl. "Not on file"),
       filter chips, document table. `GET/PATCH /people/:id`, key-document endpoints.
9. [x] **Document detail** as the modal in the design: Details (editable: title, category,
       people, dates, tags, notes), Extracted text (`GET /documents/:id/text`), Versions,
       Activity (`audit_log` for the document); Delete = soft delete with a Recently deleted list
       and restore.
10. [x] **Library browse**: category tree + table view, sort, filters by person/source/date;
        search results get category paths and "page N of M".
11. [ ] **Categories management**: create (already), rename, reorder, pin to sidebar (`user_pins`).
12. [ ] **Settings** (account + household only for now): change password, regenerate recovery
        codes, invite the second owner, sessions list with revoke, reset another owner's access.
        Backups/forwarding/appliance panels wait for their milestones.
13. [ ] Empty states and error states for every page.

Order of work: A1 → A2 → A5 → B7 → B9 → B8 → B10 → B12 → A3/A4/A6 → B11 → B13.
