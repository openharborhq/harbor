# Changelog

What changed between releases, and anything you have to do about it.

Versions are `vMAJOR.MINOR.PATCH`. Before `v1.0.0`, a minor bump may change behaviour you were
relying on; those are listed under **Worth knowing** rather than buried.

Upgrading is `harbor upgrade` on the box: it takes a backup, refuses to continue if the backup
fails, pulls the images for the tag in your configuration and restarts. To move between releases,
change `HARBOR_IMAGE_TAG` with `harbor config` first.

How entries are written — plain headlines, third person, what earns an entry at all — is in
[`docs/writing.md`](docs/writing.md).

**Rolling back is restoring a backup.** Database migrations only run forward — there are no down
migrations, on purpose, because a half-reversed schema is worse than a restore. If a release goes
wrong, follow [`docs/restore.md`](docs/restore.md) with the backup `harbor upgrade` took
immediately before it. That is why the upgrade refuses to run without one.

## v0.7.6 — 2026-09-15

- **Fixed: `harbor public enable` reported success on a share node no recipient could reach.** Funnel
  is granted by a node attribute in the tailnet's policy file, and nothing on the node itself knows
  whether that grant exists — it requests ingress, takes an HTTPS certificate, and
  `tailscale funnel status` prints *Funnel on* either way, while the control plane publishes no
  public DNS record and the name resolves only inside the tailnet. That command was what the check
  ran, so it was checking nothing. The grant is read from the node's capability map instead, and a
  tailnet that has not given it is told exactly what to add to its policy file.

  The remediation it used to print could never have run, and had stopped working regardless: it
  called `tailscale funnel 443 on`, a syntax since removed from the Tailscale CLI.

- **Changed: `harbor public status` separates running from reachable.** A share node whose tailnet
  has not granted Funnel is up, holds a certificate, and serves nobody. Status said `public: on`,
  which is the line an operator checks to answer "are my links working".

**Worth knowing:** if share links work for you and not for the people you send them to, this is
almost certainly why. `harbor public status` on this release says so, and `harbor public enable`
prints the policy change.

## v0.7.5 — 2026-09-15

- **Fixed: `harbor public enable` could not read the name its share node had taken.** The domain was
  extracted from `tailscale status --json` with a line-based pattern, and that field spans lines —
  so on a node that was published and serving Funnel correctly the name came back empty.
  `harbor public status` reported `https://unknown`, and `harbor public enable` skipped recording
  the origin, leaving links pointing at `localhost`.

## v0.7.4 — 2026-09-15

- **Fixed: creating a share returned an internal server error on an appliance.** The sealed bundle
  was written to `/data/tmp` and then moved into `/data/shares`. Those are one filesystem but two
  bind mounts, and Linux refuses to rename across a mount boundary whatever is underneath, so every
  share failed with `EXDEV: cross-device link not permitted`. The bundle is now sealed where it is
  going to live, and the move stays inside one mount.

  The guard added in v0.7.3 could not have caught this: it compares which device the two directories
  are on, and they are genuinely on the same one.

- **Fixed: `harbor public enable` stopped on a file the installer never downloaded.** The share
  node's compose overlay was fetched only by installs that run Tailscale as a container. A box with
  Tailscale on the host — the arrangement [`docs/deploy.md`](docs/deploy.md) recommends, because it
  keeps a way in when the stack is down — never received it. Every install now fetches it, and
  `harbor upgrade` adds it to boxes that already exist.

- **Fixed: the first `harbor public enable` left `SHARE_ORIGIN` unset.** The line was replaced with
  `sed` and appended only if `sed` failed — but `sed` reports success when it matches nothing, so on
  a configuration that had never carried the setting nothing was written, and the command still
  reported the links as live.

- **Changed: Settings reports whether share links reach anyone, instead of claiming they do.**
  "Harbor itself" carried a badge reading *Nothing to set up* on every install, while
  `harbor public enable` was in fact required first — the one sentence saying so was the last clause
  of the paragraph beneath it. The badge now reads the box's own state, the share dialog warns
  before a link that reaches nobody is handed over, and neither blocks: the bundle and the link are
  real, and publishing makes them reachable without invalidating either.

**Worth knowing:** a box that ran `harbor public enable` on v0.7.3 has no `SHARE_ORIGIN` in its
configuration. `sudo grep SHARE_ORIGIN /data/harbor.env` says whether yours does; running
`harbor public enable` again on this release writes it.

## v0.7.3 — 2026-09-15

- **Fixed: the stack would not start on an appliance, on any v0.7.x before this one.** The doorman
  was added to the compose file with instructions to build it from source, and nothing published an
  image for it — so `up` stopped at a build context that does not exist on a box, before any other
  service started. CI now builds and publishes `harbor-share` alongside the other four, and the
  appliance's compose file pulls it like everything else. Nothing in v0.7.0 changes; this is the
  first v0.7.x that starts.

  It was invisible until an appliance tried it: locally and in CI the stack builds from the source
  tree sitting right there, which is exactly the difference between the two.

