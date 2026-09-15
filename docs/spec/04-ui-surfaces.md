# 4. UI surfaces

Design file: Paper `01M1VQQFCBZZKMYX760BE4STAV`. Tokens: white ground, cobalt `#123FA8`
accent, Inter, 7-step type scale. All desktop artboards 1440 px; sidebar 248, content 1192.

## 4.1 Light and dark (2026-09-15)

**The machine's setting decides, and nothing else.** `prefers-color-scheme`, no toggle, no stored
preference. A theme switch is a thing to build, explain and get wrong on first paint; the question
has already been asked once, at the level where it belongs, and the answer arrives with the request.

**The dark palette is the Harbor site's, verbatim** — `harbor-website` already derived one from the
Paper file's own `terminal` and `on-dark` tokens, and two products of one household must not
disagree about what Harbor looks like at night. Ground `#0F1723`, surface `#162031`, border
`#243349`, text `#E6ECF5`, muted `#A7B4C6`, accent `#7EA6FF`, accent-soft `#1C2C4D`.

**Three tokens are lifted here and nowhere else**: `warn`, `danger` and `label`. The site never
redefines them, which leaves its danger at 2.59:1 on its own dark ground. The app's are
`#E3A445`, `#F08375`, `#5CC79D`, each measured on both the ground and its own soft fill.

**Two tokens deliberately do not flip.** On a dark ground white-on-accent needs the accent below
0.183 relative luminance and accent-as-link-text needs it above 0.214 — an empty range, so one
colour cannot do both jobs. `--color-accent` becomes the light blue for links; `--color-accent-fill`
stays cobalt for anything filled and labelled in white, which is the site's `band`/`on-band` pair
under another name. `--color-scrim` is the second: a dialog wash keyed to `--color-text` would turn
pale in dark mode and light the page it exists to push back.

**White stays white where the thing is paper** — a PDF page, a scanned image, a QR code. A document
does not change colour because the room did.

The doorman's landing page (§10.6) carries the same values inline. It had its own dark palette
first, drifted a shade or two on all seven colours, and its Download button was white on the lifted
accent at 2.44:1 — on the one page a stranger ever sees.

## Inventory

| Surface | Status | Backed by | Gap |
|---|---|---|---|
| Home | Drawn | items/categories + counts, *Needs attention* (open `tasks` + `expires_at` ≤ 90 d), recent docs, `backup_runs` | — |
| To do | Drawn — Paper row 5 | `tasks`, grouped by when | — |
| Inbox | Drawn | `category_id IS NULL`, `suggestions` | **No-suggestion, processing, and failed states not drawn** |
| Library / Search | Drawn | ranked `tsv` search, snippets, facet counts | Browse mode (no query) — reuse item-page table |
| Add documents | Drawn | intake, job status stream, sha256 check | — |
| Item | Drawn | per-item docs, children, `item_key_documents` | — |
| Document detail | Drawn | `document_text`, versions, `audit_log` | Edit mode; trash/restore |
| Settings | Drawn | users, invites, sessions, `email_ingest_log`, `backup_runs`, host metrics | — |
| Mail connections | Built, **not drawn** — `/settings/mail` | `mail_connections`, `mail_senders` | Built from the system rather than mocked first. `senders` scope has no control yet; the §7.10 trade-off is stated on the page |
| Backfill review | Built, **not drawn** — `/settings/mail/[id]` | backfill dry-run grouped by sender | Bulk approve/ignore with a category, owner-only (§7.7). Held mail listed below it |
| LLM provider settings | **Not drawn** — mock before build | provider config | Preset picker (Claude / OpenAI / Groq / Ollama / custom), base URL + key + model, live test call (§5) |
| Login + TOTP | **Not drawn** — mock before build | | |
| Setup wizard | Built, **not drawn** — `/setup` | `users` (count = 0) | First owner in the browser: name, email, password, then the same enrolment card as an invitation. Provider choice (§5) and the break-glass print are still console/doc steps |
| Invite acceptance, held-mail review, add/edit item, manage categories, recently deleted, empty states | Not drawn — build from the system | | |
| Scan — Capture / Review (mobile) | Drawn, **parked** | | |

## Schema the drawings forced (folded into §1)

`person_key_documents` (absence as a slot) · `user_pins` · `backup_runs` ·
`email_ingest_log.status/raw_blob_key` · `document_files.processing_status/page_progress/key_version` ·
`mail_connections.status/last_ok_at` (a broken connection must be visible, §7.10).

## Inbox card states

The drawn card is the LLM state (summary + prefilled FILE TO / FOR) — the primary v1
experience (§5). Three more states need mocks before build: **processing** (OCR/suggestion
pending), **no suggestion** (provider `none`, refusal, or failure — summary block collapses,
heuristic prefill), and **failed** (with Retry). A fourth — **fetch reminder**, for portal
notifications with no document in them — is deferred to v1.1 with the feature itself (§7.9).

## Known continuity issues in the original artboards (to fix)

- Names: "Maya" / "Sam" on Home should come from the seeded demo household, not be hard-coded (family cards, Settings).
- Categories: "Vehicles ›" / "Property ›" on Home should be Transportation / Real Estate.
- Source: "phone scan" (Item page) and "Scan · needs filing" (Home) should read Email/Upload
  now that mobile capture is parked.
- Inbox cards: thumbnail drives card height, leaving dead space above FILE TO.
