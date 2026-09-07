# 7. Email connections

**Principle:** the vault is a mail client, not a third party. That single fact is what lets a
self-hosted build match a SaaS inbox integration without an OAuth app, a hosted redirect URL,
or anything hardcoded in the repo.

Trustworthy.com needs OAuth because *their* servers touch *your* mailbox — delegated access
issued to a URL they own. Self-hosting inverts the relationship. Your box reads your mail the
way Thunderbird does: IMAP, over TLS, with a credential you issued it. **IMAP is the primitive,
not the fallback, and v1 contains no OAuth code path at all.**

## 7.1 Two models, deliberately separate

| | **Forwarding mailbox** (§2) | **Connected inbox** (this section) |
|---|---|---|
| Setup | A dedicated `vault@…` address; you forward mail to it | Point the vault at a mailbox you already use |
| Vault sees | Only what you sent it | One folder, or envelopes across the mailbox |
| Credential | App password on a throwaway mailbox | App password on your real mailbox |
| Effort per document | You forward each one | None, once sender rules are learned |

Both ship. The forwarding mailbox stays the zero-credential option, the phone-scan path, and
the answer for providers a connected inbox cannot reach. Neither replaces the other, and the
choice is per connection, not global.

## 7.2 Transport — IMAP only

`MailSource` is an adapter interface. IMAP is the only v1 implementation; JMAP (Fastmail —
push, no polling) is a later adapter behind the same interface, not a rewrite.

Authentication is an app password, everywhere, as of 2026-09:

| Provider | Status |
|---|---|
| Gmail / Workspace | App password — requires 2-Step Verification enabled first |
| iCloud, Fastmail, Yahoo, Zoho, Posteo, mailbox.org | App password |
| Proton | App password against Proton Bridge on the LAN |
| Self-hosted / mailcow | Plain IMAP credential |
| **Outlook.com / Microsoft 365** | **Not supported.** Use the forwarding mailbox (§2). |

**Microsoft is out of scope for v1, deliberately.** Basic auth for IMAP is retired there, so it
is the only provider that would force an OAuth path into the build — a device-code adapter, a
client ID shipped in the repo, a token refresh loop, and an egress hole — to serve one
provider. Outlook users forward to the vault mailbox instead, which costs them a rule and
costs the project nothing. Revisit if enough people ask; the `MailSource` interface is where
it would land.

TLS is verified; a custom CA may be supplied for self-hosted servers. Plaintext IMAP is
refused, with no override.

## 7.3 Setup: ask for an email address, nothing more

1. **Autodiscover.** Query Mozilla's ISPDB (`autoconfig.thunderbird.net/v1.1/<domain>`), then
   the `_imaps._tcp` SRV record, then the provider table. Host, port and TLS mode are filled
   in. Manual entry exists but is the exception, not the form.
2. **Deep-link the credential.** Each known provider gets a direct link to its app-password
   page and one line on where it hides.
3. **Test, and explain failures in human terms.** "Gmail rejected that password — app
   passwords only exist once 2-Step Verification is switched on" beats `AUTHENTICATIONFAILED`.
4. **Offer the Gmail filter file.** Gmail supports filter import (Settings → Filters and
   Blocked Addresses → Import filters). The vault serves a generated XML that creates a
   `Vault` label matching bilingually — `Rechnung`, `Beleg`, `Quittung`, `Zahlungsbestätigung`,
   `invoice`, `receipt`, `statement` — plus `has:attachment`. One click on their side, and the
   connection can run in `folder` mode below.

## 7.4 Scope: one broad read, then a narrow one

The twelve-month backfill is what makes setup worth doing, and it *is* a full-mailbox read.
Rather than blur that, it is a **separate, explicit, one-time operation** — you trigger it, you
watch it run, it ends. Steady-state watching is narrower and never widens on its own.

| Phase | What the vault opens | When |
|---|---|---|
| **Backfill** | Every folder, envelopes and `BODYSTRUCTURE`; bodies only for candidates | Once, on connect, by explicit action; `BACKFILL_MONTHS` back |
| **`folder` mode** (default) | Only the named folder(s) — nothing else is ever read | Ongoing |
| **`senders` mode** | Envelopes across the mailbox; a body is fetched only for an approved sender | Ongoing |

`folder` mode is the default and what the imported filter sets up: the vault holds a broad
credential but makes narrow use of it. `senders` mode needs no filter and is broader — it reads
who is writing to you, continuously, forever. Both are offered; the difference is stated at the
point of choice, not in a footnote. Re-running the backfill is always explicit.

## 7.5 Detection: three tiers, and the model is not one of them

Fetch `ENVELOPE` + `BODYSTRUCTURE` first, always. That is headers and a parts manifest —
enough to know "a 240 KB PDF named Rechnung_9912.pdf from stadtwerke@…" without downloading a
single body. A body is fetched only once a message scores, and only the parts that matter.

