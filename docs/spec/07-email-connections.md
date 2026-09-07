# 7. Email connections

**Principle:** the vault is a mail client, not a third party. That single fact is what lets a
self-hosted build match a SaaS inbox integration without an OAuth app, a hosted redirect URL,
or anything hardcoded in the repo.

Trustworthy.com needs OAuth because *their* servers touch *your* mailbox — delegated access
issued to a URL they own. Self-hosting inverts the relationship. Your box reads your mail the
way Thunderbird does: IMAP, over TLS, with a credential you issued it. **IMAP is the primitive,
not the fallback.**

## 7.1 Two models, deliberately separate

| | **Forwarding mailbox** (§2) | **Connected inbox** (this section) |
|---|---|---|
| Setup | A dedicated `vault@…` address; you forward mail to it | Point the vault at a mailbox you already use |
| Vault sees | Only what you sent it | A folder, or the whole mailbox |
| Credential | App password on a throwaway mailbox | App password on your real mailbox |
| Effort per document | You forward each one | None, once rules are learned |

Both ship. The forwarding mailbox stays the zero-trust option and the phone-scan path; the
connected inbox is the one that makes invoices file themselves. Neither replaces the other,
and the choice is per connection, not global.

## 7.2 Transport

`MailSource` is an adapter interface. IMAP is the only v1 implementation; JMAP (Fastmail —
push, no polling) is a later adapter behind the same interface, not a rewrite.

Authentication, as of 2026-09:

| Provider | Mechanism |
|---|---|
| Gmail / Workspace | App password (requires 2-Step Verification enabled first) |
| iCloud, Fastmail, Yahoo, Zoho, Posteo, mailbox.org | App password |
| Proton | App password against Proton Bridge on the LAN |
| Self-hosted / mailcow | Plain IMAP credential |
| **Outlook.com / Microsoft 365** | **OAuth only** — basic auth for IMAP is retired |

Microsoft is the only hole, and it has a clean answer: the **OAuth device code flow**. It has
no redirect URI, so there is nothing to hardcode and nothing to host. The vault shows a code,
the user opens `microsoft.com/devicelogin` on any device, and a refresh token comes back. The
client ID for a public client is not a secret — Thunderbird ships theirs in the open — so one
lives in the repo with a `MAIL_MS_CLIENT_ID` override for anyone who prefers to register their
own. Some managed tenants block device code via conditional access; those users fall back to
the forwarding mailbox.

Google is reachable the same way in principle but does not permit Gmail scopes in its device
flow, so there is no OAuth path for Gmail that avoids a redirect URL. There does not need to
be: the app password works. For the rare user who insists, bring-your-own client ID/secret is
documented, and the settings screen *displays* the redirect URI to paste into Google's console
rather than assuming one. **No URL is ever baked into the image.**

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
   connection can then be **folder-scoped**: the vault opens `Vault/` and never the inbox.

TLS is verified; a custom CA may be supplied for self-hosted servers. Plaintext IMAP is
refused, with no override.

## 7.4 Scanning without reading the mailbox

Fetch `ENVELOPE` + `BODYSTRUCTURE` only. That is headers and a parts manifest — enough to know
"a 240 KB PDF named Rechnung_9912.pdf from stadtwerke@…" without downloading one body. A body
is fetched only once a message scores as a candidate, and only the parts that matter.

The cascade is cheapest-first, so the expensive stage sees almost nothing:

| Tier | Test | Cost |
|---|---|---|
| 0 | Has a PDF or image part, or the sender is already known | Free, from BODYSTRUCTURE |
| 1 | Bilingual subject/filename heuristics | Free |
| 2 | Sender rules learned from what you have filed (§7.5) | One indexed lookup |
| 3 | LLM classification of the extracted text | §5 provider call |

Only Tier-3 survivors reach the model, which keeps §5's knowing cloud exception exactly as
small as it already was. Everything below Tier 3 is decided on the box.

