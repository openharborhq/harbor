# Changelog

What changed between releases, and anything you have to do about it.

Versions are `vMAJOR.MINOR.PATCH`. Before `v1.0.0`, a minor bump may change behaviour you were
relying on; those are listed under **Worth knowing** rather than buried.

Upgrading is `harbor upgrade` on the box: it takes a backup, refuses to continue if the backup
fails, pulls the images for the tag in your configuration and restarts. To move between releases,
change `HARBOR_IMAGE_TAG` with `harbor config` first.

**Rolling back is restoring a backup.** Database migrations only run forward — there are no down
migrations, on purpose, because a half-reversed schema is worse than a restore. If a release goes
wrong, follow [`docs/restore.md`](docs/restore.md) with the backup `harbor upgrade` took
immediately before it. That is why the upgrade refuses to run without one.

## v0.2.0 — 2026-09-08

- **A QR code when enrolling an authenticator** ([#1](https://github.com/openharborhq/harbor/issues/1)).
  The setup and invitation screens now draw the code so you can scan it, instead of asking you to
  type a sixteen-character key into a phone. The key is still shown for anyone who cannot scan,
  and the full link is behind a disclosure. Drawn in the browser from what the page already has,
  so the secret never travels a second time or lands in a server log.

**Worth knowing**

- There is still no way to enrol an authenticator on a *new* phone after signup
  ([#3](https://github.com/openharborhq/harbor/issues/3)). Replacing a handset means signing in
  with recovery codes until that is built.

## v0.1.0 — 2026-09-08

First tagged release. Everything before this was the tip of `main`.

**What it is.** A self-hosted family document vault: upload or email in your paperwork, and it is
OCR'd, searchable by every word inside, organised by category, family member and tag, encrypted
at rest, and backed up offsite with a restore test that actually runs.

- **Intake.** Drag-and-drop upload, deduplication by content hash, OCR with a page-by-page
  progress you can watch, text extraction that skips OCR on born-digital PDFs.
- **Finding things.** Full-text search across the OCR text with highlighted snippets, ranked, in
  German and English. Categories, people and things, tags, expiry dates surfaced on Home.
- **Email.** Connect a mailbox over IMAP with an app password. It reads envelopes, files what
  looks like paperwork, and asks you about senders once rather than about messages forever.
  Nothing is deleted or marked read in your mailbox.
- **Suggestions.** A title, summary, category, dates and whether it is paperwork at all, from
  Anthropic, any OpenAI-compatible server including one on your own network, or heuristics only.
- **Backups.** Nightly `pg_dump` plus an encrypted restic snapshot, 30 daily and 12 monthly kept.
  Once a month it restores that snapshot to scratch, loads the dump, and decrypts twenty random
  documents to check they match what was uploaded. Every run is in Settings.
- **Getting in.** Password plus an authenticator code, recovery codes printed once, no email
  reset. The first owner is created in the browser on first run; everyone else is invited.
- **Getting to it.** Tailnet-only, with nothing listening on the machine's own interfaces.

**Worth knowing**

- The web interface is built for a desktop screen. It works on a phone but is not laid out for
  one; that is the next thing on the list.
- Suggestions cost money if you point them at a hosted provider, roughly $0.007 a document on
  Sonnet. `SUGGEST_PROVIDER=none` costs nothing and sends nothing.
- A backfill of a very large mailbox stops at 20,000 messages and says so. Re-running reads from
  the same date and stops in the same place; a shorter window is what gets through.
