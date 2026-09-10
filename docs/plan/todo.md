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

2. [ ] **Empty Inbox should name the mailbox it is watching.** Today it says "gmail.com is
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

3. [ ] **Near-duplicate detection — the same paper scanned twice.** `sha256` catches identical
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

4. [ ] **Rewrite the release notes for someone outside this repo.** `CHANGELOG.md` currently
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

## Waiting on Kai

- [ ] **Protectli deploy** — M1 step 11. Runbook at `docs/deploy.md`, never once executed.
- [ ] **Backups to Backblaze B2** — needs a bucket and an application key.
- [ ] **Push.** `origin` now exists — `openharborhq/harbor` — and `main` is **10 commits ahead**
  of it (everything built on 2026-09-10: tasks, page-aware sampling, the row cleanup). They are
  still on one disk until someone pushes.

## Later

- [ ] **Device token for uploads.** Created in Settings, shown once, stored hashed, upload-only
  scope, revocable, `last_used_at`, audit entry. `SessionGuard` accepts `Authorization: Bearer`
  for routes marked upload-capable, so a device can use `GET /documents/duplicates` and
  `POST /documents` exactly as the browser does. Roughly one table, one form, one guard branch.
  Wanted by Kai's scanner station, which is his own integration rather than part of Harbor — but
  the token is a Harbor feature and any device would use it.
- [ ] Folder drops on the Add page (`webkitGetAsEntry` traversal).
- [ ] A real iPhone HEIC end to end through the worker.
- [ ] Large-file behaviour: progress on a 100-page scan, the 200 MB ceiling.
- [ ] Item reordering; item kinds beyond the active four.
- [ ] Refresh the stale Paper artboards against what was actually built.

## Housekeeping

- [ ] `apps/api` has no ESLint config, so `pnpm lint` fails at the repo root.
