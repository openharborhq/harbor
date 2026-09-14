# 10. Sharing — handing documents to an outsider

Once a year the Steuerberater needs the 2025 folder. When the boiler dies, the insurer needs
the policy and two invoices. At a move, the landlord needs three documents and nothing else.
Today that means downloading files onto a laptop and attaching them to mail — the vault's
careful custody ends the moment paperwork leaves it, and there is no record of what left.

This section closes that. It is also the **only feature in Harbor that needs a stranger's
browser to reach something**, and that single fact decides the whole design: every control a
share offers — expiry, one-time, password, revoke, audit — is a promise kept by whatever
serves the bytes. Pick the wrong server and the controls are theatre.

## 10.1 The crux, and what was chosen

Three things can be what the recipient reaches: the box itself, a relay in front of it, or a
dumb host the box pushes to.

| | Box reachable | Enforcement lives | Works while box is asleep or locked | Third party sees plaintext | Rented |
| --- | --- | --- | --- | --- | --- |
| **Tailscale Funnel** | yes, one path | our code | no | no — TLS ends on our node | no |
| Cloudflare Tunnel | yes, one path | our code | no | **yes** | yes |
| Push bundles outward | no | the store | yes | no, if sealed first | by the owner |

**Chosen: Funnel, plus a doorman that is not the vault — and pushing outward as a second sink
(§10.10).** Cloudflare is disqualified on the middle column: a product whose pitch is that your
paperwork lives in your house cannot route that paperwork through someone else's edge in the
clear, and the cost is not one a user can see. Pushing bundles outward is the better answer on
availability and on setup, and is specified as an alternate sink rather than a replacement —
**to the owner's own object store**, the one they already hold for backups, so nothing is rented
by the operator and no new account is asked for. Which sink serves a given share is a per-share
choice, because the two fail in opposite directions and neither dominates.

Funnel costs nothing, is already installed, hides the home address behind Tailscale's relays,
and terminates TLS on our own node. §3.2 currently disables it with a comment saying that is
load-bearing. This section is the one thing that flips it on, deliberately and reversibly.

## 10.2 The doorman

**The public path must never be the API.** Funnel points at one port belonging to one new
container, `harbor-share`, which is deliberately stupid.

| Does have | Does not have |
| --- | --- |
| The sealed bundles of live shares, and their per-share keys | The KEK, or any wrapped DEK |
| A policy file per share: expiry, limits, password hash | A Postgres connection of any kind |
| An append-only event log it writes | Any route that lists, searches or enumerates |
| One route family: `GET /s/:token`, `POST /s/:token/download` | Session cookies, accounts, login, admin — on that origin, ever |

The security argument is one sentence: **if the doorman falls, the attacker holds the
documents that were already being handed out**, and nothing else. Everything below exists to
keep that sentence true.

**Seal per share, at creation time.** Creating a share is not a pointer, it is a build. The
API decrypts the chosen files with their DEKs, re-encrypts them under a **fresh per-share
key**, and writes a bundle into a share-only directory. The doorman never reads `/data/blobs`
and holds no key that opens anything that was not explicitly shared. A share is therefore a
**snapshot**: it pins `document_file_id`, so replacing a document afterwards does not change
what a link hands out. Say that in the UI; it is the behaviour people expect from an
attachment and not from a link.

**The bundle is one zip, sealed whole** (decided 2026-09-14). The chosen files go into a single
archive **stored, not deflated** — scans and PDFs are already compressed, so deflate spends CPU
on both ends for nothing — and that archive is encrypted as one blob. Not a zip of separately
encrypted entries: the container has to be *inside* the seal, because otherwise the filenames
sit in the clear where the doorman or the store can read them, and a list of filenames is most
of what a document is about. `share_files.filename_in_bundle` is what the recipient sees, so it
is sanitised and de-duplicated at seal time rather than trusted from `original_filename`.

One accepted wart: a share of a single document still arrives as a zip, because the archive is
also what carries the filename. Unwrapping it for `n = 1` would work only on the sink that
decrypts in the browser, and behaviour that differs by delivery is worse than an extra click.

**The share directory is the only interface between them.** There is no API call from the
doorman into the vault, no shared database and no network path between the two containers.

