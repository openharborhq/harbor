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
       - [ ] Re-run the suggester at **prompt version 6** so existing documents produce
             obligations and are read past page one (`node dist/suggester.js rerun`). 7 of
             ~175 done. Until then only newly filed documents propose to-dos, and the 53
             bills already carrying a payment date in `expires_at` keep showing up under
             *Needs attention* as expiries. Accepted suggestions are deliberately excluded
             from the rerun, so a document whose card you already filed keeps the amount it
             was given — correct those by hand on the document.
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

3. [~] **Scanner station — a ScanSnap S1300 on a Raspberry Pi** (agreed and built
       2026-09-10). Paper in, button, catalogued in Harbor. Plan at
       `docs/plan/scanner-station.md`, code under `tools/scanstation/`, running on the Pi 4 at
       192.168.2.134 (LAN only, ssh as `admin`, key auth, password logins off). Phase 1 is
       live over email-in: the button test delivered a two-page PDF to the Gmail inbox Harbor
       watches. Tuned the same day on the first six-page job: greyscale, JPEG quality 70 (~1 MB a
       page, ~17 pages per mail), blank backs by ink coverage, scans sent to a plus address
       so one Gmail filter labels them "Harbor". Still owed: a week of real mail; decide on
       `TRIGGER=paper`; put the firmware blob and the app password in the password manager.

4. [ ] **Device token for uploads** (the Harbor half of item 3). Created in Settings, shown
       once, stored hashed, upload-only scope, revocable, `last_used_at`, audit entry.
       `SessionGuard` accepts `Authorization: Bearer` for routes marked upload-capable; the
       station then uses `GET /documents/duplicates` and `POST /documents` exactly as the
       browser does. Roughly one table, one form, one guard branch. Do after item 3's phase 1
       has run on real mail for a week.

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

## Waiting on Kai

- [ ] **Protectli deploy** — M1 step 11. Runbook at `docs/deploy.md`, never once executed.
- [ ] **Backups to Backblaze B2** — needs a bucket and an application key.
- [ ] **Git remote.** 35+ commits, all local, no remote. One `git remote add` from being safe.

## Later

- [ ] Folder drops on the Add page (`webkitGetAsEntry` traversal).
- [ ] A real iPhone HEIC end to end through the worker.
- [ ] Large-file behaviour: progress on a 100-page scan, the 200 MB ceiling.
- [ ] Item reordering; item kinds beyond the active four.
- [ ] Refresh the stale Paper artboards against what was actually built.

## Housekeeping

- [ ] `apps/api` has no ESLint config, so `pnpm lint` fails at the repo root.
