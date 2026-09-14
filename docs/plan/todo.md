# To-do

The running list. One file, kept current — milestone docs record what a chunk of work *was*
once it is done; this records what is still owed. Anything agreed in conversation lands here
in the same breath, so a decision can never exist only in a transcript.

Convention: `[ ]` open, `[x]` done and left in place until its milestone doc absorbs it,
`[~]` in progress. Blocked items say who or what they are blocked on, and why.

## Next up

1. [x] **Obligations — documents that still need doing** (built 2026-09-10). Spec:
       [§8](../spec/08-obligations.md). `tasks` table, three states (open / done /
       dismissed), repetition rolled forward on completion with no scheduler,
       `SuggestionPayload.obligations` behind prompt version 5, `/todo` page, sidebar badge
       counting overdue + due today only, Home's *Needs attention* replacing *Expiring
       soon*, the document strip, and the Inbox card's ticked clause on "Accept & file".
       Document detail also gained the **Filing** tab the artboards called for.

       Still owed on it:
       - [ ] **Skipped by Kai, 2026-09-10.** Re-running the suggester at prompt version 6
             (`node dist/suggester.js rerun`, 7 of ~175 done) would make existing documents
             propose to-dos and be read past page one. Left undone deliberately: new documents
             already get both, and the back catalogue can wait for a moment when the API spend
             is wanted. Until it runs, the 53 bills carrying a payment date in `expires_at`
             keep showing up under *Needs attention* as expiries. Accepted suggestions are
             excluded from the rerun in any case, so a card you already filed keeps its amount
             — correct those by hand on the document.
       - [x] Worker, mailfetch and suggester containers built and running locally
             (2026-09-10). They had never been created in this compose project.

2. [x] **Empty Inbox names the mailbox it is watching** (built 2026-09-10). Today it says "gmail.com is
       being watched. Harbor checks every few minutes and files what looks like paperwork
       here…" — every fact in it is vague where a precise one is already in hand. Replace with
       the provider's logo and:

       > **Gmail Inbox is connected.** Watching *<inbox name>* every *<n> minutes*.
       > Last checked *<time>*.

       - Lives in `EmptyInbox`, `apps/web/src/app/(app)/(shell)/inbox/page.tsx:120`.
       - `MailConnectionView` already carries `label`, `emailAddress`, `providerHint` and
         `lastCheckedAt` — the last of these is the migration currently in flight (0020).
       - **Gap:** the interval is `MAIL_SYNC_INTERVAL_SECONDS` (default 300 = every 5 minutes)
         and lives only in `mailfetch`'s environment. Nothing serves it to the browser. Surface
         it on the connection view rather than hardcoding "5 minutes" in copy — a number that
         silently disagrees with the deployment is worse than "every few minutes".
       - Write it per-provider from `providerHint`, not Gmail-only: the same card has to read
         correctly for Fastmail, iCloud and a bare IMAP host, which gets a generic mail glyph.
       - "Last checked" reads as relative time and the page is one people leave open, so it
         needs to keep up rather than freeze at render.
       - The existing `ailing` warning stays exactly as it is — a connection that is not `ok`
         must not be described as watched.