```
/data/shares/                         written by the API, mounted read-only in the doorman
    bundles/<share_id>/bundle         the sealed archive, padded
    bundles/<share_id>/key            the per-share key, raw
    links/<sha256(token)>/policy.json expiry, max_downloads, password_hash, filename
/data/share-state/<sha256(token)>/    the only path the doorman may write
    state.json                        completed download count, first_opened_at
    events.jsonl                      append-only: viewed, password_failed, download_started…
```

Bundles are keyed by share and policies by token, rather than everything by token, because a share
has one archive and several recipients — keying the bundle by token would mean a copy of it per
recipient. The state directory is outside the read-only mount for the obvious reason: it is the
one path the doorman may write, and it is never written from the vault side.

The doorman hashes the presented token and looks for that directory — it holds no list of
tokens to steal, though a compromise hands over the bundles directly, so this is depth, not
the defence. It re-reads `policy.json` on every request, which makes **revoke immediate**:
revoking deletes the key and the bundle, and the next request is a 404 whatever is cached
where. A worker on a short interval ingests `events.jsonl` into `share_access_log` so the app
can show the audit trail; the doorman needs no way to tell it anything.

## 10.3 Data model

```
shares               id, label, message (shown on the landing page), created_by, created_at,
                     delivery (doorman|bucket), object_key (bucket only), padded_size,
                     expires_at, revoked_at, revoked_by,
                     bundle_sha256, byte_size, file_count,
                     share_key_wrapped, iv, auth_tag, key_version,   -- KEK-wrapped, for re-seal
                     sealed_at, purged_at
share_files          share_id, document_id, document_file_id, filename_in_bundle, sort_order
share_links          id, share_id, recipient_label, token_hash,
                     password_hash (argon2id, nullable), max_downloads (NULL = unlimited),
                     download_count, expires_at (nullable, narrows the share's),
                     first_opened_at, last_downloaded_at, revoked_at, created_by
share_access_log     id, share_link_id, event (viewed|password_failed|download_started|
                     download_completed|denied), reason, ip, user_agent, bytes_sent, created_at
```

Conventions from §1 carry over: tokens are 256-bit and stored **hashed**, as sessions and
invites already are; the audit trail of *creating* and *revoking* a share is an `audit_log`
entry like every other privileged action, while `share_access_log` records what strangers did.

### Where the bytes live

Three stores, three purposes, and only the third is new. **The vault's documents never move.**

| | Holds | Encrypted with | Lifetime |
| --- | --- | --- | --- |
| `/data/blobs` on the box | the originals — the vault itself | a per-file DEK, wrapped by the KEK | as long as the document exists |
| The restic bucket | offsite backup snapshots | restic's own key, held at home | the backup retention policy |
| **A share's bundle** | a sealed **copy** of the files a share names | a fresh per-share key | until the share expires or is revoked |

A share never relocates a document; it builds a separate sealed copy and hands that out. Where
the copy sits is the only thing delivery changes: `/data/shares/` on the box for `doorman`, the
share bucket for `bucket` — and with `doorman` delivery **no bucket is involved at all**.

Bundles are **derived data and excluded from restic** (§3.4). They are a second plaintext-
equivalent copy of documents that are already backed up, under a key with a short life; adding
them to the envelope would lengthen exactly the exposure the design shortens. `purged_at`
records the bundle's deletion on expiry or revoke — the row and its audit trail outlive it.

## 10.4 Per recipient, not per link

**Mint one token per recipient.** "Named access" is not a field on one link, it is several
links. The accountant's and the landlord's differ, so the audit trail says which of them
opened it, and revoking one does not break the other.

Be honest in the UI that a recipient name is **a label, not verified identity**. Harbor sends
no mail, so it has no channel to prove who is on the other end. The password is what turns a
forwarded link into a dead link, and you tell it to them by phone.

**Copying the link is the send.** The box mails nothing, exactly as invitations already work.
That precedent is right and this feature does not break it.

Controls, per link: expiry (24 hours / 7 days / 30 days), maximum downloads (1 / n /
unlimited), optional password, revoke now. Every fetch logged with time, address and user
agent, shown on the share's page in the app.

