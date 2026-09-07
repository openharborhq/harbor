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

Nothing listens on the internet. Email-in is built (spec §7) and runs as the `mailfetch` container; backups come in a later milestone.

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
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up            # authenticate in the browser; the box joins your tailnet
tailscale ip -4         # note this address, e.g. 100.101.102.103
```

## 4. Get the images

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
HARBOR_BIND=100.101.102.103                 # the tailnet IP from step 3
WEB_ORIGIN=http://100.101.102.103:3000  # or your https://box.tailnet.ts.net if you use `tailscale serve`
SESSION_COOKIE_SECURE=false             # true once you are on https via tailscale serve
OCR_CONCURRENCY=2                       # cores - 1 on a 4-core box
OCR_LANGUAGES=deu+eng
EOF
chmod 600 /data/harbor.env

mkdir -p /data/secrets && chmod 700 /data/secrets
openssl rand -base64 32 > /data/secrets/kek && chmod 600 /data/secrets/kek   # the master key

sh check-data-volume.sh   # must print "ok"; it refuses to continue if /data is not on LUKS
```

The master key file is the only copy of the key that decrypts every document. It goes on the
printed break-glass page (step 8) and nowhere else.

## 6. Start

```sh
export $(grep -v '^#' /data/harbor.env | xargs)
docker compose --env-file /data/harbor.env -f compose.yml -f compose.prod.yml up -d
docker compose --env-file /data/harbor.env -f compose.yml -f compose.prod.yml logs -f api
```

Wait for `API listening on :4000` (migrations run first). The web app is now at
`http://<tailnet-ip>:3000` from any device on your tailnet — and from nowhere else.

## 7. Create the first owner

```sh
docker compose --env-file /data/harbor.env -f compose.yml -f compose.prod.yml \
  run --rm -e HARBOR_SETUP_PASSWORD='choose-a-long-password' api node dist/setup.js \
  --email you@example.com --name "Your name"
```

It prints an `otpauth://` URI (scan it in your authenticator app) and ten recovery codes.
**Print the recovery codes now** and clear your terminal (`clear && history -c`). There is no
password reset by email — on purpose.

## 8. The break-glass envelope

On one sheet of paper, by hand or printed:

1. The LUKS passphrase (step 2)
2. The master key: `cat /data/secrets/kek`
3. Where the box and its backups are (backups arrive in milestone 5)
4. This page's URL

Put it in a safe, or with a relative. Without it a dead disk means the documents are gone;
that is the point of running this yourself.

## 9. Prove it

1. Sign in at `http://<tailnet-ip>:3000` with password and the 6-digit code.
2. Open **Add documents**, drop a scanned bill (a photo of one is fine).
3. Watch the row go *Reading page N of M* → *Done*; open **Inbox**.
4. Search for a word that appears only inside the scan. It should come back highlighted.
5. On the box: `head -c 5 /data/blobs/*/* | xxd | head -1` — it must not begin with `%PDF`.

Record how long OCR took per page in the Inbox card; that number is the box's budget for
everything in the next milestones.

## Day-two

- **Logs:** `docker compose … logs -f worker` shows every OCR job with engine, pages and time.
- **Update:** `docker compose … pull && docker compose … up -d` (migrations apply on start).
  Take a backup first once milestone 5 exists.
- **Reboot:** type the LUKS passphrase at the console or via SSH-in-initramfs; containers
  restart on their own.
- **HTTPS on the tailnet:** `tailscale serve --bg 3000`, then set `WEB_ORIGIN` to the
  `https://…ts.net` name and `SESSION_COOKIE_SECURE=true`, and `up -d` again.

## Restore (milestone 5 will make this one command)

Until backups exist, "restore" means: the LUKS passphrase unlocks `/data`; the master key in
`/data/secrets/kek` decrypts the blobs; Postgres in `/data/postgres` holds everything else.
Copy `/data` to a new box, repeat steps 3–6, and you are back.