## v0.7.2 — 2026-09-15

- **Fixed: the API would not start on a volume without the new share directories.** Sharing creates
  `shares/` and `share-state/` under the data volume, and the API tried to make them as it booted.
  Where they did not already exist with the right owner — any volume prepared before v0.7.0 — that
  failed with a permission error and took the whole vault down with it: no documents, no inbox, no
  mail, because an optional feature could not make a folder. Sharing now fails on its own and says
  what to do, and everything else starts regardless. `check-data-volume.sh` creates both directories
  from now on, so a re-run of the installer sets them up.

## v0.7.1 — 2026-09-15

- **Fixed: the v0.7.0 images for `api`, `worker` and `backup` never built.** Sharing added a
  workspace package that those three depend on, and their Dockerfiles copied every other package's
  manifest before installing but not that one — so the build ran without its TypeScript and stopped
  at `tsc: not found`. Only `web` came out of v0.7.0 intact. Everything in v0.7.0 applies; this is
  the release that can actually be pulled.

## v0.7.0 — 2026-09-15

- **New feature: document sharing.** Share files from the box itself or from a bucket, with a link
  per recipient. Documents ticked in any list — a search, an item, the inbox — collect behind a
  **Share** button in the header. A share carries a name, an expiry, and one link for each
  recipient, so the record shows which of them opened it, and withdrawing one leaves the others
  working. A link can require a password and can be limited to a single download. Harbor sends
  nothing: each link is copied and passed on by hand, exactly as invitations already are.

  Links appear **once**, when the share is made. Harbor stores them hashed, the way it stores
  sessions, and cannot show them again.

  A share is a snapshot, sealed at the moment of creation: the chosen documents are packed into one
  archive and encrypted under a key that exists for that share alone. Replacing a document
  afterwards does not change what an outstanding link hands out, and withdrawing a share destroys
  the archive and its key together. What a recipient has already downloaded stays with them.

  **Two ways to deliver, chosen once in Settings → Sharing.** *Harbor itself* serves links from the
  box, over a new `harbor-share` container on its own tailnet name — `harbor public enable` turns
  that on and walks through the two settings Tailscale needs. Every control works, and a link is
  dead while the box is asleep. *Your own storage* pushes the sealed archive to a bucket instead, so
  links keep working when Harbor is off and nothing on the box is reachable from outside — at the
  cost of one-download limits, and a 7-day ceiling on expiry. The recipient's browser does the
  decrypting; the storage holds only bytes it cannot read. **Test** writes a file, reads it back
  through a link and deletes it, so a misconfigured bucket surfaces immediately rather than at the
  far end. See [§10](docs/spec/10-sharing.md) for the design.
- **Changed: documents open over the page instead of replacing it.** A click raises a viewer over
  the list — the document on the left at whatever size the window allows, its details on the right,
  and **Escape** returns to the list as it was. A link or a refresh still opens the full page.
- **Changed: `harbor upgrade` refreshes the stack, not just the images.** The compose files and the
  `harbor` command were written once at install and never touched, so a release adding a service or
  a subcommand could not reach a running box. Both are refreshed now for the version being moved
  to. `HARBOR_KEEP_LOCAL=1` preserves hand-edited compose files and reports which were skipped.
- **Added: security headers.** A content security policy, HSTS, framing and referrer rules, which
  the app never had. Nothing about ordinary use changes; it was a gap that mattered once anything on
  the box could face the internet, and `harbor public enable` refuses to run without them.
- **Changed: an item's Edit and Remove photo moved into a ⋯ menu** beside its name. Removing a photo
  now asks first.
- **Changed: lists dropped the Ready column and the thumbnails.** Both said the same thing on every
  row.
- **Changed: the page header stays put while the page scrolls**, and page content is centred rather
  than pressed against the sidebar.
- **Worth knowing:** this release adds a `share` service and two directories under the data volume,
  `shares/` and `share-state/`. Share archives are deliberately **not** included in backups — they
  are short-lived copies of documents already backed up.
- **Worth knowing: one manual step, once, on a box installed before this release.** The `harbor`
  command on an existing appliance predates the change above and cannot refresh itself, so the first
  upgrade brings new images but leaves the old stack around them. Re-running the installer over the
  existing install picks both up:

      curl -fsSLO https://raw.githubusercontent.com/openharborhq/harbor/main/install.sh
      HARBOR_DATA_DIR=/data sh install.sh

  Data, keys and configuration are kept. Every upgrade after this one does it automatically. Until
  then, Harbor refuses to create a share and says so, rather than making one that would be lost on
  the next restart.