Three of those depend on the sink and §10.10 says why: **maximum downloads exists only on
`doorman` delivery**, because counting needs a stateful server; **30-day expiry too**, because
presigned URLs expire after seven; and on `bucket` delivery the password wraps the key rather
than gating a request. The fetch log is the doorman's; a bucket share's page shows what the
store reports and says plainly that it records less.

## 10.5 Collecting — the basket

Sharing starts from the documents, not from a Share page. A basket persists across pages, with
an add affordance on document rows, item pages and search results, so *everything tagged 2025
taxes for the Steuerberater* is a search you turn into a share. A review screen — files,
recipients, controls, what each link will say — stands between the basket and a live link.
The basket is per-user and ephemeral; it is not a saved collection, and a share is the durable
object.

**Documents only** (decided 2026-09-14). An **item** — *the Subaru*, *Lindenstraße 14* — cannot be
dropped into the basket, not even as a shortcut that expands to the documents filed under it.
Sharing an item is a different promise from sharing four documents, and the difference is invisible
at the moment of sending: whatever the review screen showed, the person clicking Share believes
they sent *the car*. Everything a share hands out is therefore named one document at a time. An
item page still offers each of its documents individually, which is the ordinary way a share of
"the car's paperwork" gets built.

## 10.6 Serving like a hostile host

The doorman serves attacker-supplied bytes to attacker-chosen browsers on a public origin. It
behaves accordingly:

- `Content-Disposition: attachment` always, `X-Content-Type-Options: nosniff`, a strict CSP,
  `Referrer-Policy: no-referrer`. **A document is never rendered as HTML.**
- No cookies set on that origin, ever. No `Access-Control-Allow-Origin`.
- The landing page is the doorman's own minimal HTML, not the app; it shares no code path, no
  session middleware and no asset origin with `apps/web`.
- Password attempts rate-limited hard, per token and per address, reusing the existing limiter.
  A wrong password and an unknown token return the same thing after the same delay.
- Nothing in a response distinguishes *expired*, *revoked*, *download limit reached* and *never
  existed* to the fetcher — the reason goes to the log, and the owner reads it in the app.

**`harbor public enable`.** Turning Funnel on is a CLI command that prints what it means,
requires a deliberate confirmation, and has a matching `disable`. Not a first-run question:
"should this be on the public internet?" has a wrong answer for nearly everyone and asking it
during setup normalises it at the moment someone is least equipped to judge. Prerequisite, and
it is a real one: the security headers, CSP and HSTS that §3 still lacks. Funnel does not come
on until the doorman has them.

### The doorman gets its own tailnet node

**Decided 2026-09-14.** The doorman does not share a hostname with the app. It runs its own
`tailscaled` and appears in the tailnet as its own machine, so Funnel serves it at
`harbor-share.<tailnet>.ts.net` **on 443**, with its own certificate.

Two reasons, and the second is what forces it.

- **Origin separation.** Browsers scope cookies and page access by origin — scheme, host *and*
  port. Sharing an origin with the app would send the vault's session cookie to the public path
  and put attacker-influenced HTML on the same origin as the vault, which makes the "no cookies
  on that origin, ever" rule above unkeepable. A different **port** would also be a different
  origin, and Funnel allows 8443 — but see below.
- **Recipients are behind other people's firewalls.** A tax firm, an insurer, a bank: the
  outbound rules there routinely permit 80 and 443 and nothing else, and a link on `:8443` fails
  for exactly the recipients this feature exists to serve — silently, and on their side, where
  the owner cannot diagnose it. **Share links are 443 or they are broken.**

A second node costs a second container, a second auth key, a state volume to keep the machine
name stable across upgrades, and one more device in the tailnet. What it buys beyond the above:
the **funnel node attribute is granted to the share node alone**, so the app's node keeps
`AllowFunnel: {}` empty permanently and no mistake there can publish the vault.

Worth naming, because it is the same class of problem one layer out: a filtering proxy may not
recognise a `*.ts.net` host at all, whatever the port. Nothing on this path fixes that — but a
`bucket` share (§10.10) is served from an ordinary object-store endpoint, which such a proxy is
far more likely to already allow. For a recipient inside a locked-down firm, that sink is not
just more available, it is more likely to be *reachable*.

