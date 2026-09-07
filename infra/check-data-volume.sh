#!/usr/bin/env sh
# Refuse to start the vault unless $HARBOR_DATA_DIR is a separate, encrypted mount (spec §3.3).
# Postgres holds OCR plaintext, so "the blobs are encrypted" is not enough - the whole data
# directory has to sit on the LUKS volume. Run this before `docker compose up` on the appliance.
set -eu

DATA="${HARBOR_DATA_DIR:?HARBOR_DATA_DIR is not set}"

if [ ! -d "$DATA" ]; then
  echo "check-data-volume: $DATA does not exist" >&2
  exit 1
fi

if ! mountpoint -q "$DATA"; then
  echo "check-data-volume: $DATA is not a mount point. Put it on its own LUKS volume (see docs/deploy.md)." >&2
  exit 1
fi

# Walk from the mount's block device to its parent and require a dm-crypt layer somewhere in between.
DEV="$(findmnt -n -o SOURCE --target "$DATA")"
if ! lsblk -n -o TYPE "$DEV" 2>/dev/null | grep -q "^crypt$" && \
   ! lsblk -n -s -o TYPE "$DEV" 2>/dev/null | grep -q "^crypt$"; then
  if [ "${HARBOR_ALLOW_UNENCRYPTED_DATA:-}" = "yes-i-understand" ]; then
    echo "check-data-volume: WARNING $DATA ($DEV) is not on a dm-crypt volume; continuing because HARBOR_ALLOW_UNENCRYPTED_DATA is set" >&2
  else
    echo "check-data-volume: $DATA is on $DEV, which is not a LUKS/dm-crypt volume." >&2
    echo "  Either move the data directory onto the encrypted volume, or set HARBOR_ALLOW_UNENCRYPTED_DATA=yes-i-understand (dev boxes only)." >&2
    exit 1
  fi
fi

for sub in blobs tmp dumps backup postgres redis secrets; do
  mkdir -p "$DATA/$sub"
done
chmod 700 "$DATA/blobs" "$DATA/tmp" "$DATA/dumps" "$DATA/secrets"
# The app containers run as uid 1000 (node) and the bind mounts keep host ownership: created by
# root, these directories would be unwritable inside the containers on Linux. (Docker Desktop on a
# Mac maps ownership away, which is why a dev machine never sees it.) Postgres and Redis manage
# their own directories.
chown 1000:1000 "$DATA/blobs" "$DATA/tmp" "$DATA/dumps" "$DATA/backup"

# The master key (spec §3.3). Generated here so that `up` is the next step and the browser does
# the rest; it must be printed for the break-glass envelope before the box holds anything.
if [ ! -s "$DATA/secrets/kek" ]; then
  umask 077
  head -c 32 /dev/urandom | base64 > "$DATA/secrets/kek"
  echo "check-data-volume: created the master key at $DATA/secrets/kek - print it for the break-glass envelope (docs/deploy.md, step 8). Without it the documents cannot be read." >&2
fi

# The backup container mounts this as a secret and will not start without it (spec §3.4).
if [ ! -s "$DATA/secrets/restic-password" ]; then
  umask 077
  head -c 32 /dev/urandom | base64 > "$DATA/secrets/restic-password"
  echo "check-data-volume: created the backup repository password at $DATA/secrets/restic-password - it goes in the break-glass envelope with the master key." >&2
fi

echo "check-data-volume: ok ($DATA on $DEV)"
