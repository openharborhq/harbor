# Deploying harbor on your own box

This is the milestone-1 runbook: from a blank appliance to *"a scanned PDF goes in, a word
from inside it comes out of search, and the bytes on disk are ciphertext."* It is written for a
Protectli-class fanless x86 box, but any Linux machine with Docker and ~100 GB free will do.

Time: about an hour, most of it waiting for installs. You will need a printer at the end.

> **Do not run this on the machine that is also your firewall/router.** The vault gets its own
> box (spec §3.7).

## 0. What you are building

```
laptop / phone  ──tailnet──▶  [appliance]  web :3000 ──▶ api :4000 ──▶ postgres / redis
                                             │                              ▲
                                             └──────── worker (OCR, no internet) ┘
                              /data (LUKS)  ← blobs, postgres, redis, secrets
```

Nothing listens on the internet. Email-in runs as the `mailfetch` container (spec §7); backups as
the `backup` container (spec §3.4) — a nightly encrypted snapshot to wherever you point it, and a
monthly automated restore test.

## 1. Operating system

Install **Debian 12 (bookworm)**, minimal, with SSH. During partitioning leave **at least 100 GB
unallocated** for the data volume (or use a second disk). Everything below runs as root.

```sh
apt update && apt install -y cryptsetup ca-certificates curl gnupg util-linux
```

## 2. The encrypted data volume

The whole data directory — blobs, Postgres, Redis, secrets — lives on one LUKS volume that is
unlocked by a passphrase at boot. Replace `/dev/nvme0n1p3` with your free partition or disk.

```sh
cryptsetup luksFormat --type luks2 /dev/nvme0n1p3     # choose a long passphrase; it goes in the envelope
cryptsetup open /dev/nvme0n1p3 harbordata
mkfs.ext4 -L harbordata /dev/mapper/harbordata
mkdir -p /data
echo 'harbordata /dev/nvme0n1p3 none luks' >> /etc/crypttab
echo '/dev/mapper/harbordata /data ext4 defaults 0 2' >> /etc/fstab
mount /data
```

Reboot once now to confirm the machine asks for the passphrase and comes up with `/data`
mounted. **A power cut means the vault is down until someone types the passphrase** — a small
UPS is strongly recommended. (TPM auto-unlock is possible; it trades stolen-box protection for
hands-off reboots and is deliberately not the default.)

## 3. Docker and Tailscale

```sh
curl -fsSL https://get.docker.com | sh
```

Tailscale runs as one of the containers, so there is nothing to install on the host. In the
Tailscale admin console, create an auth key (Settings → Keys → Generate auth key) and turn on
**HTTPS Certificates** under DNS — `serve` needs it to have a certificate to present.

If you would rather run Tailscale on the host and skip the overlay, `curl -fsSL
https://tailscale.com/install.sh | sh && tailscale up` still works; note the address from
`tailscale ip -4` and set `HARBOR_BIND` to it in step 5.

## 4. The short way from here

Steps 5 and 6 are what `install.sh` does. If you want it to:

```sh
curl -fsSLO https://raw.githubusercontent.com/openharborhq/harbor/main/install.sh
less install.sh
sudo env HARBOR_DATA_DIR=/data TS_AUTHKEY=tskey-auth-… sh install.sh
```

Then skip to step 7. What follows is the same thing by hand, for when you want to see every part.

## 4b. Get the images

Either pull the published multi-arch images (once a release exists):

```sh
mkdir -p /opt/harbor && cd /opt/harbor
curl -fsSLO https://raw.githubusercontent.com/openharborhq/harbor/main/infra/compose.yml
curl -fsSLO https://raw.githubusercontent.com/openharborhq/harbor/main/infra/compose.prod.yml
curl -fsSLO https://raw.githubusercontent.com/openharborhq/harbor/main/infra/check-data-volume.sh
```

…or build them on the box from source (slower, no registry needed):

```sh
apt install -y git
git clone https://github.com/openharborhq/harbor /opt/harbor/src
cd /opt/harbor/src
docker compose -f infra/compose.yml build          # ~10 minutes on an N100
```

## 5. Configure

```sh
cat > /data/harbor.env <<'EOF'
HARBOR_DATA_DIR=/data
TS_AUTHKEY=tskey-auth-…                 # from step 3
TAILSCALE_HOSTNAME=harbor               # the name it takes in your tailnet
WEB_ORIGIN=https://harbor.your-tailnet.ts.net
SESSION_COOKIE_SECURE=true
OCR_CONCURRENCY=2                       # cores - 1 on a 4-core box
OCR_LANGUAGES=deu+eng
EOF
chmod 600 /data/harbor.env

HARBOR_DATA_DIR=/data sh check-data-volume.sh   # must print "ok"; it refuses to continue if /data is not on LUKS
```

The check script also creates the directories and both secrets: `/data/secrets/kek`, the master
key that decrypts every document, and `/data/secrets/restic-password`, which encrypts every
backup before it leaves the box. Each is the only copy. They go on the printed break-glass page
(step 8) and nowhere else.

**Where backups go.** Add to `/data/harbor.env` one of:

```sh
# Backblaze B2 (recommended offsite). Make an application key restricted to this bucket.
RESTIC_REPOSITORY=b2:your-bucket-name:/harbor
B2_ACCOUNT_ID=…
B2_ACCOUNT_KEY=…

# …or any SFTP host you already have (a NAS, a relative's box)
RESTIC_REPOSITORY=sftp:backup@nas.local:/srv/harbor

# …or a second disk in this machine — the no-cloud option. A backup on the *same* disk is not one.
# (mkdir it and `chown 1000:1000` it: the backup container writes as that uid.)
HARBOR_BACKUP_DIR=/mnt/backupdisk/harbor
RESTIC_REPOSITORY=/backup

TZ=Europe/Berlin        # BACKUP_HOUR (default 3) is read in this zone
```

Leave `RESTIC_REPOSITORY` unset and the vault runs but Settings → Backups says *Not configured*
and every night records a failed run — on purpose.

**Ransomware on the box must not be able to delete history.** With B2, give restic a key
*without* the `deleteFiles` capability and set `BACKUP_PRUNE=false`; snapshots then accumulate
until you prune from a laptop that holds a full key (`restic forget --keep-daily 30
--keep-monthly 12 --prune`). Anyone who takes over the appliance can add snapshots but never
remove one.

## 6. Start

```sh
curl -fsSLO https://raw.githubusercontent.com/openharborhq/harbor/main/infra/compose.tailscale.yml
curl -fsSLO https://raw.githubusercontent.com/openharborhq/harbor/main/infra/tailscale-serve.json
docker compose --env-file /data/harbor.env \
  -f compose.yml -f compose.prod.yml -f compose.tailscale.yml up -d
docker compose --env-file /data/harbor.env -f compose.yml -f compose.prod.yml logs -f api
```

Wait for `API listening on :4000` (migrations run first). The vault is now at
`https://harbor.your-tailnet.ts.net` from any device on your tailnet — and **nothing at all
listens on this machine's own interfaces**, so there is no LAN address, no localhost port and no
bind setting to get wrong. `docker compose … exec tailscale tailscale status` shows the node.

Without the third file the vault publishes a port instead, on `HARBOR_BIND` (default `127.0.0.1`,
i.e. that machine only). That is the path to take if Tailscale runs on the host.

## 7. Create the first owner

Open `https://harbor.your-tailnet.ts.net`. A vault with no owner shows **Set up your vault** instead of
the sign-in page: your name, email and a password of at least 12 characters. The next screen
shows the authenticator key (add it to your app) and ten recovery codes, **once**. Print the
codes now. There is no password reset by email — on purpose — and the page never appears again;
everyone else joins through an invitation from Settings.

The same thing from a console, if you prefer:

```sh
docker compose --env-file /data/harbor.env -f compose.yml -f compose.prod.yml \
  run --rm -e HARBOR_SETUP_PASSWORD='choose-a-long-password' api node dist/setup.js \
  --email you@example.com --name "Your name"
```

## 8. The break-glass envelope

On one sheet of paper, by hand or printed:

1. The LUKS passphrase (step 2)
2. The master key: `cat /data/secrets/kek`
3. The backup password: `cat /data/secrets/restic-password`
4. Where the backups are: the `RESTIC_REPOSITORY` line and its credentials (the B2 key, the
   SFTP login, or which disk)
5. This page's URL and `docs/restore.md`

Put it in a safe, or with a relative. Without it a dead disk means the documents are gone;
that is the point of running this yourself. Reprint it whenever any of these change.

## 9. Prove it

1. Sign in at `https://harbor.your-tailnet.ts.net` with password and the 6-digit code.
2. Open **Add documents**, drop a scanned bill (a photo of one is fine).
3. Watch the row go *Reading page N of M* → *Done*; open **Inbox**.
4. Search for a word that appears only inside the scan. It should come back highlighted.
5. On the box: `head -c 5 /data/blobs/*/* | xxd | head -1` — it must not begin with `%PDF`.

Record how long OCR took per page in the Inbox card; that number is the box's budget for
everything in the next milestones.

6. Settings → Backups → **Back up now**, then **Test a restore**. Both must show *OK* before you
   trust the box with anything. The nightly run starts at `BACKUP_HOUR`; the restore test repeats
   itself on the first of every month.

## Day-two

- **Logs:** `docker compose … logs -f worker` shows every OCR job with engine, pages and time.
- **Suggestions after an update:** a release can change what the model is asked. The suggester
  says at boot how many documents still answer the older prompt;
  `docker compose … exec suggester node dist/suggester.js rerun --dry-run` counts them and
  `… rerun --limit 50` re-reads that many. It is never automatic — with a hosted provider it
  spends per document.
- **Backups:** Settings → Backups shows every run. `docker compose … logs -f backup` for the
  detail. A backup on demand: `docker compose … exec backup node dist/backup.js run backup`.
- **Update:** back up first, then `docker compose … pull && docker compose … up -d` (migrations
  apply on start):
  ```sh
  docker compose … exec backup node dist/backup.js run backup && docker compose … pull && docker compose … up -d
  ```
- **Reboot:** type the LUKS passphrase at the console or via SSH-in-initramfs; containers
  restart on their own.
- **The tailnet node:** `docker compose … exec tailscale tailscale status`. The auth key is
  needed only on first start; the identity lives in `/data/tailscale` and is in the backups.

## Restore

See [`docs/restore.md`](restore.md): from the envelope and the repository to a signed-in vault on
new hardware, and the shorter path when only the database is lost.
