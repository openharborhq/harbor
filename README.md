# Harbor

A self-hosted family document vault. Bulk-upload or email in your paperwork; it's OCR'd,
searchable by every word inside, organised by category, family member and tag, encrypted at
rest and backed up offsite with a tested restore path. Runs on a small Linux box at home,
reachable only over your tailnet.

**Status:** working v1 — upload, OCR, search, suggestions, items, categories, email-in with
sender triage, nightly encrypted backups with a monthly automated restore test, a browser-based
first run, and tailnet-only networking. The design is in [`docs/spec`](docs/spec/00-overview.md).

## Install

On a Linux machine with Docker:

```sh
curl -fsSLO https://raw.githubusercontent.com/openharborhq/harbor/main/install.sh
less install.sh          # please read it before running it as root
sudo sh install.sh
```

It asks three questions — where the documents should live, how you want to reach it, and where
backups should go — and does everything else: compose files, secrets, configuration, images, and
starting the eight containers. Then open the address it prints. **The vault is empty and asks you
to create the first owner**, and shows an authenticator key and ten recovery codes once. There are
no default credentials. Everyone else joins by invitation from Settings.

Afterwards there is a `harbor` command for the things you actually do:

```sh
harbor status          # what is running
harbor logs worker     # follow one service
harbor break-glass     # the keys to print and keep
harbor backup          # back up now
harbor restore-test    # prove the backup can be read back
harbor upgrade         # back up, pull the current images, restart
```

Answer any of the questions up front and it stays silent, which is what makes it scriptable:

| | |
|---|---|
| `HARBOR_DATA_DIR` | where documents, database and secrets live. Default `/data` |
| `TS_AUTHKEY` | a Tailscale auth key. With it, the vault is reachable **only** on your tailnet, over HTTPS, and nothing listens on the machine's own interfaces |
| `HARBOR_BIND`, `HARBOR_WEB_PORT` | without Tailscale, where to publish. Default `127.0.0.1:3000` |
| `RESTIC_REPOSITORY` | where nightly backups go — a Backblaze B2 bucket, an SFTP host, or a second disk |

So an unattended appliance install is:

```sh
sudo env HARBOR_DATA_DIR=/data TS_AUTHKEY=tskey-auth-… RESTIC_REPOSITORY=b2:my-bucket:/harbor sh install.sh
```

### What the installer cannot do for you

Three things decide whether this is actually safe, and all three are yours:

1. **Put `HARBOR_DATA_DIR` on an encrypted volume** before you run it. Postgres holds the text of
   every document in the clear, so a stolen disk is otherwise a readable copy of your paperwork.
   [`docs/deploy.md`](docs/deploy.md) step 2 is the LUKS recipe; the installer warns but cannot
   do it afterwards.
2. **Print the break-glass page** — the master key and backup password it generates, and where
   your backups are. Without it a dead disk means the documents are gone. That is the design.
3. **Give backups somewhere to go** and check the monthly restore test passes. Settings → Backups
   shows every run; [`docs/restore.md`](docs/restore.md) is the way back.

The long form, from a blank Debian machine through the encrypted volume to the printed envelope,
is [`docs/deploy.md`](docs/deploy.md).

### Releases and upgrading

Installs pin to a release tag, not to `latest`, so the box only moves when you decide it should.
[`CHANGELOG.md`](CHANGELOG.md) says what changed; Settings and `harbor version` say what you are
running.

```sh
harbor config     # change HARBOR_IMAGE_TAG to the release you want
harbor upgrade    # backs up, pulls, restarts — and refuses if the backup fails
```

Rolling back means restoring the backup that `harbor upgrade` took immediately before, because
migrations only run forward. [`docs/restore.md`](docs/restore.md) is that procedure.

Images are published for amd64 and arm64 at `ghcr.io/openharborhq/harbor-{api,web,worker,backup}`,
tagged on release and following `main` as `latest`, built after the tests pass. To build them
yourself: clone this repository and `docker compose -f infra/compose.yml build`.

## Try it on a laptop

Same images, no LUKS, no tailnet — for looking, not for keeping documents in:

```sh
git clone https://github.com/openharborhq/harbor && cd harbor
docker compose --env-file .env.example -f infra/compose.yml build
scripts/fresh-test.sh --keep            # empty vault at http://127.0.0.1:3002, first-run flow verified
scripts/fresh-test.sh down
```

To fill it with something to look at, once an owner exists:

```sh
docker compose -p harbor-fresh --env-file data/fresh-test/stack.env \
  -f infra/compose.yml -f infra/compose.prod.yml exec api node dist/seed.js
```

That seeds an invented household — the Musters, their flat, car, dog and nine documents, some
filed and some waiting in the Inbox. Nobody's real paperwork is in this repository.

## What runs

| Container | Does | Network |
|---|---|---|
| `tailscale` | serves the app on your tailnet over HTTPS | the only thing reachable, and only from your tailnet |
| `web` | the app (Next.js) | no host port of its own |
| `api` | HTTP API, migrations, sessions | internal + out (autodiscover) |
| `worker` | OCR, thumbnails, text extraction — the only process that opens documents | **no route out** |
| `suggester` | titles, categories and dates from the text, via the LLM you choose or none | out to that provider only |
| `mailfetch` | reads connected mailboxes over IMAP; the only process that unseals mail passwords | out to IMAP hosts only |
| `backup` | nightly `pg_dump` + restic snapshot, monthly restore test | out to the repository only |
| `postgres`, `redis` | state and queues, on the encrypted volume | internal |

Blobs are AES-256-GCM under per-file keys wrapped by a master key that lives only on the
encrypted volume and in your envelope. Postgres holds the OCR text in plaintext, which is why
the whole data directory must sit on LUKS and the check script refuses otherwise.

## Development

```sh
pnpm install
cp .env.example .env
pnpm infra:up                 # postgres + redis in Docker
pnpm dev:all                  # every process: api, web, worker, suggester, mailfetch, backup
pnpm seed:demo                # optional: an invented household to look at
pnpm lint && pnpm typecheck && pnpm test
```

`scripts/stack-test.sh up` runs the full production stack from images against a copy of your
dev data — including a real backup and restore test — on `http://127.0.0.1:3001`.

## License

AGPL-3.0. See [`LICENSE`](LICENSE).