### What the owner actually does

The share node changes the Tailscale setup in exactly one place, and it is not the install.

**At install: nothing.** `deploy.md` is unchanged, `tailscale up` on the host (or the container
overlay) still serves the app and nothing else, and the share node does not exist. An install
that never shares never grows a second node.

**On `harbor public enable`**, three things happen that the owner can see:

1. **The share container joins the tailnet.** It prints a login URL exactly as `tailscale up`
   did the first time; the command surfaces that link and waits, so **no auth key has to be
   made, pasted or stored**. `TS_AUTHKEY` stays available for scripted installs, as the app's
   node already does.
2. **A second machine appears in their admin console**, `harbor-share` beside `harbor`. Say so
   before it happens. A household owner who finds an unexplained device in their tailnet is
   right to be alarmed, and being told afterwards is worse than being told first.
3. **The funnel attribute is granted to that node**, which is the one policy edit the preflight
   already walks them through. Tailnet HTTPS certificates are already on from the original
   install, so that step does not come back.

Four things that will go wrong if they are not handled:

- **The machine name may not be the one we asked for.** If `harbor-share` is taken, Tailscale
  appends a suffix and the public hostname is silently not what the link builder assumed. Read
  the node's **actual** cert domain and build links from that; never compose the hostname from
  the configured name.
- **Device approval**, where a tailnet has it switched on, leaves the node registered but not
  authorised. That is its own preflight message, not a timeout.
- **Identity must survive upgrades**, so the share node gets its own state volume on the
  encrypted disk, backed up with `/data/tailscale`. Losing it means a new node, a new name, and
  every live link dead.
- **`disable` leaves the node in place** and only stops Funnel, so re-enabling is instant; a
  `--forget` removes it from the tailnet. Whichever runs, say which — a machine that lingers
  unexplained is the same failure as one that appears unexplained.

One more device counts against the tailnet's plan; a household on the free personal tier is
nowhere near the limit.

### The preflight is most of the command

Funnel needs **no firewall change, no forwarded port and no dynamic DNS** — the box makes an
outbound connection to Tailscale's relays and traffic returns down it, which is why it works
behind carrier-grade NAT where forwarding is impossible. Opening 443 and fronting it with our
own proxy is a different option, and §3.2 keeps calling it *not recommended*.

The friction that does exist is **account-side, and once per tailnet**: Funnel is off by
default, and enabling it means HTTPS certificates turned on for the tailnet and a `funnel`
node attribute in the ACL policy file — which is JSON, in a web console. For this audience
that is the whole difficulty of the feature, so the command carries it rather than the person:

1. **Check, and say which step is missing.** Is Tailscale reachable, is the **share node**
   logged in and named as expected, are tailnet HTTPS certificates on, does the policy grant
   *that* node the Funnel attribute, is its serve config still refusing Funnel? Each has its own
   sentence. The app's node is checked only to confirm it is still **not** funnelled.
2. **Hand over one link.** When Funnel is not permitted, `tailscale funnel` refuses and prints
   an admin-console URL that pre-fills the required policy change. The command surfaces *that*
   URL, verbatim, with a line of plain English — nobody should be left to find the ACL editor.
3. **Wait and re-check** rather than exiting. The person clicks, approves, comes back; the
   command confirms and only then writes the serve config.
4. **Print the share hostname** it will serve on, and the reminder that links die while the box
   is asleep or waiting on `harbor unlock`.
5. **`disable` reverses all of it**, and says what happens to live shares: the links stop
   resolving, the bundles stay, nothing is revoked.

The owner who genuinely cannot do step 2 is the case §10.10 exists for. It is not a reason to
open a port.

## 10.7 Six things that will bite

1. **Link previewers burn one-time links.** WhatsApp, Slack and Outlook Safe Links fetch a URL
   before a human sees it. "Delete after first GET" is dead on arrival. The first GET returns a
   landing page and nothing else; **the download burns only on an explicit `POST` from a click**.
2. **Range requests make "one download" ambiguous.** Resumable downloads are several GETs of the
   same bundle. Count *completed* downloads, and give a short window after the first click —
   "opens once, then twenty minutes to finish".