- Plus a round of interface work: the share review is a dialog rather than a page, documents preview
  inside it, and a good deal of tidying to type, spacing and wording throughout.

## v0.6.1 — 2026-09-12

- **PDFs attached from Gmail are filed again.** Gmail's web client marks every file it attaches
  in a way Harbor read as an inline picture, so a bill forwarded or sent from Gmail was skipped
  without a trace — the water bill that surfaced this was scanned by two installs and filed by
  neither. Mail that arrived before this release was never recorded as seen, so a **Scan
  history** over the last month from Settings → Mail picks it up now.
- **A mailbox that drops out once is retried.** A single failed connection marked the mailbox
  unreachable and the five-minute sweep then left it alone for good, until someone pressed Test
  in Settings. The sweep now keeps trying; the Inbox still says the mailbox is not connected
  until a pass succeeds. A rejected password still waits for a new one rather than retrying.
- **You choose the currency on a to-do.** A to-do typed by hand was always stored in euros,
  whatever you meant, and one proposed from a document carried whichever currency the model
  assumed when the page showed none — so a dollar bill could sit on the list as "€5,792.25".
  Every place an amount is entered or accepted now has a currency beside it (€, $, £, CHF), and
  when a document does not state one the to-do says so with a "?" instead of guessing. Existing
  to-dos keep what they have; correct one from **Edit** on its document.
- Search results now show the people, things and tags a document is about, and how it arrived,
  as labels under the matched text.

## v0.6.0 — 2026-09-10

- **Harbor now keeps track of what paperwork still needs doing.** A bill to pay, a form to return,
  a deadline to object by. When you file a document, the suggestion offers the to-do it found as a
  tick on the filing action — "…and remind me to pay €248.10 by 14 Oct" — rather than as a second
  decision. A **To do** page lists what is outstanding, grouped by when it is due, and the sidebar
  counts what is overdue or due today. Ticking something off records who did it and when, so "did
  we ever pay that?" is still answerable next year. You can add a to-do by hand, attach it to any
  document, and correct an amount the suggestion read wrongly.
- **Documents longer than one page are read properly.** Until now the model was shown the first
  4,000 characters — less than a page of a typical scan — so summaries of multi-page documents
  described only the first page, and any figure further in was invisible. It now reads across
  every page. Documents already in your vault were summarised under the old limit; see below.
- **The same page scanned twice is now spotted.** A second pass through a scanner produces
  different bytes, so the duplicate check never saw it. Harbor compares the figures a document
  contains, says "looks like a copy of X" on the Inbox card, and offers to file the newer scan as
  another version of the document you already have. It never merges or deletes on its own.
- A **Filing** tab on each document lists every field with a label — where it is filed, where it
  came from, its size, language and extracted text — leaving the main view for what is
  outstanding, the summary and your notes.
- An empty Inbox now names the mailbox it is watching, how often it checks and when it last did,
  instead of saying "every few minutes".

Plus a round of interface tidying and internal cleanups.

**Worth knowing**

- **Home's "Expiring soon" is now "Needs attention"**, and holds both to-dos and documents that
  expire. Only a to-do can be ticked off — a passport is resolved by filing a new one, not by
  saying you dealt with it.
- **A payment due date is no longer an expiry.** Bills used to put their due date in the document's
  expiry field, which is why "Expiring soon" filled up with lapsed invoices. New documents put it
  in a to-do instead. Documents already filed keep the expiry they were given.
- **To get to-dos and better summaries for documents you already have**, run `harbor suggest rerun`
  on the box. It re-reads everything you have not already accepted a suggestion for — where you
  accepted one, your decision stands and is left alone. This sends those documents to your
  suggestion provider again, so it costs whatever your provider charges.

## v0.5.2 — 2026-09-09

- **Fixes suggestions properly.** v0.5.1 aimed at the wrong cause. Photographs need two things the
  suggester has never had — a data volume and an upload parser — and giving the shared items
  module both meant the suggester died on startup trying to create `/data/tmp`, a directory that
  does not exist in a container with no disk mounted. Photos now live in their own module that
  only the API loads. On v0.5.0 and v0.5.1 documents still arrive, are OCR'd and are searchable;
  what stops is the title, summary, category and dates a model proposes.
- **The split is the fix, not the patch.** What all six processes need stays in the items service;
  what only a web request needs — storage, encryption, uploads — sits beside the controller that
  uses it. Multer builds its disk storage the moment its module initialises, so merely being in
  the graph was enough to kill a process that had no use for it.

**Worth knowing**

- If you are on v0.5.0 or v0.5.1, upgrade. Nothing was lost while suggestions were down: the
  documents are filed, and `harbor suggest rerun` on the box re-reads the ones that never got a
  suggestion.

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
