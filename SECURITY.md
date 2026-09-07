# Security

Harbor holds a household's most sensitive paperwork — passports, contracts, medical letters,
bank statements — on a machine the household owns. This page says what it defends against, what
it does not, and how to report a problem.

The design detail behind all of it is [`docs/spec/03-security-hosting.md`](docs/spec/03-security-hosting.md).

## Reporting a vulnerability

Open a **private** security advisory:
https://github.com/openharborhq/harbor/security/advisories/new

Please do not open a public issue for anything exploitable. There is no bounty. Expect a first
reply within a week; a fix lands on `main` and in the published images, with the advisory
published once operators have had a chance to update.

Include what you would want in return: the version or commit, the setup, and the smallest
reproduction you can manage.

## What it defends against

| Adversary | What they get | Why it does not help them |
|---|---|---|
| Burglar takes the box | A powered-off appliance | The data volume is LUKS; the passphrase is never stored on it |
| Backup provider is breached | Snapshots | restic encrypts client-side; the key never leaves the house |
| Attacker on the internet | Nothing to connect to | With `compose.tailscale.yml` no container publishes a host port; the only ingress is your tailnet |
| A malicious PDF arrives by email | Code execution inside the OCR worker | That container has no route out, a read-only filesystem, no capabilities and is not root |
| Someone reads a database dump | Mail passwords among the rows | Sealed under the master key, which lives only on the encrypted volume |
| A family laptop is stolen | A session | Second factor required to sign in; sessions are revocable from Settings |
| The authenticator is lost | Nothing | Printed recovery codes; there is deliberately no email reset to phish |
| Disaster | A dead box and a backup | One printed page gets you from bare Linux to a restored vault |

## What it does not defend against

Stated plainly, because a security page that claims everything is worth nothing:

- **A compromised running server.** While Harbor is running it holds plaintext by design: the
  OCR text is in Postgres so it can be searched, and the master key is readable by the processes
  that need it. Anyone with root on a running appliance has the documents.
- **A malicious owner.** Every owner sees everything. There are no restricted roles, and the
  audit log records what happened rather than preventing it.
- **The LLM provider**, when you choose a hosted one. It receives the document text. Choosing
  `none`, or pointing `openai-compatible` at a model on your own network, is how you avoid that.
- **A compromised Tailscale account**, which is a route onto your tailnet.
- **Traffic analysis.** Sizes and timings of outbound backups and API calls are visible.

There is no end-to-end encryption. Server-side OCR and search need the plaintext.

**A connected mailbox widens the first two.** A live compromise reaches not only the filed
documents but the mailbox behind them, and an app password from a large provider usually carries
the ability to send mail as well as read it. That is a real cost of the convenience, not
something Harbor defends against. The narrower options are a folder-scoped connection or a
dedicated forwarding address the vault holds no credential to.

## How the pieces are separated

Each container gets only the reach its job needs, which is what makes the OCR row above true:

| Container | Opens documents | Route to the internet |
|---|---|---|
| `worker` (OCR) | yes — the only one | **none** |
| `mailfetch` | no | IMAP hosts only; the only process that unseals a mail password |
| `suggester` | no, reads extracted text | the LLM provider you configured |
| `backup` | reads blob ciphertext | the backup repository |
| `api` | serves them to you | outbound lookups only |
| `web` | no | no host port of its own with the tailnet overlay |
| `tailscale` | no | the tailnet; the only way in |
| `postgres`, `redis` | — | none |

Keys are layered: a LUKS passphrase protects the powered-off disk; a master key on that volume
wraps a separate key for every file; each file's key is stored next to its ciphertext in the
database. Rotating the master key rewraps the per-file keys and never rewrites a blob.

## What is expected of the operator

Harbor cannot enforce these, and without them the table above is optimistic:

1. **Put the data directory on an encrypted volume.** `infra/check-data-volume.sh` refuses to
   start otherwise unless you explicitly override it.
2. **Do not co-host it on your router or firewall.**
3. **Use `infra/compose.tailscale.yml`,** or otherwise make sure the web port is not on an
   interface strangers can reach. Without it the port is published on `HARBOR_BIND`.
4. **Print the break-glass page** — master key, backup password, where the backups are — and
   keep it somewhere physical. There is no other copy, and no way for anyone to reset it for you.
5. **Configure backups and check that the monthly restore test passes.** Settings → Backups shows
   every run. An untested backup is a hope.
6. **Keep the box updated.** Images are rebuilt on every change to `main`.

## Cryptography, briefly

AES-256-GCM for documents, under a per-file key wrapped by the master key. Argon2id for
passwords. TOTP for the second factor, its secret sealed under the master key. Session tokens
are random and stored hashed. restic handles backup encryption. Nothing here is home-grown; if
you find something that is, that is a bug worth reporting.

## Scope

In scope: this repository, the published images, and the deployment it documents.

Out of scope: findings that require an already-compromised appliance or owner account; anything
about the explicit non-goals above; missing hardening on a deployment that ignores the operator
expectations; automated scanner output without a demonstrated impact.