3. **The box is at home.** Asleep, rebooting, or waiting on `harbor unlock` all mean a dead link,
   and the owner learns it from the recipient. The share screen says so in words when a link is
   created, and §10.10 — the second sink — is the answer for a share that cannot afford it.
4. **The audit log is a GDPR asset, not a nicety.** This feature hands third parties personal
   documents about identifiable people. Knowing exactly what left, to whom and when is the
   record you would want to have.
5. **Purge is part of the feature, not cleanup.** A bundle outliving its share is the whole
   exposure. Expiry, revoke and purge run on the existing scheduler, and a failed purge is a
   visible error, not a silent retry.
6. **The temptation, once the doorman exists,** will be to route the whole app through it and
   call household access solved. Don't. It is safe precisely because it is stupid and holds
   almost nothing.

## 10.8 Not in v1

Watermarking. In-browser view-only rendering — a PDF viewer on a public origin is a large
attack surface for very little. Upload-back, where the recipient returns files: a natural
sequel, a bad start. Expiry timers that begin on first open. Shipping is: basket →
per-recipient links → expiry, max downloads, password, revoke, audit.

## 10.9 What this changes in §3

Two rows of the threat model stop being true and must be rewritten rather than left standing:

- *Internet attacker — nothing to connect to — zero inbound ports, tailnet only.* With Funnel
  on there is exactly one path, to one container, and the honest claim is the narrower one:
  **nothing an internet attacker reaches holds a key to anything that was not shared on
  purpose.**
- *Non-goals* gains one: a recipient who keeps a copy. Once a document has been downloaded it is
  theirs; expiry and one-time limit further *fetches*, not what already left. The UI must not
  imply otherwise.

§3.2's "public exposure mode, not recommended" stays accurate for the app itself. It is the
doorman, and only the doorman, that faces outward — **a `bucket` share (§10.10) needs none of
this**, since the box only ever makes an outbound PUT and both rows above stay true as written.
An install that never enables Funnel keeps the original threat model intact and can still share.

## 10.10 The second sink — the owner's own bucket

The doorman's worst failure is trap 3: a link is dead whenever the box is asleep, rebooting or
waiting on `harbor unlock`, and the owner finds out from the recipient. The fix is the third row
of §10.1 — the box **pushes** a sealed bundle outward instead of serving it — and the question
that decides whether it is a good idea is *whose* external location it is.

| | A — a relay the operator runs | **B — the owner's own bucket** | C — their bucket plus a function |
| --- | --- | --- | --- |
| Setup for the owner | none | **one private bucket** on credentials they have | deploy a Worker: out of reach |
| Enforcement available | all four controls | expiry, revoke, password | all four |
| Who pays | the operator, monthly | the owner, pennies | the owner |
| Data-processor duty | **the operator** | the owner, where it already sits | the owner |

**B is specified here; A stays deferred and C is rejected.** B answers the objection that the
Funnel preflight (§10.6) is too much to ask, and it does so without the operator renting,
holding or answering for anything: **Harbor already requires an object store for backups**
(§3.4). Reusing those credentials means no new account and no new vendor — one new bucket, on a
console the owner already has open. Their documents, their bucket, their bill. A relay
run by the operator remains the only sellable version of this feature, for the reason at the
end of this section, and nothing here forecloses it.

### How it works

`shares.delivery` is `doorman` or `bucket`, chosen per share. The seal is **byte-identical**
either way; only what happens next differs.

```
seal (unchanged)  →  doorman:  write /data/shares/<sha256(token)>/ and serve it
                  →  bucket:   PUT <share-bucket>/<sha256(token)>/bundle
                               PUT <share-bucket>/<sha256(token)>/index.html
                               link = presigned GET of index.html, key in the fragment
```

Two objects are written per share, into the **same bucket**: the sealed `bundle`, and a tiny
per-share `index.html` with the bundle's presigned URL baked into its body. The link handed to
the recipient is the **presigned URL of that page**, with the key in the fragment:

```
https://<endpoint>/<share-bucket>/<sha256(token)>/index.html?X-Amz-…#k=<key>
```