3. [x] **Near-duplicate detection — the same paper scanned twice** (built 2026-09-10). `sha256` catches identical
       bytes and nothing else, so two passes through the scanner produce two Inbox cards
       (Kai hit this on 2026-09-10 with a 2-page scan re-run 2½ minutes later).

       Measured on the real vault before choosing an approach:

       | pair | text similarity | number-set Jaccard |
       | --- | --- | --- |
       | true duplicates (byte-different, text-identical) | 1.000 | 1.000 |
       | **the re-scan pair** | 0.894 | **0.935** |
       | genuinely different offers from one dealer | 0.90–0.98 | 0.56–0.84 |

       Prose similarity **cannot** separate them: the re-scan scores *lower* than eleven pairs
       of genuinely distinct documents, because a sender's boilerplate dominates the text. The
       numbers a document contains — amounts, dates, invoice numbers, IBANs — do separate them,
       because two scans of one page carry the same numbers and two different offers do not.

       Plan: the worker stores the distinct numeric tokens at stage 3; candidates are gated by
       page count, byte size ±5% and sender; flag when number-Jaccard ≥ 0.90 **and** text
       similarity ≥ 0.7. Never auto-delete — surface it on the Inbox card as "looks like a copy
       of X" with keep both / replace / delete, where *replace* files the newer scan as a new
       version of the existing document rather than a second one.

       The margin between 0.84 and 0.935 is thin and tuned on one vault. It proposes; a person
       decides.

       **Built as planned**, minus the stored token column: the two cheap gates cut the candidate
       set to a handful, so the metrics are computed on demand and nothing had to be migrated or
       backfilled. `GET /documents/near-duplicates?inbox=1` finds them; the Inbox card offers
       "it is a newer scan of that one", which moves the file onto the older document as its next
       version and carries any to-dos across. Filing normally is what keeping both means, so that
       option needed no button. Found Kai's real pair at 0.935 / 0.895 with no false positives
       across 165 documents.

       Still worth doing later: the thresholds are one vault's evidence. Revisit once a few more
       real re-scans have gone through.

4. [x] **Search results say who and what a document is about** (built 2026-09-11). Each hit
       now carries the linked people and things as chips (accent, each one a link to its page)
       and the tags after them (grey), the same chip style as the document view. The row ends
       in a **View** button instead of relying on the title link. `SearchHit` gained `items`
       and `tags`; `SearchService.respond` loads both in one pass alongside the category index.

5. [x] **Mail from Gmail with a PDF was silently skipped; a dropped connection stopped the sweep
       for good** (fixed 2026-09-12, unreleased). Found on a water bill sent from Gmail on
       2026-09-11: Gmail sets a Content-ID on real attachments and `isAttachment` tested that
       before the disposition, so both installs scanned the message and neither filed or logged
       it. Separately, the local install's connection went `unreachable` on one dropped socket
       at 03:12 and `syncAll` only swept `ok`, so nothing was read after that. Both fixed with
       tests; `SWEPT_STATUSES` names what the sweep opens.

       Still owed:
       - [ ] Release as v0.6.1 (`scripts/release.sh v0.6.1`) and `harbor upgrade` on the box.
       - [ ] Then **Scan history**, last month, from Settings → Mail on each install: the bill
             was never logged as seen, so the ordinary sweep will not go back for it.
       - [x] Rebuild the local `mailfetch` image (done 2026-09-12; the fixed sweep cleared the
             stuck status on its first pass). Always `docker compose --env-file .env -f
             infra/compose.yml …` — without the env file compose recreates postgres and redis on
             the default ports, which collide with the Homebrew ones and leave the stack down.

6. [x] **A to-do's currency is chosen, not assumed** (built 2026-09-12, unreleased). Reported
       as "sometimes $, sometimes €": `AddTask` hardcoded EUR, `DocumentTasks` kept `?? "EUR"`,
       the Inbox card could not change what the model proposed, and `formatAmount` drew "€" for
       a null currency. Now: `Currency` enum (EUR/USD/GBP/CHF) on `CreateTask`/`UpdateTask`,
       `normaliseCurrency` for whatever a model or person wrote, a `CurrencySelect` on all three
       forms, `AcceptSuggestion.obligations[i].currency` so the card's choice travels with the
       accept, null rendered as a bare figure, and the prompt (version 7) told to read the
       currency off the page or return null. Prompt 7 does not need a rerun for this.

7. [x] **`harbor upgrade` wrote the tag before the pull** (fixed in `install.sh` 2026-09-12, ships
       with the next release; the copy already on the box keeps the old behaviour until
       `install.sh` is re-run there). Kai ran it on the Protectli before CI had published v0.6.1:
       the pull failed, the containers stayed on v0.6.0, but `/data/harbor.env` said v0.6.1, so a
       retry would have said "already on it". The pull now runs with the wanted tag first and the
       file is written only when it succeeds. The v0.6.1 rollout itself was finished by hand with
       `docker compose … pull && up -d` from `/opt/harbor`.

