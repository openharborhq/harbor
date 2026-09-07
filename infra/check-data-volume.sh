#!/usr/bin/env sh
# Refuse to start the vault unless $TW_DATA_DIR is a separate, encrypted mount (spec §3.3).
# Postgres holds OCR plaintext, so "the blobs are encrypted" is not enough - the whole data
# directory has to sit on the LUKS volume. Run this before `docker compose up` on the appliance.
set -eu

DATA="${TW_DATA_DIR:?TW_DATA_DIR is not set}"

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
  if [ "${TW_ALLOW_UNENCRYPTED_DATA:-}" = "yes-i-understand" ]; then
    echo "check-data-volume: WARNING $DATA ($DEV) is not on a dm-crypt volume; continuing because TW_ALLOW_UNENCRYPTED_DATA is set" >&2
  else
    echo "check-data-volume: $DATA is on $DEV, which is not a LUKS/dm-crypt volume." >&2
    echo "  Either move the data directory onto the encrypted volume, or set TW_ALLOW_UNENCRYPTED_DATA=yes-i-understand (dev boxes only)." >&2
    exit 1
  fi
fi

for sub in blobs tmp postgres redis secrets; do
  mkdir -p "$DATA/$sub"
done
chmod 700 "$DATA/blobs" "$DATA/tmp" "$DATA/secrets"

if [ ! -s "$DATA/secrets/kek" ]; then
  echo "check-data-volume: no master key at $DATA/secrets/kek yet - the first api start will refuse to boot until \`setup:owner\` has run." >&2
fi

echo "check-data-volume: ok ($DATA on $DEV)"