Fragments are never transmitted, so the store serves a page and some ciphertext and learns
nothing else. The page fetches the bundle from **its own origin** — which is why both objects go
in one bucket: same origin, so no CORS configuration is asked of the owner. It decrypts through
Web Crypto and hands over a file. No server code anywhere on this path.

Three rules that are not optional:

- **Pad every bundle to a size bucket** (1, 4, 16, 64, 256 MB…). The store sees sizes, and an
  unpadded size separates a passport scan from a year of tax paperwork perfectly well.
- **The password wraps the key, it does not gate a download.** With no server to ask, a password
  is only meaningful as crypto: the fragment carries the per-share key *wrapped* under a key
  derived from the password, and the recipient types it to decrypt. This is
  offline-brute-forceable by anyone holding the ciphertext, unlike the doorman's rate-limited
  check, so the UI says "choose something they will not guess", not "protected by a password".

  **PBKDF2-SHA256 at 600,000 iterations, not argon2id** (settled in implementation, 2026-09-14).
  The unwrapping happens in a browser, and Web Crypto has no argon2; supplying one means shipping
  a WebAssembly build to the single page that is supposed to carry no third-party code, which is
  the worse trade. It is weaker per guess, which is exactly why the wording above promises less.
  The parameters are a contract between the sealing code and the page, and a test asserts it.
- **Stream the decryption.** Chunked AEAD, not one buffer — Web Crypto's one-shot `decrypt` would
  otherwise need a whole 200 MB bundle in memory *and* produce its plaintext all at once.

  One limit is the browser's, not ours: handing the finished file over still means assembling a
  Blob, unless `showSaveFilePicker` exists (Chromium), in which case each chunk is written
  straight to the file the recipient chose and nothing accumulates. Mobile Safari is the target
  to test against, and the browser floor is stated on the share screen because the recipient is by
  definition someone the owner cannot troubleshoot for.

  The bundle stores `iv || tag || ciphertext`, which is Node's layout; Web Crypto expects the tag
  **appended** to the ciphertext. The page swaps them. This is written down because getting it
  wrong fails as an undifferentiated "did not decrypt".

### Setting it up

One page, `Settings → Sharing`: the choice, and — when it is `bucket` — an address, a bucket name,
a region, a key id and a secret, with presets that fill the first two in. The secret is sealed
under the KEK like a mailbox password, and is reported only as present or absent.

**Test does what a share does**, in the order a share does it: writes a small object, reads it
back **through a signed link**, and deletes it. A credential check alone would pass on a bucket
that cannot serve a presigned GET — the one capability that makes a store a sink — and the owner
would find that out from their accountant. A failed delete fails the test too, because a share
that cannot be deleted cannot be withdrawn.

### Which stores can be a sink, and why it is not every backup backend

Backups and sharing need different things from a remote. restic needs *write and read blobs,
authenticated, as the owner*. A sink needs *serve one object to an anonymous browser over HTTPS,
at a URL carrying no credential of the owner's*. SFTP cannot do the second at any price — there
is no HTTP server at the other end — and neither can a local disk, a removable drive or a restic
REST server. **The set of share sinks is a subset of the backup backends, and the two are
configured separately even when they share an account.** Backing up over SFTP stays fully
supported; it means sharing on that install runs through the doorman, and someone who chose SFTP
for backups is precisely the person who can complete the preflight in §10.6.

The adapter count is nevertheless **one**. B2, R2, Wasabi, MinIO, Storj and S3 itself all expose
an S3-compatible API, so a single `s3` sink with a configurable endpoint reaches all of them.
This follows §5 exactly: *commercial services are settings presets, not code paths*. The preset
fills in endpoint and region; "custom" takes both by hand. Each preset is only listed once its
presigning and content-type behaviour have actually been verified against it, not because the
vendor's documentation claims S3 compatibility.

```
ShareSink        put(key, bytes, contentType)  ·  presign(key, ttl)  ·  delete(keys)
implementations  doorman (local, always available)  ·  s3 (endpoint + presets)
not a sink       sftp · local · removable disk · restic REST — no anonymous HTTPS GET
```

