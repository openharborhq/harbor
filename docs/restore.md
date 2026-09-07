# Restoring Harbor from a backup

For the day the disk dies, the box is stolen, or you move to new hardware. Nothing here needs
the old machine. Time: about an hour plus the download.

## What you need

From the break-glass envelope (`docs/deploy.md`, step 8):

1. **The master key** — decrypts every document and every sealed secret (TOTP, mail passwords).
   Without it the blobs in the backup are noise.
2. **The backup repository password** — restic's client-side encryption key.
3. **Where the repository is** (`RESTIC_REPOSITORY`) and its credentials (the B2 key, or the SFTP
   login, or which disk).
4. The recovery codes, if your authenticator app is gone too.

The LUKS passphrase from the old box is *not* needed: a new box gets a new volume.

## 1. A box with an empty vault

Follow `docs/deploy.md` steps 1–5 on the new machine: OS, encrypted volume, Docker, Tailscale,
images, `harbor.env`. In step 5, instead of generating new secrets, put the old ones back
exactly:

```sh
mkdir -p /data/secrets && chmod 700 /data/secrets
printf '%s\n' '<master key from the envelope>' > /data/secrets/kek
printf '%s\n' '<repository password from the envelope>' > /data/secrets/restic-password
chmod 600 /data/secrets/kek /data/secrets/restic-password
```

and set `RESTIC_REPOSITORY` and its credentials in `/data/harbor.env` as they were. A key typed
wrong fails loudly in the next step, not silently later.

Do **not** start the stack yet. Aliases for what follows:

```sh
cd /opt/harbor
export $(grep -v '^#' /data/harbor.env | xargs)
alias dc='docker compose --env-file /data/harbor.env -f compose.yml -f compose.prod.yml'
```

## 2. Bring the files back

```sh
dc up -d postgres                       # the backup container needs it to start
dc run --rm backup restic snapshots     # proves the password and the repository; lists what exists
dc run --rm backup restic restore latest --target /
```

`--target /` puts everything back where it was: the documents under `/data/blobs`, the database
dump at `/data/dumps/harbor.dump`. Both paths are mounts inside the container, so nothing else
is written. To restore a particular night instead of the latest, use its id from the list.

## 3. Load the database

```sh
dc run --rm backup pg_restore --no-owner --exit-on-error \
  --dbname=postgres://harbor:harbor@postgres:5432/harbor /data/dumps/harbor.dump
```

This is the same command the monthly restore test runs against a scratch database. The dump
includes the migrations table, so the API will start without running migrations again.

## 4. Start and sign in

```sh
dc up -d
dc logs -f api        # wait for "API listening on :4000"
```

Sign in at the new tailnet address with your password and authenticator — the TOTP secrets were
sealed under the master key, which is why the envelope holds it. Sessions and invites are in the
dump too. Mail connections come back **enabled**; if the old box might still be running, disable
them in Settings → Email first so two vaults do not read the same mailbox.

## 5. Prove it

1. Open a document from before the loss and read a page of it.
2. Search for a word that appears only inside a scan.
3. Settings → Backups → **Test a restore**. It should pass against the same repository.
4. Settings → Backups → **Back up now**, so the first snapshot from the new box exists tonight.

## What the backup does not contain

- **The master key and the repository password.** By design; that is what the envelope is for.
- **Redis.** Queues only. Anything that was mid-OCR at the moment of loss shows as *queued* or
  *failed* in the Inbox; open it and re-upload the file.
- **The live Postgres directory.** Inconsistent while the server runs; the nightly dump is the
  database. You lose at most the day since the last dump.
- **`/data/tmp`.** Scratch.

## Only the database is gone

Disk is fine, Postgres is not (a bad upgrade, a wrong `rm`):

```sh
dc stop api web worker mailfetch suggester backup
dc exec postgres psql -U harbor -c 'DROP DATABASE harbor' -c 'CREATE DATABASE harbor' postgres
dc run --rm backup pg_restore --no-owner --exit-on-error \
  --dbname=postgres://harbor:harbor@postgres:5432/harbor /data/dumps/harbor.dump
dc up -d
```

`/data/dumps/harbor.dump` is last night's; for an older one, `restic restore <id> --target / --include /data/dumps/harbor.dump` first.