8. [ ] **Rewrite the release notes for someone outside this repo.** `CHANGELOG.md` currently
       reads like a postmortem written for whoever fixed it — "Multer builds its disk storage the
       moment its module initialises", "the suggester died trying to create `/data/tmp`". True,
       and no help at all to a person deciding whether to upgrade.

       What an outside reader needs from an entry, in this order: **what can I now do that I
       could not**, **what was broken and is not**, **what do I have to do about it**. Cause
       belongs in the commit message and the spec; a release note earns its detail only where the
       detail changes the reader's decision — data was affected, a manual step is required, or
       behaviour they relied on has moved.

       Rough shape to aim for:

       > **v0.5.2** — Suggestions work again on installs running v0.5.0 or v0.5.1, where the
       > process that writes titles, summaries and dates was crash-looping. Documents kept
       > arriving throughout and nothing was lost; run `harbor suggest rerun` to fill in the
       > suggestions those documents never got.

       Keep the **Worth knowing** section — it is the part that already speaks to a reader — and
       keep the header on upgrading and rolling back. `parseChangelog` and its tests define the
       format, so the headings and structure have to survive the edit; the Version settings page
       renders this file.

       **How to decide how much a change is worth.** One question settles it: *would someone on
       another install do anything differently because of this?* If not, it does not get its own
       entry.

       | | earns | examples |
       | --- | --- | --- |
       | **Called out** | a heading bullet, two or three sentences | a new capability; behaviour someone relied on has moved; data was affected; a manual step is needed; something visibly broken now works |
       | **Named** | one line, no explanation | a fix to something people hit but could work around; a smaller addition inside an existing feature |
       | **Summed up** | one closing line for the whole release | interface tidying, copy, layout, spacing; internal refactors; dependency bumps; anything only this repo can see |

       The summed-up line is a real sentence, not an apology — "Plus a round of interface tidying
       and internal cleanups." A reader who wants that detail has the commit log.

       Two traps this exists to avoid. **Cause is not significance:** a one-line fix to a
       crash-loop is a called-out change, and a week of refactoring that nobody can observe is a
       summed-up one. And **a release note is not a receipt** — leaving small work uncounted is
       the point, not a failure to credit it.

9. [ ] **Extensions — Phase 0, the foundation** (agreed 2026-09-12; design in
       [§9](../spec/09-extensions.md)). The direction: people evolve their own install with an
       internal agent that compiles shared *recipes* into extensions, behind a manifest, a
       sandbox, acceptance examples and a person's approval — never third-party code loaded
       into core. Phase 0 is the substrate everything else stands on, and it is useful on its
       own before any agent exists.
       - [ ] **Integration tokens with scopes.** Absorbs the device-token item under *Later*:
             created in Settings, shown once, stored hashed, revocable, `last_used_at`, audit
             entry. Scopes to start: `upload`, `documents:read`, `tasks:write`, `events:read`.
             `SessionGuard` accepts `Authorization: Bearer` on routes that carry a scope. The
             scanner station is the first client.
       - [ ] **Event outbox.** A table plus Redis stream: `document.received`,
             `document.filed`, `task.due`, `backup.finished`, `mail.connection.ailing`. Payload
             schemas in `@harbor/shared`.
       - [ ] **One signed outbound webhook** as the first sink, configured in Settings. That is
             the whole notification story: ntfy, Apprise or n8n fan out from there. No
             notification plugin system, by decision.
       - [ ] Surface versioning: a `surface` constant, and an *Extension surface* heading in
             `CHANGELOG.md` for anything that changes it.

