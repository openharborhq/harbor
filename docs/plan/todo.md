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
       - [ ] Re-run the suggester at prompt version 5 so existing documents produce
             obligations (`node dist/suggester.js rerun`). Until then only newly filed
             documents propose to-dos, and the 53 bills already carrying a payment date in
             `expires_at` keep showing up under *Needs attention* as expiries.
       - [ ] The worker/suggester Docker images need rebuilding before the re-run —
             `docker compose --env-file .env -f infra/compose.yml build suggester`.

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

3. [ ] **Scanner station — a ScanSnap S1300i on a Raspberry Pi** (agreed 2026-09-10). Paper
       in, button, catalogued in Harbor. Plan at `docs/plan/scanner-station.md`. Pi side is
       shell + systemd under `tools/scanstation/`: scanbd on the button, `scanimage` duplex
       colour 300 dpi, blank-back removal, `img2pdf`, a spool with an atomic commit point, and
       an uploader with backoff. Phase 1 sends over email-in and needs no Harbor change.

4. [ ] **Device token for uploads** (the Harbor half of item 3). Created in Settings, shown
       once, stored hashed, upload-only scope, revocable, `last_used_at`, audit entry.
       `SessionGuard` accepts `Authorization: Bearer` for routes marked upload-capable; the
       station then uses `GET /documents/duplicates` and `POST /documents` exactly as the
       browser does. Roughly one table, one form, one guard branch. Do after item 3's phase 1
       has run on real mail for a week.

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
