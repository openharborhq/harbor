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

## 4.2 Phone and tablet widths (2026-10-04)

**The desktop artboards are unchanged from 1440 down to `lg`; below it the same screens reflow.**
There are no separate mobile screens and no second set of routes — a phone opens the same URL and
gets the same page with its columns stacked. Checked at 360, 390, 768, 1024 and 1440: no page
scrolls sideways at any of them.

- **Gutters** are 16 px on a phone, 32 from `sm`, the drawn 56 from `lg`.
- **The vault's sidebar** is a drawer below `lg` (it already was). **Settings' sidebar** becomes a
  band across the top: Back to Harbor, then the sections as a row that scrolls sideways and keeps
  the current one in view.
- **Card grids** go 2 → 3 → 4 columns (`sm`, `lg`). Home's Needs attention / Recently added pair sits
  side by side only from `xl`; at 1024 the right-hand column was 240 px of truncated titles.
- **Document lists** (Library, an item's records, Recently deleted) are one line from `xl` and two
  below — title over where it is filed — with the date columns dropping out as width runs short.
  The Library filter rail is a disclosure above the list below `xl`: forty filter rows stacked over
  the documents would put every document a long scroll away.
- **Reading a document** stacks below `lg`: the page on top at 60% of the screen height, the details
  under it, the whole sheet scrolling. A phone gets the sheet edge to edge rather than inset 16 px.
- **Under a finger** (`pointer: coarse`): form text is 16 px, because Safari on iOS zooms the whole
  page into any smaller field on focus and leaves it there; the ⌘K hint is gone; the Add page says
  "Choose files or photos" instead of dropping folders and browsing a computer.
- **The Inbox card** drops its 200 px thumbnail on a phone. The title and summary say what the
  document is, and Open document shows it. *Superseded by §4.3: the phone Inbox shows one document
  at a time, with its page on top.*

## 4.3 Mobile first, not mobile fitted (2026-10-04)

§4.2 made every page fit a phone; it did not make any page *for* one. The core screens were then
redesigned phone-first in Paper (page "Mobile — core screens": Home, Inbox, Document, Library, To
do, Add, Menu) and built below `lg`. Desktop is untouched.

**Navigation stays a drawer behind the burger.** A bottom tab bar was drawn and dropped: a bar fixed
to the bottom of a mobile web page fights Safari's own toolbar as it collapses, the keyboard as it
rises, and a different safe-area inset on every device. The top bar on a phone is the menu and a
round cobalt Add, nothing else. The drawer is the account's home too — who is signed in, Settings,
Sign out — and leaves the category list to Library.

**Nothing on a phone is set under 15 px.** The first pass carried the desktop's 11 px uppercase
labels and 13 px sub-lines down to a 390 px screen, where they are the hardest thing on it to read
and make every row look busy. The rule now: a row has one 17 px line (`text-copy`) and at most one
15 px line under it; a section heading is a 21 px sentence (`text-lead`), not a tracked capital
label; a number that matters is large and its label is a word under it; anything tappable is at
least 44 px. What does not help someone recognise or decide on the thing in front of them — "12 min
ago", page counts, a category's full path — is cut rather than shrunk. `text-copy` and `text-lead`
were already in the Paper file (the site uses them) and joined the app's tokens for this.

- **Home** opens with a sentence — how many things need you — then those things, most urgent first,
  with the Inbox among them. Search is a field on the page, not in the top bar. People and things
  are a strip that scrolls sideways.
- **The Inbox is one document at a time** on a phone, with Accept & file fixed at the bottom where
  the thumb is. A queue of cards each carrying its own controls is a desktop shape; on a phone it
  is a long scroll of forms.
- **A document** is its page with a sheet over it: the title, up to three facts, the open to-dos,
  Download and Full size. The five tabs are one tap further, under All details.
- **Library** carries its own search field and filters results by the categories they fall in.
- **Add** is a page, not the sheet the design drew: an upload runs for as long as the page that
  started it is open, and a sheet is closed with a swipe. Its three ways in — take a photo, choose
  from Photos, browse files — replace the drop zone, which a phone has nothing to drop onto.

**On a home screen Harbor is an app, not a bookmark** (2026-10-04): `display: standalone` in the
manifest and `apple-mobile-web-app-capable`, so it opens without Safari around it. Chosen knowing
the cost — no browser back button, so every screen has to carry its own way out, which the drawer,
the document's close button and Settings' Back to Harbor already do. The icon is the tab mark
reversed: a white shield and cobalt anchor on a full cobalt tile, square and opaque, since iOS
rounds the corners itself and fills transparency with black.

Dates are spelled from a fixed month table (`SHORT_MONTHS`), not `toLocaleString`: Node and Chrome
abbreviate September as "Sept" in en-GB and Safari as "Sep", so every client component that showed a
September date failed to hydrate on an iPhone.

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