10. [ ] **Sharing — handing documents to an outsider** (design agreed 2026-09-08, spec written
        2026-09-14: [§10](../spec/10-sharing.md)). The one feature that needs a public surface.
        Delivery decided: **Tailscale Funnel pointed at a separate `harbor-share` doorman
        container**, never the API; a relay the box pushes to stays deferred (§10.10), and the
        bundle format is kept sink-agnostic so that stays a delivery change. Sharing is free and
        in the repo — not a paid add-on, decided 2026-09-08 and argued in §10.10.
        - [ ] **Hardening first, and it gates the rest.** Security headers, CSP, HSTS. §3 has
              none of them today, and `harbor public enable` does not ship until the doorman has
              them. Worth doing whether or not Funnel is ever turned on.
        - [x] **Seal and store** (built 2026-09-14). `shares`, `share_files`, `share_links`, `share_access_log`;
              re-encrypt the chosen `document_file` versions under a fresh per-share key — **one
              zip, stored not deflated, sealed whole** so the filenames are inside the ciphertext
              (decided 2026-09-14); write
              bundle, key and `policy.json` to `/data/shares/<sha256(token)>/`. Exclude bundles
              from restic. Purge on expiry or revoke, on the existing scheduler.
        - [~] **The doorman container, on its own tailnet node** (§10.6, decided 2026-09-14).
              *Container built and tested 2026-09-14; the tailnet node and Funnel are not done.*
              Its own `tailscaled` and state volume, so Funnel serves it at
              `harbor-share.<tailnet>.ts.net` **on 443** — a separate origin from the app, and a
              port that recipients behind a corporate firewall can actually reach. The funnel
              attribute is granted to that node alone; the app's node keeps `AllowFunnel: {}`
              empty for good. No Postgres, no KEK, no cookies, one route family, a
              read-only mount of the share directory and one writable state directory. Setup
              consequences (§10.6): the node joins by **printed login URL, not an auth key**;
              a second machine appears in the admin console and the owner is told *before* it
              does; links are built from the node's **actual** cert domain, since a name
              collision silently renames it; its state volume is backed up, because losing the
              identity kills every live link. Landing
              page on GET, burn on POST — link previewers make that load-bearing (§10.7).
        - [x] **A worker that ingests `events.jsonl`** into `share_access_log` (built 2026-09-14,
              as an interval inside the API rather than a sixth container). The doorman gets
              no way to call the API; the vault reads its log.
        - [x] **The basket and the review screen** in the app (built 2026-09-14), with an add affordance on document
              rows, item pages and search results, plus a share detail page showing the audit
              trail and a revoke button. **Individual documents only** (decided 2026-09-14):
              an item cannot go in the basket, not even as a shortcut that expands — everything
              a share hands out is named one document at a time.
        - [ ] **`harbor public enable` / `disable`**, printing what it means and requiring a
              deliberate confirmation, and the §3.1 threat-model rewrite (§10.9) alongside it —
              "nothing to connect to" stops being true the moment this ships.
        - [ ] **The second sink: the owner's own bucket** (§10.10, agreed 2026-09-14). `shares`
              gains `delivery` (`doorman|bucket`); the seal is byte-identical and only the next
              step differs — PUT to the object store Harbor already needs for backups, a static
              landing page uploaded once, token and key in the URL fragment, decryption in the
              recipient's browser. Buys availability when the box is asleep, needs no Funnel and
              no §3.1 rewrite. Costs one-time downloads, which need a stateful server. Three
              non-optional rules: pad bundles to size buckets, password *wraps the key* rather
              than gating a request (argon2id, expensive), and stream the decryption chunked.
              Default sink is `doorman` when Funnel is on, `bucket` otherwise.
        - [ ] **One `s3` sink, not one per provider** (§10.10, agreed 2026-09-14). A `ShareSink`
              is `put` / `presign` / `delete`; B2, R2, Wasabi, MinIO, Storj and S3 all speak the
              S3 API, so they are **settings presets, not code paths** — the §5 precedent. Verify
              presigning and content-type against each preset before listing it. **SFTP, local
              disk and restic REST cannot be sinks at all**: no anonymous HTTPS GET. That is not
              a gap to close — those installs share through the doorman, and the settings page
              has to say so instead of offering a sink that silently fails.
        - [ ] **A second bucket, private, separate from restic.** No public-read policy and no
              CORS rules needed: bundle and per-share `index.html` go in one bucket so the page
              fetches same-origin, and the link is the presigned URL of that page with the key in
              the fragment. Consequence to surface in the UI: **presigned URLs cap at 7 days**,
              so 30-day expiry is doorman-only.
        - [ ] **The Funnel preflight, which is most of that command** (§10.6). Funnel needs no
              firewall change and no port forwarding — it is an outbound connection, and it works
              behind CGNAT. The friction is account-side and once per tailnet: HTTPS certificates
              on, and a `funnel` node attribute in the ACL policy file, which is JSON in a web
              console. The command checks each precondition and names the one that is missing,
              surfaces the admin-console URL `tailscale funnel` prints (it pre-fills the policy
              change) with a line of plain English, waits and re-checks instead of exiting, then
              writes the serve config and prints the share hostname. This is the difference
              between shippable and not for a non-technical owner.

