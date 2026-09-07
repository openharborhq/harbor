# Harbor

A self-hosted family document vault. Bulk-upload or email in your paperwork; it's OCR'd,
searchable by every word inside, organised by category, family member and tag, encrypted at
rest and backed up offsite with a tested restore path. Runs on a small Linux box at home,
reachable only over your tailnet.

**Status:** working v1 — upload, OCR, search, suggestions, items, categories, email-in with
sender triage, nightly encrypted backups with a monthly automated restore test, a browser-based
first run, and tailnet-only networking. The design is in [`docs/spec`](docs/spec/00-overview.md).

## Install on your own box

The full runbook is [`docs/deploy.md`](docs/deploy.md): Debian, an encrypted data volume,
Docker, Tailscale, then the stack. The short version, on a fresh Debian 12 machine as root:

```sh
mkdir -p /opt/harbor && cd /opt/harbor
for f in compose.yml compose.prod.yml check-data-volume.sh; do
  curl -fsSLO "https://raw.githubusercontent.com/openharborhq/harbor/main/infra/$f"
done
curl -fsSLO https://raw.githubusercontent.com/openharborhq/harbor/main/infra/compose.tailscale.yml
curl -fsSLO https://raw.githubusercontent.com/openharborhq/harbor/main/infra/tailscale-serve.json
cat > /data/harbor.env <<'ENV'
HARBOR_DATA_DIR=/data                    # the LUKS-backed mount (deploy.md, step 2)
TS_AUTHKEY=tskey-auth-…                  # Tailscale admin console → Settings → Keys
TAILSCALE_HOSTNAME=harbor
WEB_ORIGIN=https://harbor.your-tailnet.ts.net
SESSION_COOKIE_SECURE=true
ENV
HARBOR_DATA_DIR=/data sh check-data-volume.sh      # refuses an unencrypted /data; creates the secrets
docker compose --env-file /data/harbor.env \
  -f compose.yml -f compose.prod.yml -f compose.tailscale.yml up -d
```

Then open `https://harbor.your-tailnet.ts.net`. Nothing listens on the machine's own interfaces:
Tailscale runs as one of the containers and serves the app on your tailnet over HTTPS, so there
is no LAN address and no bind setting to get wrong. Drop the third compose file to publish a
local port instead (`HARBOR_BIND`, default loopback). **The vault starts empty and asks you to create the first
owner** — name, email, password — and shows the authenticator key and recovery codes once. There
are no default credentials. Everyone else joins by invitation from Settings.

Before the box holds anything you care about, do step 8 of the runbook: print the break-glass
envelope (master key, backup password, where the backups are) and set `RESTIC_REPOSITORY` so the
nightly backup has somewhere to go. Settings → Backups shows every run and the monthly restore
test; [`docs/restore.md`](docs/restore.md) is the way back from a dead disk.

Images are published for amd64 and arm64 at `ghcr.io/openharborhq/harbor-{api,web,worker,backup}`
on every push to `main`; the compose files pull them. To build them yourself instead:
`git clone` this repository and `docker compose -f infra/compose.yml build`.

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