| Tier | Test | Cost |
|---|---|---|
| 0 | Has a PDF or image part, or the sender is already known | Free, from `BODYSTRUCTURE` |
| 1 | Bilingual subject and filename heuristics | Free |
| 2 | Sender rules learned from what you have filed (§7.6) | One indexed lookup |

**No tier sends unfiled mail to an LLM.** A classification tier was designed and cut: §5's
exception covers text from documents you have chosen to keep, and subject lines and sender
addresses from a personal inbox are a wider grant of a different kind. Detection happens
entirely on the box. The suggestion pass runs afterwards, on an ingested document, exactly as
it does for an upload — the model cannot tell how the document arrived beyond the sender line
§5 already sends.

This costs some recall. Invoices with no attachment and no vendor history will be missed until
you file one by hand and the sender rule exists. That is the trade accepted. Revisiting it
means an opt-in setting that is off by default, not a change to this default.

**IDLE, not polling.** One long-lived connection per mailbox gives near-instant arrival and
less work on a fanless box than waking every few minutes. A periodic full resync runs on top
for correctness, and a dropped IDLE degrades to polling rather than to silence. *(This
supersedes §2's "poll every few minutes".)*

**Idempotency.** `(connection_id, message_id)` is unique; attachments are additionally matched
on sha256 against `document_files`, reusing §2's duplicate prompt. A changed `UIDVALIDITY`
triggers a resync keyed on Message-ID — never a re-ingest.

**Caps.** 25 MB per attachment, 10 attachments per message, 200 messages per sync pass.
Anything over a cap is **held**, never dropped — the mail is still in your mailbox and the
held item says which cap it hit.

## 7.6 Onboarding: the backfill dry-run

The backfill scans a bounded window **read-only** — `BACKFILL_MONTHS` in `packages/shared`,
currently **2 months** — and presents the result grouped by *sender*, not
by message: "142 candidates from 23 senders." The user approves senders in bulk.

Sixty seconds after connecting, they have seen the value *and* built the allowed-senders list
§2 already wanted. Each approval becomes a standing rule — "Stadtwerke → Utilities ›
Electricity › for Musterstraße 7" — so later mail from that sender files itself correctly and
silently. Rules are editable and visible; nothing is learned invisibly.

Unapproved senders are **held**, exactly as in §2. Mail is never dropped and never
auto-ingested from a stranger.

## 7.7 Candidates are private until filed

The vault is shared and has no roles (§0), but that is a statement about *filed documents*.
Mail that has not been filed is not a document yet — it is someone's correspondence.

**Held items and backfill candidates are visible only to `mail_connections.owner_user_id`.**
Once a document is filed it is a normal vault document, shared like everything else. Filing is
the deliberate act of sharing; a candidate is just mail that has not been read yet.

This puts one owner check on the Inbox and the held-mail review screen. It is cheap now and
unpleasant to retrofit after two people have connected mailboxes.

## 7.8 The vault never writes to your mailbox

Default `write_back = none`: no `\Seen`, no flags, no moves. Marking read or labelling is
opt-in per connection.

**§2's "processed mail is deleted after 30 days" applies only to a dedicated forwarding
mailbox.** On a connected inbox it is unavailable — `retention_days` is NULL and the UI offers
no way to set it. Deleting from a mailbox the vault does not own is a data-loss bug wearing a
feature's clothes.

**Held mail is not copied into the vault either.** §2 keeps the raw message in `raw_blob_key`
because there the vault is the only copy. On a connected inbox the message is still sitting in
your mailbox, so the vault stores the envelope and fetches the body on demand when you open the
held item. Arbitrary private correspondence does not accumulate in the vault, and it does not
land in the backups.

## 7.9 Body-only invoices

Many invoices have no attachment: the invoice is the HTML body. Those are rendered to PDF with
**WeasyPrint** and ingested like any other document — ~50 MB, no browser engine, and a CSS
print renderer handles invoice tables well enough. §2 rejected LibreOffice at ~500 MB for a
rare case; this case is not rare, and this candidate is a tenth of the size. Rendering happens
in the isolated worker, on untrusted input, with remote resource loading disabled.

`Your invoice is ready — log in to view` is the other half of the problem, and there is no
document in it at all. Creating an empty one is wrong, and the honest output — a reminder to go
fetch it — is a new Inbox card state, a non-document entity, and its own notion of "done".
**Deferred to v1.1.** In v1 those messages classify as ignore and are handled by hand, which is
what happens today.

## 7.10 The trade-off, stated plainly

**An IMAP app password is a broader grant than OAuth would be.** Gmail's app password gives
full mailbox read *and* SMTP send — a compromised vault could send mail as you, which
`gmail.readonly` never could. We choose it for deployment friction, not because it is safer,
and the docs say so in those words.

Mitigations, in order of strength: the forwarding mailbox (the vault holds no credential to
your real inbox at all); a mail-client forwarding rule (same, driven from your side); `folder`
mode via the imported filter (broad credential, narrow use); `senders` mode (no filter needed,
reads envelopes across the mailbox). The settings UI names the trade-off at the point of choice
rather than in a doc nobody opens.

Operationally: the credential is encrypted under the existing KEK, never logged, and never
returned by the API once written. Credentials get revoked and providers rate-limit, so
connection status is first-class — `status`, `last_ok_at`, and a visible banner. **A broken
connection is never a silent one.**

## 7.11 Data model additions

```
mail_connections     id, owner_user_id, label, email_address, kind (forwarding|inbox),
                     provider_hint, imap_host, imap_port, imap_username, secret_enc,
                     scope_mode (folder|senders), folders[],
                     write_back (none|seen|flag), retention_days (NULL unless kind=forwarding),
                     backfill_started_at, backfill_completed_at,
                     status (ok|auth_failed|unreachable|disabled), status_detail,
                     last_ok_at, last_sync_at, uidvalidity jsonb, created_at
mail_senders         id, connection_id, from_addr, decision (file|ignore|hold),
                     default_category_slug, default_item_labels[], default_tags[],
                     learned_from (backfill|manual|accepted_suggestion), updated_at
email_ingest_log     id, connection_id, message_id, imap_uid, folder, tier,
                     from_addr, subject, status (accepted|held|rejected), held_reason,
                     raw_blob_key, document_ids[], received_at, created_at
```

Four things this shape says out loud:

- **`kind` decides what the vault may do**, not a guess from other fields. Only a `forwarding`
  mailbox may set `retention_days`; the API rejects it on an `inbox` rather than ignoring it,
  because someone asking for it has misunderstood what the vault owns (§7.8).
- **`secret_enc` is one column**, sealed under the KEK exactly as `users.totp_secret_enc` is,
  carrying its own key version inline. The four-column DEK layout is for file keys, not secrets.
  There is no `auth_kind`: every connection is an app password, and adding OAuth later is a
  migration we accept rather than pre-build. There is no CA column either — a private CA is a
  property of the host, so it belongs in `NODE_EXTRA_CA_CERTS` on the `mailfetch` container.
- **Sender defaults are slugs and labels, not ids**, resolved against the current vocabulary when
  the rule fires with unknown values dropped — the same contract `suggestions.payload` already
  has. Deleting a category or an item can then never strand a rule pointing at nothing.
- **`(connection_id, message_id)` is unique**: the idempotency key (§7.5). `raw_blob_key` stays
  NULL on a connected inbox (§7.8), and `held_reason` says in words why something is waiting.

`documents.source` stays `upload|email` — which connection a document arrived through is a join,
not a new enum value.

## 7.12 Build order

1. ~~`MailSource` interface + IMAP adapter; secret encrypted under the KEK~~ **done**
2. ~~Autodiscover, connection test~~ **done** — provider picker still needs a UI
3. ~~`folder` mode, the Tier 0–2 cascade, `mailfetch`, generated Gmail filter XML~~ **done**
4. ~~Backfill dry-run, sender rules, owner-scoped held mail~~ **done** — API only, no UI yet
5. ~~Web UI: connect flow, backfill review, held mail, connection health~~ **done** (§4)
6. `senders` mode (the fetcher supports it; nothing sets it yet)
7. IDLE, replacing the interval sweep
8. WeasyPrint body rendering
9. JMAP adapter, behind the same interface

Steps 1–5 are the feature. Everything after is coverage.

**The API never opens a mailbox.** Every operation that needs an IMAP connection — test, sync,
backfill, applying a new rule to its backlog — is a job on the `mail-ops` queue, run by
`mailfetch`. That is what §3.6 asks for, and it has a second consequence worth stating: a
connection is created **sealed first and tested afterwards**, so a plaintext app password is
never written to Redis on its way anywhere. `mailfetch` is the only process that unseals one.

A test therefore has no synchronous answer, and deliberately no result type of its own: the
answer is the connection's `status`, `statusDetail` and `discoveredFolders`. One place to look
for connection health rather than two that can disagree (§7.10).

**Still ahead of the build:** §7.5 specifies IDLE; this is an interval sweep
(`MAIL_SYNC_INTERVAL_SECONDS`, default 300). The sync logic is exactly what IDLE would trigger,
so it is a driver swap rather than a rewrite — but until it lands, arrival is not immediate.

## Resolved

Decided 2026-09-07, all previously open: no LLM detection tier (§7.5) · full-mailbox backfill
then narrow watching (§7.4) · candidates private to the connection owner (§7.7) · envelope-only
held mail (§7.8) · Microsoft out of scope (§7.2) · WeasyPrint (§7.9) · fetch reminders in v1.1
(§7.9) · caps at 25 MB / 10 / 200 (§7.5).