**IDLE, not polling.** One long-lived connection per mailbox gives near-instant arrival and
less work on a fanless box than waking every few minutes. A periodic full resync runs on top
for correctness, and a dropped IDLE degrades to polling rather than to silence. *(This
supersedes §2's "poll every few minutes".)*

**Idempotency.** `(connection_id, message_id)` is unique; attachments are additionally matched
on sha256 against `document_files`, reusing §2's duplicate prompt. A changed `UIDVALIDITY`
triggers a resync keyed on Message-ID — never a re-ingest.

## 7.5 Onboarding: the backfill dry-run

On first connect, scan twelve months **read-only** and present the result grouped by *sender*,
not by message: "142 candidates from 23 senders." The user approves senders in bulk.

Sixty seconds after connecting, they have seen the value *and* built the allowed-senders list
§2 already wanted. Each approval becomes a standing rule — "Stadtwerke → Utilities ›
Electricity › for Musterstraße 7" — so later mail from that sender files itself correctly and
silently. Rules are editable and visible; nothing is learned invisibly.

Unapproved senders are **held**, exactly as in §2. Mail is never dropped and never
auto-ingested from a stranger.

## 7.6 The vault never writes to your mailbox

Default `write_back = none`: no `\Seen`, no flags, no moves. Marking read or labelling is
opt-in per connection.

**§2's "processed mail is deleted after 30 days" applies only to a dedicated forwarding
mailbox.** On a connected inbox it is unacceptable and unavailable — `retention_days` is NULL
and the UI offers no way to set it. Deleting from a mailbox the vault does not own is a
data-loss bug wearing a feature's clothes.

## 7.7 Portal notifications

A large share of "invoices" are `Your invoice is ready — log in to view`. There is no document
in the message. Creating an empty one is wrong; the honest output is a **reminder to go fetch
it**, as its own Inbox card state, linked to the sender rule that produced it. HTML-body
invoices with no attachment are the other half of this problem and are rendered to PDF; the
renderer choice is open (§7.9).

## 7.8 The trade-off, stated plainly

**An IMAP app password is a broader grant than OAuth would be.** Gmail's app password gives
full mailbox read *and* SMTP send — a compromised vault could send mail as you, which
`gmail.readonly` never could. We choose it for deployment friction, not because it is safer,
and the docs say so in those words.

Mitigations, in order of strength: the forwarding mailbox (the vault holds no credential to
your real inbox at all); a mail-client forwarding rule (same, driven from your side);
folder-scoped access via the imported filter (broad credential, narrow use); full-mailbox
scanning (most convenient, broadest). The settings UI names the trade-off at the point of
choice rather than in a doc nobody opens.

Operationally: the credential is encrypted under the existing KEK, never logged, and never
returned by the API once written. Credentials get revoked and providers rate-limit, so
connection status is first-class — `status`, `last_ok_at`, and a visible banner. **A broken
connection is never a silent one.**

## 7.9 Data model additions

```
mail_connections     id, owner_user_id, label, email_address,
                     auth_kind (app_password|oauth_device), provider_hint,
                     imap_host, imap_port, imap_username,
                     secret_enc, iv, auth_tag, key_version,   -- password or refresh token
                     scope_mode (folder|full_mailbox), folders[],
                     write_back (none|seen|flag), retention_days (NULL on connected inboxes),
                     status (ok|auth_failed|unreachable|disabled), status_detail,
                     last_ok_at, last_sync_at, uidvalidity jsonb, created_at
mail_senders         id, connection_id, from_addr, decision (file|ignore|hold),
                     default_category_id, default_item_ids[], default_tag_ids[],
                     learned_from (backfill|manual|accepted_suggestion), updated_at
```

`email_ingest_log` gains `connection_id`, `imap_uid` and `tier` (which stage accepted it), and
`(connection_id, message_id)` becomes unique. `documents.source` stays `upload|email` — which
connection it came from is a join, not a new enum value.

## 7.10 Build order

1. `MailSource` interface + IMAP adapter; secret encrypted under the KEK
2. Autodiscover, provider picker, connection test
3. Folder-scoped mode + generated Gmail filter XML
4. Backfill dry-run and sender rules
5. Microsoft device-code adapter
6. Full-mailbox auto-detect with the Tier 0–3 cascade
7. JMAP adapter, behind the same interface

Steps 1–4 are the feature. Everything after is coverage.

## Open questions

- **HTML-body → PDF renderer.** LibreOffice was rejected in §2 at ~500 MB for a rare case;
  body-only invoices are not rare. WeasyPrint is the current candidate. Undecided.
- **Attachment size and count caps** on a connected inbox, where the volume is not self-selected.
- Whether the reminder card of §7.7 is v1 or v1.1.