**A second bucket, and it is private** (decided 2026-09-14). Shares do not go in the restic
bucket: a lifecycle rule that is right for share objects is wrong for backup data, and a prefix
that anonymous requests can reach has no business inside the bucket holding the vault's last
line of defence. The share bucket needs **no public-read policy and no CORS rules** — presigned
URLs and the same-origin layout above cover both — so creating it is one form in a console the
owner already has open, not a permissions exercise. That is the whole of the new setup, and it
is one thing rather than zero; the earlier claim that this sink costs nothing to set up was too
strong.

**One hard limit comes from presigning.** SigV4 presigned URLs are valid for at most **seven
days**, which is shorter than the longest expiry this feature offers. So on `bucket` delivery,
expiry choices are 24 hours and 7 days; **30 days requires the doorman**, and the share screen
says that rather than offering a control that would quietly produce a dead link on day eight.
An owner who wants long-lived links from a bucket can make it public-read and let a lifecycle
rule do the expiring — documented, not a default, because it trades an unguessable presigned URL
for an unguessable path and asks for a bucket policy.

### What the owner gives up, in plain words

- **Expiry tops out at 7 days**, the presigning limit. A 30-day share needs the doorman.
- **One-time download is unavailable on this sink.** Counting requires a stateful server, and a
  presigned URL to an object store is not one. The share screen offers *max downloads* only for
  `doorman` delivery, and says why rather than greying out a control in silence.
- **The key never expires.** Revocation works because the object is deleted; the key itself lives
  in every chat log, clipboard and browser history the link passed through. If the ciphertext
  ever leaks another way — the store's own backups, a misconfigured bucket — anyone who kept the
  URL can still read it. On the doorman, revoke destroys the key and the bundle together, at
  home. Expiry on this sink is a property of *availability*, not of secrecy, and the UI says so.
- **The store learns metadata**: a token, a padded size, and the recipient's address and time on
  every fetch. Not the documents, and not who they are — but a pattern.
- **JavaScript is required** to open a share. Some corporate gateways and locked-down browsers
  will refuse, and the fallback is the doorman.

### What it buys

Availability, which is the whole point: the link works while the box is asleep, mid-upgrade or
locked. **No public path to the appliance at all** — so unlike the doorman this sink requires no
Funnel, no preflight, and **no rewrite of §3.1**; "an internet attacker has nothing to connect
to" stays literally true. Serving a large bundle stops depending on a home upstream. Abuse
traffic lands on a store designed for it. And trap 1 disappears: a link previewer cannot burn a
one-time link when the key was never sent to any server.

### Which sink, and who chooses

**A setting, not a per-share choice** (decided 2026-09-14, replacing the per-share design above).
It was briefly a pair of radio buttons on the review screen. That is the wrong place for it: the
two sinks differ in what they *require* — one needs a bucket and its credentials — and putting a
prerequisite in front of someone who is halfway through sending four documents means they meet it
at the worst possible moment, or pick the other option for the wrong reason.

So the choice lives in **Settings → Sharing**, once, next to the fields it needs, with each option
stating its own consequence and only the selected one opening its form (the pattern §4 already
uses for the suggestion provider). `doorman` is the default because it needs no setup: an install
that has been configured for nothing at all can still share.

The review screen (§10.5) **states** the consequence in one line rather than offering it — *"Works
even if your Harbor is offline. Cannot be limited to a single download, and lasts at most 7
days."* — with a link to change it. Choosing `bucket` without a usable bucket is reported as *not
ready* and blocks creating a share, rather than quietly falling back to the doorman: a share that
went out by a different route than the owner chose would be worse than one that refuses.

The delivery is therefore resolved on the server and is **not** part of the create-share request.

### Sharing stays free

Decided 2026-09-08 and unchanged by any of the above. Harbor is AGPL-3.0 and public, so a gated
feature invites a fork with the check removed; and the governing rule is **sell only what you
control the uptime of**. Both sinks specified here run on things the customer owns — their box,
their bucket — so charging for either means taking money for failures that are theirs to fix.
If anything is ever sold it is sink A, the relay on the operator's own infrastructure, bundled
with household access and a real domain — not sharing alone.

## Open questions

None. (Resolved 2026-09-14: one sealed zip; the doorman on its own tailnet node at 443; the
basket holds individual documents only — items are not a shareable unit.)
