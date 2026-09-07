# 1. Data model

Central distinction: **users** log in; **items** are the people and things a document is
about — family members, a house, a car, an account (§6). Never conflate them.

```
users                id, email, password_hash (argon2id), totp_secret_enc, totp_enabled,
                     display_name, status, last_login_at
invites              id, email, token_hash, expires_at, created_by, accepted_at
sessions             id, user_id, token_hash, expires_at, ip, user_agent, revoked_at
document_views       user_id, document_id, viewed_at   -- one row per pair; reopening moves it

items                id, kind (person|property|vehicle|account|policy|pet|business|other),
                     label, details jsonb, parent_id (nullable, self-reference), notes,
                     sort_order
item_key_documents   item_id, kind, document_id (NULL = "not on file"), sort_order

categories           id, name, slug, parent_id (nullable, depth ≤ 2), icon, sort_order
tags                 id, name, slug, color

documents            id, title, category_id (NULL = Inbox), notes, document_date,
                     expires_at, status, source (upload|email), created_by,
                     created_at, updated_at, deleted_at
document_items       document_id, item_id
document_tags        document_id, tag_id

document_files       id, document_id, version, is_current,
                     storage_key (uuid path), sha256 (non-unique, for duplicate detection),
                     original_filename, mime_type, byte_size, page_count,
                     dek_wrapped, iv, auth_tag, key_version,
                     processing_status (queued|extracting|ocr|indexing|suggesting|ready|failed),
                     processing_error, page_progress, uploaded_by
document_text        document_file_id, text_content, ocr_engine, ocr_ms,
                     searchable_pdf_key, completed_at
document_search      document_id, tsv (GIN)   -- A: title, B: tags+items+notes+category, C: text+summary

suggestions          id, document_id, model, payload jsonb, created_at,
                     accepted_at, rejected_at
mail_connections     id, owner_user_id, label, email_address, auth_kind, provider_hint,
                     imap_host, imap_port, imap_username,
                     secret_enc, iv, auth_tag, key_version,
                     scope_mode (folder|full_mailbox), folders[], write_back, retention_days,
                     status, status_detail, last_ok_at, last_sync_at, uidvalidity jsonb
mail_senders         id, connection_id, from_addr, decision (file|ignore|hold),
                     default_category_id, default_item_ids[], default_tag_ids[], learned_from
email_ingest_log     id, connection_id, message_id, imap_uid, tier, from_addr, subject,
                     status (accepted|held|rejected), raw_blob_key, received_at,
                     document_ids[]   -- unique (connection_id, message_id)
backup_runs          id, kind (backup|restore_test), status, started_at, finished_at,
                     snapshot_id, bytes, document_count, detail
audit_log            id, actor_user_id, action, entity_type, entity_id, metadata jsonb,
                     ip, created_at
```

## Decisions

- **`documents` ≠ `document_files`.** A document is the logical thing; files are immutable
  versions. Re-scanning a passport adds a version. Originals are never mutated; OCR output
  lands in `document_text` and a separate searchable-PDF blob.
- **Inbox is `category_id IS NULL`**, not a special category. Every ingest path drops here.
- **`suggestions` is its own table.** Model output is a proposal; it can never silently
  overwrite typed data, and a better model can be re-run over old documents.
- **`audit_log` from day one.** "Who moved the deed?" cannot be backfilled.
- **No blob sharing.** `sha256` is kept for *duplicate detection* ("you uploaded this on
  4 Mar — add as new version, or skip?"), but every file gets its own blob and DEK. This
  removes the need for refcounting/GC. See §2.
- **Mail credentials live in `mail_connections`, encrypted under the KEK** like a DEK —
  `secret_enc`/`iv`/`auth_tag`/`key_version`, never returned by the API once written. An
  app password and an OAuth refresh token are the same column; `auth_kind` distinguishes
  them. See §7.
- **`documents.source` stays `upload|email`.** Which mailbox a document arrived through is a
  join through `email_ingest_log`, not a new enum value.
- **`person_key_documents` models absence.** A row with `document_id NULL` renders as
  "Passport — Not on file" on the item page.
- **Plaintext lives in Postgres.** `document_text` and `tsv` are unencrypted copies of every
  document. Postgres's data directory MUST be on the encrypted volume (§3).
- **`documents.notes`** is free text about a document: why it was kept, what was agreed on
  the phone, which invoice it settles. Indexed at weight B beside tags and item labels, so a
  note can be searched for — a note nobody can find is half a note.
- **`expires_at` is read** by Home ("Expiring soon", 90 days) and item pages. v1 reminders
  are in-app; an email digest is v1.1.
- **Envelope encryption:** `dek_wrapped` is the per-file key wrapped by the KEK; `key_version`
  lets rotation re-wrap DEKs without re-encrypting blobs (§3.3).

## Deferred

Share links for an accountant/lawyer; document-to-document relationships; per-file
retention rules; trash/restore UI (soft delete exists via `deleted_at`).