## Waiting on Kai

- [ ] **Protectli deploy** — M1 step 11. Runbook at `docs/deploy.md`, never once executed.
- [ ] **Backups to Backblaze B2** — needs a bucket and an application key.
- [x] **Pushed and released as v0.6.0** (2026-09-10). 15 commits, images built, GitHub release
  published. Still never installed anywhere — see the Protectli deploy above.

## Later

- [ ] **Device token for uploads** — folded into *Extensions — Phase 0* above (integration tokens with scopes); kept here until that lands. Created in Settings, shown once, stored hashed, upload-only
  scope, revocable, `last_used_at`, audit entry. `SessionGuard` accepts `Authorization: Bearer`
  for routes marked upload-capable, so a device can use `GET /documents/duplicates` and
  `POST /documents` exactly as the browser does. Roughly one table, one form, one guard branch.
  Wanted by Kai's scanner station, which is his own integration rather than part of Harbor — but
  the token is a Harbor feature and any device would use it.
- [ ] **Extensions — Phases 1 to 4** ([§9](../spec/09-extensions.md)), in order, each after
  the previous has proved its point: **1** `ext_records`, custom fields, the item-section slot,
  the WebAssembly runner (Extism) with one hand-written transform for the meter-reading case,
  the Harbor catalog and the in-house spec renderer (json-render's format, our code);
  **2** the recipe format, the Extensions settings page, provenance, verify-on-upgrade — test
  it with a fake upgrade; **3** the compiler, the internal agent, declarative tier first, then
  transforms; **4** connector sidecars behind `MailSource`-over-HTTP, JMAP or Microsoft Graph
  as the proof, and a public recipes repo. Phase 1's open decisions: the WebAssembly toolchain
  for TypeScript, the exact catalog, memory for the runner on the Protectli.
- [ ] **External-facing MCP server** — deferred until the internal agent has mileage. The
  conditions it must meet are written down in §9 *Deferred*; do not re-derive them.
- [ ] **Website — a "See how it works" page** (agreed 2026-09-13). The hero's second button
  points at `#features` further down the same page; give it somewhere to go. The centrepiece is
  a schematic drawn in the hand-drawn vocabulary the site already has
  (`harbor-website`, `src/components/visuals/sketch.ts`): the Protectli-like box from
  `VaultIllustration` in the middle, with a labelled line to each thing that plugs into it —
  the email providers, a scanner, file upload from a phone or a laptop, Backblaze B2 and the
  other backup targets, and a secure expiring link out to the accountant. Says in one drawing
  what the feature list needs six blocks for: everything meets at one box in the house, and only
  two lines leave it. Lives in the website repo, not this one.
- [ ] Folder drops on the Add page (`webkitGetAsEntry` traversal).
- [ ] A real iPhone HEIC end to end through the worker.
- [ ] Large-file behaviour: progress on a 100-page scan, the 200 MB ceiling.
- [ ] Item reordering; item kinds beyond the active four.
- [ ] Refresh the stale Paper artboards against what was actually built.

## Housekeeping

- [x] `apps/api` has an ESLint config again — `pnpm lint` passes at the repo root, which is what
  let the release script run its checks.
