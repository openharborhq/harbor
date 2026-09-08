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

## v0.5.1 — 2026-09-08

- **Fixes suggestions, which v0.5.0 broke.** Photographs gave the items service a dependency on
  encrypted-blob storage, and the `suggester` process — which shares that service — was not given
  the module it lives in, so it restarted in a loop. On v0.5.0 documents still arrive, are OCR'd
  and are searchable; what stops is the title, summary, category and dates a model proposes.
  Every other service was unaffected.
- **The module now names what it needs** rather than relying on a global one having been imported
  somewhere else. Six processes share these services, and "global" only reaches the ones that
  already pull the module in — which is why this is the second release to be broken by exactly
  this shape of mistake.

**Worth knowing**

- The smoke job added in v0.4.1 caught this before anyone ran it: the images built, and starting
  them is what failed. That is the difference between compiling and running.

## v0.5.0 — 2026-09-08

- **Settings is its own page.** Seven sections behind their own navigation — Account, Users,
  Devices, Email Ingest, Integrations, Backup, Version — instead of one long scroll of stacked
  panels. It takes the window over rather than nesting inside it, with a way back at the top.
  Every address is unchanged, so anything you had bookmarked still works.
- **Choosing where document text goes reads like the decision it is.** The three providers are
  now rows that each state their consequence, and only the one you pick opens to show its own
  fields. The *Send first names* toggle is wired up: the panel described it before but never
  saved it, so it was always on.
- **Every release says what changed, in Settings → Version.** Each version is a row you can
  open. The notes that shipped in your image are always there, so a vault with no route out can
  still say what it is running; when the box can reach GitHub the list also covers releases
  newer than yours, which is the half that answers "should I upgrade".
- **A photograph for every person and thing.** Add one from the item page and crop it in the
  browser — drag, zoom, and only the circle is kept. Photos appear on the item page, the
  People & things grid and Home. They are encrypted at rest exactly like a document, under
  their own key wrapped by the vault's master key.
- **The app wears the same mark as the website**, and both left-hand columns sit on a light
  grey rather than white.

**Worth knowing**

- One migration adds the photo columns. `harbor upgrade` applies it on the way up; there is
  nothing to do by hand.
- The crop is all that is stored — the vault never receives the original photograph. Framing it
  differently means uploading it again, which is the trade for not keeping a picture you did not
  choose to show.
- Photos are refused unless the file's own leading bytes say JPEG, PNG or WebP.
- Backups are still configured in the environment file on the box; that half of
  [#2](https://github.com/openharborhq/harbor/issues/2) is still not done.

## v0.4.1 — 2026-09-08

- **Fixes email-in, which v0.4.0 broke.** The suggestion settings work gave `SuggestService` a new
  dependency, and `mailfetch` — which shares that service — was not given the module it lives in,
  so it could not start. Any vault on v0.4.0 with a connected mailbox stopped fetching mail. Every
  other service was unaffected.
- **CI now starts every service from the images it just built** and fails if any of them exits.
  Building an image proves it compiles, not that it runs, and this is precisely the fault that
  slips through: one entrypoint out of six unable to resolve a dependency, showing only as a
  container that dies seconds after boot.

## v0.4.0 — 2026-09-08

- **Choose the suggestion provider in Settings** ([#2](https://github.com/openharborhq/harbor/issues/2), in part).
  Provider, model, endpoint and API key are set in the browser instead of in a file over ssh.
  Anthropic, or any OpenAI-compatible endpoint with ready-made settings for OpenRouter, OpenAI,
  Groq and Ollama, or off entirely. A **Test** button makes a real call before you commit to
  anything, and says plainly whether the key was rejected or the endpoint unreachable.
- **Keys are stored encrypted** under the vault's master key, the same way mail passwords are, and
  are never sent back to the browser — Settings only reports whether one is held. An API key in
  the database sealed under the KEK is safer than one in a file on disk.
- **Changes take effect immediately.** The provider is resolved for each document rather than when
  the container started, so nothing needs restarting.
- **Your existing configuration keeps working.** Anything not saved here falls back to the
  environment, so installs configured through `harbor config` are unchanged until you choose
  otherwise.

**Worth knowing**

- Backups are still configured in the env file; that half of
  [#2](https://github.com/openharborhq/harbor/issues/2) is not done.
- Whatever you pick other than *Off* receives the text of every document. The panel says so.

## v0.3.0 — 2026-09-08

- **Settings tells you when a release is out.** The vault asks GitHub once a day whether anything
  newer exists and says so under *This vault*. Nothing about you or your documents is sent — it is
  a plain request for the repository's tags — and `HARBOR_UPDATE_CHECK=false` stops it entirely. A
  check that fails says so rather than reading as "up to date", because those are not the same
  thing.
- **`harbor upgrade` goes to the newest release on its own.** It used to require editing
  `HARBOR_IMAGE_TAG` by hand before it would move. Now it looks up the newest release, tells you
  what it is moving from and to, and writes the tag itself — only after the backup has succeeded,
  so a failed backup cannot leave the configuration pointing at a release that was never pulled.
  `harbor upgrade v0.2.0` still goes exactly where you say.

**Worth knowing**

- Upgrading is still a command on the box. Doing it from the browser needs the settings work in
  [#2](https://github.com/openharborhq/harbor/issues/2).

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
